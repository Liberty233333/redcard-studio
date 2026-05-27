import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { beforeEach } from 'node:test';

import {
  __resetPromptSnapshotMemoryForTests,
  captureSnapshot,
  deleteSnapshotsOlderThan,
  getSnapshot,
  listSnapshots,
} from './promptSnapshot.ts';

beforeEach(() => {
  process.env.SNAPSHOT_PERSIST_DIR = mkdtempSync(join(tmpdir(), 'redcard-snapshots-'));
  __resetPromptSnapshotMemoryForTests();
});

function sample(overrides = {}) {
  return {
    projectId: 'p1',
    step: 'article' as const,
    agent: 'testAgent',
    fullMessages: [{ role: 'user', content: 'hello sk-' + 'A'.repeat(48) }],
    systemPrompt: '',
    modelConfig: { provider: 'test', model: 'mock', temperature: 0.2, maxTokens: 100 },
    response: { raw: { ok: true }, extractedText: 'done' },
    metadata: {},
    durationMs: 12,
    ...overrides,
  };
}

test('captures and retrieves a redacted snapshot', async () => {
  await captureSnapshot(sample());
  const items = await listSnapshots();
  assert.equal(items.length, 1);
  assert.equal(items[0].fullMessages[0].content, 'hello [REDACTED:openai-key]');
  const found = await getSnapshot(items[0].id);
  assert.equal(found?.response.extractedText, 'done');
});

test('does not capture snapshots when V2_1_ENABLED is false', async () => {
  globalThis.__RED_CARD_V2_1_ENABLED__ = false;
  try {
    await captureSnapshot(sample());
    assert.equal((await listSnapshots()).length, 0);
  } finally {
    globalThis.__RED_CARD_V2_1_ENABLED__ = undefined;
  }
});

test('lists with filters and before cursor', async () => {
  await captureSnapshot(sample({ projectId: 'p1', step: 'article', response: { raw: {}, extractedText: 'a' } }));
  await new Promise((resolve) => setTimeout(resolve, 2));
  await captureSnapshot(sample({ projectId: 'p2', step: 'cards', response: { raw: {}, extractedText: 'b' } }));
  const p1 = await listSnapshots({ projectId: 'p1' });
  const cards = await listSnapshots({ step: 'cards' });
  const limited = await listSnapshots({ limit: 1 });
  const before = await listSnapshots({ before: limited[0].createdAt });
  assert.equal(p1.length, 1);
  assert.equal(cards.length, 1);
  assert.equal(limited.length, 1);
  assert.equal(before.length, 1);
});

test('deletes snapshots older than a date', async () => {
  await captureSnapshot(sample());
  await new Promise((resolve) => setTimeout(resolve, 2));
  const deleted = await deleteSnapshotsOlderThan(new Date());
  assert.equal(deleted, 1);
  assert.equal((await listSnapshots()).length, 0);
});

test('persists snapshots to disk in Node runtime', async () => {
  await captureSnapshot(sample({ projectId: 'disk-p1' }));
  const dayDirs = readdirSync(process.env.SNAPSHOT_PERSIST_DIR!, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  assert.equal(dayDirs.length, 1);
  const files = readdirSync(join(process.env.SNAPSHOT_PERSIST_DIR!, dayDirs[0].name)).filter((name) => name.endsWith('.json'));
  assert.equal(files.length, 1);
  const persisted = JSON.parse(readFileSync(join(process.env.SNAPSHOT_PERSIST_DIR!, dayDirs[0].name, files[0]), 'utf8'));
  assert.equal(persisted.projectId, 'disk-p1');
  assert.equal(persisted.fullMessages[0].content, 'hello [REDACTED:openai-key]');
  assert.equal((await getSnapshot(persisted.id))?.projectId, 'disk-p1');
});
