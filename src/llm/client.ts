import type { ImageProviderConfig, TextProviderConfig } from '../types';
import { isV21Enabled } from '../config.ts';
import { captureSnapshot, type PromptSnapshot } from '../utils/promptSnapshot.ts';
import { lintLongform, type LintViolation } from '../validators/longformLint.ts';
import type { ContentSpec } from '../spec/contentSpec.ts';

interface ClaudeProviderConfig {
  provider: 'claude_relay' | 'claude_direct';
  apiKey: string;
  relayUrl: string;
  model: string;
}

/**
 * Accept any of:
 *   https://relay.example.com
 *   https://relay.example.com/
 *   https://relay.example.com/v1
 *   https://relay.example.com/v1/messages
 * → always returns ".../v1/messages"
 */
export function normalizeRelayUrl(input: string): string {
  let u = input.trim().replace(/\/+$/, ''); // strip trailing slashes
  if (!u) {
    throw new Error('文案模型还没有填写 Claude 中转地址。请点右上角 API 配置，填写 Text 的中转地址 / Base URL 后再生成长文。');
  }
  if (/\/v1\/messages$/.test(u)) return u;
  if (/\/v1$/.test(u)) return u + '/messages';
  return u + '/v1/messages';
}

export interface CallLLMOptions {
  system?: string;
  maxTokens?: number;
  temperature?: number;
  snapshot?: {
    projectId?: string;
    step: PromptSnapshot['step'];
    agent: string;
    metadata?: Record<string, any>;
  };
}

export type TextPromptInput = string | {
  prompt: string;
  messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  system?: string;
  metadata?: Record<string, any>;
};

export interface LongformLintCallResult {
  text: string;
  attempts: number;
  violations: LintViolation[];
  warnings: LintViolation[];
  warning?: string;
}

export async function callTextProvider(
  cfg: TextProviderConfig,
  input: TextPromptInput,
  opts: CallLLMOptions = {}
): Promise<string> {
  const payload = normalizeTextPrompt(input);
  const mergedOpts = {
    ...opts,
    system: opts.system || payload.system,
    snapshot: opts.snapshot ? { ...opts.snapshot, metadata: { ...payload.metadata, ...opts.snapshot.metadata } } : undefined,
  };
  if (shouldLintLongformPrompt(payload.prompt)) {
    const result = await generateLongformWithLint(cfg, payload, mergedOpts);
    return result.text;
  }
  return rawCallTextProvider(cfg, payload, mergedOpts);
}

export async function generateLongformWithLint(
  cfg: TextProviderConfig,
  input: TextPromptInput,
  opts: CallLLMOptions = {},
  generate: (prompt: TextPromptInput, callOpts?: CallLLMOptions) => Promise<string> = (prompt, callOpts = opts) => rawCallTextProvider(cfg, normalizeTextPrompt(prompt), callOpts)
): Promise<LongformLintCallResult> {
  const payload = normalizeTextPrompt(input);
  const contentSpec = resolveContentSpec(payload, opts);
  let attempts = 1;
  let lastPromptPayload: ReturnType<typeof normalizeTextPrompt> = payload;
  let currentText = await generate(lastPromptPayload, withLintMetadata(opts, attempts));
  if (!isV21Enabled()) {
    return { text: currentText, attempts, violations: [], warnings: [] };
  }
  let result = lintLongform(currentText, contentSpec);

  while (!result.passed && attempts < 3) {
    if (isDebugLintEnabled()) {
      console.debug(`[lint] attempt ${attempts} failed:`, result.violations);
    }
    attempts += 1;
    const retryPayload = buildLongformFixPayload({
      originalPayload: payload,
      previousPromptPayload: lastPromptPayload,
      previousText: currentText,
      fixPromptForModel: result.fixPromptForModel,
      violations: result.violations,
      includeSelfReview: attempts === 3,
    });
    lastPromptPayload = normalizeTextPrompt(retryPayload);
    currentText = await generate(retryPayload, withLintMetadata(opts, attempts));
    result = lintLongform(currentText, contentSpec);
  }

  if (result.passed) {
    return { text: currentText, attempts, violations: [], warnings: result.warnings };
  }

  if (isDebugLintEnabled()) {
    console.debug(`[lint] exhausted after ${attempts} attempts:`, result.violations);
  }

  return {
    text: currentText,
    attempts,
    violations: result.violations,
    warnings: result.warnings,
    warning: '自动修订三次后仍有问题未解决，请人工审阅',
  };
}

