import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';

import { generateLongformWithLint } from '../llm/client.ts';
import { lintLongform, type ViolationCategory } from './longformLint.ts';

const cases: Array<{ category: ViolationCategory; pattern: string; text: string }> = [
  { category: 'syntax', pattern: '——', text: '这个判断很关键——它改变了后面的选择。' },
  { category: 'syntax', pattern: '(?<!-)--(?!-)', text: '这个判断很关键--它改变了后面的选择。' },
  { category: 'syntax', pattern: '---+', text: '第一段结束。\n\n---\n\n第二段开始。' },
  { category: 'phrase', pattern: '总而言之', text: '这件事说到底要回到行动。总而言之，先做一版。' },
  { category: 'phrase', pattern: '综上所述', text: '这件事说到底要回到行动。综上所述，先做一版。' },
  { category: 'phrase', pattern: '在某种意义上', text: '在某种意义上，这个选择像一次复盘。' },
  { category: 'phrase', pattern: '众所周知', text: '这件事说到底要回到行动。众所周知，工具会变。' },
  { category: 'phrase', pattern: '不可否认', text: '不可否认，这次调整有帮助。' },
  { category: 'phrase', pattern: '值得一提的是', text: '值得一提的是，这一步最容易被忽略。' },
  { category: 'phrase', pattern: '不难看出', text: '不难看出，这个流程需要检查点。' },
  { category: 'phrase', pattern: '从某种程度上来说', text: '从某种程度上来说，稳定比灵感重要。' },
  { category: 'phrase', pattern: '在一定程度上', text: '在一定程度上，流程改变了结果。' },
  { category: 'empty-praise', pattern: '非常的', text: '这次体验非常的顺滑。' },
  { category: 'empty-praise', pattern: '极其', text: '这个判断极其关键。' },
  { category: 'empty-praise', pattern: '极为', text: '这个判断极为关键。' },
  { category: 'empty-praise', pattern: '堪称', text: '这个方法堪称万能。' },
  { category: 'empty-praise', pattern: '颇为', text: '这个方法颇为有效。' },
  { category: 'opening', pattern: '^在当今', text: '在当今内容很多的环境里，我们先看一个具体场景。' },
  { category: 'opening', pattern: '^随着.*?的发展', text: '随着 AI 工具的发展，很多人开始重新整理工作流。' },
  { category: 'opening', pattern: '^近年来', text: '近年来，很多人都在谈效率。' },
  { category: 'opening', pattern: '^在这个.*?的时代', text: '在这个人人都谈 AI 的时代，最难的是判断。' },
  { category: 'opening', pattern: '^众所周知', text: '众所周知，工具会变。' },
];

test('detects every configured pattern with category, location, and fix instruction', () => {
  for (const item of cases) {
    const result = lintLongform(item.text);
    const hit = result.violations.find((v) => v.category === item.category && v.pattern === item.pattern);
    assert.ok(hit, `missing ${item.category} ${item.pattern}`);
    assert.ok(hit.location.start >= 0);
    assert.ok(hit.location.end > hit.location.start);
    assert.ok(hit.location.excerpt.length > 0);
    assert.ok(hit.fixInstruction.length > 0);
  }
});

test('does not flag clean nearby wording', () => {
  const result = lintLongform('我今天先看一个具体场景。这个流程的价值在于，它把反馈留在系统里。');
  assert.equal(result.passed, true);
  assert.equal(result.violations.length, 0);
});

test('syntax span boundary is capped at 30 characters', () => {
  const within = lintLongform(Array.from({ length: 3 }, () => `不是${'好'.repeat(30)}而是`).join('。'));
  const outside = lintLongform(Array.from({ length: 3 }, () => `不是${'好'.repeat(35)}而是`).join('。'));
  assert.equal(within.passed, false);
  assert.equal(outside.passed, true);
});

test('不是而是 syntax can match across line breaks', () => {
  const result = lintLongform(Array.from({ length: 3 }, () => '问题不是工具不够好\n而是流程没有定义。').join('\n'));
  assert.equal(result.passed, false);
  assert.equal(result.violations[0].pattern, '不是.{1,30}而是');
  assert.equal(result.violations.length, 1);
  assert.match(result.fixPromptForModel, /A 不能解决问题，B 才是关键/);
});

test('contrast patterns are frequency-limited to two occurrences', () => {
  const once = lintLongform('你想要的不是自动化，是逃离混乱。');
  const twice = lintLongform('你想要的不是自动化，是逃离混乱。核心不是工具，是任务。');
  const three = lintLongform('你想要的不是自动化，是逃离混乱。核心不是工具，是任务。关键不是速度，是判断。');
  const five = lintLongform('你想要的不是自动化，是逃离混乱。核心不是工具，是任务。关键不是速度，是判断。结果不是运气，是系统。问题不是模型，是流程。');
  assert.equal(once.passed, true);
  assert.equal(twice.passed, true);
  assert.equal(three.violations.length, 1);
  assert.equal(three.violations[0].note, '已出现 3 次（上限 2 次）');
  assert.deepEqual(three.violations[0].occurrence, { count: 3, max: 2 });
  assert.equal(five.violations.length, 3);
});

