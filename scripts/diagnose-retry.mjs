// Diagnostic utility: manually reproduces one longform retry chain for lint calibration.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

if (!process.execArgv.includes('--experimental-transform-types')) {
  const result = spawnSync(
    process.execPath,
    ['--experimental-transform-types', ...process.argv.slice(1)],
    { stdio: 'inherit', env: process.env }
  );
  process.exit(result.status ?? 1);
}

const root = resolve(import.meta.dirname, '..');
execFileSync(process.execPath, [resolve(root, 'scripts/compile-knowledge-base.mjs')], { stdio: 'inherit' });
execFileSync(process.execPath, [resolve(root, 'scripts/compile-patterns.mjs')], { stdio: 'inherit' });
execFileSync(process.execPath, [resolve(root, 'scripts/compile-exemplars.mjs')], { stdio: 'inherit' });
execFileSync(process.execPath, [resolve(root, 'scripts/compile-longform-skill.mjs')], { stdio: 'inherit' });

const { buildArticleDraftPrompt } = await import('../src/llm/prompts.ts');
const { lintLongform } = await import('../src/validators/longformLint.ts');

const materialsPath = resolve(root, 'docs/verification/materials.md');
const outputPath = resolve(root, 'docs/exec-plans/active/v2.1-retry-diagnosis.md');
const provider = loadTextProviderConfig();
const material = parseMaterials(readFileSync(materialsPath, 'utf8')).find((item) => item.index === 1);
if (!material) throw new Error('Material 1 not found in docs/verification/materials.md');

const originalPayload = normalizeTextPrompt(buildArticleDraftPrompt({
  rawInput: material.body,
  instruction: '这是 v2.1 retry 校准诊断，请严格按 RedCard 长文规则输出。',
}));

const records = [];
let attempts = 1;
let lastPromptPayload = originalPayload;
let currentPayload = originalPayload;

while (attempts <= 3) {
  const inputType = attempts === 1 ? '初次' : 'fix';
  const started = performance.now();
  const responseText = await callTextProviderOnce(provider, currentPayload, {
    temperature: Number(process.env.REDCARD_VERIFY_TEMPERATURE || 0.7),
    maxTokens: Number(process.env.REDCARD_VERIFY_MAX_TOKENS || 4096),
  });
  const durationMs = Math.round(performance.now() - started);
  const lint = lintLongform(responseText);
  records.push({
    attempt: attempts,
    inputType,
    inputLastUser: getLastUserMessage(currentPayload),
    responseText,
    durationMs,
    violations: lint.violations,
  });

  console.log(`[${attempts}/3] ${lint.passed ? 'PASS' : 'FAIL'} violations=${lint.violations.length} duration=${durationMs}ms`);
  if (lint.passed || attempts >= 3) break;

  attempts += 1;
  currentPayload = normalizeTextPrompt(buildLongformFixPayload({
    originalPayload,
    previousPromptPayload: lastPromptPayload,
    previousText: responseText,
    fixPromptForModel: lint.fixPromptForModel,
    violations: lint.violations,
    includeSelfReview: attempts === 3,
  }));
  lastPromptPayload = currentPayload;
}

writeFileSync(outputPath, buildReport({ material, records, provider }));
console.log(`Wrote retry diagnosis: ${outputPath}`);

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
  const cfg = {
    provider: process.env.REDCARD_TEXT_PROVIDER || 'claude_relay',
    apiKey: process.env.REDCARD_TEXT_API_KEY || '',
    relayUrl: process.env.REDCARD_TEXT_RELAY_URL || '',
    model: process.env.REDCARD_TEXT_MODEL || 'claude-sonnet-4-6',
  };
  if (cfg.provider === 'claude_direct' && !cfg.apiKey) {
    throw new Error('Missing REDCARD_TEXT_API_KEY for claude_direct diagnosis run.');
  }
  if (cfg.provider === 'claude_relay' && !cfg.relayUrl) {
    throw new Error('Missing REDCARD_TEXT_RELAY_URL for claude_relay diagnosis run.');
  }
  if (cfg.provider === 'openai_compatible' && !cfg.relayUrl && !cfg.apiKey) {
    throw new Error('Missing REDCARD_TEXT_RELAY_URL or REDCARD_TEXT_API_KEY for openai_compatible diagnosis run.');
  }
  return cfg;
}

function normalizeTextPrompt(input) {
  if (typeof input === 'string') {
    return { prompt: input, messages: [{ role: 'user', content: input }], metadata: {} };
  }
  return {
    prompt: input.prompt,
    messages: input.messages?.length ? input.messages : [{ role: 'user', content: input.prompt }],
    metadata: input.metadata || {},
  };
}

function getLastUserMessage(payload) {
  return [...payload.messages].reverse().find((message) => message.role === 'user')?.content || '';
}