function resolveContentSpec(payload: ReturnType<typeof normalizeTextPrompt>, opts: CallLLMOptions): ContentSpec | null {
  return (payload.metadata?.contentSpec || opts.snapshot?.metadata?.contentSpec || null) as ContentSpec | null;
}

async function rawCallTextProvider(
  cfg: TextProviderConfig,
  payload: ReturnType<typeof normalizeTextPrompt>,
  opts: CallLLMOptions = {}
): Promise<string> {
  validateTextProvider(cfg);
  if (cfg.provider === 'claude_direct' || cfg.provider === 'claude_relay') {
    const compat: ClaudeProviderConfig = {
      provider: cfg.provider,
      apiKey: cfg.apiKey,
      relayUrl: cfg.relayUrl,
      model: cfg.model,
    };
    return callClaudeLike(compat, payload, opts);
  }

  const url = normalizeOpenAIChatUrl(cfg.relayUrl);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const system = opts.system || payload.system;
  const messages = system ? [{ role: 'system' as const, content: system }, ...payload.messages] : payload.messages;
  const raw = await callModelWithSnapshot(
    {
      projectId: opts.snapshot?.projectId ?? '',
      step: opts.snapshot?.step ?? 'other',
      agent: opts.snapshot?.agent ?? 'textProvider',
      fullMessages: messages,
      systemPrompt: system,
      modelConfig: {
        provider: cfg.provider,
        model: cfg.model,
        temperature: opts.temperature ?? 0.7,
        maxTokens: opts.maxTokens ?? 4096,
      },
      metadata: opts.snapshot?.metadata ?? {},
    },
    async () => {
      const res = await proxiedFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 4096,
    }),
      });
      const raw = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}\n${raw.slice(0, 300)}`);
      return raw;
    }
  );
  const data = JSON.parse(raw);
  return data?.choices?.[0]?.message?.content || data?.content?.[0]?.text || raw;
}

function normalizeTextPrompt(input: TextPromptInput): {
  prompt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  system: string;
  fullMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  metadata: Record<string, any>;
} {
  if (typeof input === 'string') {
    const messages = [{ role: 'user' as const, content: input }];
    return { prompt: input, messages, system: '', fullMessages: messages, metadata: {} };
  }
  const rawMessages = input.messages?.length ? input.messages : [{ role: 'user' as const, content: input.prompt }];
  const system = [
    input.system,
    ...rawMessages.filter((message) => message.role === 'system').map((message) => message.content),
  ].filter(Boolean).join('\n\n');
  const messages = rawMessages.filter((message): message is { role: 'user' | 'assistant'; content: string } => message.role !== 'system');
  const safeMessages = messages.length ? messages : [{ role: 'user' as const, content: input.prompt }];
  return {
    prompt: input.prompt,
    messages: safeMessages,
    system,
    fullMessages: system ? [{ role: 'system' as const, content: system }, ...safeMessages] : safeMessages,
    metadata: input.metadata || {},
  };
}

function withLintMetadata(opts: CallLLMOptions, attempt: number): CallLLMOptions {
  if (!opts.snapshot) return opts;
  return {
    ...opts,
    snapshot: {
      ...opts.snapshot,
      metadata: {
        ...opts.snapshot.metadata,
        lintRetryAttempt: attempt,
      },
    },
  };
}

function shouldLintLongformPrompt(prompt: string): boolean {
  return prompt.includes('可发布的小红书认知干货长文') || prompt.includes('重写当前小红书长文');
}

function buildLongformFixPrompt(input: {
  originalPrompt: string;
  previousPrompt: string;
  previousText: string;
  fixPromptForModel: string;
  violations: LintViolation[];
  includeSelfReview: boolean;
}): string {
  const selfReview = input.includeSelfReview
    ? `
