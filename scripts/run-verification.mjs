import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { generateLongformWithLint } from '../src/llm/client.ts';
import { buildArticleDraftPrompt } from '../src/llm/prompts.ts';
import { extractSpec } from '../src/spec/specExtractor.ts';
import { captureSnapshot, listSnapshots } from '../src/utils/promptSnapshot.ts';
import { lintLongform } from '../src/validators/longformLint.ts';

const root = resolve(import.meta.dirname, '..');
const materialsPath = resolve(root, 'docs/verification/materials.md');
const resultsPath = resolve(root, 'docs/exec-plans/completed/v2.1-results.md');
const useMock = process.argv.includes('--mock') || process.env.REDCARD_VERIFY_MOCK === '1';

const materials = parseMaterials(readFileSync(materialsPath, 'utf8'));
if (!materials.length) {
  throw new Error(`No materials found in ${materialsPath}. Use headings like "## Material 1".`);
}

const textProvider = useMock ? mockProviderConfig() : loadTextProviderConfig();
const startedAt = new Date().toISOString();
const rows = [];

for (const material of materials) {
  const contentSpec = useMock ? mockSpec(material) : await extractSpec(material.body, { textProvider });
  const prompt = buildArticleDraftPrompt({
    rawInput: material.body,
    instruction: '这是 v2.1 批量验证，请严格按 RedCard 长文规则输出。',
    contentSpec,
  });
  const projectId = `verification-${String(material.index).padStart(2, '0')}-${Date.now().toString(36)}`;
  const started = performance.now();
  const result = await generateLongformWithLint(
    textProvider,
    prompt,
    {
      temperature: Number(process.env.REDCARD_VERIFY_TEMPERATURE || 0.7),
      maxTokens: Number(process.env.REDCARD_VERIFY_MAX_TOKENS || 4096),
      snapshot: {
        projectId,
        step: 'article',
        agent: useMock ? 'verificationRunnerMock' : 'verificationRunner',
        metadata: {
          materialIndex: material.index,
          materialTitle: material.title,
          verificationMode: useMock ? 'mock' : 'real',
          contentSpec,
        },
      },
    },
    useMock ? createMockGenerate(material) : undefined
  );
  const durationMs = Math.round(performance.now() - started);
  const finalLint = lintLongform(result.text, contentSpec);
  const snapshots = await listSnapshots({ projectId, limit: 10 });
  const latestSnapshot = snapshots[0] || null;
  const snapshotComplete = Boolean(
    latestSnapshot &&
    Array.isArray(latestSnapshot.fullMessages) &&
    latestSnapshot.fullMessages.length > 0 &&
    latestSnapshot.response &&
    latestSnapshot.response.raw !== undefined &&
    String(latestSnapshot.response.extractedText || '').length > 0
  );

  rows.push({
    material,
    projectId,
    attempts: result.attempts,
    retries: Math.max(0, result.attempts - 1),
    durationMs,
    passed: finalLint.passed,
    violations: finalLint.violations,
    snapshotComplete,
    snapshotId: latestSnapshot?.id || '',
    injectedExemplarIds: latestSnapshot?.metadata?.injectedExemplarIds || prompt.metadata.injectedExemplarIds || [],
    outputChars: result.text.length,
    warning: result.warning || '',
    contentSpec,
  });

  console.log(
    `[${material.index}/${materials.length}] ${finalLint.passed ? 'PASS' : 'FAIL'} retries=${Math.max(0, result.attempts - 1)} duration=${durationMs}ms snapshot=${snapshotComplete ? 'ok' : 'missing'}`
  );
}

writeFileSync(resultsPath, buildReport({ rows, startedAt, mode: useMock ? 'mock' : 'real' }));
console.log(`\nWrote verification report: ${resultsPath}`);

function parseMaterials(markdown) {
  const materials = [];
  const headingRegex = /^## Material\s+(\d+)([^\n]*)$/gm;
  const headings = [...markdown.matchAll(headingRegex)];
  for (let i = 0; i < headings.length; i += 1) {
    const current = headings[i];
    const next = headings[i + 1];
    const bodyStart = (current.index ?? 0) + current[0].length;
    const bodyEnd = next?.index ?? markdown.length;
    const body = markdown.slice(bodyStart, bodyEnd).trim();
    if (body) {
      materials.push({
        index: Number(current[1]),
        title: `Material ${current[1]}${current[2].trim() ? current[2].trim() : ''}`,
        body,
      });
    }
  }
  return materials;
}

