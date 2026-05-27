import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import type { ContentSpec } from '../spec/contentSpec.ts';
import { __resetSpecStoreForTests, getSpec, saveSpec } from './specStore.ts';

const SPEC: ContentSpec = {
  thesis: '真正拖慢创作者的不是工具，而是没有先定义内容目标。',
  mustKeepFacts: ['先抽取 SPEC', '用户确认后再生成'],
  mustAvoid: ['自动跳过用户审阅'],
  targetReader: '正在用 AI 做小红书长文的创作者',
  voiceAnchors: ['直接', '方法论感'],
  platformConventions: ['第一张图前置金句'],
  staleInsights: ['AI 自动化万能论'],
  structureHint: '先讲问题，再给流程',
  hookAngle: '工具为什么写不准',
};

beforeEach(() => {
  __resetSpecStoreForTests();
});

test('getSpec returns null when a draft has no Content SPEC', async () => {
  assert.equal(await getSpec('missing-draft'), null);
});

test('saveSpec and getSpec persist a Content SPEC by draftId', async () => {
  await saveSpec('draft-1', SPEC);
  assert.deepEqual(await getSpec('draft-1'), SPEC);
});

test('saveSpec keeps specs isolated by draftId', async () => {
  await saveSpec('draft-1', SPEC);
  await saveSpec('draft-2', { ...SPEC, thesis: '第二篇的判断' });

  assert.equal((await getSpec('draft-1'))?.thesis, SPEC.thesis);
  assert.equal((await getSpec('draft-2'))?.thesis, '第二篇的判断');
});
