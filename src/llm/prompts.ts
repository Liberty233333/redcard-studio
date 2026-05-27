import { injectFewShot } from './fewShotInjector.ts';
import { getPromptTemplate, getStyleProfile } from '../knowledge/knowledgeBase.ts';
import type { ContentSpec } from '../spec/contentSpec.ts';

export type PaletteFamily = 'red' | 'amber' | 'blue' | 'neon';
export type ResolvedBgMode = 'light' | 'dark';
export type CoverBgModeInput = ResolvedBgMode | 'auto';

export interface CoverSourceImage {
  dataUrl: string;
  role?: string;
  name?: string;
}

export interface CoverPromptInput {
  title: string;
  subtitle?: string;
  redAccent?: string;
  series: string;
  mode?: string;
  paletteFamily?: PaletteFamily | 'auto';
  bgMode?: CoverBgModeInput;
  accountName?: string;
  article?: string;
  articleThesis?: string;
  instruction?: string;
  visualInstruction?: string;
  sourceImages?: CoverSourceImage[];
  referenceNames?: string[];
  hasAvatar?: boolean;
  rules?: string;
}

export interface CoverPromptOutput {
  textPrompt: string;
  styleReferenceImages: string[];
  sourceImages: string[];
  selectedPalette: {
    family: PaletteFamily;
    bgMode: ResolvedBgMode;
  };
}

interface CoverSample {
  id: string;
  palette: string;
  path: string;
}

const PALETTE_TOKENS: Record<PaletteFamily, Record<ResolvedBgMode, { bg: string; accent: string; text: string } | null>> = {
  red: {
    light: { bg: '#F2EBD9', accent: '#B82828', text: '#1A1A1A' },
    dark: { bg: '#6C0C0C ~ #1A1A1A', accent: '#E40C0C', text: '#FFFFFF' },
  },
  amber: {
    light: { bg: '#F5F4F1', accent: '#D97706', text: '#1F2937' },
    dark: { bg: '#1A1A1A', accent: '#D97706', text: '#FFFFFF' },
  },
  blue: {
    light: { bg: '#ECE6D8', accent: '#1F4FA8', text: '#1F2937' },
    dark: { bg: '#0F172A', accent: '#1E40AF', text: '#FFFFFF' },
  },
  neon: {
    light: null,
    dark: { bg: '#000000 ~ #14151A', accent: '#FCFC0C 或 #6CFC3C', text: '#FFFFFF + dim grey 副' },
  },
};

export const POLISH_SYSTEM_PROMPT = `你是一个专业的社交媒体文案专家和排版大师。
将用户输入的文章转换成适合制作 3:4 比例艺术文字卡片的格式。

要求：
1. 生成标题：必须生成一个极其吸引人的"大标题"和"小标题"。
   格式必须为（且只能出现一次）：
   大标题: [吸引人的标题]
   小标题: [补充性的副标题]
2. 提取重点：识别文章中的核心金句，用双星号 **重点内容** 包裹。
   绝对禁止携带中括号 [ ] 或 【 】，直接包裹文字即可。
   每张卡（约 200 字）至少 1 个 **金句**，避免连续段落都没有重点。
3. 优化分段：保持段落长度均衡，避免只有几个字的超短段落。
   一段控制在 80–150 字之间最佳；过长的段落主动拆分。
4. 标点统一：所有标点符号转中文全角。
5. 处理细节：保留原意，精简啰嗦词汇，使其更具卡片感。

直接输出处理后的全文，不要任何开场白、解释、标记，也不要 markdown 代码块包裹。`;

export function buildPolishPrompt(article: string): string {
  return `待处理文章内容：

${article}`;
}

const DB_CHECK_SUMMARY = `dontbesilent DB Check 诊断规则：
- 只诊断，不改写，不代笔。
- 必须同时检查标题和长文，不能只检查正文文案。
- 总判断必须同时参考：标题能不能让人点开、正文是否真的有内容价值。
- 文字洁癖：识别 AI 味、空洞排比、翻译腔、太光滑、公共废话、假深刻。
- 标题诊断：判断标题是否有认知冲突、好奇缺口、真实痛点、具体对象、结果承诺、点击张力；小红书标题尽量 20 字内。
- 标题要单独判断，不允许用“标题还可以”这种泛话糊弄；必须指出它的问题来自钩子弱、对象模糊、冲突不够、利益不清、太像 AI、太长或太平。
- 表达效率：能不能一句话说清核心观点，有没有用大量包装遮住很少的内容。
- 认知落差：读者看完会不会觉得“这个我知道”，有没有真正的新东西。
- 内容形式：判断这篇是否适合小红书图文，哪里需要压缩、拆页、前置金句。
- 直接指出问题，像编辑一样精准，不要讨好，不要泛泛建议。`;

