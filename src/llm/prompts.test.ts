import assert from 'node:assert/strict';
import test from 'node:test';

import { buildArticleDraftPrompt, buildCoverPrompt, inferPalette, selectAnchors } from './prompts.ts';

test('buildArticleDraftPrompt includes full Content SPEC in system and user prompt', () => {
  const payload = buildArticleDraftPrompt({
    rawInput: '原始素材',
    contentSpec: {
      thesis: '核心判断要先行。',
      mustKeepFacts: ['必须保留核心案例'],
      mustAvoid: ['不要写评论区告诉我'],
      targetReader: 'AI 图文创作者',
      voiceAnchors: ['第一张图前置金句'],
      platformConventions: ['每页独立成立'],
      staleInsights: ['AI 提效万能论'],
      structureHint: '判断到案例再到行动',
      hookAngle: '从工具写不准切入',
    },
  });

  assert.match(payload.messages[0].content, /核心判断要先行/);
  assert.match(payload.messages[0].content, /必须保留核心案例/);
  assert.match(payload.messages[0].content, /每页独立成立/);
  assert.match(payload.prompt, /AI 提效万能论/);
  assert.deepEqual(payload.metadata.contentSpec?.mustAvoid, ['不要写评论区告诉我']);
});

test('buildCoverPrompt resolves palette, anchors, source images, and Day 8 instructions', async () => {
  const result = await buildCoverPrompt({
    title: '某研究员的 7 条反共识',
    redAccent: '天道酬勤是最大谎言',
    visualInstruction: '人物保持访谈截图原姿态，不要生成演讲手势。',
    series: '#AI Learning',
    paletteFamily: 'auto',
    bgMode: 'auto',
    articleThesis: '某 AI 研究员分享对当前 AI 发展的反共识思考，覆盖 7 个核心观点',
    sourceImages: [
      { dataUrl: 'data:image/png;base64,mockA', role: 'person' },
      { dataUrl: 'data:image/png;base64,mockB', role: 'person' },
    ],
    hasAvatar: true,
  });

  assert.equal(result.selectedPalette.family, 'red');
  assert.ok(['light', 'dark'].includes(result.selectedPalette.bgMode));
  assert.equal(result.styleReferenceImages.length, 0);
  assert.equal(result.sourceImages.length, 2);
  assert.match(result.textPrompt, /Cover Voice Profile v1\.0/);
  assert.match(result.textPrompt, /五条铁律/);
  assert.match(result.textPrompt, /Cover Samples Index v1\.0/);
  assert.match(result.textPrompt, /palette[：:]/);
  assert.match(result.textPrompt, /(参考图|没有 anchor)/);
  assert.match(result.textPrompt, /约 72px 头像 \+ 22px 账号名/);
  assert.match(result.textPrompt, /人物保持访谈截图原姿态/);
  assert.match(result.textPrompt, /不要凭空生成演讲/);
  assert.match(result.textPrompt, /必须出现用户上传的人物本人/);
  assert.match(result.textPrompt, /风格语法/);
  assert.match(result.textPrompt, /避免模板化/);
  assert.match(result.textPrompt, /禁止明显 AI 感/);
  assert.match(result.textPrompt, /高级杂志感/);
  assert.match(result.textPrompt, /carousel 圆点/);
  assert.match(result.textPrompt, /底部长条/);
  assert.match(result.textPrompt, /系列名称：#AI Learning/);
  assert.match(result.textPrompt, /只能逐字使用这一段文字：「#AI Learning」/);
  assert.match(result.textPrompt, /如果这段文字本身包含开头的 #/);
  assert.match(result.textPrompt, /严禁生成任何其他话题标签、hashtag、关键词串、分类标签或自造系列名/);
  assert.match(result.textPrompt, /不要额外添加其他 # 标签/);
});

test('inferPalette follows Day 8 deterministic defaults and selectAnchors returns data URLs', async () => {
  assert.deepEqual(inferPalette({
    title: '某研究员的 7 条反共识',
    series: 'AI Learning',
    paletteFamily: 'auto',
    bgMode: 'auto',
    articleThesis: '人物访谈，反共识观点',
  }), { family: 'red', bgMode: 'dark' });

  const anchors = await selectAnchors('red', 'light', 2);
  assert.equal(anchors.length, 2);
  assert.match(anchors[0], /^data:image\/png;base64,/);
});

test('buildCoverPrompt honors manual Phase 6 cover controls', async () => {
  const result = await buildCoverPrompt({
    title: 'GitHub 项目的增长飞轮',
    redAccent: '开源就是渠道',
    series: '工具实测',
    paletteFamily: 'blue',
    bgMode: 'dark',
    sourceImages: [
      { dataUrl: 'data:image/png;base64,screenA', role: 'screenshot', name: 'repo-dashboard.png' },
    ],
  });

  assert.deepEqual(result.selectedPalette, { family: 'blue', bgMode: 'dark' });
  assert.equal(result.sourceImages.length, 1);
  assert.match(result.textPrompt, /开源就是渠道/);
  assert.match(result.textPrompt, /palette=blue \/ bg=dark/);
  assert.match(result.textPrompt, /repo-dashboard\.png role=screenshot/);
  assert.match(result.textPrompt, /#0F172A/);
});