【上一轮失败请求快照】
${input.previousPrompt}

【上一轮违规列表】
${JSON.stringify(input.violations, null, 2)}

请先在心里确认你已经理解这些违规点，再重写。最终输出只给重写后的完整长文，不要输出确认过程。`
    : '';

  return `${input.originalPrompt}

【上一次生成结果】
${input.previousText}

【必须修复的问题】
${input.fixPromptForModel}
${selfReview}

请基于原始素材和本次修复要求，重新输出完整长文。不要解释，不要输出修改说明。`;
}

function buildLongformFixPayload(input: {
  originalPayload: ReturnType<typeof normalizeTextPrompt>;
  previousPromptPayload: ReturnType<typeof normalizeTextPrompt>;
  previousText: string;
  fixPromptForModel: string;
  violations: LintViolation[];
  includeSelfReview: boolean;
}): TextPromptInput {
  const prompt = buildLongformFixPrompt({
    originalPrompt: input.originalPayload.prompt,
    previousPrompt: input.previousPromptPayload.prompt,
    previousText: input.previousText,
    fixPromptForModel: input.fixPromptForModel,
    violations: input.violations,
    includeSelfReview: input.includeSelfReview,
  });
  const baseMessages = input.originalPayload.fullMessages.length ? input.originalPayload.fullMessages : input.originalPayload.messages;
  const messages = baseMessages.length
    ? [...baseMessages.slice(0, -1), { role: 'user' as const, content: prompt }]
    : [{ role: 'user' as const, content: prompt }];
  return {
    prompt,
    messages,
    metadata: input.originalPayload.metadata,
  };
}

function isDebugLintEnabled(): boolean {
  return Boolean(
    import.meta.env?.VITE_DEBUG_LINT ||
    (typeof process !== 'undefined' && process.env?.DEBUG_LINT)
  );
}

async function callModelWithSnapshot(
  context: {
    projectId: string;
    step: PromptSnapshot['step'];
    agent: string;
    fullMessages: Array<{ role: string; content: any }>;
    systemPrompt: string;
    modelConfig: PromptSnapshot['modelConfig'];
    metadata: Record<string, any>;
  },
  run: () => Promise<any>
): Promise<any> {
  const start = performance.now();
  let response: any;
  let error: unknown;
  try {
    response = await run();
  } catch (err) {
    error = err;
  }
  const durationMs = performance.now() - start;
  const extractedText = error ? '' : extractSnapshotText(response);
  const lintMetadata = buildSnapshotLintMetadata(extractedText, context.metadata);
  await captureSnapshot({
    projectId: context.projectId,
    step: context.step,
    agent: context.agent,
    fullMessages: context.fullMessages,
    systemPrompt: context.systemPrompt,
    modelConfig: context.modelConfig,
    response: error
      ? { raw: { error: String((error as any)?.message || error) } }
      : { raw: snapshotRaw(response), extractedText },
    metadata: {
      ...context.metadata,
      ...lintMetadata,
    },
    durationMs,
  });
  if (error) throw error;
  return response;
}

function buildSnapshotLintMetadata(
  extractedText: string,
  metadata: Record<string, any>
): Record<string, any> {
  if (!extractedText || !metadata.contentSpec) return {};
  const lint = lintLongform(extractedText, metadata.contentSpec);
  return {
    lintPassed: lint.passed,
    lintViolations: lint.violations,
    lintWarnings: lint.warnings,
  };
}

function snapshotRaw(response: any): any {
  if (typeof response !== 'string') return response;
  if (response.length <= 6000) return response;
  return `${response.slice(0, 3000)}\n...[SNAPSHOT_TRUNCATED ${response.length - 6000} chars]...\n${response.slice(-3000)}`;
}

function extractSnapshotText(response: any): string {
  if (typeof response === 'string') {
    try {
      const parsed = JSON.parse(response);
      return parsed?.choices?.[0]?.message?.content || parsed?.content?.[0]?.text || response.slice(0, 500);
    } catch {
      return response.slice(0, 500);
    }
  }
  return String(response ?? '').slice(0, 500);
}

function validateTextProvider(cfg: TextProviderConfig) {
  if (cfg.provider === 'claude_direct' && !cfg.apiKey.trim()) {
    throw new Error('文案模型还没有填写 Claude API Key。请点右上角 API 配置，填写 Text 的 API Key 后再生成长文。');
  }
  if (cfg.provider === 'claude_relay' && !cfg.relayUrl.trim()) {
    throw new Error('文案模型还没有填写 Claude 中转地址。请点右上角 API 配置，填写 Text 的中转地址 / Base URL 后再生成长文。');
  }
  if (cfg.provider === 'openai_compatible' && !cfg.relayUrl.trim() && !cfg.apiKey.trim()) {
    throw new Error('文案模型还没有配置 OpenAI-compatible 地址或 API Key。请点右上角 API 配置后再生成长文。');
  }
}

function normalizeOpenAIChatUrl(input: string): string {
  const u = input.trim().replace(/\/+$/, '');
  if (!u) return 'https://api.openai.com/v1/chat/completions';
  if (/\/v1\/chat\/completions$/.test(u)) return u;
  if (/\/v1$/.test(u)) return u + '/chat/completions';
  return u + '/v1/chat/completions';
}

async function callClaudeLike(
  cfg: ClaudeProviderConfig,
  payload: ReturnType<typeof normalizeTextPrompt>,
  opts: CallLLMOptions = {}
): Promise<string> {
  const body = {
    model: cfg.model,
    max_tokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0.7,
    ...(opts.system || payload.system ? { system: opts.system || payload.system } : {}),
    messages: payload.messages,
  };
  const system = opts.system || payload.system;

  const url =
    cfg.provider === 'claude_direct'
      ? 'https://api.anthropic.com/v1/messages'
      : normalizeRelayUrl(cfg.relayUrl);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (cfg.provider === 'claude_direct') {
    headers['x-api-key'] = cfg.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  } else if (cfg.apiKey) {
    headers.Authorization = `Bearer ${cfg.apiKey}`;
  }

  const rawText = await callModelWithSnapshot(
    {
      projectId: opts.snapshot?.projectId ?? '',
      step: opts.snapshot?.step ?? 'other',
      agent: opts.snapshot?.agent ?? 'textProvider',
      fullMessages: system ? [{ role: 'system', content: system }, ...payload.messages] : payload.messages,
      systemPrompt: system,
      modelConfig: {
        provider: cfg.provider,
        model: cfg.model,
        temperature: opts.temperature ?? 0.7,
        maxTokens: opts.maxTokens ?? 4096,
      },
      metadata: opts.snapshot?.metadata ?? {},
    },
    async () => {
      const res = await proxiedFetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      const rawText = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} 来自 ${url}\n响应：${rawText.slice(0, 300)}`);
      return rawText;
    }
  );
  const trimmed = rawText.trimStart();
  if (trimmed.startsWith('<') || trimmed.toLowerCase().startsWith('<!doctype')) {
    throw new Error(`中转返回 HTML 而不是 JSON。\n请求地址：${url}`);
  }
  const data = JSON.parse(rawText);
  if (Array.isArray(data?.content)) {
    return data.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('');
  }
  if (data?.choices?.[0]?.message?.content) return String(data.choices[0].message.content);
  if (data?.error?.message) throw new Error(`API 错误：${data.error.message}`);
  throw new Error(`LLM 返回格式无法解析：${rawText.slice(0, 300)}`);
}

