import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { Copy, Download, Image, Loader2, Plus, Save, Settings, Sparkles, Trash2 } from 'lucide-react';
import { toBlob } from 'html-to-image';

import type { CoverPaletteFamily, CoverSourceRole, ProviderConfig, RedCardProject, ReviewRule, RuleScope, WorkflowStep } from './types';
import type { ContentSpec } from './spec/contentSpec';
import type { BodyCard } from './pagination/paginate';
import { paginate } from './pagination/paginate';
import { getRenderer } from './themes/router';
import { ThemePicker } from './themes/ThemePicker';
import { SpecReview } from './components/SpecReview';
import Landing from './screens/Landing';
import Editor, { type WorkspaceColumn } from './screens/Editor';
import { callTextProvider, generateCoverImage } from './llm/client';
import { buildCoverTelemetry, persistCoverTelemetry } from './cover/telemetry';
import { compositeAvatar, getAccentColor } from './cover/avatarComposite';
import { extractSpec } from './spec/specExtractor';
import { getSpec, saveSpec } from './storage/specStore';
import { clearSnapshots, listSnapshots, type PromptSnapshot } from './utils/promptSnapshot';
import { redactSecrets } from './utils/secretRedactor';
import { createZip } from './utils/zip';
import { mergeImportedProviderConfig } from './workbench/providerImport';
import { getDocumentTitle, matchMeta } from './workbench/projectTitle';
import {
  buildArticleDraftPrompt,
  buildArticleRevisionPrompt,
  buildCardMagicPrompt,
  buildCardRevisionPrompt,
  buildCoverPrompt,
  buildDbCheckPrompt,
  buildPublishCaptionPrompt,
} from './llm/prompts';
import {
  ACTIVE_PROJECT_KEY,
  PROVIDER_KEY,
  activeRuleText,
  createProject,
  defaultProviders,
  deleteProject,
  fileToDataUrl,
  loadMeta,
  loadProjects,
  loadRules,
  saveMeta,
  saveProject,
  saveRule,
} from './workbench/projectStore';

import './themes/theme-picker.css';

const LINE_HEIGHT = 1.75;

type FlowStage = 'draft' | 'cards' | 'cover' | 'export';
type StatusTarget =
  | 'global'
  | 'source'
  | 'article'
  | 'check'
  | 'revision'
  | 'cards-markdown'
  | 'cards-preview'
  | 'cards-revision'
  | 'cover-preview'
  | 'cover-input'
  | 'cover-refine'
  | 'export-zip'
  | 'export-caption';

const FLOW_STAGES: Array<{ key: FlowStage; label: string }> = [
  { key: 'draft', label: '长文' },
  { key: 'cards', label: '文字卡片' },
  { key: 'cover', label: 'AI 封面' },
  { key: 'export', label: '导出发布' },
];

const COVER_PALETTE_OPTIONS: Array<{ value: CoverPaletteFamily; label: string; swatch: string }> = [
  { value: 'auto', label: '自动', swatch: 'linear-gradient(135deg,#B82828,#1F4FA8,#FCFC0C)' },
  { value: 'red', label: '红', swatch: '#B82828' },
  { value: 'amber', label: '橙', swatch: '#D97706' },
  { value: 'blue', label: '蓝', swatch: '#1F4FA8' },
  { value: 'neon', label: '亮黄', swatch: '#FCFC0C' },
];
const COVER_SOURCE_ROLES: Array<{ value: CoverSourceRole; label: string }> = [
  { value: 'person', label: '人物' },
  { value: 'scene', label: '场景' },
  { value: 'screenshot', label: '截图' },
];

function stageFromStep(step: WorkflowStep): FlowStage {
  if (step === 'cards') return 'cards';
  if (step === 'cover') return 'cover';
  if (step === 'export') return 'export';
  return 'draft';
}

function stepFromStage(stage: FlowStage): WorkflowStep {
  if (stage === 'cards') return 'cards';
  if (stage === 'cover') return 'cover';
  if (stage === 'export') return 'export';
  return 'article';
}