function loadTextProviderConfig() {
  if (process.env.REDCARD_TEXT_PROVIDER_JSON) {
    return JSON.parse(process.env.REDCARD_TEXT_PROVIDER_JSON);
  }
  const provider = process.env.REDCARD_TEXT_PROVIDER || 'claude_relay';
  const cfg = {
    provider,
    apiKey: process.env.REDCARD_TEXT_API_KEY || '',
    relayUrl: process.env.REDCARD_TEXT_RELAY_URL || '',
    model: process.env.REDCARD_TEXT_MODEL || 'claude-sonnet-4-6',
  };
  if (cfg.provider === 'claude_direct' && !cfg.apiKey) {
    throw new Error('Missing REDCARD_TEXT_API_KEY for claude_direct verification run.');
  }
  if (cfg.provider === 'claude_relay' && !cfg.relayUrl) {
    throw new Error('Missing REDCARD_TEXT_RELAY_URL for claude_relay verification run.');
  }
  if (cfg.provider === 'openai_compatible' && !cfg.relayUrl && !cfg.apiKey) {
    throw new Error('Missing REDCARD_TEXT_RELAY_URL or REDCARD_TEXT_API_KEY for openai_compatible verification run.');
  }
  return cfg;
}

function mockProviderConfig() {
  return { provider: 'claude_relay', apiKey: '', relayUrl: 'mock://verification', model: 'mock-longform' };
}

function createMockGenerate(material) {
  let callCount = 0;
  return async (input, callOpts = {}) => {
    callCount += 1;
    const payload = normalizeInput(input);
    const shouldForceRetry = material.index % 4 === 0 && callCount === 1;
    const text = shouldForceRetry
      ? `重要的是，这条素材不是工具问题而是系统问题。\n\n这是 mock 第一次输出，故意触发 lint。`
      : `标题：把混乱变成可观察\n副标题：第 ${material.index} 条验证素材\n系列标签建议：AI工作流\n封面方向：真实笔记截图 + 大标题\n\n正文：\n这条素材真正有价值的地方，是它把一个日常现场拆成了可以复盘的动作。\n\n它没有急着把结论包装成万能方法，而是先保留了问题发生时的细节：任务是什么，卡点在哪里，最后靠什么判断往前走。\n\n**能被观察的问题，才有机会被稳定改进。**\n\n对创作者来说，这比多记一个技巧更重要。因为技巧只能解决一次表达，观察方式会改变后面每一次创作。\n\n如果你也在做自己的内容系统，可以先从一条真实素材开始：写清楚现场，再提炼判断，最后再决定它适合变成标题、长文还是封面。\n\n评论区告诉我，你最近最想复盘的是哪一个工作流。`;
    await captureSnapshot({
      projectId: callOpts.snapshot?.projectId || '',
      step: callOpts.snapshot?.step || 'article',
      agent: callOpts.snapshot?.agent || 'verificationRunnerMock',
      fullMessages: payload.messages,
      systemPrompt: callOpts.system || '',
      modelConfig: {
        provider: 'mock',
        model: 'mock-longform',
        temperature: callOpts.temperature,
        maxTokens: callOpts.maxTokens,
      },
      response: { raw: text, extractedText: text.slice(0, 500) },
      metadata: callOpts.snapshot?.metadata || {},
      durationMs: 1,
    });
    return text;
  };
}

function mockSpec(material) {
  return {
    thesis: `第 ${material.index} 条素材要保留真实现场，再提炼判断。`,
    mustKeepFacts: [],
    mustAvoid: ['评论区告诉我'],
    targetReader: '正在用 AI 做内容工作流的人',
    voiceAnchors: ['第一张图前置金句', '每页独立成立'],
    platformConventions: ['小红书图文第一张要有钩子', '每页只讲一个判断'],
    staleInsights: ['AI 工具万能论'],
    structureHint: '真实现场到判断再到行动',
    hookAngle: '从素材里的具体卡点切入',
  };
}

function normalizeInput(input) {
  if (typeof input === 'string') {
    return { prompt: input, messages: [{ role: 'user', content: input }] };
  }
  return {
    prompt: input.prompt,
    messages: input.messages?.length ? input.messages : [{ role: 'user', content: input.prompt }],
  };
}