export function buildArticleDraftPrompt(input: {
  rawInput: string;
  instruction?: string;
  rules?: string;
  contentSpec?: ContentSpec | null;
}): BuiltTextPrompt {
  const fewShot = injectFewShot({ count: 2 });
  const longformSkill = getPromptTemplate('longform-skill-v3.5').content;
  const specBlock = formatContentSpecForPrompt(input.contentSpec);
  const prompt = `你要把用户提供的混乱素材整理成一篇可发布的小红书认知干货长文。

【长期规则】
${input.rules || '暂无'}

【本次额外要求】
${input.instruction?.trim() || '无。请自行判断结构和长度。'}

${specBlock}

【原始素材】
${input.rawInput}

请输出以下格式：

标题：
副标题：
系列标签建议：
封面方向：

正文：
`;
  return {
    prompt,
    messages: [
      { role: 'system', content: specBlock ? `${specBlock}\n\n${longformSkill}` : longformSkill },
      ...fewShot.messages,
      { role: 'user', content: prompt },
    ],
    metadata: {
      injectedExemplarIds: fewShot.injectedExemplarIds,
      contentSpec: input.contentSpec || null,
    },
  };
}

function formatContentSpecForPrompt(spec?: ContentSpec | null): string {
  if (!spec) return '';
  return `【本篇 Content SPEC：必须优先服从】
核心判断：
${spec.thesis || '未提供'}

要保留的事实清单：
${formatSpecList(spec.mustKeepFacts)}

要避免的内容清单：
${formatSpecList(spec.mustAvoid)}

目标读者：
${spec.targetReader || '未提供'}

风格锚点：
${formatSpecList(spec.voiceAnchors)}

平台约定：
${formatSpecList(spec.platformConventions)}

待淡化的旧观点：
${formatSpecList(spec.staleInsights)}

结构建议：
${spec.structureHint?.trim() || '未提供'}

切入提示：
${spec.hookAngle?.trim() || '未提供'}`;
}

function formatSpecList(items: string[] = []): string {
  const clean = items.map((item) => item.trim()).filter(Boolean);
  return clean.length ? clean.map((item, index) => `${index + 1}. ${item}`).join('\n') : '未提供';
}

export function buildArticleRevisionPrompt(input: {
  currentDraft: string;
  instruction: string;
  rawInput?: string;
  rules?: string;
}): string {
  const longformSkill = getPromptTemplate('longform-skill-v3.5').content;
  return `你要根据用户的修改要求，重写当前小红书长文。

【长期规则】
${input.rules || '暂无'}

【写作 Skill】
${longformSkill}

【修改要求】
${input.instruction}

【原始素材，用于真实性校验】
${input.rawInput || '未提供'}

【当前版本】
${input.currentDraft}

请直接输出修改后的完整版本，仍然保留“标题 / 副标题 / 系列标签建议 / 封面方向 / 正文”的结构。`;
}

export function buildDbCheckPrompt(input: {
  title: string;
  subtitle?: string;
  article: string;
}): string {
  return `你要使用 dontbesilent 的内容诊断标准，检查一篇已经生成好的小红书图文长文和标题。

【DB Check 标准】
${DB_CHECK_SUMMARY}

【待检查标题】
${input.title || '未提取到标题'}

【副标题】
${input.subtitle || '无'}

【待检查长文】
${input.article}

请输出诊断报告，格式如下：

# DB Check 诊断报告

## 总判断
✅ 可继续 / ⚠️ 需要修改 / ❌ 需要重做
一句话说明。必须同时提到标题和长文。

## 标题诊断
- 判断：
- 点击力：
- 认知冲突：
- 具体问题：
- 为什么：

## 长文诊断
| 维度 | 判断 | 具体问题 |
|------|------|----------|
| 文字洁癖 | ✅/⚠️/❌ | |
| 表达效率 | ✅/⚠️/❌ | |
| 认知落差 | ✅/⚠️/❌ | |
| 小红书图文适配 | ✅/⚠️/❌ | |

## 最该改的 3 件事
1.
2.
3.

## 一句话
给一个犀利但有用的结论。

只输出诊断，不要重写标题，不要重写正文。`;
}