export async function generateCoverImage(
  cfg: ImageProviderConfig,
  prompt: string,
  referenceImages: CoverImageReferences = [],
  snapshot?: CallLLMOptions['snapshot']
): Promise<string> {
  const safeCfg = normalizeImageConfig(cfg);
  assertImageAuthConfigured(safeCfg);
  const references = normalizeCoverImageReferences(referenceImages);
  const allReferenceImages = [...references.styleReferenceImages, ...references.sourceImages];
  if (cfg.provider === 'openai_responses') {
    return generateWithResponses(safeCfg, prompt, references, snapshot);
  }
  if (allReferenceImages.length > 0) {
    return generateWithImageEdits(safeCfg, prompt, allReferenceImages, snapshot);
  }
  return generateWithImagesEndpoint(safeCfg, prompt, allReferenceImages, snapshot);
}

export interface CoverImageReferenceGroups {
  styleReferenceImages?: string[];
  sourceImages?: string[];
}

export type CoverImageReferences = string[] | CoverImageReferenceGroups;

function normalizeCoverImageReferences(referenceImages: CoverImageReferences): Required<CoverImageReferenceGroups> {
  if (Array.isArray(referenceImages)) {
    return {
      styleReferenceImages: [],
      sourceImages: referenceImages,
    };
  }
  return {
    styleReferenceImages: referenceImages.styleReferenceImages || [],
    sourceImages: referenceImages.sourceImages || [],
  };
}