test('contrast variant stays local and avoids unrelated clauses', () => {
  const hit = lintLongform('你想要的不是自动化，是逃离混乱。核心不是工具，是任务。关键不是速度，是判断。');
  const alternateHit = lintLongform('真正的问题不是自动化，逃离混乱才是。真正的问题不是工具，任务才是。真正的问题不是速度，判断才是。');
  const miss = lintLongform('不是每一次改动都要立刻发布。这个判断是为了降低风险。');
  assert.equal(hit.passed, false);
  assert.equal(hit.violations.some((v) => v.pattern === '不是[^，。？！\\n]{1,15}，是[^，。？！\\n]{1,15}'), true);
  assert.equal(alternateHit.violations.some((v) => v.pattern === '不是[^，。？！\\n]{1,15}，[^，。？！\\n]{1,15}是'), true);
  assert.equal(miss.passed, true);
});

test('markdown horizontal rule is reported once as its explicit pattern', () => {
  const result = lintLongform('第一段结束。\n\n---\n\n第二段开始。');
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].pattern, '---+');
  assert.match(result.fixPromptForModel, /Markdown horizontal rule/);
});

test('opening category only scans the first 50 trimmed characters', () => {
  const inside = lintLongform(`随着${'工'.repeat(40)}的发展，先看这个场景。`);
  const outside = lintLongform(`随着${'工'.repeat(51)}的发展，先看这个场景。`);
  assert.equal(inside.violations.some((v) => v.category === 'opening'), true);
  assert.equal(outside.violations.some((v) => v.category === 'opening'), false);
});

test('multiple categories are returned and grouped into one fix prompt', () => {
  const result = lintLongform('在当今信息很多的时候，不是选择太少而是判断太散。综上所述，这个方法极其重要。');
  assert.equal(result.passed, false);
  assert.equal(new Set(result.violations.map((v) => v.category)).size, 3);
  assert.match(result.fixPromptForModel, /长文里出现了以下问题/);
  assert.match(result.fixPromptForModel, /综上所述/);
  assert.match(result.fixPromptForModel, /极其/);
});

test('lintLongform handles 2000 characters under 50ms', () => {
  const input = '这是一个干净段落。'.repeat(125);
  const started = performance.now();
  lintLongform(input);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 50, `expected under 50ms, got ${elapsed}ms`);
});

test('content SPEC lint warns on missing mustKeepFacts keywords', () => {
  const result = lintLongform('这篇只讲自动化流程，没有提到具体工具。', {
    thesis: '要讲清楚工具和事实。',
    mustKeepFacts: ['某产品全球市占率第一'],
    mustAvoid: [],
    targetReader: 'AI 创作者',
    voiceAnchors: ['前置判断'],
    platformConventions: ['每页独立成立'],
    staleInsights: [],
  });
  assert.equal(result.passed, true);
  assert.equal(result.violations.length, 0);
  assert.equal(result.warnings[0].level, 'warn');
  assert.equal(result.warnings[0].category, 'spec-must-keep');
  assert.match(result.warnings[0].fixInstruction, /某产品全球市占率第一/);
});

test('content SPEC lint flags mustAvoid substring hits', () => {
  const result = lintLongform('评论区告诉我，你最近最想复盘哪个工作流。', {
    thesis: '避免模板 CTA。',
    mustKeepFacts: [],
    mustAvoid: ['评论区告诉我'],
    targetReader: '小红书创作者',
    voiceAnchors: ['每页独立成立'],
    platformConventions: ['第一张图前置钩子'],
    staleInsights: [],
  });
  assert.equal(result.passed, false);
  assert.equal(result.violations[0].level, 'violation');
  assert.equal(result.violations[0].category, 'spec-must-avoid');
  assert.match(result.fixPromptForModel, /评论区告诉我/);
});

test('generateLongformWithLint does not retry mustKeepFacts warnings', async () => {
  const calls: any[] = [];
  const result = await generateLongformWithLint(
    { provider: 'claude_relay', apiKey: '', relayUrl: '', model: 'mock' },
    {
      prompt: '你要把用户提供的混乱素材整理成一篇可发布的小红书认知干货长文。',
      metadata: {
        contentSpec: {
          thesis: '必须保留工具事实。',
          mustKeepFacts: ['某产品全球市占率第一'],
          mustAvoid: [],
          targetReader: 'AI 创作者',
          voiceAnchors: ['前置判断'],
          platformConventions: ['每页独立成立'],
          staleInsights: [],
        },
      },
    },
    {},
    async (prompt) => {
      calls.push(prompt);
      return '这篇只讲自动化流程，没有提到具体工具。';
    }
  );
  assert.equal(result.attempts, 1);
  assert.equal(calls.length, 1);
  assert.equal(result.violations.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].category, 'spec-must-keep');
});