function buildLongformFixPayload(input) {
  const prompt = buildLongformFixPrompt({
    originalPrompt: input.originalPayload.prompt,
    previousPrompt: input.previousPromptPayload.prompt,
    previousText: input.previousText,
    fixPromptForModel: input.fixPromptForModel,
    violations: input.violations,
    includeSelfReview: input.includeSelfReview,
  });
  return {
    prompt,
    messages: input.originalPayload.messages.length
      ? [...input.originalPayload.messages.slice(0, -1), { role: 'user', content: prompt }]
      : [{ role: 'user', content: prompt }],
    metadata: input.originalPayload.metadata,
  };
}

function buildLongformFixPrompt(input) {
  const selfReview = input.includeSelfReview
    ? `
【上一轮失败请求快照】
${input.previousPrompt}

【上一轮违规列表】
${JSON.stringify(input.violations, null, 2)}

请先在心里确认你已经理解这些违规点，再重写。最终输出只给重写后的完整长文，不要输出确认过程。`
    : '';

  return `${input.originalPrompt}

【上一次生成结果】
${input.previousText}

【必须修复的问题】
${input.fixPromptForModel}
${selfReview}

请基于原始素材和本次修复要求，重新输出完整长文。不要解释，不要输出修改说明。`;
}

async function callTextProviderOnce(cfg, payload, opts) {
  if (cfg.provider === 'claude_direct' || cfg.provider === 'claude_relay') {
    return callClaudeLike(cfg, payload, opts);
  }
  return callOpenAICompatible(cfg, payload, opts);
}

async function callClaudeLike(cfg, payload, opts) {
  const url = cfg.provider === 'claude_direct'
    ? 'https://api.anthropic.com/v1/messages'
    : normalizeRelayUrl(cfg.relayUrl);
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.provider === 'claude_direct') {
    headers['x-api-key'] = cfg.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  } else if (cfg.apiKey) {
    headers.Authorization = `Bearer ${cfg.apiKey}`;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
      messages: payload.messages,
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}\n${raw.slice(0, 500)}`);
  const data = JSON.parse(raw);
  if (Array.isArray(data?.content)) {
    return data.content.filter((block) => block?.type === 'text').map((block) => block.text).join('');
  }
  if (data?.choices?.[0]?.message?.content) return String(data.choices[0].message.content);
  if (data?.error?.message) throw new Error(`API error: ${data.error.message}`);
  throw new Error(`Unable to parse LLM response: ${raw.slice(0, 500)}`);
}

async function callOpenAICompatible(cfg, payload, opts) {
  const url = normalizeOpenAIChatUrl(cfg.relayUrl);
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: cfg.model,
      messages: payload.messages,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}\n${raw.slice(0, 500)}`);
  const data = JSON.parse(raw);
  return data?.choices?.[0]?.message?.content || data?.content?.[0]?.text || raw;
}

function normalizeRelayUrl(input) {
  const u = input.trim().replace(/\/+$/, '');
  if (!u) throw new Error('Missing Claude relay URL.');
  if (/\/v1\/messages$/.test(u)) return u;
  if (/\/v1$/.test(u)) return `${u}/messages`;
  return `${u}/v1/messages`;
}

function normalizeOpenAIChatUrl(input) {
  const u = input.trim().replace(/\/+$/, '');
  if (!u) return 'https://api.openai.com/v1/chat/completions';
  if (/\/v1\/chat\/completions$/.test(u)) return u;
  if (/\/v1$/.test(u)) return `${u}/chat/completions`;
  return `${u}/v1/chat/completions`;
}

function buildReport({ material, records, provider }) {
  const rows = records.map((record) => `| ${record.attempt} | ${record.inputType} | ${escapeTable(truncate(record.responseText, 200))} | ${escapeTable(formatViolations(record.violations))} | ${record.violations.length} | ${record.durationMs} ms |`).join('\n');
  const details = records.map((record) => `## Call ${record.attempt} · ${record.inputType}

### Input Last User Message

\`\`\`text
${record.inputLastUser}
\`\`\`

### Response Extracted Text

\`\`\`text
${record.responseText}
\`\`\`

### Violations

${record.violations.length ? record.violations.map((violation) => `- category: \`${violation.category}\`; pattern: \`${violation.pattern}\`; excerpt: ${violation.location.excerpt}`).join('\n') : '- None'}
`).join('\n');

  return `# v2.1 Retry Diagnosis

Generated at: \`${new Date().toISOString()}\`

Material: \`${material.title}\`

Provider: \`${provider.provider}\`

Model: \`${provider.model}\`

## Comparison Table

| 调用序号 | 输入类型 | 输出前 200 字 | 命中 pattern 详表 | violation 总数 | 耗时 |
| ---: | --- | --- | --- | ---: | ---: |
${rows}

## Material 1 Source

\`\`\`text
${material.body}
\`\`\`

${details}
`;
}

function formatViolations(violations) {
  if (!violations.length) return 'None';
  return violations.map((violation) => `${violation.category} / ${violation.pattern} / ${violation.location.excerpt}`).join('<br>');
}

function truncate(text, limit) {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length > limit ? `${singleLine.slice(0, limit)}...` : singleLine;
}

function escapeTable(text) {
  return text.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}