function normalizeImageConfig(cfg: ImageProviderConfig): ImageProviderConfig {
  return {
    ...cfg,
    apiKey: cfg.apiKey?.trim() || '',
    authHeader: cfg.authHeader?.trim() || '',
    model: cfg.model?.trim() || 'gpt-image-2',
    size: cfg.size?.trim() || '1056x1408',
    quality: cfg.quality?.trim() || 'high',
  };
}

function assertImageAuthConfigured(cfg: ImageProviderConfig): void {
  const auth = imageAuthHeader(cfg);
  if (cfg.provider !== 'custom_relay' && !auth) {
    throw new Error('生图模型的 Image API Key 为空。请在 API 配置里重新导入 Provider JSON，并确认 IMAGE 栏的 API Key 已填写后保存。');
  }
  if (auth && /[^\x20-\x7E]/.test(auth)) {
    throw new Error('生图模型的 Image API Key / Authorization 含有中文、全角符号或其他非 ASCII 字符。请清空 IMAGE 栏 API Key，只粘贴纯 key；不要粘贴整段 JSON、中文备注或“Authorization:”标签。');
  }
  if (auth && /[\r\n]/.test(auth)) {
    throw new Error('生图模型的 Image API Key / Authorization 含有换行。请清空 IMAGE 栏 API Key，只粘贴单行纯 key。');
  }
}

function imageAuthHeader(cfg: ImageProviderConfig): string {
  const apiKey = cfg.apiKey?.trim();
  if (apiKey) {
    if (/^(Bearer|Basic)\s+/i.test(apiKey)) return apiKey;
    return `Bearer ${apiKey}`;
  }
  return '';
}

function normalizeImageBaseUrl(input: string): string {
  const base = input.trim().replace(/\/+$/, '');
  if (!base) return 'https://api.openai.com';
  if (/\/v1\/images\/generations$/.test(base)) return base.replace(/\/v1\/images\/generations$/, '');
  if (/\/v1\/responses$/.test(base)) return base.replace(/\/v1\/responses$/, '');
  if (/\/v1$/.test(base)) return base.replace(/\/v1$/, '');
  return base;
}