test('generateLongformWithLint retries a violating model output', async () => {
  const outputs = [
    '在当今变化很快的时候，不是工具不行而是流程太散。综上所述，要行动。',
    '先看一个真实场景：同样的模型，放在不同流程里，结果会明显不同。',
  ];
  const result = await generateLongformWithLint(
    { provider: 'claude_relay', apiKey: '', relayUrl: '', model: 'mock' },
    '你要把用户提供的混乱素材整理成一篇可发布的小红书认知干货长文。',
    {},
    async () => outputs.shift() || ''
  );
  assert.equal(result.attempts, 2);
  assert.equal(result.violations.length, 0);
  assert.match(result.text, /真实场景/);
});

test('generateLongformWithLint preserves few-shot messages during retry', async () => {
  const outputs = [
    '在当今变化很快的时候，不是工具不行而是流程太散。综上所述，要行动。',
    '先看一个真实场景：同样的模型，放在不同流程里，结果会明显不同。',
  ];
  const calls: any[] = [];
  const result = await generateLongformWithLint(
    { provider: 'claude_relay', apiKey: '', relayUrl: '', model: 'mock' },
    {
      prompt: '你要把用户提供的混乱素材整理成一篇可发布的小红书认知干货长文。',
      messages: [
        { role: 'user', content: 'exemplar source 1' },
        { role: 'assistant', content: 'exemplar final 1' },
        { role: 'user', content: 'exemplar source 2' },
        { role: 'assistant', content: 'exemplar final 2' },
        { role: 'user', content: '你要把用户提供的混乱素材整理成一篇可发布的小红书认知干货长文。' },
      ],
      metadata: { injectedExemplarIds: ['a', 'b'] },
    },
    {},
    async (prompt) => {
      calls.push(prompt);
      return outputs.shift() || '';
    }
  );
  assert.equal(result.attempts, 2);
  assert.equal(calls[1].messages.length, 5);
  assert.equal(calls[1].messages[0].content, 'exemplar source 1');
  assert.equal(calls[1].messages[1].content, 'exemplar final 1');
  assert.equal(calls[1].messages[2].content, 'exemplar source 2');
  assert.equal(calls[1].messages[3].content, 'exemplar final 2');
  assert.match(calls[1].messages[4].content, /【上一次生成结果】/);
  assert.deepEqual(calls[1].metadata.injectedExemplarIds, ['a', 'b']);
});

test('generateLongformWithLint adds self-review context on the second retry', async () => {
  const outputs = [
    '在当今变化很快的时候，不是工具不行而是流程太散。综上所述，要行动。',
    '近年来，这个事情不是速度不够而是判断太散。',
    '先看一个真实场景：同样的模型，放在不同流程里，结果会明显不同。',
  ];
  const calls: any[] = [];
  const result = await generateLongformWithLint(
    { provider: 'claude_relay', apiKey: '', relayUrl: '', model: 'mock' },
    {
      prompt: '你要把用户提供的混乱素材整理成一篇可发布的小红书认知干货长文。',
      messages: [
        { role: 'user', content: 'exemplar source 1' },
        { role: 'assistant', content: 'exemplar final 1' },
        { role: 'user', content: '你要把用户提供的混乱素材整理成一篇可发布的小红书认知干货长文。' },
      ],
    },
    {},
    async (prompt) => {
      calls.push(prompt);
      return outputs.shift() || '';
    }
  );
  assert.equal(result.attempts, 3);
  assert.match(calls[2].messages.at(-1).content, /【上一轮失败请求快照】/);
  assert.match(calls[2].messages.at(-1).content, /【上一轮违规列表】/);
  assert.match(calls[2].messages.at(-1).content, /请先在心里确认/);
  assert.equal(calls[2].messages[0].content, 'exemplar source 1');
  assert.equal(calls[2].messages[1].content, 'exemplar final 1');
});

test('generateLongformWithLint bypasses lint when V2_1_ENABLED is false', async () => {
  globalThis.__RED_CARD_V2_1_ENABLED__ = false;
  try {
    const result = await generateLongformWithLint(
      { provider: 'claude_relay', apiKey: '', relayUrl: '', model: 'mock' },
      '你要把用户提供的混乱素材整理成一篇可发布的小红书认知干货长文。',
      {},
      async () => '在当今变化很快的时候，不是工具不行而是流程太散。'
    );
    assert.equal(result.attempts, 1);
    assert.equal(result.violations.length, 0);
  } finally {
    globalThis.__RED_CARD_V2_1_ENABLED__ = undefined;
  }
});
