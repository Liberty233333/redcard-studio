import assert from 'node:assert/strict';
import test from 'node:test';

import { injectFewShot, listExemplars, type Exemplar } from './fewShotInjector.ts';

// The public repo ships with an empty exemplar registry, so selection-logic
// tests provide their own fixtures via the `pool` seam.
const FIXTURES: Exemplar[] = [
  {
    id: 'ex_test0001',
    sourceMaterial: '原始素材 A',
    finalArticle: '这是范文 A 的正文内容。'.repeat(12),
    tags: { contentType: '人物访谈', performedWellOn: '' },
  },
  {
    id: 'ex_test0002',
    sourceMaterial: '原始素材 B',
    finalArticle: '这是范文 B 的正文内容。'.repeat(12),
    tags: { contentType: '工具实测', performedWellOn: '' },
  },
];

test('returns requested count when enough exemplars exist', () => {
  const result = injectFewShot({ count: 2, pool: FIXTURES });
  assert.equal(result.injectedExemplarIds.length, 2);
  assert.equal(result.messages.length, 4);
});

test('returns all available when fewer than requested', () => {
  const result = injectFewShot({ count: 99, pool: FIXTURES });
  assert.equal(result.injectedExemplarIds.length, FIXTURES.length);
});

test('returns empty when count is zero', () => {
  const result = injectFewShot({ count: 0, pool: FIXTURES });
  assert.equal(result.injectedExemplarIds.length, 0);
  assert.equal(result.messages.length, 0);
});

test('returns empty when V2_1_ENABLED is false', () => {
  globalThis.__RED_CARD_V2_1_ENABLED__ = false;
  try {
    const result = injectFewShot({ count: 2, pool: FIXTURES });
    assert.equal(result.injectedExemplarIds.length, 0);
    assert.equal(result.messages.length, 0);
  } finally {
    globalThis.__RED_CARD_V2_1_ENABLED__ = undefined;
  }
});

test('contentTypeHint prefers matching exemplars', () => {
  const exemplar = FIXTURES[0];
  const result = injectFewShot({ count: 1, contentTypeHint: exemplar.tags.contentType, pool: FIXTURES });
  assert.deepEqual(result.injectedExemplarIds, [exemplar.id]);
});

test('contentTypeHint fallback returns from unfiltered pool', () => {
  const result = injectFewShot({ count: 2, contentTypeHint: '不存在的类型', pool: FIXTURES });
  assert.equal(result.injectedExemplarIds.length, 2);
});

test('empty registry degrades to zero-shot', () => {
  const result = injectFewShot({ count: 2 });
  assert.equal(result.injectedExemplarIds.length, listExemplars().length);
});

test('stable ids are unique and well-formed', () => {
  const ids = FIXTURES.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => /^ex_[a-z0-9]{8}$/.test(id)));
});

test('messages are user/assistant pairs', () => {
  const result = injectFewShot({ count: 1, pool: FIXTURES });
  assert.equal(result.messages[0].role, 'user');
  assert.match(result.messages[0].content, /以下是一段原始素材/);
  assert.equal(result.messages[1].role, 'assistant');
  assert.ok(result.messages[1].content.length > 100);
});