function imageSnapshotContext(
  cfg: ImageProviderConfig,
  prompt: string,
  snapshot: CallLLMOptions['snapshot'],
  metadata: Record<string, any>
) {
  return {
    projectId: snapshot?.projectId ?? '',
    step: snapshot?.step ?? 'cover',
    agent: snapshot?.agent ?? 'coverImageGenerator',
    fullMessages: [{ role: 'user', content: prompt }],
    systemPrompt: '',
    modelConfig: {
      provider: cfg.provider,
      model: cfg.model,
    },
    metadata: {
      ...metadata,
      ...snapshot?.metadata,
      size: cfg.size,
      quality: cfg.quality,
    },
  };
}

async function generateWithImagesEndpoint(
  cfg: ImageProviderConfig,
  prompt: string,
  referenceImages: string[],
  snapshot?: CallLLMOptions['snapshot']
): Promise<string> {
  const referenceNote = referenceImages.length
    ? `\n\n参考图片已经由用户上传，若当前中转不支持图像输入，请尽量根据用户文字要求还原其真实素材感。`
    : '';
  const raw = await callModelWithSnapshot(
    imageSnapshotContext(cfg, prompt + referenceNote, snapshot, { endpoint: '/v1/images/generations', referenceImageCount: referenceImages.length }),
    async () => {
      let lastError = '';
      for (const attemptCfg of imageRequestConfigs(cfg)) {
        const base = normalizeImageBaseUrl(attemptCfg.relayUrl);
        const url = attemptCfg.provider === 'custom_relay' && attemptCfg.relayUrl.trim().endsWith('/v1/images/generations')
          ? attemptCfg.relayUrl.trim()
          : `${base}/v1/images/generations`;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const auth = imageAuthHeader(attemptCfg);
        if (auth) headers.Authorization = auth;
      const res = await fetchImageProvider(cfg, url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: attemptCfg.model,
      prompt: prompt + referenceNote,
      size: attemptCfg.size,
      quality: attemptCfg.quality,
      n: 1,
    }),
      });
      const raw = await res.text();
        if (res.ok) return raw;
        lastError = formatImageHttpError(res.status, raw);
        if (!shouldTryNextImageConfig(cfg, attemptCfg, res.status)) break;
      }
      throw new Error(lastError || '生图失败：中转没有返回错误详情。');
    }
  );
  const data = JSON.parse(raw);
  const item = data?.data?.[0] || data?.output?.[0] || data;
  if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
  if (item?.url) return fetchImageAsDataUrl(item.url);
  if (item?.image_base64) return `data:image/png;base64,${item.image_base64}`;
  throw new Error(`生图返回格式无法解析：${raw.slice(0, 500)}`);
}

async function generateWithImageEdits(
  cfg: ImageProviderConfig,
  prompt: string,
  referenceImages: string[],
  snapshot?: CallLLMOptions['snapshot']
): Promise<string> {
  const raw = await callModelWithSnapshot(
    imageSnapshotContext(cfg, prompt, snapshot, { endpoint: '/v1/images/edits', referenceImageCount: referenceImages.length }),
    async () => {
      let lastError = '';
      for (const attemptCfg of imageRequestConfigs(cfg)) {
        const base = normalizeImageBaseUrl(attemptCfg.relayUrl);
        const url = `${base}/v1/images/edits`;
        const form = new FormData();
        form.append('model', attemptCfg.model);
        form.append('prompt', prompt);
        form.append('size', attemptCfg.size);
        form.append('quality', attemptCfg.quality);
        form.append('n', '1');
        const imageField = imageEditFieldName(attemptCfg);
        referenceImages.forEach((dataUrl, index) => {
          form.append(imageField, dataUrlToBlob(dataUrl), `reference-${index + 1}.png`);
        });
        const headers: Record<string, string> = {};
        const auth = imageAuthHeader(attemptCfg);
        if (auth) headers.Authorization = auth;
      const res = await fetchImageProvider(attemptCfg, url, { method: 'POST', headers, body: form });
      const raw = await res.text();
        if (res.ok) return raw;
        lastError = formatImageHttpError(res.status, raw);
        if (!shouldTryNextImageConfig(cfg, attemptCfg, res.status)) break;
      }
      throw new Error(lastError || '生图失败：中转没有返回错误详情。');
    }
  );
  const data = JSON.parse(raw);
  const item = data?.data?.[0] || data?.output?.[0] || data;
  if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
  if (item?.url) return fetchImageAsDataUrl(item.url);
  if (item?.image_base64) return `data:image/png;base64,${item.image_base64}`;
  throw new Error(`生图返回格式无法解析：${raw.slice(0, 500)}`);
}

