import assert from 'node:assert/strict';
import test from 'node:test';

import type { ContentSpec } from '../spec/contentSpec.ts';
import {
  addSpecArrayItem,
  createSpecReviewActions,
  removeSpecArrayItem,
  SPEC_REVIEW_LABELS,
  updateSpecArrayItem,
  updateSpecTextField,
} from './specReviewModel.ts';

const SPEC: ContentSpec = {
  thesis: '先定义目标，再开始生成。',
  mustKeepFacts: ['Material 6', '完整 retry loop'],
  mustAvoid: ['不要跳过 SPEC'],
  targetReader: '需要稳定输出长文的人',
  voiceAnchors: ['锋利', '具体'],
  platformConventions: ['每页独立成立'],
  staleInsights: ['AI 提效万能论'],
  structureHint: '',
  hookAngle: '',
};

test('SpecReview labels cover every ContentSpec field', () => {
  assert.deepEqual(Object.keys(SPEC_REVIEW_LABELS).sort(), [
    'hookAngle',
    'mustAvoid',
    'mustKeepFacts',
    'platformConventions',
    'staleInsights',
    'structureHint',
    'targetReader',
    'thesis',
    'voiceAnchors',
  ]);
});

test('SpecReview text edits update draft state immutably', () => {
  const next = updateSpecTextField(SPEC, 'thesis', '新的核心判断');

  assert.equal(next.thesis, '新的核心判断');
  assert.equal(SPEC.thesis, '先定义目标，再开始生成。');
});

test('SpecReview array edits add, update, and remove rows', () => {
  const added = addSpecArrayItem(SPEC, 'mustKeepFacts');
  const updated = updateSpecArrayItem(added, 'mustKeepFacts', 2, '新增事实');
  const removed = removeSpecArrayItem(updated, 'mustKeepFacts', 0);

  assert.deepEqual(removed.mustKeepFacts, ['完整 retry loop', '新增事实']);
});

test('SpecReview button actions call regenerate with edited SPEC and back callbacks', async () => {
  const calls: string[] = [];
  const actions = createSpecReviewActions({
    getDraft: () => SPEC,
    onRegenerate: async (spec) => calls.push(`regenerate:${spec.thesis}`),
    onBack: () => calls.push('back'),
  });

  await actions.regenerate();
  actions.back();

  assert.deepEqual(calls, ['regenerate:先定义目标，再开始生成。', 'back']);
});
