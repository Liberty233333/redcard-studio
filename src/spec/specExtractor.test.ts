import assert from 'node:assert/strict';
import test from 'node:test';

import { extractSpec } from './specExtractor.ts';
import type { TextProviderConfig } from '../types.ts';

const provider: TextProviderConfig = {
  provider: 'claude_relay',
  apiKey: '',
  relayUrl: 'mock://spec',
  model: 'mock-spec',
};

test('extractSpec returns a valid ContentSpec shape', async () => {
  const spec = await extractSpec(
    '我发现很多人想要自动化，其实是在逃离混乱。流程没定义清楚，自动化只会把混乱跑得更快。先写 SOP 会逼你说清楚输入、判断和输出。',
    {
      textProvider: provider,
      getPromptTemplate: () => ({
        key: 'spec-extractor',
        content: 'Return strict JSON matching the ContentSpec schema.',
      }),
      getStyleProfile: () => ({
        key: 'account-voice',
        content: '账号语气：先给判断，再用真实工作现场解释。',
      }),
      searchCases: () => [
        {
          id: 'case-1',
          sourceMaterial: '工具不是主角，任务才是主角。',
          finalArticle: '先看一个真实任务，再讲工具怎么接住它。',
          tags: { contentType: 'AI工作流', performedWellOn: '小红书' },
        },
      ],
      callTextProvider: async () => JSON.stringify({
        thesis: '自动化不能替代流程定义，只会放大原来的混乱。',
        mustKeepFacts: [
          '很多人想要自动化，其实是在逃离混乱',
          '流程没定义清楚时，自动化会让混乱跑得更快',
          '先写 SOP 会逼你说清楚输入、判断和输出',
        ],
        mustAvoid: ['不要编造具体工具或 API 步骤'],
        targetReader: '正在尝试用 AI Agent 做自动化的人',
        voiceAnchors: ['先给判断，再落到真实工作现场', '每页独立成立'],
        platformConventions: ['第一张图前置强判断', '每页只讲一个小判断'],
        staleInsights: ['自动化等于省时间'],
        structureHint: '判断开场，然后解释 SOP 为什么是自动化前置条件',
        hookAngle: '从“自动化不是解药，是放大器”切入',
      }),
    }
  );

  assert.equal(typeof spec.thesis, 'string');
  assert.ok(spec.thesis.length > 0);
  assert.ok(spec.mustKeepFacts.length > 0);
  assert.ok(spec.targetReader.length > 0);
  assert.ok(spec.voiceAnchors.length > 0);
  assert.ok(spec.platformConventions.length > 0);
  assert.ok(Array.isArray(spec.staleInsights));
});

test('extractSpec repairs unescaped quotes inside JSON string values', async () => {
  const spec = await extractSpec('我以为我想要自动化，其实我想要的是不再混乱。', {
    textProvider: provider,
    getPromptTemplate: () => ({ key: 'spec-extractor', content: 'Return strict JSON.' }),
    getStyleProfile: () => ({ key: 'account-voice', content: '' }),
    searchCases: () => [],
    callTextProvider: async () => `{
  "thesis": "自动化不能替代流程定义。",
  "mustKeepFacts": [
    "用户以为自己想要自动化，其实想要的是不再混乱"
  ],
  "mustAvoid": [],
  "targetReader": "AI 自动化实践者",
  "voiceAnchors": ["先给判断"],
  "platformConventions": ["第一张图前置强判断"],
  "staleInsights": [],
  "hookAngle": "从"你以为你想要自动化，其实你想要的是不再混乱"切入"
}`,
  });

  assert.match(spec.hookAngle || '', /你以为你想要自动化/);
});