async function generateWithResponses(
  cfg: ImageProviderConfig,
  prompt: string,
  referenceImages: Required<CoverImageReferenceGroups>,
  snapshot?: CallLLMOptions['snapshot']
): Promise<string> {
  const referenceImageCount = referenceImages.styleReferenceImages.length + referenceImages.sourceImages.length;
  const raw = await callModelWithSnapshot(
    imageSnapshotContext(cfg, prompt, snapshot, {
      endpoint: '/v1/responses',
      referenceImageCount,
      styleReferenceImageCount: referenceImages.styleReferenceImages.length,
      sourceImageCount: referenceImages.sourceImages.length,
    }),
    async () => {
      let lastError = '';
      for (const attemptCfg of imageRequestConfigs(cfg)) {
        const base = normalizeImageBaseUrl(attemptCfg.relayUrl);
        const url = `${base}/v1/responses`;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const auth = imageAuthHeader(attemptCfg);
        if (auth) headers.Authorization = auth;
        const requestBody = buildResponsesImageRequestBody(attemptCfg, prompt, referenceImages);
      const res = await fetchImageProvider(cfg, url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
      });
      const raw = await res.text();
        if (res.ok) return raw;
        lastError = formatImageHttpError(res.status, raw);
        if (!shouldTryNextImageConfig(cfg, attemptCfg, res.status)) break;
      }
      throw new Error(lastError || '生图失败：中转没有返回错误详情。');
    }
  );
  const data = JSON.parse(raw);
  const b64 = findImageBase64(data);
  if (b64) return `data:image/png;base64,${b64}`;
  const urlResult = findImageUrl(data);
  if (urlResult) return fetchImageAsDataUrl(urlResult);
  throw new Error(`Responses 生图返回格式无法解析：${raw.slice(0, 500)}`);
}

export function buildResponsesImageRequestBody(
  cfg: ImageProviderConfig,
  prompt: string,
  referenceImages: CoverImageReferences = []
) {
  const references = normalizeCoverImageReferences(referenceImages);
  const content: any[] = [{ type: 'input_text', text: prompt }];
  if (references.styleReferenceImages.length) {
    content.push({
      type: 'input_text',
      text: '以下是 style reference 参考图。只学习风格语法：整体气质、色彩关系、大字重量、构图比例、留白密度和信息密度。严禁直接改这些图，严禁复制具体版式、模板结构、人物、人脸、文字、底部条、carousel 圆点、页码点或边角标签。',
    });
    references.styleReferenceImages.forEach((image_url) => content.push({ type: 'input_image', image_url }));
  }
  if (references.sourceImages.length) {
    content.push({
      type: 'input_text',
      text: '以下是 source 素材。它们优先级高于任何风格参考；人物、截图或场景必须成为封面核心素材。若有用户上传的人物图，必须使用该人物本人，不能换成陌生人或风格参考图里的人。',
    });
    references.sourceImages.forEach((image_url) => content.push({ type: 'input_image', image_url }));
  }
  return {
    model: cfg.model,
    input: [{ role: 'user', content }],
    tools: [{ type: 'image_generation', size: cfg.size, quality: cfg.quality }],
  };
}