export function inferPalette(input: CoverPromptInput): { family: PaletteFamily; bgMode: ResolvedBgMode } {
  let family = normalizePaletteFamily(input.paletteFamily);
  const requestedBgMode = normalizeBgMode(input.bgMode || input.mode);
  const series = (input.series || '').toLowerCase();
  const thesis = `${input.articleThesis || ''}\n${input.article || ''}\n${input.title || ''}\n${input.subtitle || ''}\n${input.redAccent || ''}`.toLowerCase();

  if (!family) {
    if (/(ai learning|论文共读|ai学习)/i.test(series)) family = 'red';
    else if (/搞钱拆解/.test(series)) family = 'amber';
    else if (/(工具实测|实战现场)/.test(series)) family = 'neon';
    else if (/(技术|论文|算法|github|模型|研究|benchmark|agent|deepmind)/i.test(thesis)) family = 'blue';
    else family = 'red';
  }

  let bgMode: ResolvedBgMode;
  if (requestedBgMode && requestedBgMode !== 'auto') {
    bgMode = requestedBgMode;
  } else if (family === 'neon') {
    bgMode = 'dark';
  } else if (/工具实测/.test(series)) {
    bgMode = 'dark';
  } else if (/(反共识|神话|谎言|为什么|没有未来)/.test(thesis)) {
    bgMode = 'dark';
  } else {
    bgMode = 'light';
  }

  if (family === 'neon' && bgMode === 'light') {
    family = 'amber';
  }

  return { family, bgMode };
}

function normalizePaletteFamily(value?: string): PaletteFamily | null {
  if (value === 'red' || value === 'amber' || value === 'blue' || value === 'neon') return value;
  return null;
}

function normalizeBgMode(value?: string): CoverBgModeInput | null {
  if (!value || value === 'auto') return 'auto';
  if (value === 'light' || value === 'dark') return value;
  const lower = value.toLowerCase();
  if (lower.includes('light')) return 'light';
  if (lower.includes('dark')) return 'dark';
  return 'auto';
}

export async function selectAnchors(family: PaletteFamily, bgMode: ResolvedBgMode, count = 2): Promise<string[]> {
  const samplesIndex = getStyleProfile('coverSamplesIndex').content;
  const samples = parseCoverSamples(samplesIndex);
  const candidates = samples.filter((sample) => sample.palette === `${family}-${bgMode}`);
  const selected = candidates.slice(0, count);
  // Anchor sample images are optional local assets (git-ignored). If a file is
  // missing (e.g. a fresh clone without the private cover-samples), skip it
  // instead of failing the whole cover generation.
  const loaded = await Promise.all(
    selected.map(async (sample) => {
      try {
        return await loadAssetAsDataUrl(sample.path);
      } catch {
        return null;
      }
    }),
  );
  return loaded.filter((dataUrl): dataUrl is string => Boolean(dataUrl));
}

