// Diagnostic utility: samples first-pass outputs to find dominant retry-causing patterns.
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
const outputPath = resolve(root, 'docs/exec-plans/active/v2.1-sniff-results.md');
const provider = loadTextProviderConfig();
const materials = parseMaterials(readFileSync(materialsPath, 'utf8'));

if (!materials.length) {
  throw new Error(`No materials found in ${materialsPath}. Use headings like "## Material 1".`);
}

const rows = [];
const patternStats = new Map();

for (const material of materials) {
  const payload = normalizeTextPrompt(buildArticleDraftPrompt({
    rawInput: material.body,
    instruction: '这是 v2.1 first-pass retry sniff，请按 RedCard 长文规则输出。本轮只诊断首轮输出，不会自动修复。',
  }));
  const started = performance.now();
  const responseText = await callTextProviderOnce(provider, payload, {
    temperature: Number(process.env.REDCARD_VERIFY_TEMPERATURE || 0.7),
    maxTokens: Number(process.env.REDCARD_VERIFY_MAX_TOKENS || 4096),
  });
  const durationMs = Math.round(performance.now() - started);
  const lint = lintLongform(responseText);
  rows.push({ material, responseText, durationMs, violations: lint.violations });

  for (const violation of lint.violations) {
    const key = `${violation.category}::${violation.pattern}`;
    const stat = patternStats.get(key) || {
      category: violation.category,
      pattern: violation.pattern,
      count: 0,
      excerpts: [],
      materials: new Set(),
    };
    stat.count += 1;
    stat.materials.add(material.index);
    if (stat.excerpts.length < 2) {
      stat.excerpts.push({ materialIndex: material.index, excerpt: violation.location.excerpt });
    }
    patternStats.set(key, stat);
  }

  console.log(`[${material.index}/${materials.length}] first-pass violations=${lint.violations.length} duration=${durationMs}ms`);
}

writeFileSync(outputPath, buildReport({ rows, patternStats, provider }));
console.log(`Wrote retry sniff report: ${outputPath}`);

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
    throw new Error('Missing REDCARD_TEXT_API_KEY for claude_direct sniff run.');
  }
  if (cfg.provider === 'claude_relay' && !cfg.relayUrl) {
    throw new Error('Missing REDCARD_TEXT_RELAY_URL for claude_relay sniff run.');
  }
  if (cfg.provider === 'openai_compatible' && !cfg.relayUrl && !cfg.apiKey) {
    throw new Error('Missing REDCARD_TEXT_RELAY_URL or REDCARD_TEXT_API_KEY for openai_compatible sniff run.');
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

function buildReport({ rows, patternStats, provider }) {
  const totalViolations = rows.reduce((sum, row) => sum + row.violations.length, 0);
  const stats = [...patternStats.values()]
    .map((stat) => ({
      ...stat,
      materialList: [...stat.materials].sort((a, b) => a - b),
      percent: totalViolations ? stat.count / totalViolations : 0,
    }))
    .sort((a, b) => b.percent - a.percent || b.count - a.count || a.pattern.localeCompare(b.pattern));
  const dominant = stats.filter((stat) => stat.percent > 0.3);

  return `# v2.1 Retry Pattern Sniff

Generated at: \`${new Date().toISOString()}\`

Provider: \`${provider.provider}\`

Model: \`${provider.model}\`

Materials tested: ${rows.length}

First-pass violation total: ${totalViolations}

Dominant threshold: > 30% of all first-pass violations

## Pattern Distribution

| Rank | Category | Pattern | Hits | Share | Materials |
| ---: | --- | --- | ---: | ---: | --- |
${stats.length ? stats.map((stat, index) => `| ${index + 1} | ${stat.category} | \`${stat.pattern}\` | ${stat.count} | ${formatPercent(stat.percent)} | ${stat.materialList.join(', ')} |`).join('\n') : '| - | - | - | 0 | 0.0% | - |'}

## Dominant Patterns

${dominant.length ? dominant.map((stat) => `### ${stat.category} / \`${stat.pattern}\`

Hits: ${stat.count}

Share: ${formatPercent(stat.percent)}

Example excerpts:
${stat.excerpts.map((item) => `- Material ${item.materialIndex}: ${item.excerpt}`).join('\n')}
`).join('\n') : '- None. No pattern exceeded 30% of first-pass violations.'}

## Per-material First-pass Violations

| Material | Violation Count | Duration | Patterns |
| ---: | ---: | ---: | --- |
${rows.map((row) => `| ${row.material.index} | ${row.violations.length} | ${row.durationMs} ms | ${row.violations.map((violation) => `\`${violation.category}/${violation.pattern}\``).join('<br>') || 'None'} |`).join('\n')}

## Per-material Excerpts

${rows.map((row) => `### Material ${row.material.index}

${row.violations.length ? row.violations.map((violation) => `- \`${violation.category}/${violation.pattern}\`: ${violation.location.excerpt}`).join('\n') : '- None'}
`).join('\n')}
`;
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}