// In the browser, route https calls through a same-origin proxy
// (`/__redcard_image_proxy`) so they bypass CORS. The proxy is provided by the
// Vite dev/preview middleware locally, and by `_worker.js` on Cloudflare Pages.
// Used for both text and image provider calls.
function proxiedFetch(url: string, init: RequestInit): Promise<Response> {
  if (isBrowserRuntime() && /^https:\/\//i.test(url)) {
    return fetch(`/__redcard_image_proxy?target=${encodeURIComponent(url)}`, init);
  }
  return fetch(url, init);
}

function fetchImageProvider(_cfg: ImageProviderConfig, url: string, init: RequestInit): Promise<Response> {
  return proxiedFetch(url, init);
}

function imageRequestConfigs(cfg: ImageProviderConfig): ImageProviderConfig[] {
  if (isApiYiRelay(cfg) && cfg.model.trim() === 'gpt-image-2') {
    return [cfg, { ...cfg, model: 'gpt-image-2-all' }];
  }
  return [cfg];
}

function shouldTryNextImageConfig(original: ImageProviderConfig, attempted: ImageProviderConfig, status: number): boolean {
  return isApiYiRelay(original)
    && original.model.trim() === 'gpt-image-2'
    && attempted.model.trim() === 'gpt-image-2'
    && (status === 403 || status === 429);
}

function imageEditFieldName(cfg: ImageProviderConfig): 'image' | 'image[]' {
  return isApiYiRelay(cfg) ? 'image[]' : 'image';
}

function isApiYiRelay(cfg: ImageProviderConfig): boolean {
  return /(^|\/\/|\.)(apiyi\.com|api\.apiyi\.com)(\/|$)/i.test(cfg.relayUrl);
}

function formatImageHttpError(status: number, raw: string): string {
  const detail = extractProviderErrorDetail(raw);
  if (status === 401 || status === 403) return `生图鉴权失败 HTTP ${status}：${detail}`;
  if (status === 429) return `生图请求被中转拒绝 HTTP 429：${detail}`;
  return `生图失败 HTTP ${status}：${detail}`;
}

function extractProviderErrorDetail(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '中转没有返回错误详情。';
  try {
    const data = JSON.parse(trimmed);
    const error = data?.error || data;
    const parts = [
      error?.message,
      error?.localized_message,
      error?.type ? `type=${error.type}` : '',
      error?.code ? `code=${error.code}` : '',
      error?.param ? `param=${error.param}` : '',
    ].filter(Boolean);
    if (parts.length) return parts.join('；').slice(0, 500);
  } catch {
    // Fall through to raw text. Many relay errors are plain text.
  }
  return trimmed.slice(0, 500);
}

function isBrowserRuntime(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function findImageBase64(value: any): string | null {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.b64_json === 'string') return value.b64_json;
  if (typeof value.image_base64 === 'string') return value.image_base64;
  if (typeof value.result === 'string' && /^[A-Za-z0-9+/=]+$/.test(value.result.slice(0, 80))) return value.result;
  for (const v of Object.values(value)) {
    if (Array.isArray(v)) {
      for (const item of v) {
        const found = findImageBase64(item);
        if (found) return found;
      }
    } else {
      const found = findImageBase64(v);
      if (found) return found;
    }
  }
  return null;
}

function findImageUrl(value: any): string | null {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.url === 'string' && /^https?:/.test(value.url)) return value.url;
  for (const v of Object.values(value)) {
    if (Array.isArray(v)) {
      for (const item of v) {
        const found = findImageUrl(item);
        if (found) return found;
      }
    } else {
      const found = findImageUrl(v);
      if (found) return found;
    }
  }
  return null;
}

async function fetchImageAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`图片下载失败 HTTP ${res.status}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(',');
  const mime = meta.match(/data:(.*?);base64/)?.[1] || 'image/png';
  const binary = atob(b64 || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
