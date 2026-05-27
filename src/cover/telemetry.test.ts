import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { afterEach } from 'node:test';

import { buildCoverTelemetry, estimateImageCostUsd, persistCoverTelemetry } from './telemetry.ts';

afterEach(() => {
  delete process.env.COVER_TELEMETRY_PATH;
});

test('estimates OpenAI gpt-image-1 cost for a high-quality 3:4 cover', () => {
  assert.equal(estimateImageCostUsd({
    model: 'gpt-image-1',
    size: '1024x1536',
    quality: 'high',
  }), 0.25);
});

test('builds cover telemetry with visual self-checks', () => {
  const entry = buildCoverTelemetry({
    projectId: 'project-1',
    startedAt: performance.now(),
    provider: {
      provider: 'openai_responses',
      apiKey: '',
      relayUrl: '',
      model: 'gpt-image-1',
      size: '1024x1536',
      quality: 'high',
    },
    selectedPalette: {
      family: 'red',
      bgMode: 'dark',
    },
    styleReferenceImageCount: 2,
    sourceImageCount: 1,
    hasAvatar: true,
    prompt: '本次封面使用 palette：red\n五条铁律：1. 大字',
  });

  assert.equal(entry.projectId, 'project-1');
  assert.equal(entry.output.normalizedSize, '1080x1440');
  assert.equal(entry.estimatedCostUsd, 0.25);
  assert.equal(entry.visualSelfCheck.every((check) => check.status === 'pass'), true);
});

test('persists cover telemetry as JSONL in Node runtime', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'redcard-cover-telemetry-'));
  process.env.COVER_TELEMETRY_PATH = join(dir, 'telemetry.jsonl');
  const entry = buildCoverTelemetry({
    projectId: 'disk-project',
    startedAt: performance.now(),
    provider: {
      provider: 'openai_responses',
      apiKey: '',
      relayUrl: '',
      model: 'gpt-image-1',
      size: '1024x1536',
      quality: 'high',
    },
    selectedPalette: {
      family: 'auto',
      bgMode: 'auto',
    },
    styleReferenceImageCount: 1,
    sourceImageCount: 0,
    hasAvatar: false,
    prompt: '本次封面使用 palette：auto\n五条铁律：1. 大字',
  });

  await persistCoverTelemetry(entry);
  const lines = readFileSync(process.env.COVER_TELEMETRY_PATH, 'utf8').trim().split('\n');
  const persisted = JSON.parse(lines[0]);
  assert.equal(lines.length, 1);
  assert.equal(persisted.projectId, 'disk-project');
  assert.equal(persisted.promptLength, entry.promptLength);
});