export default function App() {
  const [projects, setProjects] = useState<RedCardProject[]>([]);
  const [project, setProject] = useState<RedCardProject | null>(null);
  const [providers, setProviders] = useState<ProviderConfig>(defaultProviders);
  const [rules, setRules] = useState<ReviewRule[]>([]);
  const [step, setStep] = useState<WorkflowStep>('raw');
  const [screen, setScreen] = useState<'home' | 'project'>('home');
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [statusTarget, setStatusTarget] = useState<StatusTarget>('global');
  const [providerOpen, setProviderOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [ruleDraft, setRuleDraft] = useState({ title: '', body: '', scope: 'global' as RuleScope });
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [focusedCardId, setFocusedCardId] = useState<number | null>(null);
  const [focusedModule, setFocusedModule] = useState<string>('');
  const [lastExportFailed, setLastExportFailed] = useState(false);
  const [contentSpec, setContentSpec] = useState<ContentSpec | null>(null);
  const saveTimer = useRef<number | null>(null);
  const cardTextRef = useRef<HTMLTextAreaElement | null>(null);

  const showStatus = useCallback((target: StatusTarget, message: string) => {
    setStatusTarget(target);
    setStatus(message);
  }, []);

  const clearStatus = useCallback(() => {
    setStatusTarget('global');
    setStatus('');
  }, []);

  useEffect(() => {
    (async () => {
      const [loadedProjects, loadedRules, loadedProviders, activeId] = await Promise.all([
        loadProjects(),
        loadRules(),
        loadMeta(PROVIDER_KEY, defaultProviders),
        loadMeta<string | null>(ACTIVE_PROJECT_KEY, null),
      ]);
      let list = loadedProjects;
      if (!list.length) {
        const first = createProject('第一篇小红书图文');
        await saveProject(first);
        list = [first];
      }
      setProjects(list);
      setRules(loadedRules);
      setProviders(mergeProviders(loadedProviders));
      setProject(list.find((p) => p.id === activeId) || list[0]);
    })();
  }, []);

  useEffect(() => {
    if (!project) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    setSaveState('saving');
    saveTimer.current = window.setTimeout(async () => {
      try {
        await saveProject(project);
        await saveMeta(ACTIVE_PROJECT_KEY, project.id);
        setProjects((items) => {
          const next = items.some((p) => p.id === project.id)
            ? items.map((p) => (p.id === project.id ? { ...project, updatedAt: new Date().toISOString() } : p))
            : [project, ...items];
          return next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        });
        setSaveState('saved');
      } catch (err: any) {
        setSaveState('idle');
        showStatus('global', `保存失败：${formatError(err)}。如果刚上传了很多大图，请删除部分参考图或封面历史后再试。`);
      }
    }, 450);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [project]);

  useEffect(() => {
    if (!project) {
      setContentSpec(null);
      return;
    }
    let cancelled = false;
    getSpec(project.id).then((savedSpec) => {
      if (!cancelled) setContentSpec(savedSpec);
    });
    return () => {
      cancelled = true;
    };
  }, [project?.id]);

  const bodyCards = useMemo(() => {
    if (!project) return [];
    const source = project.cardText || project.articleDraft;
    const lines = source.split('\n').filter((l) => {
      const t = l.trim();
      return !/^标题[:：]/.test(t)
        && !/^副标题[:：]/.test(t)
        && !/^系列标签建议[:：]/.test(t)
        && !/^封面方向[:：]/.test(t)
        && !/^\s*(-{2,}|—{2,}|_{2,}|\*{2,}|={2,})\s*$/.test(t);
    });
    const metrics = paginationMetrics(project.theme);
    return paginate(lines, {
      contentPxWidth: metrics.width,
      contentPxHeight: metrics.height,
      fontSize: project.fontSize,
      lineHeight: LINE_HEIGHT,
    });
  }, [project]);

  const updateProject = useCallback((patch: Partial<RedCardProject>) => {
    setProject((prev) => (prev ? { ...prev, ...patch, updatedAt: new Date().toISOString() } : prev));
  }, []);

  async function newProject() {
    const next = createProject('小红书图文');
    await saveProject(next);
    setProjects((items) => [next, ...items]);
    setProject(next);
    setStep('raw');
    setScreen('project');
  }

  function openProject(p: RedCardProject) {
    setProject(p);
    setScreen('project');
    setStep(p.articleDraft ? 'article' : 'raw');
  }

  async function removeProject(id: string) {
    if (projects.length <= 1) return;
    const target = projects.find((p) => p.id === id);
    if (!window.confirm(`确认删除「${target?.name || '未命名项目'}」吗？这个项目的封面、参考图和历史记录都会删除。`)) return;
    await deleteProject(id);
    const rest = projects.filter((p) => p.id !== id);
    setProjects(rest);
    if (project?.id === id) setProject(rest[0]);
  }

  async function duplicateProject(source: RedCardProject) {
    const now = new Date().toISOString();
    const copy: RedCardProject = {
      ...source,
      id: crypto.randomUUID(),
      name: `${source.name || '未命名'} 副本`,
      createdAt: now,
      updatedAt: now,
      revisionLog: [
        {
          id: crypto.randomUUID(),
          step: 'review',
          instruction: '复制项目',
          result: `从项目「${source.name || source.id}」复制。`,
          createdAt: now,
        },
        ...source.revisionLog,
      ],
    };
    await saveProject(copy);
    setProjects((items) => [copy, ...items]);
    setProject(copy);
  }

  async function runSpecExtract() {
    if (!project?.rawInput.trim()) return;
    setBusy('spec');
    showStatus('source', '正在抽取 Content SPEC...');
    try {
      const spec = await extractSpec(project.rawInput, { textProvider: providers.text });
      await saveSpec(project.id, spec);
      setContentSpec(spec);
      setStep('spec');
      showStatus('source', 'SPEC 已抽取。');
    } catch (err: any) {
      showStatus('source', formatError(err));
    } finally {
      setBusy(null);
    }
  }

  async function runSpecAndArticleGenerate() {
    if (!project?.rawInput.trim()) return;
    setBusy('spec');
    showStatus('source', '正在抽取 Content SPEC...');
    try {
      const spec = await extractSpec(project.rawInput, { textProvider: providers.text });
      await saveSpec(project.id, spec);
      setContentSpec(spec);
      await runArticleGenerate(spec);
    } catch (err: any) {
      showStatus('source', formatError(err));
      setBusy(null);
    }
  }

  async function regenerateWithSpec(spec: ContentSpec) {
    if (!project) return;
    await saveSpec(project.id, spec);
    setContentSpec(spec);
    await runArticleGenerate(spec);
  }

  async function runArticleGenerate(spec?: ContentSpec) {
    if (!project?.rawInput.trim()) return;
    setBusy('article');
    showStatus('article', '正在整理长文...');
    try {
      const prompt = buildArticleDraftPrompt({
        rawInput: project.rawInput,
        instruction: project.articleInstruction,
        rules: activeRuleText(rules, 'article'),
        contentSpec: spec,
      });
      const result = await callTextProvider(providers.text, prompt, {
        maxTokens: 4500,
        temperature: 0.65,
        snapshot: {
          projectId: project.id,
          step: 'article',
          agent: 'longformWriter',
          metadata: {
            contentSpecApproved: Boolean(spec),
            contentSpec: spec || null,
          },
        },
      });
      const extracted = extractArticleMeta(result);
      updateProject({
        articleDraft: result,
        cardText: stripArticleMeta(result),
        coverTitle: extracted.title || project.coverTitle,
        coverSubtitle: project.coverSubtitle || extracted.subtitle,
        coverSeries: project.coverSeries || extracted.series || '',
        revisionLog: addLog(project, 'article', project.articleInstruction, result),
      });
      setStep('article');
      showStatus('article', '长文已生成');
    } catch (err: any) {
      showStatus('article', formatError(err));
    } finally {
      setBusy(null);
    }
  }

  async function runPublishCaptionGenerate() {
    if (!project) return;
    const article = (project.articleDraft || project.cardText || '').trim();
    if (!article) return;
    setBusy('caption');
    showStatus('export-caption', '正在生成发布文案...');
    try {
      const prompt = buildPublishCaptionPrompt({
        article,
        rules: activeRuleText(rules, 'article'),
      });
      const result = await callTextProvider(providers.text, prompt, {
        maxTokens: 800,
        temperature: 0.8,
        snapshot: {
          projectId: project.id,
          step: 'other',
          agent: 'publishCaption',
        },
      });
      updateProject({ publishCaption: clampCaption(result) });
      showStatus('export-caption', '发布文案已生成');
    } catch (err: any) {
      showStatus('export-caption', formatError(err));
    } finally {
      setBusy(null);
    }
  }

  async function runArticleRevision() {
    if (!project?.articleDraft.trim() || !project.articleInstruction.trim()) return;
    setBusy('article');
    setFocusedModule('revise');
    showStatus('revision', '正在修改长文...');
    try {
      const prompt = buildArticleRevisionPrompt({
        currentDraft: project.articleDraft,
        instruction: project.articleInstruction,
        rawInput: project.rawInput,
        rules: activeRuleText(rules, 'article'),
      });
      const result = await callTextProvider(providers.text, prompt, {
        maxTokens: 4500,
        temperature: 0.55,
        snapshot: { projectId: project.id, step: 'article', agent: 'longformReviser' },
      });
      const extracted = extractArticleMeta(result);
      updateProject({
        articleDraft: result,
        cardText: stripArticleMeta(result),
        coverTitle: extracted.title || project.coverTitle,
        coverSubtitle: extracted.subtitle || project.coverSubtitle,
        revisionLog: addLog(project, 'article', project.articleInstruction, result),
      });
      showStatus('revision', '长文已修改');
    } catch (err: any) {
      showStatus('revision', formatError(err));
    } finally {
      setBusy(null);
    }
  }

  async function runDbCheck() {
    if (!project?.articleDraft.trim()) return;
    setBusy('db-check');
    setFocusedModule('db-check');
    showStatus('check', '正在进行 DB Check...');
    try {
      const extracted = extractArticleMeta(project.articleDraft);
      const prompt = buildDbCheckPrompt({
        title: project.coverTitle || extracted.title,
        subtitle: project.coverSubtitle || extracted.subtitle,
        article: project.articleDraft,
      });
      const result = await callTextProvider(providers.text, prompt, {
        maxTokens: 3500,
        temperature: 0.35,
        snapshot: { projectId: project.id, step: 'article', agent: 'dbCheck' },
      });
      updateProject({
        dbCheckReport: result,
        revisionLog: addLog(project, 'review', 'DB Check：检查标题和长文', result),
      });
      showStatus('check', 'DB Check 已完成');
    } catch (err: any) {
      showStatus('check', formatError(err));
    } finally {
      setBusy(null);
    }
  }

  async function runCoverGenerate() {
    if (!project) return;
    setBusy('cover');
    showStatus(project.coverInstruction.trim() ? 'cover-refine' : 'cover-input', '正在生成完整 AI 封面...');
    try {
      const startedAt = performance.now();
      const coverPrompt = await buildCoverPrompt({
        title: project.coverTitle || getDocumentTitle(project.articleDraft) || getDocumentTitle(project.cardText),
        subtitle: project.coverSubtitle || extractArticleMeta(project.articleDraft).subtitle,
        redAccent: '',
        series: project.coverSeries,
        paletteFamily: project.coverPaletteFamily,
        bgMode: project.coverMode,
        accountName: project.accountName,
        article: project.articleDraft || project.rawInput,
        articleThesis: extractArticleMeta(project.articleDraft).subtitle || project.coverSubtitle,
        instruction: project.coverInstruction,
        visualInstruction: project.coverVisualInstruction,
        sourceImages: project.referenceImages.map((img) => ({ dataUrl: img.dataUrl, name: img.name, role: img.role })),
        referenceNames: project.referenceImages.map(formatReferenceName),
        hasAvatar: Boolean(project.avatarImage),
        rules: activeRuleText(rules, 'cover'),
      });
      const image = await generateCoverImage(
        providers.image,
        coverPrompt.textPrompt,
        {
          styleReferenceImages: coverPrompt.styleReferenceImages,
          sourceImages: coverPrompt.sourceImages,
        },
        {
          projectId: project.id,
          step: 'cover',
          agent: 'coverImageGenerator',
          metadata: {
            selectedPalette: coverPrompt.selectedPalette,
            styleReferenceImageCount: coverPrompt.styleReferenceImages.length,
            sourceImageCount: coverPrompt.sourceImages.length,
          },
        }
      );
      const normalizedCover = await normalizeImageTo3x4(image);
      const coverImage = project.avatarImage
        ? await compositeAvatar(normalizedCover, project.avatarImage, {
            accountName: project.accountName,
            accentColor: getAccentColor(coverPrompt.selectedPalette),
          })
        : normalizedCover;
      const telemetry = buildCoverTelemetry({
        projectId: project.id,
        startedAt,
        provider: providers.image,
        selectedPalette: {
          family: project.coverPaletteFamily,
          bgMode: project.coverMode,
        },
        styleReferenceImageCount: coverPrompt.styleReferenceImages.length,
        sourceImageCount: coverPrompt.sourceImages.length,
        hasAvatar: Boolean(project.avatarImage),
        prompt: coverPrompt.textPrompt,
      });
      void persistCoverTelemetry(telemetry);
      const coverEntry = {
        id: crypto.randomUUID(),
        image: coverImage,
        prompt: coverPrompt.textPrompt,
        instruction: [project.coverVisualInstruction, project.coverInstruction].filter(Boolean).join('\n'),
        createdAt: new Date().toISOString(),
        telemetry: telemetry as unknown as Record<string, unknown>,
      };
      updateProject({
        coverPrompt: coverPrompt.textPrompt,
        coverImage,
        coverHistory: [coverEntry, ...(project.coverHistory || [])].slice(0, 20),
        revisionLog: addLog(
          project,
          'cover',
          [project.coverVisualInstruction, project.coverInstruction].filter(Boolean).join('\n'),
          coverPrompt.textPrompt
        ),
      });
      setStep('cover');
      const costText = telemetry.estimatedCostUsd === null ? '' : `，估算成本 $${telemetry.estimatedCostUsd.toFixed(3)}`;
      showStatus('cover-preview', `封面已生成${costText}`);
    } catch (err: any) {
      showStatus(project.coverInstruction.trim() ? 'cover-refine' : 'cover-input', formatError(err));
    } finally {
      setBusy(null);
    }
  }

  async function runCardsRevision() {
    if (!project) return;
    setBusy('cards');
    showStatus('cards-revision', '正在调整文字卡片...');
    try {
      if (!project.cardInstruction.trim()) return;
      const prompt = buildCardRevisionPrompt({
        currentCards: project.cardText || project.articleDraft,
        instruction: project.cardInstruction,
        article: project.articleDraft,
        rules: activeRuleText(rules, 'cards'),
      });
      const result = await callTextProvider(providers.text, prompt, {
        maxTokens: 3600,
        temperature: 0.5,
        snapshot: { projectId: project.id, step: 'cards', agent: 'cardReviser' },
      });
      updateProject({
        cardText: cleanCardMarkdown(result, { collapseBlankLines: false }),
        fontSize: suggestFontSize(result),
        revisionLog: addLog(project, 'cards', project.cardInstruction || 'AI Magic 自动排版清洗', result),
      });
      showStatus('cards-preview', '卡片文本已整理');
    } catch (err: any) {
      showStatus('cards-revision', formatError(err));
    } finally {
      setBusy(null);
    }
  }

  async function runCardsMagic() {
    if (!project) return;
    setBusy('cards-magic');
    showStatus('cards-markdown', '正在进行 AI Magic 排版...');
    try {
      const prompt = buildCardMagicPrompt({
        currentCards: project.cardText || project.articleDraft,
        article: project.articleDraft,
        rules: activeRuleText(rules, 'cards'),
      });
      const result = await callTextProvider(providers.text, prompt, {
        maxTokens: 3600,
        temperature: 0.35,
        snapshot: { projectId: project.id, step: 'cards', agent: 'aiMagic' },
      });
      updateProject({
        cardText: cleanCardMarkdown(result, { collapseBlankLines: true }),
        fontSize: suggestFontSize(result),
        revisionLog: addLog(project, 'cards', 'AI Magic 自动排版清洗', result),
      });
      showStatus('cards-markdown', 'AI Magic 已整理');
    } catch (err: any) {
      showStatus('cards-markdown', formatError(err));
    } finally {
      setBusy(null);
    }
  }

  async function runSingleCardRevision(cardId: number) {
    const card = bodyCards.find((item) => item.id === cardId);
    if (!project || !card || !project.cardInstruction.trim()) return;
    setBusy(`card-${cardId}`);
    showStatus('cards-preview', `正在调整第 ${cardId + 1} 张文字卡片...`);
    try {
      const prompt = buildCardRevisionPrompt({
        currentCards: card.content.join('\n'),
        instruction: `只修改这一张卡片，保持适合单张卡片展示。\n${project.cardInstruction}`,
        article: project.articleDraft,
        rules: activeRuleText(rules, 'cards'),
      });
      const result = await callTextProvider(providers.text, prompt, {
        maxTokens: 1800,
        temperature: 0.5,
        snapshot: { projectId: project.id, step: 'cards', agent: 'singleCardReviser', metadata: { cardId } },
      });
      const nextText = replaceCardText(project.cardText || project.articleDraft, card.content, result);
      updateProject({
        cardText: nextText,
        revisionLog: addLog(project, 'cards', project.cardInstruction, result),
      });
      showStatus('cards-preview', '单张卡片已调整');
    } catch (err: any) {
      showStatus('cards-preview', formatError(err));
    } finally {
      setBusy(null);
    }
  }

  async function applyCardMarkdown(action: MarkdownToolbarAction) {
    if (!project) return;
    const textarea = cardTextRef.current;
    const selectionStart = textarea?.selectionStart ?? project.cardText.length;
    const selectionEnd = textarea?.selectionEnd ?? selectionStart;
    const next = applyMarkdownToolbarAction(project.cardText, selectionStart, selectionEnd, action);
    updateProject({
      cardText: next.text,
      ...(getDocumentTitle(next.text) ? { coverTitle: getDocumentTitle(next.text) } : {}),
    });
    await nextPaint();
    textarea?.focus();
    textarea?.setSelectionRange(next.selectionStart, next.selectionEnd);
  }

  async function addRule() {
    if (!ruleDraft.title.trim() || !ruleDraft.body.trim()) return;
    const now = new Date().toISOString();
    const rule: ReviewRule = {
      id: crypto.randomUUID(),
      scope: ruleDraft.scope,
      status: 'active',
      title: ruleDraft.title.trim(),
      body: ruleDraft.body.trim(),
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await saveRule(rule);
    setRules((items) => [rule, ...items]);
    setRuleDraft({ title: '', body: '', scope: ruleDraft.scope });
  }

  async function exportAll() {
    if (!project) return;
    setBusy('export');
    setLastExportFailed(false);
    showStatus('export-zip', '正在准备导出...');
    try {
      await nextPaint();
      if ('fonts' in document) {
        await document.fonts.ready;
      }
      const files: Array<{ name: string; blob: Blob }> = [];
      if (project.coverImage) {
        files.push({ name: `${slugName(project.name)}-01-cover.png`, blob: dataUrlToBlob(project.coverImage) });
      }
      const caption = project.publishCaption.trim();
      if (caption) {
        files.push({
          name: `${slugName(project.name)}-publish-caption.txt`,
          blob: new Blob([caption], { type: 'text/plain;charset=utf-8' }),
        });
      }
      await Promise.all(bodyCards.map(async (card, i) => {
        const el = document.getElementById(`card-${card.id}`);
        if (!el) return;
        showStatus('export-zip', `正在渲染文字卡片 ${i + 1} / ${bodyCards.length}...`);
        const prevTransform = el.style.transform;
        const prevBoxShadow = el.style.boxShadow;
        el.style.transform = 'none';
        el.style.boxShadow = 'none';
        let blob: Blob | null = null;
        try {
          blob = await toBlob(el, {
            pixelRatio: 2.4,
            backgroundColor: 'transparent',
            cacheBust: true,
            width: 450,
            height: 600,
            style: {
              transform: 'none',
              boxShadow: 'none',
              margin: '0',
            },
          });
        } finally {
          el.style.transform = prevTransform;
          el.style.boxShadow = prevBoxShadow;
        }
        if (blob) files.push({ name: `${slugName(project.name)}-${String(i + (project.coverImage ? 2 : 1)).padStart(2, '0')}-page.png`, blob });
      }));
      if (!files.length) {
        showStatus('export-zip', '没有可导出的图片');
        return;
      }
      showStatus('export-zip', '正在打包 ZIP...');
      const zip = await createZip(files.sort((a, b) => a.name.localeCompare(b.name)));
      downloadBlob(zip, `${slugName(project.name || 'redcard')}.zip`);
      showStatus('export-zip', `导出完成：${files.filter((file) => file.name.endsWith('.png')).length} 张图片和发布文案已打包。`);
    } catch (err: any) {
      setLastExportFailed(true);
      showStatus('export-zip', formatError(err));
    } finally {
      setBusy(null);
    }
  }

  if (!project) {
    return <div className="min-h-screen bg-[var(--bg-base)] flex items-center justify-center">Loading RedCard...</div>;
  }

  const Renderer = getRenderer(project.theme);
  const activeStage = stageFromStep(step);
  const activeStageIndex = FLOW_STAGES.findIndex((item) => item.key === activeStage);

  function goStage(stage: FlowStage) {
    clearStatus();
    setStep(stepFromStage(stage));
  }

  function goNextStage() {
    const next = FLOW_STAGES[Math.min(FLOW_STAGES.length - 1, activeStageIndex + 1)];
    goStage(next.key);
  }

  function goPrevStage() {
    const prev = FLOW_STAGES[Math.max(0, activeStageIndex - 1)];
    goStage(prev.key);
  }

  if (screen === 'home') {
    return (
      <div className="min-h-screen bg-[var(--bg)] text-[var(--text-primary)] selection:bg-[var(--accent-glow)]">
        <Landing
          projects={projects}
          onCreateProject={newProject}
          onOpenProject={openProject}
          onDuplicateProject={duplicateProject}
          onDeleteProject={removeProject}
          onOpenProvider={() => setProviderOpen(true)}
          onOpenRules={() => setRulesOpen(true)}
        />

        {providerOpen && (
          <ProviderModal
            providers={providers}
            setProviders={setProviders}
            onClose={async () => {
              await saveMeta(PROVIDER_KEY, providers);
              setProviderOpen(false);
            }}
          />
        )}
        {rulesOpen && (
          <RuleModal
            project={project}
            rules={rules}
            setRules={setRules}
            ruleDraft={ruleDraft}
            setRuleDraft={setRuleDraft}
            onSave={addRule}
            onClose={() => setRulesOpen(false)}
          />
        )}

        <style>{APP_CSS}</style>
      </div>
    );
  }

  const scopedStatus = (target: StatusTarget): string | undefined => (
    status && statusTarget === target ? status : undefined
  );

  const cardsColumns: WorkspaceColumn[] = [
    {
      id: '01',
      label: 'MARKDOWN',
      status: scopedStatus('cards-markdown'),
      body: (
        <ModuleCard
          id="01"
          label="MARKDOWN"
          hint="编辑卡片内容"
          status={project.cardText.trim() ? 'done' : focusedModule === 'markdown' ? 'focused' : 'empty'}
          tip="这里是文字卡片的 Markdown 源文。你可以手改，也可以让右侧 AI Magic 重新整理排版。"
          focused={focusedModule === 'markdown'}
        >
          <div className="markdown-control-row">
            <EditorToolbar onAction={applyCardMarkdown} />
            <div className="font-row compact">
              <span className="field-label">字号</span>
              <button className="mini-square" onClick={() => updateProject({ fontSize: Math.max(10, project.fontSize - 1) })}>-</button>
              <span>{project.fontSize}</span>
              <button className="mini-square" onClick={() => updateProject({ fontSize: Math.min(32, project.fontSize + 1) })}>+</button>
            </div>
            <button className="mini-btn bordered justify-center magic-inline-btn" onClick={runCardsMagic} disabled={busy === 'cards-magic'}>
              {busy === 'cards-magic' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              AI Magic 排版
            </button>
          </div>
          <ThemePicker value={project.theme} onChange={(theme) => updateProject({ theme })} />
          <textarea
            ref={cardTextRef}
            value={project.cardText}
            onChange={(e) => {
              const nextCardText = e.target.value;
              const nextTitle = getDocumentTitle(nextCardText);
              updateProject({
                cardText: nextCardText,
                ...(nextTitle ? { coverTitle: nextTitle } : {}),
              });
            }}
            onFocus={() => setFocusedModule('markdown')}
            className="module-textarea cards-editor"
            placeholder={'把要分页成卡片的 Markdown 放这里。例如：\n# 一级标题\n正文段落\n**重点金句**'}
          />
        </ModuleCard>
      ),
    },
    {
      id: '02',
      label: 'CARD PREVIEW',
      status: scopedStatus('cards-preview'),
      body: (
        <ModuleCard
          id="02"
          label="CARD PREVIEW"
          hint="文字卡片分页"
          status={bodyCards.length ? 'done' : 'empty'}
          tip="这里预览最终导出的文字卡片分页。页数是系统数据，红色只用于数字高亮。"
        >
          <WorkflowPreview
            project={project}
            bodyCards={bodyCards}
            Renderer={Renderer}
            focusedCardId={focusedCardId}
            busy={busy}
            setFocusedCardId={setFocusedCardId}
            showCover={false}
          />
        </ModuleCard>
      ),
    },
    {
      id: '03',
      label: 'REVISION',
      status: scopedStatus('cards-revision'),
      body: (
        <ModuleCard
          id="03"
          label="REVISION"
          hint="修改意见"
          status={project.cardInstruction.trim() ? 'done' : focusedModule === 'card-magic' ? 'focused' : 'empty'}
          tip="这里只写你对文字卡片的修改意见。AI Magic 排版在 [01] MARKDOWN 里。"
          focused={focusedModule === 'card-magic'}
          footer={(
            <button className="black-btn w-full" onClick={runCardsRevision} disabled={busy === 'cards' || !project.cardInstruction.trim()}>
              {busy === 'cards' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              发送
            </button>
          )}
        >
          <textarea
            value={project.cardInstruction}
            onChange={(e) => updateProject({ cardInstruction: e.target.value })}
            onFocus={() => setFocusedModule('card-magic')}
            className="module-textarea"
            placeholder={'告诉 AI 这些卡片怎么改。例如：\n· 第 3 张标题太弱，换成更锋利的表达\n· 重点句不要太多，只保留最强的\n· 这组卡片语气再像人话一点'}
          />
        </ModuleCard>
      ),
    },
  ];

  const coverColumns: WorkspaceColumn[] = [
    {
      id: '01',
      label: 'PREVIEW',
      status: scopedStatus('cover-preview'),
      body: (
        <ModuleCard
          id="01"
          label="PREVIEW"
          hint="完整 AI 海报"
          status={project.coverImage ? 'done' : busy === 'cover' ? 'focused' : 'empty'}
          tip="这里只显示完整 AI 生成海报。封面不是前端叠字模板。"
        >
          <CoverPreview project={project} compact busy={busy === 'cover'} />
        </ModuleCard>
      ),
    },
    {
      id: '02',
      label: 'COVER INPUT',
      status: scopedStatus('cover-input'),
      body: (
        <ModuleCard
          id="02"
          label="COVER INPUT"
          hint="标题 / 头像 / 模式"
          status={project.coverTitle.trim() ? 'done' : focusedModule === 'cover-input' ? 'focused' : 'empty'}
          tip="输入主标题、账号名称、头像和参考素材。头像只会作为底部账号识别使用。"
          focused={focusedModule === 'cover-input'}
          footer={(
            <button className="black-btn w-full" onClick={runCoverGenerate} disabled={busy === 'cover'}>
              {busy === 'cover' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Image className="w-3 h-3" />}
              生成封面
            </button>
          )}
        >
          <Field label="主标题" value={project.coverTitle} onChange={(v) => updateProject({ coverTitle: v })} onFocus={() => setFocusedModule('cover-input')} />
          <div className="cover-meta-row">
            <Field label="系列标" value={project.coverSeries} onChange={(v) => updateProject({ coverSeries: v })} onFocus={() => setFocusedModule('cover-input')} placeholder="选填，如 #AI Learning" />
            <Field label="账号名称" value={project.accountName} onChange={(v) => updateProject({ accountName: v })} onFocus={() => setFocusedModule('cover-input')} placeholder="你的账号名" />
            <AvatarUploader project={project} updateProject={updateProject} />
          </div>
          <div>
            <span className="field-label">画面补充说明</span>
            <textarea
              value={project.coverVisualInstruction}
              onChange={(e) => updateProject({ coverVisualInstruction: e.target.value })}
              onFocus={() => setFocusedModule('cover-input')}
              className="module-textarea cover-visual-note"
              placeholder={'给生图模型的一句画面要求。例如：\n人物保持访谈截图原姿态，不要生成演讲手势；流程图融入背景，不要像小黑板。'}
            />
          </div>
          <div className="cover-control-grid">
            <div>
              <span className="field-label">Palette</span>
              <div className="palette-segmented">
                {COVER_PALETTE_OPTIONS.map((palette) => (
                  <button
                    key={palette.value}
                    className={project.coverPaletteFamily === palette.value ? 'active' : ''}
                    onClick={() => updateProject({ coverPaletteFamily: palette.value })}
                    title={palette.label}
                  >
                    <span style={{ background: palette.swatch }} />
                    {palette.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="field-label">背景</span>
              <div className="segmented">
                {(['auto', 'dark', 'light'] as const).map((m) => (
                  <button key={m} className={project.coverMode === m ? 'active' : ''} onClick={() => updateProject({ coverMode: m })}>
                    {m === 'auto' ? '自动' : m === 'dark' ? '深色' : '浅色'}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <ReferenceUploader project={project} updateProject={updateProject} />
        </ModuleCard>
      ),
    },
    {
      id: '03',
      label: 'AI REFINE',
      status: scopedStatus('cover-refine'),
      body: (
        <ModuleCard
          id="03"
          label="AI REFINE"
          hint="修改封面"
          status={project.coverInstruction.trim() ? 'done' : focusedModule === 'cover-refine' ? 'focused' : 'empty'}
          tip="对封面提出修改意见，比如人物更大、标题更大、减少小字、换成深色模式。"
          focused={focusedModule === 'cover-refine'}
          footer={(
            <button className="black-btn w-full" onClick={runCoverGenerate} disabled={busy === 'cover'}>
              {busy === 'cover' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              生成 / 修改封面
            </button>
          )}
        >
          <textarea
            value={project.coverInstruction}
            onChange={(e) => updateProject({ coverInstruction: e.target.value })}
            onFocus={() => setFocusedModule('cover-refine')}
            className="module-textarea"
            placeholder={'告诉 AI 封面哪里要改。例如：\n· 人物放大到占画面一半\n· 主标题更大，下面压荧光色块\n· 去掉多余小标签'}
          />
        </ModuleCard>
      ),
    },
  ];

  const imageCount = bodyCards.length + (project.coverImage ? 1 : 0);
  const exportColumns: WorkspaceColumn[] = [
    {
      id: '01',
      label: 'ZIP EXPORT',
      status: scopedStatus('export-zip'),
      body: (
        <ModuleCard
          id="01"
          label="ZIP EXPORT"
          hint="整套图片打包下载"
          status={imageCount ? 'done' : 'empty'}
          tip="导出会把封面、全部文字卡片和发布文案打进一个 ZIP。文字卡片按 1080×1440 输出。"
        >
          <div className="export-bar">
            <div className="export-summary">
              <div><b>{project.coverImage ? 1 : 0}</b><span>封面</span></div>
              <div><b>{bodyCards.length}</b><span>文字卡片</span></div>
              <div><b>{captionBodyLength(project.publishCaption)}</b><span>文案字数</span></div>
            </div>
            <button className="black-btn export-download" onClick={exportAll} disabled={busy === 'export' || !imageCount}>
              {busy === 'export' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
              下载 ZIP
            </button>
          </div>
          <p className="small-note">点击下载后会先切到文字卡片页渲染卡片，再自动打包 ZIP。</p>
        </ModuleCard>
      ),
    },
    {
      id: '02',
      label: 'PUBLISH CAPTION',
      status: scopedStatus('export-caption'),
      body: (
        <ModuleCard
          id="02"
          label="PUBLISH CAPTION"
          hint="200 字内发布文案"
          status={project.publishCaption.trim() ? 'done' : 'empty'}
          tip="点「重新生成」按短视频发布文案规则把长文重写成 200 字内正文 + 标签，也可以直接手写。导出时会写入 txt。"
        >
          <div className="field-label-row">
            <span className="field-label">发布文案</span>
            <span className="field-actions">
              <button className="mini-btn bordered" type="button" onClick={runPublishCaptionGenerate} disabled={busy === 'caption' || (!project.articleDraft.trim() && !project.cardText.trim())}>
                {busy === 'caption' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {busy === 'caption' ? '生成中' : '重新生成'}
              </button>
              <span>{captionBodyLength(project.publishCaption)}/200 + 标签</span>
            </span>
          </div>
          <textarea
            className="big-textarea publish-caption"
            value={project.publishCaption}
            onChange={(e) => updateProject({ publishCaption: clampCaption(e.target.value) })}
            placeholder="点「重新生成」用 AI 按短视频文案规则生成，或直接在这里手写发布文案。"
          />
        </ModuleCard>
      ),
    },
  ];

  const specReview = activeStage === 'draft' && step === 'spec' && contentSpec ? (
    <section className="editor-spec-review">
      <SpecReview
        spec={contentSpec}
        busy={busy === 'article' || busy === 'spec'}
        onRegenerate={regenerateWithSpec}
        onBack={() => setStep(project.articleDraft.trim() ? 'article' : 'raw')}
      />
    </section>
  ) : null;

  return (
    <>
      <Editor
        project={project}
        activeStage={activeStage}
        saveState={saveState}
        status={status && statusTarget === 'global' ? <div className="status-line">{status}</div> : null}
        hiddenExportCards={activeStage !== 'cards' && bodyCards.length > 0 ? (
          <HiddenExportCards project={project} bodyCards={bodyCards} Renderer={Renderer} />
        ) : null}
        onBackHome={() => setScreen('home')}
        onProjectNameChange={(name) => updateProject({ name })}
        onOpenRules={() => setRulesOpen(true)}
        onOpenProvider={() => setProviderOpen(true)}
        onStage={goStage}
        onPrev={goPrevStage}
        onNext={goNextStage}
        canNext={activeStage !== 'export' && (activeStage !== 'draft' || Boolean(project.articleDraft.trim()))}
        rawInput={project.rawInput}
        articleDraft={project.articleDraft}
        articleInstruction={project.articleInstruction}
        focusedModule={focusedModule}
        busy={busy}
        canViewSpec={Boolean(contentSpec)}
        onRawInputChange={(rawInput) => updateProject({ rawInput })}
        onArticleDraftChange={(nextArticle) => {
          const nextTitle = getDocumentTitle(nextArticle);
          updateProject({
            articleDraft: nextArticle,
            cardText: stripArticleMeta(nextArticle),
            ...(nextTitle ? { coverTitle: nextTitle } : {}),
          });
        }}
        onArticleInstructionChange={(articleInstruction) => updateProject({ articleInstruction })}
        onFocusModule={setFocusedModule}
        onGenerateArticle={runSpecAndArticleGenerate}
        onViewSpec={() => contentSpec && setStep('spec')}
        onConfirmCards={() => {
          const extracted = extractArticleMeta(project.articleDraft);
          updateProject({
            cardText: stripArticleMeta(project.articleDraft),
            coverTitle: getDocumentTitle(project.articleDraft) || project.coverTitle,
            coverSubtitle: extracted.subtitle || project.coverSubtitle,
            coverSeries: extracted.series || project.coverSeries,
          });
          setStep('cards');
        }}
        onRunDbCheck={runDbCheck}
        onRunArticleRevision={runArticleRevision}
        draftStatus={{
          source: scopedStatus('source'),
          article: scopedStatus('article'),
          check: scopedStatus('check'),
          revision: scopedStatus('revision'),
        }}
        dbCheckReport={<DbCheckReport project={project} />}
        specReview={specReview}
        cardsColumns={cardsColumns}
        coverColumns={coverColumns}
        exportColumns={exportColumns}
      />

      {providerOpen && (
        <ProviderModal
          providers={providers}
          setProviders={setProviders}
          onClose={async () => {
            await saveMeta(PROVIDER_KEY, providers);
            setProviderOpen(false);
          }}
        />
      )}
      {rulesOpen && (
        <RuleModal
          project={project}
          rules={rules}
          setRules={setRules}
          ruleDraft={ruleDraft}
          setRuleDraft={setRuleDraft}
          onSave={addRule}
          onClose={() => setRulesOpen(false)}
        />
      )}

      <style>{APP_CSS}</style>
    </>
  );
}

type ModuleStatus = 'empty' | 'focused' | 'done' | 'warning';

function ModuleCard({
  id,
  label,
  hint,
  status,
  tip,
  focused,
  footer,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  status: ModuleStatus;
  tip: string;
  focused?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`module ${focused ? 'focused' : ''}`}>
      <div className="module-header">
        <div className="module-id-label">
          <span className="module-id">[{id}]</span>
          <span className="module-label">{label}</span>
        </div>
        <div className="module-actions">
          <StatusDot status={focused ? 'focused' : status} />
          <HelpIcon tip={tip} />
        </div>
      </div>
      {hint && <div className={`module-hint ${status === 'done' ? 'hidden' : ''}`}>{hint}</div>}
      <div className="module-divider" />
      <div className="module-body">{children}</div>
      {footer && <div className="module-footer">{footer}</div>}
    </section>
  );
}

function StatusDot({ status }: { status: ModuleStatus }) {
  const glyph = status === 'done' ? '✓' : status === 'warning' ? '⚠' : status === 'focused' ? '●' : '◯';
  return <span className={`status-dot ${status}`}>{glyph}</span>;
}

function HelpIcon({ tip }: { tip: string }) {
  return <span className="help-icon" data-tip={tip}>(?)</span>;
}

function DbCheckReport({ project }: { project: RedCardProject }) {
  const extracted = extractArticleMeta(project.articleDraft);
  const title = project.coverTitle || extracted.title || getDocumentTitle(project.cardText) || '未提取到标题';
  const articleLength = project.articleDraft.trim().length;
  return (
    <div className="db-report">
      <div className="db-stats">
        <span>标题 <b className="num-accent">{title.length}</b> 字</span>
        <span>长文 <b className="num-accent">{articleLength}</b> 字</span>
      </div>
      {project.dbCheckReport.trim() ? (
        <pre>{project.dbCheckReport}</pre>
      ) : (
        <p className="small-note">点击「重新检查」后，这里会显示完整 DB Check 诊断报告。</p>
      )}
    </div>
  );
}

function FlowNav({
  activeStage,
  onStage,
  onPrev,
  onNext,
  canNext = true,
}: {
  activeStage: FlowStage;
  onStage: (stage: FlowStage) => void;
  onPrev: () => void;
  onNext: () => void;
  canNext?: boolean;
}) {
  const activeIndex = FLOW_STAGES.findIndex((stage) => stage.key === activeStage);
  return (
    <div className="flow-shell">
      <button className="mini-btn" onClick={onPrev}>上一步</button>
      <div className="flow-line">
        {FLOW_STAGES.map((stage, index) => {
          const state = index < activeIndex ? 'done' : stage.key === activeStage ? 'active' : 'upcoming';
          return (
            <button
              key={stage.key}
              className={state}
              disabled={state === 'upcoming'}
              onClick={() => state !== 'upcoming' && onStage(stage.key)}
            >
              <span>{state === 'done' ? '✓' : String(index + 1).padStart(2, '0')}</span>
              <b>{stage.label}</b>
              {state === 'active' && <em>ACTIVE</em>}
            </button>
          );
        })}
      </div>
      <button className="black-btn" onClick={onNext} disabled={!canNext}>下一步</button>
    </div>
  );
}

type MarkdownToolbarAction = 'h1' | 'h2' | 'bold' | 'quote' | 'list' | 'divider';

function EditorToolbar({ onAction }: { onAction: (action: MarkdownToolbarAction) => void }) {
  return (
    <div className="editor-toolbar" aria-label="Markdown 工具">
      <button type="button" title="一级标题" onClick={() => onAction('h1')}>H1</button>
      <button type="button" title="二级标题" onClick={() => onAction('h2')}>H2</button>
      <button type="button" title="加粗" onClick={() => onAction('bold')}>B</button>
      <button type="button" title="引用" onClick={() => onAction('quote')}>“”</button>
      <button type="button" title="列表" onClick={() => onAction('list')}>•</button>
      <button type="button" title="分隔" onClick={() => onAction('divider')}>—</button>
    </div>
  );
}

function CoverPreview({ project, compact = false, busy = false }: { project: RedCardProject; compact?: boolean; busy?: boolean }) {
  return (
    <div className={`workflow-preview ${compact ? 'compact' : ''}`}>
      <div className="workflow-preview-head">
        <div>
          <span>{project.coverImage ? '✓' : '◯'} PREVIEW</span>
          <h3>完整 AI 海报</h3>
        </div>
        <span>{busy ? '生成中...' : project.coverImage ? '已生成' : '等待封面'}</span>
      </div>
      <div className="preview-stage single">
        {busy ? (
          <div className="cover-empty cover-loading">
            <Loader2 className="w-7 h-7 mb-4 animate-spin" />
            <p>生成中...</p>
          </div>
        ) : project.coverImage ? (
          <div className="group relative">
            <PageGutter index={1} label="cover" />
            <div className="cover-frame">
              <img src={project.coverImage} alt="AI generated cover" />
            </div>
          </div>
        ) : (
          <div className="cover-empty">
            <Image className="w-8 h-8 mb-4" />
            <div className="font-serif italic text-2xl text-[var(--accent)]">AI Cover</div>
            <p>封面只走完整 AI 海报生成</p>
          </div>
        )}
      </div>
    </div>
  );
}

function WorkflowPreview({
  project,
  bodyCards,
  Renderer,
  focusedCardId,
  busy,
  setFocusedCardId,
  showCover,
}: {
  project: RedCardProject;
  bodyCards: BodyCard[];
  Renderer: ReturnType<typeof getRenderer>;
  focusedCardId: number | null;
  busy: string | null;
  setFocusedCardId: Dispatch<SetStateAction<number | null>>;
  showCover: boolean;
}) {
  return (
    <div className="workflow-preview">
      <div className="workflow-preview-head">
        <div>
          <span>{showCover ? 'EXPORT PREVIEW' : 'CARD PREVIEW'}</span>
          <h3>{showCover ? '整套图文' : '文字卡片分页'}</h3>
        </div>
        <span>{project.coverImage ? 'AI COVER' : 'NO COVER'} · <b className="num-accent">{bodyCards.length}</b> PAGES</span>
      </div>
      <div className="preview-stage">
        {showCover && (
          project.coverImage ? (
            <div className="group relative">
              <PageGutter index={1} label="cover" />
              <div className="cover-frame">
                <img src={project.coverImage} alt="AI generated cover" />
              </div>
            </div>
          ) : (
            <div className="cover-empty">
              <Image className="w-8 h-8 mb-4" />
              <div className="font-serif italic text-2xl text-[var(--accent)]">AI Cover</div>
              <p>封面只走完整 AI 海报生成</p>
            </div>
          )
        )}

        {bodyCards.map((card, idx) => (
          <div key={card.id} className={`group relative preview-card ${focusedCardId === card.id ? 'focused' : ''}`}>
            <PageGutter index={idx + (showCover && project.coverImage ? 2 : 1)} label="page" />
            <Renderer.BodyCard
              id={card.id}
              content={card.content}
              fontSize={project.fontSize}
              cardIndex={idx + (showCover && project.coverImage ? 1 : 0)}
              totalCards={bodyCards.length + (showCover && project.coverImage ? 1 : 0)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function HiddenExportCards({
  project,
  bodyCards,
  Renderer,
}: {
  project: RedCardProject;
  bodyCards: BodyCard[];
  Renderer: ReturnType<typeof getRenderer>;
}) {
  return (
    <div className="hidden-export-cards" aria-hidden="true">
      {bodyCards.map((card, idx) => (
        <Renderer.BodyCard
          key={card.id}
          id={card.id}
          content={card.content}
          fontSize={project.fontSize}
          cardIndex={idx + (project.coverImage ? 1 : 0)}
          totalCards={bodyCards.length + (project.coverImage ? 1 : 0)}
        />
      ))}
    </div>
  );
}

function RuleModal({
  project,
  rules,
  setRules,
  ruleDraft,
  setRuleDraft,
  onSave,
  onClose,
}: {
  project: RedCardProject;
  rules: ReviewRule[];
  setRules: Dispatch<SetStateAction<ReviewRule[]>>;
  ruleDraft: { title: string; body: string; scope: RuleScope };
  setRuleDraft: Dispatch<SetStateAction<{ title: string; body: string; scope: RuleScope }>>;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <section className="rule-modal">
        <div className="modal-head">
          <div>
            <span className="label">KNOWLEDGE BASE</span>
            <h2 className="panel-title">知识档</h2>
            <p className="knowledge-desc">这里只沉淀自动总结和人工确认后的规则信息；每个项目完成时核查新增规则候选，每周汇总一次让你确认。</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className="rule-modal-grid">
          <div className="rule-compose">
            <div className="label">RULE CANDIDATE</div>
            <p className="small-note">完成项目后，把本次暴露出的稳定规则写成候选；周汇总时只确认真正值得长期保留的条目。</p>
            <div className="grid grid-cols-[120px_1fr] gap-3">
              <select value={ruleDraft.scope} onChange={(e) => setRuleDraft((r) => ({ ...r, scope: e.target.value as RuleScope }))} className="field-input">
                <option value="global">全局</option>
                <option value="article">长文</option>
                <option value="cover">封面</option>
                <option value="cards">卡片</option>
                <option value="export">导出</option>
              </select>
              <input value={ruleDraft.title} onChange={(e) => setRuleDraft((r) => ({ ...r, title: e.target.value }))} className="field-input" placeholder="规则标题，只记录最终确认版" />
            </div>
            <textarea
              value={ruleDraft.body}
              onChange={(e) => setRuleDraft((r) => ({ ...r, body: e.target.value }))}
              className="big-textarea min-h-[118px]"
              placeholder="例如：封面只用完整 AI 海报生成；人物要大，标题要大，禁止便利贴堆信息。"
            />
            <button className="black-btn w-full" onClick={onSave}>
              <Save className="w-3 h-3" />
              保存为已确认规则
            </button>
          </div>

          <div className="rule-library">
            <div className="label">RULES</div>
            <RuleList rules={rules} setRules={setRules} compact />
          </div>
        </div>
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  onFocus,
  sensitive = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onFocus?: () => void;
  sensitive?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <input
        type={sensitive ? 'password' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        className="field-input"
        placeholder={placeholder}
        autoComplete={sensitive ? 'off' : undefined}
        spellCheck={false}
      />
    </label>
  );
}

function formatReferenceName(image: { name: string; role?: CoverSourceRole }): string {
  const roleLabel = COVER_SOURCE_ROLES.find((role) => role.value === image.role)?.label;
  return roleLabel ? `${image.name} role=${roleLabel}` : image.name;
}

function ReferenceUploader({ project, updateProject }: { project: RedCardProject; updateProject: (patch: Partial<RedCardProject>) => void }) {
  return (
    <div>
      <span className="field-label">参考素材</span>
      <label className="upload-strip">
        <Plus className="w-4 h-4" />
        上传截图 / 人物图 / 访谈图
        <input
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={async (e) => {
            const files = Array.from(e.target.files || []) as File[];
            const refs = await Promise.all(files.map(async (file) => ({
              id: crypto.randomUUID(),
              name: file.name,
              dataUrl: await fileToDataUrl(file),
              role: 'scene' as CoverSourceRole,
            })));
            updateProject({ referenceImages: [...project.referenceImages, ...refs] });
            e.target.value = '';
          }}
        />
      </label>
      {!!project.referenceImages.length && (
        <div className="reference-grid">
          {project.referenceImages.map((img) => (
            <div key={img.id} className="reference-thumb">
              <img src={img.dataUrl} alt={img.name} />
              <button className="reference-remove" onClick={() => updateProject({ referenceImages: project.referenceImages.filter((x) => x.id !== img.id) })}>×</button>
              <div className="reference-role-row">
                {COVER_SOURCE_ROLES.map((role) => (
                  <button
                    key={role.value}
                    className={img.role === role.value ? 'active' : ''}
                    onClick={() => updateProject({
                      referenceImages: project.referenceImages.map((item) => (
                        item.id === img.id ? { ...item, role: role.value } : item
                      )),
                    })}
                    title={role.label}
                  >
                    {role.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AvatarUploader({ project, updateProject }: { project: RedCardProject; updateProject: (patch: Partial<RedCardProject>) => void }) {
  return (
    <div>
      <span className="field-label">头像</span>
      <label className="avatar-upload">
        {project.avatarImage ? <img src={project.avatarImage} alt="账号头像" /> : <Plus className="w-4 h-4" />}
        <span>{project.avatarImage ? '更换头像' : '上传默认头像'}</span>
        <input
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            updateProject({ avatarImage: await fileToDataUrl(file) });
            e.target.value = '';
          }}
        />
      </label>
    </div>
  );
}

function RuleList({ rules, setRules, compact = false }: { rules: ReviewRule[]; setRules: Dispatch<SetStateAction<ReviewRule[]>>; compact?: boolean }) {
  const [editing, setEditing] = useState<Record<string, { title: string; body: string; scope: RuleScope }>>({});

  async function reviseRule(rule: ReviewRule) {
    const draft = editing[rule.id];
    if (!draft?.title.trim() || !draft.body.trim()) return;
    const now = new Date().toISOString();
    const oldRule: ReviewRule = { ...rule, status: 'revised', updatedAt: now };
    const newRule: ReviewRule = {
      ...rule,
      id: crypto.randomUUID(),
      title: draft.title.trim(),
      body: draft.body.trim(),
      scope: draft.scope,
      status: 'active',
      version: rule.version + 1,
      supersedes: rule.id,
      createdAt: now,
      updatedAt: now,
    };
    await saveRule(oldRule);
    await saveRule(newRule);
    setRules((items) => [newRule, ...items.map((r) => (r.id === rule.id ? oldRule : r))]);
    setEditing((items) => {
      const next = { ...items };
      delete next[rule.id];
      return next;
    });
  }

  return (
    <div className="space-y-2">
      {rules.map((rule) => (
        <div key={rule.id} className={`rule-row ${compact ? 'compact' : ''}`}>
          <div>
            {editing[rule.id] ? (
              <div className="space-y-2">
                <select
                  value={editing[rule.id].scope}
                  onChange={(e) => setEditing((items) => ({ ...items, [rule.id]: { ...items[rule.id], scope: e.target.value as RuleScope } }))}
                  className="field-input"
                >
                  <option value="global">全局</option>
                  <option value="article">长文</option>
                  <option value="cover">封面</option>
                  <option value="cards">卡片</option>
                  <option value="export">导出</option>
                </select>
                <input
                  value={editing[rule.id].title}
                  onChange={(e) => setEditing((items) => ({ ...items, [rule.id]: { ...items[rule.id], title: e.target.value } }))}
                  className="field-input"
                />
                <textarea
                  value={editing[rule.id].body}
                  onChange={(e) => setEditing((items) => ({ ...items, [rule.id]: { ...items[rule.id], body: e.target.value } }))}
                  className="ai-box"
                />
              </div>
            ) : (
              <>
                <div className="rule-row-title">{rule.title}</div>
                <div className="rule-row-meta">v{rule.version} · {rule.scope} · {rule.status}</div>
                <div className="rule-row-body">{rule.body}</div>
                <div className="rule-row-usage">{ruleUsageLabel(rule)}</div>
              </>
            )}
          </div>
          <div className="rule-actions">
            <select
              value={rule.status}
              onChange={async (e) => {
                const next = { ...rule, status: e.target.value as ReviewRule['status'], updatedAt: new Date().toISOString() };
                await saveRule(next);
                setRules((items) => items.map((r) => (r.id === rule.id ? next : r)));
              }}
              className="field-input"
            >
              <option value="active">active</option>
              <option value="draft">draft</option>
              <option value="revised">revised</option>
              <option value="disabled">disabled</option>
            </select>
            {editing[rule.id] ? (
              <>
                <button className="micro-btn primary" onClick={() => reviseRule(rule)}>保存</button>
                <button className="micro-btn" onClick={() => setEditing((items) => {
                  const next = { ...items };
                  delete next[rule.id];
                  return next;
                })}>取消</button>
              </>
            ) : (
              <button
                className="micro-btn"
                onClick={() => setEditing((items) => ({ ...items, [rule.id]: { title: rule.title, body: rule.body, scope: rule.scope } }))}
              >
                修订
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ruleUsageLabel(rule: ReviewRule): string {
  if (rule.status !== 'active') return '未应用：只有 active 规则会进入生成链路';
  if (rule.scope === 'global') return '应用于：长文生成 / 文字卡片 / AI 封面全部链路';
  if (rule.scope === 'article') return '应用于：长文生成与长文修改链路';
  if (rule.scope === 'cards') return '应用于：文字卡片、AI Magic 排版与单页修改链路';
  if (rule.scope === 'cover') return '应用于：AI 封面生成与封面修改链路';
  if (rule.scope === 'export') return '应用于：全部导出链路';
  return '应用于：对应生成链路';
}

function RevisionList({ project, compact = false }: { project: RedCardProject; compact?: boolean }) {
  return (
    <div className={`revision-list ${compact ? 'compact' : ''}`}>
      <div className="label">PROJECT HISTORY</div>
      {!project.revisionLog.length && <p className="small-note">这个项目还没有 AI 操作记录。</p>}
      {project.revisionLog.slice(0, 12).map((item) => (
        <details key={item.id} className="revision-item">
          <summary>
            <span>{item.step}</span>
            <time>{new Date(item.createdAt).toLocaleString()}</time>
          </summary>
          {item.instruction && <p className="revision-instruction">{item.instruction}</p>}
          <pre>{item.result.slice(0, 1800)}</pre>
        </details>
      ))}
    </div>
  );
}

function ProviderModal({
  providers,
  setProviders,
  onClose,
}: {
  providers: ProviderConfig;
  setProviders: Dispatch<SetStateAction<ProviderConfig>>;
  onClose: () => void;
}) {
  const [testStatus, setTestStatus] = useState('');
  const [testing, setTesting] = useState<string | null>(null);
  const [promptHistoryOpen, setPromptHistoryOpen] = useState(false);

  async function importProviderConfig(file: File) {
    setTestStatus('正在导入 Provider JSON...');
    try {
      const json = JSON.parse(await file.text());
      setProviders((current) => mergeImportedProviderConfig(current, json));
      setTestStatus('Provider JSON 已导入。确认后点保存，API Key 只会保存在本机浏览器配置中。');
    } catch (err: any) {
      setTestStatus(`导入失败：${formatError(err)}`);
    }
  }

  async function testText() {
    setTesting('text');
    setTestStatus('正在测试文案模型...');
    try {
      const result = await callTextProvider(providers.text, '请只回复 OK。', {
        maxTokens: 20,
        temperature: 0,
        snapshot: { projectId: '', step: 'other', agent: 'providerTextTest' },
      });
      setTestStatus(`文案模型可用：${result.slice(0, 80)}`);
    } catch (err: any) {
      setTestStatus(`文案模型失败：${formatError(err)}`);
    } finally {
      setTesting(null);
    }
  }

  async function testImage() {
    setTesting('image');
    setTestStatus('正在测试生图模型，这会消耗一次图片调用...');
    try {
      await generateCoverImage(
        providers.image,
        '生成一张极简 3:4 测试图，米白背景，中心只有清晰文字 RedCard Test。',
        [],
        { projectId: '', step: 'cover', agent: 'providerImageTest' }
      );
      setTestStatus('生图模型可用：已返回图片。');
    } catch (err: any) {
      setTestStatus(`生图模型失败：${formatError(err)}`);
    } finally {
      setTesting(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl p-6 rounded-xl shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="panel-title">Provider 设置</h2>
          <button className="black-btn" onClick={onClose}><Save className="w-3 h-3" />保存</button>
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <div className="label">TEXT · Claude 中转</div>
            {!providers.text.relayUrl.trim() && providers.text.provider === 'claude_relay' && (
              <div className="config-warning">需要填写中转地址，否则长文生成会请求到本地 /v1/messages。</div>
            )}
            <SelectField
              label="模式"
              value={providers.text.provider}
              options={[
                ['claude_relay', 'Claude 中转'],
                ['claude_direct', 'Claude 直连'],
                ['openai_compatible', 'OpenAI-compatible'],
              ]}
              onChange={(provider) => setProviders((p) => ({ ...p, text: { ...p.text, provider: provider as ProviderConfig['text']['provider'] } }))}
            />
            <Field label="中转地址 / Base URL" value={providers.text.relayUrl} onChange={(relayUrl) => setProviders((p) => ({ ...p, text: { ...p.text, relayUrl } }))} />
            <Field label="API Key" value={providers.text.apiKey} sensitive onChange={(apiKey) => setProviders((p) => ({ ...p, text: { ...p.text, apiKey } }))} />
            <Field label="Model" value={providers.text.model} onChange={(model) => setProviders((p) => ({ ...p, text: { ...p.text, model } }))} />
            <button className="mini-btn bordered" onClick={testText} disabled={testing === 'text'}>
              {testing === 'text' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              测试文案连接
            </button>
          </div>
          <div className="space-y-3">
            <div className="label">IMAGE · image2 / OpenAI-compatible</div>
            <SelectField
              label="模式"
              value={providers.image.provider}
              options={[
                ['openai_images', 'Images API'],
                ['openai_responses', 'Responses image tool'],
                ['custom_relay', '自定义中转'],
              ]}
              onChange={(provider) => setProviders((p) => ({ ...p, image: { ...p.image, provider: provider as ProviderConfig['image']['provider'] } }))}
            />
            <Field label="中转地址 / Base URL" value={providers.image.relayUrl} onChange={(relayUrl) => setProviders((p) => ({ ...p, image: { ...p.image, relayUrl } }))} />
            <Field label="API Key" value={providers.image.apiKey} sensitive onChange={(apiKey) => setProviders((p) => ({ ...p, image: { ...p.image, apiKey, authHeader: '' } }))} />
            <Field label="Model" value={providers.image.model} onChange={(model) => setProviders((p) => ({ ...p, image: { ...p.image, model } }))} />
            <Field label="Size（3:4）" value={providers.image.size} onChange={(size) => setProviders((p) => ({ ...p, image: { ...p.image, size } }))} />
            <Field label="Quality" value={providers.image.quality} onChange={(quality) => setProviders((p) => ({ ...p, image: { ...p.image, quality } }))} />
            <button className="mini-btn bordered" onClick={testImage} disabled={testing === 'image'}>
              {testing === 'image' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Image className="w-3 h-3" />}
              测试生图连接
            </button>
          </div>
        </div>
        {testStatus && <div className="provider-test-status">{testStatus}</div>}
        <div className="mt-5 border-t border-neutral-200 pt-4">
          <div className="label">调试</div>
          <div className="flex flex-wrap gap-2 mt-2">
            <label className="mini-btn bordered cursor-pointer">
              <Settings className="w-3 h-3" />
              导入 Provider JSON
              <input
                type="file"
                accept="application/json,.json"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) await importProviderConfig(file);
                  e.target.value = '';
                }}
              />
            </label>
            <button className="mini-btn bordered" onClick={() => setPromptHistoryOpen(true)}>
              Prompt 历史
            </button>
          </div>
        </div>
        <p className="small-note mt-5">API Key 默认隐藏显示，只保存在本机浏览器配置中；不会写入项目、知识档、导出文件或操作历史。</p>
      </div>
      {promptHistoryOpen && <PromptHistoryModal onClose={() => setPromptHistoryOpen(false)} />}
    </div>
  );
}

function PromptHistoryModal({ onClose }: { onClose: () => void }) {
  const [snapshots, setSnapshots] = useState<PromptSnapshot[]>([]);
  const [selected, setSelected] = useState<PromptSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    const items = await listSnapshots({ limit: 100 });
    setSnapshots(items);
    setSelected((current) => current && items.find((item) => item.id === current.id) || null);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function clearAll() {
    if (!window.confirm('确认清空全部 Prompt 历史吗？')) return;
    await clearSnapshots();
    await refresh();
  }

  const newest = snapshots[0]?.createdAt;
  const oldest = snapshots[snapshots.length - 1]?.createdAt;

  return (
    <div className="fixed inset-0 z-[120] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-5xl max-h-[86vh] overflow-hidden rounded-xl shadow-2xl flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-neutral-200">
          <div>
            <h2 className="panel-title">Prompt 历史</h2>
            <p className="small-note">
              共 {snapshots.length} 条{newest ? ` · 最新 ${new Date(newest).toLocaleString()}` : ''}{oldest ? ` · 最早 ${new Date(oldest).toLocaleString()}` : ''}
            </p>
          </div>
          <div className="flex gap-2">
            <button className="mini-btn bordered" onClick={refresh}>刷新</button>
            <button className="mini-btn bordered" onClick={clearAll}>清空</button>
            <button className="black-btn" onClick={onClose}>关闭</button>
          </div>
        </div>
        <div className="grid md:grid-cols-[360px_1fr] min-h-0 flex-1">
          <div className="border-r border-neutral-200 overflow-auto p-3">
            {loading && <p className="small-note">正在读取...</p>}
            {!loading && !snapshots.length && <p className="small-note">还没有 Prompt 快照。生成一次长文、卡片或封面后再回来查看。</p>}
            {snapshots.map((item) => (
              <button
                key={item.id}
                className={`prompt-row ${selected?.id === item.id ? 'active' : ''}`}
                onClick={() => setSelected(item)}
              >
                <span>{new Date(item.createdAt).toLocaleString()}</span>
                <strong>{item.step} · {item.agent}</strong>
                <em>{item.modelConfig.model} · {Math.round(item.durationMs)}ms</em>
                <small>{item.response.extractedText?.slice(0, 100) || '无文本摘要'}</small>
              </button>
            ))}
          </div>
          <div className="overflow-auto p-4">
            {!selected && <p className="small-note">选择左侧一条记录查看完整 JSON。</p>}
            {selected && (
              <>
                <div className="flex justify-end mb-3">
                  <button className="mini-btn bordered" onClick={() => navigator.clipboard?.writeText(JSON.stringify(selected, null, 2))}>
                    复制 JSON
                  </button>
                </div>
                <pre className="prompt-json">{JSON.stringify(selected, null, 2)}</pre>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatError(err: any): string {
  const msg = redactSecrets(String(err?.message || err || '未知错误'));
  if (/来自 \/v1\/messages|请求地址：\/v1\/messages/.test(msg)) return '文案模型的中转地址为空，所以请求打到了本地 /v1/messages。请点右上角 API 配置，填写 Text 的中转地址 / Base URL。';
  if (/HTML 而不是 JSON|Unexpected token '<'/.test(msg)) return '中转地址返回了网页，不是 API JSON。请检查 Base URL 或 endpoint。';
  if (/non ISO-8859-1 code point|ByteString|Headers|Authorization 含有中文|API Key \/ Authorization 含有中文/.test(msg)) return 'Image API Key / Authorization 里混入了中文、全角符号、换行或整段 JSON。请清空 IMAGE 栏 API Key，只粘贴单行纯 key；不要带“Authorization:”标签或中文备注。';
  if (/生图鉴权失败 HTTP 401|生图鉴权失败 HTTP 403/.test(msg)) return msg.slice(0, 500);
  if (/401|403|unauthorized|forbidden/i.test(msg)) return '鉴权失败。请检查 API Key、Authorization 格式或中转额度。';
  if (/404|not found/i.test(msg)) return '接口路径不存在。请检查是否需要填写 Base URL，还是完整 /v1/... endpoint。';
  if (/生图请求被中转拒绝 HTTP 429/.test(msg)) return msg.slice(0, 500);
  if (/429/.test(msg)) return `中转返回 HTTP 429：${msg.slice(0, 450)}`;
  if (/insufficient_quota|quota|余额不足|额度不足|balance/i.test(msg)) return `中转返回额度错误：${msg.slice(0, 450)}`;
  if (/rate limit|too many requests|限流/i.test(msg)) return `中转返回限流错误：${msg.slice(0, 450)}`;
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return '浏览器请求失败，可能是 CORS 或中转地址不可访问。';
  return msg.slice(0, 500);
}

function mergeProviders(value: ProviderConfig): ProviderConfig {
  const text = { ...defaultProviders.text, ...(value?.text || {}) };
  const image = { ...defaultProviders.image, ...(value?.image || {}) };
  if (!image.size?.trim() || image.size === '1024x1536' || image.size === '1080x1440') image.size = defaultProviders.image.size;
  if (!image.quality?.trim()) image.quality = defaultProviders.image.quality;
  if (!image.model?.trim()) image.model = defaultProviders.image.model;
  return {
    text,
    image,
  };
}

function paginationMetrics(theme: RedCardProject['theme']) {
  if (theme === 'plain_markdown') return { width: 386, height: 492 };
  if (theme === 'swiss_grid') return { width: 398, height: 462 };
  if (theme === 'architectural_frame') return { width: 398, height: 450 };
  if (theme === 'terminal_tech') return { width: 398, height: 442 };
  return { width: 386, height: 448 };
}

function applyMarkdownToolbarAction(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  action: MarkdownToolbarAction
): { text: string; selectionStart: number; selectionEnd: number } {
  const selected = text.slice(selectionStart, selectionEnd);
  const lineStart = text.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;

  if (action === 'divider') {
    const lineEnd = findLineEnd(text, selectionStart);
    const currentLine = text.slice(lineStart, lineEnd);
    if (currentLine.trim() === '***') {
      const removeEnd = lineEnd < text.length ? lineEnd + 1 : lineEnd;
      return replaceSelection(text, lineStart, removeEnd, '', lineStart, lineStart);
    }
    return insertAtSelection(text, selectionStart, selectionEnd, '\n\n***\n\n');
  }

  if (action === 'bold') {
    return toggleInlineWrapper(text, selectionStart, selectionEnd, '**', '重点文字');
  }

  if (action === 'quote') {
    return toggleLinePrefix(text, selectionStart, selectionEnd, '> ');
  }

  if (action === 'h1') return toggleHeadingPrefix(text, selectionStart, selectionEnd, '# ');
  if (action === 'h2') return toggleHeadingPrefix(text, selectionStart, selectionEnd, '## ');
  return toggleLinePrefix(text, selectionStart, selectionEnd, '- ');
}

function insertAtSelection(text: string, selectionStart: number, selectionEnd: number, insertion: string) {
  return replaceSelection(text, selectionStart, selectionEnd, insertion, selectionStart + insertion.length, selectionStart + insertion.length);
}

function replaceSelection(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  replacement: string,
  nextSelectionStart: number,
  nextSelectionEnd: number
) {
  return {
    text: text.slice(0, selectionStart) + replacement + text.slice(selectionEnd),
    selectionStart: nextSelectionStart,
    selectionEnd: nextSelectionEnd,
  };
}

function toggleInlineWrapper(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  wrapper: string,
  placeholder: string
): { text: string; selectionStart: number; selectionEnd: number } {
  const selected = text.slice(selectionStart, selectionEnd);
  const before = text.slice(selectionStart - wrapper.length, selectionStart);
  const after = text.slice(selectionEnd, selectionEnd + wrapper.length);
  if (selected && before === wrapper && after === wrapper) {
    const start = selectionStart - wrapper.length;
    const end = selectionEnd + wrapper.length;
    return replaceSelection(text, start, end, selected, start, start + selected.length);
  }
  if (selected.startsWith(wrapper) && selected.endsWith(wrapper) && selected.length >= wrapper.length * 2) {
    const inner = selected.slice(wrapper.length, -wrapper.length);
    return replaceSelection(text, selectionStart, selectionEnd, inner, selectionStart, selectionStart + inner.length);
  }
  const body = selected || placeholder;
  const replacement = `${wrapper}${body}${wrapper}`;
  return replaceSelection(text, selectionStart, selectionEnd, replacement, selectionStart + wrapper.length, selectionStart + wrapper.length + body.length);
}

function toggleHeadingPrefix(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  prefix: '# ' | '## '
): { text: string; selectionStart: number; selectionEnd: number } {
  return transformSelectedLines(text, selectionStart, selectionEnd, (line) => {
    if (!line.trim()) return line;
    const withoutHeading = line.replace(/^(#{1,6}\s+)/, '');
    if (line.startsWith(prefix)) return withoutHeading;
    return `${prefix}${withoutHeading}`;
  });
}

function toggleLinePrefix(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  prefix: '> ' | '- '
): { text: string; selectionStart: number; selectionEnd: number } {
  const block = selectedLineBlock(text, selectionStart, selectionEnd);
  const lines = block.value.split('\n');
  const nonEmpty = lines.filter((line) => line.trim());
  const shouldRemove = nonEmpty.length > 0 && nonEmpty.every((line) => line.startsWith(prefix));
  const nextLines = lines.map((line) => {
    if (!line.trim()) return line;
    if (shouldRemove && line.startsWith(prefix)) return line.slice(prefix.length);
    return line.startsWith(prefix) ? line : `${prefix}${line}`;
  });
  return replaceSelection(text, block.start, block.end, nextLines.join('\n'), block.start, block.start + nextLines.join('\n').length);
}

function transformSelectedLines(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  transform: (line: string) => string
): { text: string; selectionStart: number; selectionEnd: number } {
  const block = selectedLineBlock(text, selectionStart, selectionEnd);
  const next = block.value.split('\n').map(transform).join('\n');
  return replaceSelection(text, block.start, block.end, next, block.start, block.start + next.length);
}

function selectedLineBlock(text: string, selectionStart: number, selectionEnd: number): { start: number; end: number; value: string } {
  const start = text.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;
  const end = findLineEnd(text, selectionEnd);
  return { start, end, value: text.slice(start, end) };
}

function findLineEnd(text: string, index: number): number {
  const end = text.indexOf('\n', index);
  return end === -1 ? text.length : end;
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="field-input">
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </label>
  );
}

function PageGutter({ index, label }: { index: number; label: string }) {
  return (
    <div className="absolute -left-12 top-2 flex flex-col items-end opacity-60 group-hover:opacity-100 transition-opacity">
      <span className="font-mono text-[11px] leading-none text-[var(--accent)]">[{String(index).padStart(2, '0')}]</span>
      <span className="text-[12px] font-mono tracking-[0.16em] text-[var(--accent)] uppercase mt-1">{label}</span>
    </div>
  );
}

function addLog(project: RedCardProject, step: WorkflowStep, instruction: string, result: string) {
  return [
    {
      id: crypto.randomUUID(),
      step,
      instruction,
      result,
      createdAt: new Date().toISOString(),
    },
    ...project.revisionLog.slice(0, 30),
  ];
}

function extractArticleMeta(text: string) {
  const title = matchMeta(text, ['标题', '大标题', '主标题']);
  const subtitle = matchMeta(text, ['副标题', '小标题']);
  const series = matchMeta(text, ['系列标签建议', '系列标签', '系列名称']);
  return { title, subtitle, series };
}

function stripArticleMeta(text: string) {
  return text
    .split('\n')
    .filter((line) => !/^#{0,3}\s*(标题|大标题|主标题|副标题|小标题|系列标签建议|系列标签|系列名称|封面方向)[:：]/.test(line.trim()))
    .join('\n')
    .replace(/^\s*正文[:：]\s*/m, '')
    .trim();
}

const MAX_CAPTION_BODY_LENGTH = 200;

function normalizePublishSentence(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/^#{1,6}\s*/g, '')
    .replace(/^\s*\d{1,2}\s*[｜|]\s*/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([，。！？；：、])\s*/g, '$1')
    .trim();
}

function makeCompleteCaptionBody(text: string): string {
  const normalized = normalizePublishSentence(text)
    .replace(/^(标题|正文|发布文案)[:：]/, '')
    .replace(/最戳中你$/, '')
    .trim();
  if (!normalized) return '';
  return /[。！？!?]$/.test(normalized) ? normalized : `${normalized}。`;
}

function stripTrailingTags(text: string): string {
  return normalizePublishText(text)
    .split(/\n+/)
    .filter((line) => !line.trim().startsWith('#'))
    .join(' ')
    .replace(/#[^#\s]+(?: [^#\s]+)?/g, '')
    .trim();
}

function normalizePublishText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*([，。！？；：、])\s*/g, '$1')
    .trim();
}

function captionBodyLength(text: string): number {
  return stripTrailingTags(text).length;
}

function uniqueList(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = item.trim();
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function clampCaption(text: string): string {
  const body = stripTrailingTags(text);
  const tags = extractHashTags(text);
  return [clampCaptionBody(body), uniqueList(tags).join(' ')].filter(Boolean).join('\n\n');
}

function extractHashTags(text: string): string[] {
  return Array.from(text.matchAll(/#[^#\s]+(?: [^#\s]+)?/g)).map((match) => match[0].trim());
}

function clampCaptionBody(text: string): string {
  const normalized = makeCompleteCaptionBody(text);
  if (normalized.length <= MAX_CAPTION_BODY_LENGTH) return normalized;
  const cut = normalized.slice(0, MAX_CAPTION_BODY_LENGTH);
  const lastStop = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'));
  const safe = lastStop > 45 ? cut.slice(0, lastStop + 1) : cut.replace(/[，、；：][^，、；：。！？!?]*$/, '');
  const complete = makeCompleteCaptionBody(safe || cut);
  if (complete.length <= MAX_CAPTION_BODY_LENGTH) return complete;
  return `${complete.slice(0, MAX_CAPTION_BODY_LENGTH - 1).replace(/[，、；：。！？!?]+$/, '')}。`;
}

function replaceCardText(source: string, oldLines: string[], replacement: string): string {
  const oldBlock = oldLines.join('\n');
  const idx = source.indexOf(oldBlock);
  if (idx === -1) return replacement.trim() + '\n\n' + source;
  return source.slice(0, idx) + replacement.trim() + source.slice(idx + oldBlock.length);
}

function cleanCardMarkdown(text: string, options: { collapseBlankLines?: boolean } = {}): string {
  const cleaned = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\u3000/g, ' ').replace(/[ \t]+/g, ' ').trim())
    .filter((line) => !/^\s*(-{2,}|—{2,}|_{2,}|\*{2,}|={2,}|·{3,})\s*$/.test(line))
    .join('\n')
    .replace(/^\s*(标题|副标题|正文|封面方向|系列标签建议)[:：].*$/gm, '')
    .trim();
  return options.collapseBlankLines ? cleaned.replace(/\n{4,}/g, '\n\n\n') : cleaned;
}

function suggestFontSize(text: string): number {
  const len = cleanCardMarkdown(text).replace(/\s/g, '').length;
  if (len > 1800) return 17;
  if (len > 1300) return 18;
  if (len < 700) return 20;
  return 19;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(',');
  const mime = meta.match(/data:(.*?);base64/)?.[1] || 'image/png';
  const binary = atob(b64 || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function slugName(name: string): string {
  return (name || 'redcard')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'redcard';
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = name;
  link.href = url;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function normalizeImageTo3x4(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => {
      const targetW = 1080;
      const targetH = 1440;
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      const ratio = img.width / img.height;
      const targetRatio = targetW / targetH;
      if (Math.abs(ratio - targetRatio) < 0.01) {
        ctx.drawImage(img, 0, 0, targetW, targetH);
        resolve(canvas.toDataURL('image/png'));
        return;
      }
      const scale = Math.max(targetW / img.width, targetH / img.height);
      const drawW = img.width * scale;
      const drawH = img.height * scale;
      const dx = (targetW - drawW) / 2;
      const dy = (targetH - drawH) / 2;
      ctx.drawImage(img, dx, dy, drawW, drawH);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function nextPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

const APP_CSS = `
body { font-family: var(--font-sans-en), var(--font-sans-cn); }
.font-serif { font-family: var(--font-serif-en), var(--font-serif-cn); }
.font-mono { font-family: var(--font-mono); }
.app-logo { font-family:var(--font-serif-en); font-style:italic; font-size:17px; font-weight:500; color:var(--ink-primary); line-height:1; }
.app-logo span { color:var(--accent); }
.app-divider { color:var(--ink-disabled); font-size:14px; }
.saved-status { font-family:var(--font-mono); font-size:11px; color:var(--ink-secondary); display:inline-flex; align-items:center; gap:6px; }
.saved-status .dot { color:var(--state-success); }
.saved-status.saving .dot { color:var(--state-warning); animation:blink 1s infinite; }
.saved-status.idle .dot { color:var(--ink-disabled); }
@keyframes blink { 50% { opacity:.35; } }
.ai-side { padding:24px 22px; }
.side-box { position:sticky; top:22px; display:flex; flex-direction:column; gap:14px; }
.side-stack { position:sticky; top:22px; display:flex; flex-direction:column; gap:18px; }
.side-ai-textarea { width:100%; min-height:320px; padding:13px 14px; resize:vertical; border:1px solid var(--line-default); border-radius:var(--radius-md); background:var(--bg-elevated); outline:none; font-size:var(--text-sm); line-height:1.75; color:var(--ink-primary); }
.side-ai-textarea:focus { border-color:var(--ink-primary); box-shadow:none; }
.spec-review { display:flex; flex-direction:column; gap:18px; padding:8px 0 32px; min-height:calc(100vh - 190px); }
.spec-review-head { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; padding-bottom:16px; border-bottom:1px solid var(--line-default); }
.spec-review-actions { display:flex; align-items:center; justify-content:flex-end; gap:10px; flex-wrap:wrap; }
.spec-review-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
.spec-field, .spec-array { display:flex; flex-direction:column; gap:8px; min-width:0; background:var(--bg-elevated); border:1px solid var(--line-default); border-radius:var(--radius-md); padding:14px 16px; }
.spec-field.full, .spec-array { grid-column:1 / -1; }
.spec-field span, .spec-array-head > span { font-family:var(--font-mono); font-size:11px; letter-spacing:.14em; color:var(--accent); text-transform:uppercase; }
.spec-field input, .spec-field textarea, .spec-array-row input { width:100%; border:0; outline:none; background:transparent; color:var(--ink-primary); font:14px/1.7 var(--font-sans-cn); }
.spec-field input { min-height:34px; border-bottom:1px solid var(--line-default); }
.spec-field textarea { min-height:96px; resize:vertical; border-top:1px solid var(--line-default); padding-top:10px; }
.spec-field input:focus, .spec-field textarea:focus, .spec-array-row input:focus { border-color:var(--ink-primary); }
.spec-array-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.spec-array-list { display:flex; flex-direction:column; gap:9px; }
.spec-array-row { display:grid; grid-template-columns:minmax(0,1fr) 28px; gap:8px; align-items:center; border-top:1px solid var(--line-default); padding-top:9px; }
.spec-review-footer { display:flex; justify-content:flex-end; gap:10px; padding-top:4px; }
.status-dot { font-size:11px; line-height:1; }
.status-dot.empty { color:var(--ink-disabled); }
.status-dot.focused { color:var(--accent); }
.status-dot.done { color:var(--state-success); }
.status-dot.warning { color:var(--state-warning); }
.help-icon { font-size:11px; color:var(--ink-disabled); cursor:help; position:relative; user-select:none; }
.help-icon:hover { color:var(--ink-secondary); }
.help-icon::after { content:attr(data-tip); position:absolute; right:0; top:calc(100% + 8px); background:var(--ink-primary); color:var(--ink-inverse); font-family:var(--font-sans-cn); font-size:12px; font-weight:400; letter-spacing:normal; line-height:1.5; padding:10px 14px; border-radius:4px; white-space:normal; width:240px; opacity:0; visibility:hidden; transition:opacity 150ms; z-index:20; pointer-events:none; box-shadow:var(--shadow-md); }
.help-icon:hover::after { opacity:1; visibility:visible; }
.num-accent { color:var(--accent); font-family:var(--font-mono); font-weight:500; }
.db-report { min-height:0; overflow:auto; }
.db-stats { font-family:var(--font-mono); font-size:11px; color:var(--ink-tertiary); display:flex; gap:16px; margin-bottom:12px; padding-bottom:10px; border-bottom:1px dashed var(--line-default); }
.db-report pre { white-space:pre-wrap; margin:0; font-size:11px; color:var(--ink-secondary); line-height:1.7; font-family:var(--font-sans-cn); }
.db-check-module { grid-column:1 / -1; border-top:1px solid var(--line-default); padding-top:22px; margin-top:2px; display:flex; flex-direction:column; gap:14px; }
.db-side-box { border-top:1px solid var(--line-default); padding-top:16px; display:flex; flex-direction:column; gap:12px; }
.db-side-box h3 { font-family:var(--font-serif-en),var(--font-serif-cn); font-style:italic; font-size:20px; font-weight:500; line-height:1; }
.db-check-module h3 { font-family:var(--font-serif-en),var(--font-serif-cn); font-style:italic; font-size:var(--text-h2); font-weight:500; line-height:1; }
.db-check-target { display:grid; grid-template-columns:1fr 160px; gap:14px; }
.db-check-target.compact { grid-template-columns:1fr; gap:8px; }
.db-check-target div { border-top:1px solid var(--line-default); padding-top:10px; min-width:0; }
.db-check-target span { display:block; font-size:var(--text-micro); letter-spacing:.16em; color:var(--ink-tertiary); font-weight:500; text-transform:uppercase; margin-bottom:5px; }
.db-check-target strong { display:block; font-size:var(--text-sm); color:var(--ink-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.db-check-report { width:100%; min-height:240px; resize:vertical; border:1px solid var(--line-default); border-radius:var(--radius-md); background:var(--bg-elevated); outline:none; padding:14px; font-family:var(--font-sans-cn); font-size:var(--text-sm); line-height:1.8; color:var(--ink-secondary); }
.db-check-report.side { min-height:180px; max-height:260px; font-size:12px; }
.db-check-report:focus { border-color:var(--ink-primary); box-shadow:none; }
.work-pane { min-width:0; display:flex; flex-direction:column; gap:14px; }
.pane-head { display:flex; align-items:center; justify-content:space-between; gap:14px; min-height:32px; }
.studio-textarea { width:100%; flex:1; min-height:560px; resize:vertical; border:0; border-top:1px solid var(--line-default); border-bottom:1px solid var(--line-default); background:transparent; outline:none; padding:18px 2px; font-family:var(--font-sans-cn); font-size:15px; line-height:1.9; color:var(--ink-primary); }
.studio-textarea:focus { border-color:var(--ink-primary); }
.label, .field-label { display:block; font-family:var(--font-mono); font-size:12px; font-weight:500; letter-spacing:.16em; color:var(--accent); text-transform:uppercase; margin-bottom:7px; }
.field-label-row { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.field-label-row .field-label { margin-bottom:7px; }
.field-label-row span:last-child { font-family:var(--font-mono); font-size:11px; color:var(--ink-tertiary); margin-bottom:7px; }
.field-label-row .field-actions { display:inline-flex; align-items:center; gap:10px; font-family:var(--font-mono); font-size:11px; color:var(--ink-tertiary); margin-bottom:7px; }
.field-label-row .field-actions .mini-btn { font-family:var(--font-sans-cn); margin-bottom:0; }
.panel-title { font-family:var(--font-serif-en),var(--font-serif-cn); font-style:italic; font-size:var(--text-h2); font-weight:500; line-height:1; }
.black-btn { display:inline-flex; align-items:center; justify-content:center; gap:7px; background:var(--ink-primary); color:var(--ink-inverse); padding:9px 14px; border-radius:var(--radius-md); font-size:var(--text-xs); font-weight:500; letter-spacing:0; transition:background var(--duration) var(--ease); white-space:nowrap; }
.black-btn:hover { background:var(--ink-secondary); }
.black-btn:disabled { background:var(--bg-muted); color:var(--ink-disabled); cursor:not-allowed; }
.icon-btn { width:32px; height:32px; display:flex; align-items:center; justify-content:center; color:var(--ink-tertiary); border-radius:var(--radius-sm); }
.icon-btn:hover { color:var(--ink-primary); background:var(--bg-muted); }
.mini-btn { display:inline-flex; align-items:center; gap:5px; font-size:var(--text-xs); color:var(--ink-secondary); padding:5px 8px; border-radius:var(--radius-md); }
.mini-btn.bordered { border:1px solid var(--ink-primary); color:var(--ink-primary); }
.mini-btn:hover, .mini-square:hover { background:var(--bg-muted); color:var(--ink-primary); }
.mini-square { width:26px; height:26px; border:1px solid var(--line-default); border-radius:var(--radius-md); }
.big-textarea, .ai-box { width:100%; background:var(--bg-elevated); border:1px solid var(--line-default); border-radius:var(--radius-md); outline:none; color:var(--ink-primary); }
.field-input, .field-select { width:100%; background:transparent; border:0; border-bottom:1px solid var(--line-default); border-radius:0; outline:none; color:var(--ink-primary); }
.big-textarea { padding:13px 14px; resize:vertical; font-family:var(--font-sans-cn); font-size:var(--text-body); line-height:1.8; }
.ai-box { min-height:82px; padding:11px 12px; resize:vertical; font-size:13px; line-height:1.65; }
.field-input, .field-select { padding:10px 0; font-size:var(--text-body); }
.field-select { appearance:none; cursor:pointer; }
.big-textarea:focus, .ai-box:focus, .field-input:focus, .field-select:focus { border-color:var(--ink-primary); box-shadow:none; }
.segmented { display:flex; gap:6px; }
.segmented button { flex:1; padding:8px; border:1px solid var(--line-default); border-radius:var(--radius-md); font-size:var(--text-xs); color:var(--ink-secondary); }
.segmented button.active { background:var(--ink-primary); color:var(--ink-inverse); }
.palette-segmented { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:6px; }
.palette-segmented button { min-width:0; display:flex; align-items:center; justify-content:center; gap:5px; padding:8px 6px; border:1px solid var(--line-default); border-radius:var(--radius-md); font-size:var(--text-xs); color:var(--ink-secondary); white-space:nowrap; }
.palette-segmented button span { width:10px; height:10px; border-radius:50%; border:1px solid rgba(0,0,0,.12); flex:0 0 auto; }
.palette-segmented button.active { border-color:var(--ink-primary); background:var(--ink-primary); color:var(--ink-inverse); }
.upload-strip { display:flex; align-items:center; justify-content:center; gap:8px; min-height:46px; border:1px dashed var(--ink-disabled); border-radius:var(--radius-md); font-size:var(--text-xs); color:var(--ink-secondary); cursor:pointer; }
.upload-strip:hover { border-color:var(--ink-primary); color:var(--ink-primary); background:var(--bg-muted); }
.avatar-upload { display:flex; align-items:center; gap:10px; min-height:46px; border:1px dashed var(--ink-disabled); border-radius:var(--radius-md); padding:8px 10px; font-size:var(--text-xs); color:var(--ink-secondary); cursor:pointer; }
.avatar-upload:hover { border-color:var(--ink-primary); color:var(--ink-primary); background:var(--bg-muted); }
.avatar-upload img { width:34px; height:34px; border-radius:50%; object-fit:cover; display:block; }
.cover-generate { min-width:116px; height:38px; }
.reference-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-top:10px; }
.reference-thumb { position:relative; aspect-ratio:1; border-radius:var(--radius-md); overflow:hidden; background:var(--bg-muted); }
.reference-thumb img { width:100%; height:100%; object-fit:cover; display:block; }
.reference-remove { position:absolute; right:4px; top:4px; width:20px; height:20px; border-radius:50%; background:rgba(255,255,255,.9); font-size:13px; }
.reference-role-row { position:absolute; left:4px; right:4px; bottom:4px; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:3px; }
.reference-role-row button { min-width:0; height:19px; border-radius:3px; background:rgba(255,255,255,.84); color:var(--ink-secondary); font-size:9px; line-height:1; overflow:hidden; white-space:nowrap; }
.reference-role-row button.active { background:var(--ink-primary); color:var(--ink-inverse); }
.cover-history { border-top:1px solid var(--line-default); padding-top:16px; }
.cover-history-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
.cover-history-grid button { aspect-ratio:3/4; border:1px solid var(--line-default); border-radius:var(--radius-md); overflow:hidden; background:var(--bg-muted); }
.cover-history-grid button.active { outline:2px solid var(--accent); outline-offset:2px; }
.cover-history-grid img { width:100%; height:100%; object-fit:cover; display:block; }
.prompt-details { border:1px solid var(--line-default); border-radius:var(--radius-md); margin-bottom:10px; background:var(--bg-elevated); }
.prompt-details summary { cursor:pointer; padding:9px 11px; font-size:11px; color:var(--ink-secondary); font-weight:500; }
.prompt-details pre { white-space:pre-wrap; padding:0 11px 11px; margin:0; max-height:240px; overflow:auto; font-size:11px; line-height:1.6; color:var(--ink-secondary); }
.rules-preview { white-space:pre-wrap; font-size:11px; line-height:1.65; color:var(--ink-secondary); background:var(--bg-elevated); border:1px solid var(--line-default); padding:10px; border-radius:var(--radius-md); max-height:150px; overflow:auto; }
.rule-row { display:grid; grid-template-columns:minmax(0,1fr) 182px; gap:18px; align-items:start; padding:13px 0; border-bottom:1px solid var(--line-subtle); background:transparent; }
.rule-row.compact { grid-template-columns:minmax(0,1fr) 172px; }
.rule-row:first-child { padding-top:0; }
.rule-row:last-child { border-bottom:0; padding-bottom:0; }
.rule-row-title { font-size:13px; font-weight:700; color:var(--ink-primary); line-height:1.4; }
.rule-row-meta { font-family:var(--font-mono); font-size:10px; color:var(--ink-tertiary); margin-top:3px; letter-spacing:.04em; }
.rule-row-body { font-size:12px; color:var(--ink-secondary); line-height:1.65; margin-top:6px; }
.rule-row-usage { margin-top:7px; font-size:11px; line-height:1.5; color:var(--accent); }
.rule-actions { display:flex; align-items:center; justify-content:flex-end; gap:8px; flex-wrap:wrap; }
.rule-actions .field-input { width:96px; font-size:11px; padding:4px 0; }
.micro-btn { display:inline-flex; align-items:center; justify-content:center; height:24px; padding:0 9px; border:1px solid var(--line-default); border-radius:var(--radius-sm); background:transparent; color:var(--ink-secondary); font-size:11px; line-height:1; cursor:pointer; }
.micro-btn:hover { border-color:var(--ink-primary); color:var(--ink-primary); background:var(--bg-muted); }
.micro-btn.primary { background:var(--ink-primary); border-color:var(--ink-primary); color:var(--ink-inverse); }
.revision-list { border-top:1px solid var(--line-default); padding-top:16px; margin-top:4px; }
.revision-list.compact { max-height:220px; overflow:auto; }
.revision-item { border:1px solid var(--line-default); border-radius:var(--radius-md); background:var(--bg-elevated); overflow:hidden; }
.revision-item summary { cursor:pointer; display:flex; justify-content:space-between; gap:12px; padding:10px 12px; font-size:11px; color:var(--ink-secondary); font-weight:500; text-transform:uppercase; letter-spacing:.08em; }
.revision-item time { color:var(--ink-disabled); font-weight:500; text-transform:none; letter-spacing:0; }
.revision-item pre { white-space:pre-wrap; margin:0; padding:0 12px 12px; font-size:11px; line-height:1.65; color:var(--ink-secondary); max-height:220px; overflow:auto; }
.revision-instruction { margin:0 12px 8px; font-size:11px; color:var(--accent); line-height:1.6; }
.small-note { font-size:11px; line-height:1.7; color:var(--ink-tertiary); }
.provider-test-status { margin-top:16px; padding:10px 12px; border-left:2px solid var(--accent); background:var(--accent-soft); color:var(--ink-secondary); font-size:var(--text-xs); line-height:1.7; white-space:pre-wrap; }
.config-warning { padding:9px 10px; border:1px solid var(--accent-soft); background:var(--accent-soft); color:var(--ink-secondary); border-radius:var(--radius-md); font-size:11px; line-height:1.6; }
.prompt-row { width:100%; text-align:left; display:flex; flex-direction:column; gap:4px; padding:10px; border:1px solid var(--line-subtle); border-radius:var(--radius-md); background:var(--bg-base); margin-bottom:8px; cursor:pointer; }
.prompt-row.active { border-color:var(--accent); background:var(--accent-soft); }
.prompt-row span, .prompt-row em, .prompt-row small { font-size:10px; line-height:1.45; color:var(--ink-tertiary); font-style:normal; }
.prompt-row strong { font-size:12px; color:var(--ink-primary); }
.prompt-json { margin:0; padding:12px; border:1px solid var(--line-default); border-radius:var(--radius-md); background:var(--bg-elevated); white-space:pre-wrap; overflow:auto; font-size:11px; line-height:1.55; color:var(--ink-secondary); }
.modal-backdrop { position:fixed; inset:0; z-index:100; display:flex; align-items:center; justify-content:center; padding:24px; background:rgba(26,26,26,.28); backdrop-filter:blur(10px); }
.rule-modal { width:min(1040px, calc(100vw - 48px)); max-height:calc(100vh - 48px); overflow:auto; background:var(--bg-base); border:1px solid var(--line-default); border-radius:var(--radius-lg); box-shadow:var(--shadow-lg); padding:22px; }
.modal-head { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; padding-bottom:18px; border-bottom:1px solid var(--line-default); margin-bottom:22px; }
.knowledge-desc { margin:10px 0 0; font-size:12px; line-height:1.7; color:var(--ink-tertiary); max-width:680px; }
.learning-inbox, .applied-rules { border:1px solid var(--line-default); border-radius:var(--radius-md); background:var(--bg-elevated); padding:14px; margin-bottom:18px; }
.learning-inbox-head { display:grid; grid-template-columns:1fr minmax(220px,360px); gap:18px; align-items:end; padding-bottom:12px; border-bottom:1px solid var(--line-default); margin-bottom:12px; }
.learning-inbox-head h3 { font-family:var(--font-serif-en),var(--font-serif-cn); font-style:italic; font-size:20px; font-weight:500; line-height:1; margin:0; }
.learning-inbox-head p { margin:0; font-size:11px; line-height:1.7; color:var(--ink-tertiary); }
.learning-list { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:10px; }
.learning-item { display:grid; grid-template-columns:1fr auto; gap:12px; align-items:start; padding:10px; border:1px solid var(--line-subtle); border-radius:var(--radius-md); background:var(--bg-base); }
.learning-item span { display:block; font-family:var(--font-mono); font-size:10px; letter-spacing:.14em; color:var(--accent); text-transform:uppercase; margin-bottom:5px; }
.learning-item strong { display:block; font-size:12px; color:var(--ink-primary); margin-bottom:5px; }
.learning-item p { margin:0; font-size:11px; line-height:1.65; color:var(--ink-secondary); }
.applied-rule-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
.rule-usage-card { display:grid; grid-template-columns:1fr auto; gap:10px; align-items:start; padding:12px; border:1px solid var(--line-subtle); border-radius:var(--radius-md); background:var(--bg-base); }
.rule-usage-card span { display:block; font-family:var(--font-mono); font-size:10px; letter-spacing:.14em; color:var(--accent); text-transform:uppercase; margin-bottom:5px; }
.rule-usage-card strong { display:block; font-size:12px; color:var(--ink-primary); margin-bottom:5px; }
.rule-usage-card p { margin:0; font-size:11px; line-height:1.65; color:var(--ink-secondary); }
.rule-usage-card b { font-size:20px; line-height:1; }
.rule-usage-card ul { grid-column:1 / -1; margin:2px 0 0; padding:8px 0 0; border-top:1px dashed var(--line-default); list-style:none; display:flex; flex-direction:column; gap:4px; }
.rule-usage-card li { font-size:11px; line-height:1.45; color:var(--ink-tertiary); }
.rule-modal-grid { display:grid; grid-template-columns:330px minmax(0,1fr); gap:26px; align-items:start; }
.rule-compose, .rule-library { min-width:0; display:flex; flex-direction:column; gap:12px; }
.rule-library { max-height:560px; overflow:auto; padding-right:6px; }
.rule-library .space-y-2 { display:flex; flex-direction:column; gap:0; }
.rule-library .rule-row { grid-template-columns:minmax(0,1fr) 172px; }
.custom-scrollbar::-webkit-scrollbar { width:5px; }
.custom-scrollbar::-webkit-scrollbar-track { background:transparent; }
.custom-scrollbar::-webkit-scrollbar-thumb { background:var(--line-default); border-radius:0; }
`;