function parseCoverSamples(markdown: string): CoverSample[] {
  const blocks = markdown.split(/\n(?=###\s+)/g);
  return blocks
    .map((block) => {
      const id = block.match(/^###\s+(.+?)\s*$/m)?.[1]?.trim();
      const palette = block.match(/-\s+\*\*palette\*\*:\s*([a-z]+-[a-z]+)/i)?.[1]?.trim();
      const path = block.match(/-\s+\*\*path\*\*:\s*`([^`]+)`/)?.[1]?.trim();
      if (!id || !palette || !path || path.includes('/_avoid/')) return null;
      return { id, palette, path };
    })
    .filter((sample): sample is CoverSample => Boolean(sample));
}

async function loadAssetAsDataUrl(path: string): Promise<string> {
  if (typeof window === 'undefined') {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;
    const { readFile } = await dynamicImport<typeof import('node:fs/promises')>('node:fs/promises');
    const { resolve } = await dynamicImport<typeof import('node:path')>('node:path');
    const buffer = await readFile(resolve(process.cwd(), path));
    return `data:${mimeFromPath(path)};base64,${buffer.toString('base64')}`;
  }

  const res = await fetch(`/${path}`);
  if (!res.ok) throw new Error(`Failed to load cover anchor: ${path}`);
  const blob = await res.blob();
  return blobToDataUrl(blob);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Failed to read cover anchor blob'));
    reader.readAsDataURL(blob);
  });
}

function mimeFromPath(path: string): string {
  if (/\.jpe?g$/i.test(path)) return 'image/jpeg';
  if (/\.webp$/i.test(path)) return 'image/webp';
  return 'image/png';
}

export async function buildCoverPrompt(input: CoverPromptInput): Promise<CoverPromptOutput> {
  const selectedPalette = inferPalette(input);
  const sourceImages = (input.sourceImages || []).map((image) => image.dataUrl).filter(Boolean);
  const styleReferenceImages = sourceImages.length
    ? []
    : await selectAnchors(selectedPalette.family, selectedPalette.bgMode, 2);
  const textPrompt = assembleCoverTextPrompt({
    voiceProfile: getStyleProfile('coverVoiceProfile').content,
    samplesIndex: getStyleProfile('coverSamplesIndex').content,
    selectedPalette,
    anchorCount: styleReferenceImages.length,
    input,
  });

  return {
    textPrompt,
    styleReferenceImages,
    sourceImages,
    selectedPalette,
  };
}

function assembleCoverTextPrompt(input: {
  voiceProfile: string;
  samplesIndex: string;
  selectedPalette: { family: PaletteFamily; bgMode: ResolvedBgMode };
  anchorCount: number;
  input: CoverPromptInput;
}): string {
  const { voiceProfile, samplesIndex, selectedPalette, anchorCount } = input;
  const source = input.input;
  const paletteToken = PALETTE_TOKENS[selectedPalette.family][selectedPalette.bgMode];
  const referenceNames = source.referenceNames?.length
    ? source.referenceNames
    : (source.sourceImages || []).map((image, index) => {
        const name = image.name || `source-${index + 1}`;
        return image.role ? `${name} role=${image.role}` : name;
      });
  const references = referenceNames.length
    ? referenceNames.map((n, i) => `${i + 1}. ${n}`).join('\n')
    : '无参考素材。若用户未提供参考素材，请基于标题和文章方向生成完整海报场景。';
  const hasPersonSource = (source.sourceImages || []).some((image) => image.role === 'person');
  const avatarRule = source.hasAvatar
    ? '用户已上传账号头像，但头像不会发送给生图模型。模型只需要在底部保留一个安静、克制的小留白区域；真实头像和账号名会在后处理阶段贴上去。'
    : '用户未上传账号头像。不要生成账号头像、头像占位圆、账号名或类似底部署名模块。';
  const anchorInstruction = anchorCount > 0
    ? `以下 ${anchorCount} 张是风格参考图，只学习风格语法：整体气质、色彩关系、大字重量、主视觉比例、留白密度和杂志/新闻封面的完整感。禁止照搬模板、固定版式、具体人物、人脸、文字、底部条、carousel 圆点、页码点或边角标签。`
    : '本次没有 anchor 参考图，严格按上面 palette token 和构图原则发挥。';
  const paletteLine = `本次封面使用 palette：${selectedPalette.family}-${selectedPalette.bgMode}
- bg: ${paletteToken?.bg || '未指定'}
- accent: ${paletteToken?.accent || '未指定'}
- text: ${paletteToken?.text || '未指定'}`;
  const articleReference = source.articleThesis || source.article || '';
  const seriesLabel = normalizeCoverSeriesLabel(source.series || '');

  return `你是 RedCard 的小红书封面生成器。你要基于用户素材生成一张完整 3:4 小红书封面海报，不是前端模板、不是信息图、不是 PPT。

【Cover Voice Profile：最高优先级 source of truth】
${voiceProfile}

【Cover Samples Index：风格锚点与反例索引】
${samplesIndex}

【长期规则】
${source.rules || '暂无'}

【本次已解析的 palette】
${paletteLine}

【风格参考图说明】
${anchorInstruction}

【用户提供/系统提取的信息】
系列名称：${seriesLabel || '（用户未填写，本次可不在封面出现系列标）'}
主标题：${source.title || '请基于文章提炼一个超大主标题'}
主题补充：${source.redAccent || source.subtitle || '可基于文章提炼一句简短主题补充，也可以不使用'}
模式：palette=${source.paletteFamily || 'auto'} / bg=${source.bgMode || source.mode || 'auto'}
账号名称：${source.accountName || '（用户未填写）'}
参考素材：
${references}
账号头像：${avatarRule}

【本次封面执行指令】
1. 先根据用户指定的模式和素材性质选择 palette family + bg mode；如果模式是 auto，按 Cover Voice Profile §3 的推断规则执行。
2. 若选择到有 anchor 的 palette，只参考 Cover Samples Index 中同 palette anchor 的风格语法：大色块、大字重量、主视觉比例、信息密度、留白节奏和整体海报感；严禁直接改风格参考图，严禁复制 anchor 里的具体人物、文字、人脸、固定版式或模板结构。
3. 若选择到 amber / blue 等暂未验证槽位，使用 Cover Voice Profile §2 中的 token 和 §4 构图原则生成，保持文字是主角。
4. 必须遵守五条铁律：大色块、大字、极简构图、大图大场景、扎眼吸睛。
5. 必须原生生成完整 3:4 竖版封面构图，按 1056×1408 生成思考，后处理会归一到 1080×1440。
6. 用户提供真实素材时，主视觉必须围绕这些 source 素材展开；人物、截图或场景要占据封面 50% 以上面积，不能缩成小贴纸。${hasPersonSource ? '本次包含人物/访谈 source，最终封面必须出现用户上传的人物本人，不允许换成其他人、不允许从风格参考图借人脸、不允许凭空生成陌生人物。' : ''}
7. 主标题必须是最大视觉中心，6-15 字、1-2 行，字号至少占短边 1/6；核心关键词用大色块或强反差处理。
8. 必须有高级杂志感：中文标题优先粗宋/标宋/editorial serif，色块要像版面结构而不是贴纸，允许纸张肌理、出血裁切、压字、人物与色块穿插；避免普通 PPT 黑体、廉价电商标题字和塑料质感。
9. 构图必须为本篇内容重新组织，避免模板化：不要固定左字右人、不要固定斜切色块、不要固定底部条、不要固定边角标签、不要生成看起来像 Canva/PPT 模板的页面。
10. 严禁生成任何小红书 UI 元素：底部长条、carousel 圆点、页码点、分页圆点、装饰长线、底部导航条、账号头像占位或账号名。账号模块只由后处理合成。
11. 如果参考素材包含人物访谈/人物图，必须保持人物身份、年龄、面部特征、服装气质和原素材里的自然姿态；不要凭空生成演讲、指点、托举、握拳、夸张手势或换装。若 source 本身就是西装照、抱胸照、讲师照或商业头像照，可以保留，但必须融入海报场景，不能像证件照抠图贴片。
12. 如果参考素材包含屏幕、流程图或黑色面板，只能把它作为背景层、环境屏幕或大面积场景的一部分融入画面；不要做成一小块漂浮黑板、教程卡片或粘贴式流程图。
13. 文字必须像画面设计的一部分：贴合色块、透视和留白；不要让标题、人物、截图、流程图像分别贴上去的独立素材。
14. 只允许 0-2 条极小辅助信息；禁止城市 skyline、蓝色企业科技背景、PPT 风底部条、便利贴堆叠、清单、三条以上 bullet、漂浮小标签、箭头涂鸦、多信息框、教程拼贴、国潮奇幻、低清营销号风。
15. 禁止明显 AI 感：塑料皮肤、假棚拍、过度平滑、奇怪手、假光影、人物边缘糊成贴纸、廉价商业宣传图质感。
16. ${source.hasAvatar ? '底部左下或右下只保留一个约 72px 头像 + 22px 账号名的低矮安静区域，不绘制头像、不绘制账号名文字、不画占位圆、不画圆点，后处理会合成真实账号模块。' : '不要生成底部账号模块；没有上传头像时封面底部保持干净。'}
17. ${seriesLabel ? `封面可以出现系列标，但只能逐字使用这一段文字：「${seriesLabel}」。如果这段文字本身包含开头的 #，例如「#话题」，可以保留这个 #。严禁生成任何其他话题标签、hashtag、关键词串、分类标签或自造系列名；尤其禁止出现类似“#AI创业 #Agent #中国B端AI #产业互联网”的多标签串。不要额外添加其他 # 标签，不要把系列标扩写、翻译或替换。` : '用户未提供系列标，不要在封面生成任何系列标、话题标签、hashtag 或自造分类名。'}

【本次画面补充说明】
${source.visualInstruction?.trim() || '无。请严格根据真实素材组织构图，不额外发明人物动作或小组件。'}

【本次额外要求】
${source.instruction?.trim() || '无。请自行生成小红书爆款封面。'}

【文章内容参考】
${articleReference.slice(0, 2600)}

直接生成一张完整的小红书 3:4 竖版封面海报。最终封面必须能在信息流缩略图里 0.5 秒看清：一个超大主标题、一个强色块关系、一个真实主视觉、一个克制的账号识别留位。`;
}

function normalizeCoverSeriesLabel(series: string): string {
  return series
    .trim()
    .replace(/\s+/g, ' ');
}

export function buildCardRevisionPrompt(input: {
  currentCards: string;
  instruction: string;
  article: string;
  rules?: string;
}): string {
  return `你要根据用户要求调整小红书文字卡片内容。

【长期规则】
${input.rules || '暂无'}

【修改要求】
${input.instruction}

【当前卡片文本】
${input.currentCards}

【原始长文】
${input.article}

请输出适合继续分页成文字卡片的 Markdown 文本。保留空行、标题、加粗金句。`;
}

export function buildCardMagicPrompt(input: {
  currentCards: string;
  article: string;
  rules?: string;
}): string {
  return `你要把当前小红书图文长文重新整理成适合文字卡片分页的 Markdown。

【长期规则】
${input.rules || '暂无'}

【AI Magic 目标】
- 这是一次强制排版整理，不是轻微润色；必须让输出明显不同于输入。
- 删除顶部、尾部无意义空行。
- 删除中间无意义分隔线，例如 ---、——、___、***。
- 保留真实标题，但不要保留“标题：”“副标题：”“正文：”这类元信息标签。
- 需要大标题的地方用 #，需要二级标题的地方用 ##。
- 每 1-2 张卡至少提亮一句真正有价值的金句，用 **加粗** 包裹。
- 重新自然分段：长段必须拆开，过碎短句要合并，段落之间只保留一个空行。
- 合并过短段落，避免一页只有几个字。
- 段落之间只保留必要空行，不要连续空三行以上。
- 清理所有无意义空格、连续空行、装饰横线、孤立符号、重复标题。
- 不要发明原文没有的信息，不要新增案例、数据、人物动作。
- 输出只要 Markdown 正文，不要解释，不要代码块。

【当前卡片/长文文本】
${input.currentCards}

【原始长文参考】
${input.article}

请输出清洗和排版后的完整 Markdown。`;
}

export function buildPublishCaptionPrompt(input: { article: string; rules?: string }): string {
  return `你是短视频发布文案编辑。请把我给你的长文，总结成一段适合抖音/小红书视频发布时搭配的文字，并附上标签。

要求：
1. 正文字数控制在 200 字以内。
2. 不要复述全文，只提炼最有传播力的观点。
3. 开头要有冲突、反差或痛点，能让人停下来。
4. 中间用一句话说清楚核心观点。
5. 结尾要适合引发评论、收藏或转发。
6. 语言要短、狠、口语化，不要 AI 腔。
7. 不要使用夸张标题党，不要堆砌感叹号。
8. 不要写成摘要，要写成“发布时配的视频文案”。
9. 标签控制在 5-8 个，优先选择内容主题、目标人群、使用场景和平台热词。
10. 标签要自然，不要堆无关热词。

【长期规则（如与上面冲突，以上面 10 条要求为准）】
${input.rules || '暂无'}

【输出格式】
- 先输出正文（200 字以内），不要加“正文”“文案”等前缀或任何解释。
- 空一行后单独输出标签，每个标签以 # 开头、用空格分隔，例如：#标签1 #标签2 #标签3。
- 除正文和标签外，不要输出任何额外内容。

【长文如下】
${input.article}`;
}

export interface BuiltTextPrompt {
  prompt: string;
  messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  metadata?: Record<string, any>;
}
