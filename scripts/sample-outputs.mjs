// Diagnostic utility: generates representative longform samples for subjective review.
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

const { generateLongformWithLint } = await import('../src/llm/client.ts');
const { buildArticleDraftPrompt } = await import('../src/llm/prompts.ts');
const { extractSpec } = await import('../src/spec/specExtractor.ts');

const materialsPath = resolve(root, 'docs/verification/materials.md');
const outputPath = resolve(root, 'docs/exec-plans/active/v2.1-sample-outputs.md');
const provider = loadTextProviderConfig();
const wanted = new Set([6, 9, 11]);
const materials = parseMaterials(readFileSync(materialsPath, 'utf8')).filter((item) => wanted.has(item.index));

if (materials.length !== wanted.size) {
  throw new Error(`Expected Material 6, 9, and 11 in ${materialsPath}; found ${materials.map((m) => m.index).join(', ')}`);
}

const samples = [];

for (const material of materials) {
  const contentSpec = await extractSpec(material.body, { textProvider: provider });
  const prompt = buildArticleDraftPrompt({
    rawInput: material.body,
    instruction: '这是 v2.1 主观质量验证样本，请严格按 RedCard 长文规则输出。',
    contentSpec,
  });
  const started = performance.now();
  const result = await generateLongformWithLint(
    provider,
    prompt,
    {
      temperature: Number(process.env.REDCARD_VERIFY_TEMPERATURE || 0.7),
      maxTokens: Number(process.env.REDCARD_VERIFY_MAX_TOKENS || 4096),
      snapshot: {
        projectId: `sample-output-${String(material.index).padStart(2, '0')}-${Date.now().toString(36)}`,
        step: 'article',
        agent: 'sampleOutputsRunner',
        metadata: {
          materialIndex: material.index,
          materialTitle: material.title,
          samplePurpose: 'v2.1 subjective quality review',
          contentSpec,
        },
      },
    }
  );
  const durationMs = Math.round(performance.now() - started);
  samples.push({
    material,
    finalOutput: result.text,
    retryCount: Math.max(0, result.attempts - 1),
    attempts: result.attempts,
    durationMs,
    exemplarIds: prompt.metadata.injectedExemplarIds || [],
    contentSpec,
  });
  console.log(`[Material ${material.index}] retries=${Math.max(0, result.attempts - 1)} duration=${durationMs}ms`);
}

writeFileSync(outputPath, buildReport(samples));
console.log(`Wrote sample outputs: ${outputPath}`);

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
    throw new Error('Missing REDCARD_TEXT_API_KEY for claude_direct sample run.');
  }
  if (cfg.provider === 'claude_relay' && !cfg.relayUrl) {
    throw new Error('Missing REDCARD_TEXT_RELAY_URL for claude_relay sample run.');
  }
  if (cfg.provider === 'openai_compatible' && !cfg.relayUrl && !cfg.apiKey) {
    throw new Error('Missing REDCARD_TEXT_RELAY_URL or REDCARD_TEXT_API_KEY for openai_compatible sample run.');
  }
  return cfg;
}

function buildReport(samples) {
  return `# v2.1 Sample Outputs

Generated at: \`${new Date().toISOString()}\`

## Materials

${samples.map((sample) => `# Material ${sample.material.index}

## Raw Material

\`\`\`text
${sample.material.body}
\`\`\`

## Content SPEC

\`\`\`json
${JSON.stringify(sample.contentSpec, null, 2)}
\`\`\`

## Final Output

\`\`\`text
${sample.finalOutput}
\`\`\`

## Metadata

- Exemplar IDs: ${sample.exemplarIds.length ? sample.exemplarIds.map((id) => `\`${id}\``).join(', ') : 'none'}
- Retry count: ${sample.retryCount}
- Attempts: ${sample.attempts}
- Duration: ${sample.durationMs} ms
`).join('\n')}
`;
}