function buildReport({ rows, startedAt, mode }) {
  const total = rows.length;
  const failed = rows.filter((row) => !row.passed).length;
  const totalFinalViolations = rows.reduce((sum, row) => sum + row.violations.length, 0);
  const hitRate = total ? failed / total : 0;
  const averageRetries = average(rows.map((row) => row.retries));
  const averageDuration = average(rows.map((row) => row.durationMs));
  const snapshotCompleteRate = total ? rows.filter((row) => row.snapshotComplete).length / total : 0;
  const patternHits = new Map();
  for (const row of rows) {
    for (const violation of row.violations) {
      patternHits.set(violation.pattern, (patternHits.get(violation.pattern) || 0) + 1);
    }
  }
  const sortedPatternHits = [...patternHits.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const modeWarning = mode === 'mock'
    ? '\n> Note: This report was generated in `--mock` mode for script plumbing only. It is not a project-level quality acceptance run.\n'
    : '';
  const observedIssues = [];
  if (failed) {
    observedIssues.push(...rows
      .filter((row) => !row.passed)
      .map((row) => `- Material ${row.material.index} still has ${row.violations.length} final lint violation(s): ${row.violations.map((v) => `${v.category}/${v.pattern}`).join(', ')}`));
  } else {
    observedIssues.push('- No final-output banned patterns were detected in this run.');
  }
  if (averageRetries >= 0.5) {
    observedIssues.push(`- Average retry count was ${averageRetries.toFixed(2)}, above the < 0.50 target. The lint gate is catching and repairing issues, but the first-pass prompt is still producing banned patterns too often.`);
  }
  if (snapshotCompleteRate < 1) {
    observedIssues.push('- One or more snapshots were missing or incomplete; inspect the per-material details above.');
  } else {
    observedIssues.push('- All generated calls had complete prompt snapshots.');
  }

  return `# v2.1 Results

## Summary

Verification started at: \`${startedAt}\`

Mode: \`${mode}\`
${modeWarning}
Materials tested: ${total}

Overall status: ${failed === 0 ? 'PASS for final lint status' : 'FAIL, final lint violations remain'}

## Statistics

| Metric | Value | Target |
| --- | ---: | ---: |
| Final banned-pattern hit rate | ${formatPercent(hitRate)} | 0% |
| Final banned-pattern violation count | ${totalFinalViolations} | 0 |
| Average retry count | ${averageRetries.toFixed(2)} | < 0.50 |
| Average time per generation | ${Math.round(averageDuration)} ms | Track |
| Snapshot completeness | ${formatPercent(snapshotCompleteRate)} | 100% |

## Banned Pattern Hits

${sortedPatternHits.length ? sortedPatternHits.map(([pattern, count]) => `- \`${pattern}\`: ${count}`).join('\n') : '- None in final outputs.'}

## Per-material Details

| # | Final lint | Retries | Duration | Snapshot | Output chars | Patterns |
| ---: | --- | ---: | ---: | --- | ---: | --- |
${rows.map((row) => `| ${row.material.index} | ${row.passed ? 'PASS' : 'FAIL'} | ${row.retries} | ${row.durationMs} ms | ${row.snapshotComplete ? 'OK' : 'MISSING'} | ${row.outputChars} | ${row.violations.map((v) => `\`${v.pattern}\``).join('<br>') || 'None'} |`).join('\n')}

## Snapshot Details

${rows.map((row) => `- Material ${row.material.index}: projectId=\`${row.projectId}\`, snapshotId=\`${row.snapshotId || 'n/a'}\`, exemplars=${formatArray(row.injectedExemplarIds)}, warning=${row.warning || 'none'}`).join('\n')}

## Observed Issues

${observedIssues.join('\n')}

## Recommendations For v2.2

- Compare high-retry materials against their injected exemplar ids to see whether certain source types need dedicated examples.
- Add a small in-app verification view if this script becomes part of regular release QA.
- Keep expanding \`docs/verification/materials.md\` with real voice notes, draft fragments, and Obsidian/Feishu raw notes; real messy inputs are more useful than polished samples.
`;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatArray(value) {
  return Array.isArray(value) && value.length ? value.map((item) => `\`${item}\``).join(', ') : 'none';
}
