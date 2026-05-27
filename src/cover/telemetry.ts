import type { ImageProviderConfig } from '../types.ts';

export interface CoverTelemetryEntry {
  id: string;
  projectId: string;
  createdAt: string;
  durationMs: number;
  provider: string;
  model: string;
  size: string;
  quality: string;
  selectedPalette: {
    family: string;
    bgMode: string;
  };
  styleReferenceImageCount: number;
  sourceImageCount: number;
  hasAvatar: boolean;
  promptLength: number;
  output: {
    normalizedSize: '1080x1440';
    format: 'png-data-url';
  };
  visualSelfCheck: Array<{
    rule: string;
    status: 'pass' | 'warn';
    note: string;
  }>;
  estimatedCostUsd: number | null;
}

export function buildCoverTelemetry(input: {
  projectId: string;
  startedAt: number;
  provider: ImageProviderConfig;
  selectedPalette: CoverTelemetryEntry['selectedPalette'];
  styleReferenceImageCount: number;
  sourceImageCount: number;
  hasAvatar: boolean;
  prompt: string;
}): CoverTelemetryEntry {
  return {
    id: createTelemetryId(),
    projectId: input.projectId,
    createdAt: new Date().toISOString(),
    durationMs: Math.max(0, Math.round(performanceNow() - input.startedAt)),
    provider: input.provider.provider,
    model: input.provider.model,
    size: input.provider.size,
    quality: input.provider.quality,
    selectedPalette: input.selectedPalette,
    styleReferenceImageCount: input.styleReferenceImageCount,
    sourceImageCount: input.sourceImageCount,
    hasAvatar: input.hasAvatar,
    promptLength: input.prompt.length,
    output: {
      normalizedSize: '1080x1440',
      format: 'png-data-url',
    },
    visualSelfCheck: buildVisualSelfCheck({
      prompt: input.prompt,
      styleReferenceImageCount: input.styleReferenceImageCount,
      sourceImageCount: input.sourceImageCount,
      hasAvatar: input.hasAvatar,
    }),
    estimatedCostUsd: estimateImageCostUsd(input.provider),
  };
}

export async function persistCoverTelemetry(entry: CoverTelemetryEntry): Promise<void> {
  if (isNodeRuntime()) {
    await appendTelemetryJsonl(entry);
    return;
  }
  persistTelemetryToBrowser(entry);
}

export function estimateImageCostUsd(provider: Pick<ImageProviderConfig, 'model' | 'size' | 'quality'>): number | null {
  const key = `${provider.model}:${provider.quality}:${provider.size}`.toLowerCase();
  const prices: Record<string, number> = {
    'gpt-image-1:low:1024x1024': 0.011,
    'gpt-image-1:low:1024x1536': 0.016,
    'gpt-image-1:low:1536x1024': 0.016,
    'gpt-image-1:medium:1024x1024': 0.042,
    'gpt-image-1:medium:1024x1536': 0.063,
    'gpt-image-1:medium:1536x1024': 0.063,
    'gpt-image-1:high:1024x1024': 0.167,
    'gpt-image-1:high:1024x1536': 0.25,
    'gpt-image-1:high:1536x1024': 0.25,
  };
  return prices[key] ?? null;
}

function buildVisualSelfCheck(input: {
  prompt: string;
  styleReferenceImageCount: number;
  sourceImageCount: number;
  hasAvatar: boolean;
}): CoverTelemetryEntry['visualSelfCheck'] {
  return [
    {
      rule: 'palette locked',
      status: /本次封面使用 palette/.test(input.prompt) ? 'pass' : 'warn',
      note: 'Prompt contains the resolved palette token block.',
    },
    {
      rule: 'five cover laws',
      status: /五条铁律/.test(input.prompt) ? 'pass' : 'warn',
      note: 'Prompt carries the Day 8 cover voice profile.',
    },
    {
      rule: 'source image role',
      status: input.sourceImageCount > 0 ? 'pass' : 'warn',
      note: input.sourceImageCount > 0
        ? `${input.sourceImageCount} source image(s) were sent after style references.`
        : 'No source images were provided for this run.',
    },
    {
      rule: 'style anchors',
      status: input.styleReferenceImageCount > 0 ? 'pass' : 'warn',
      note: input.styleReferenceImageCount > 0
        ? `${input.styleReferenceImageCount} style anchor(s) were sent first.`
        : 'No verified anchor exists for this palette slot.',
    },
    {
      rule: 'avatar post-process',
      status: input.hasAvatar ? 'pass' : 'warn',
      note: input.hasAvatar
        ? 'Avatar was composited after generation.'
        : 'No avatar was uploaded, so only prompt-level account spacing applies.',
    },
  ];
}

function persistTelemetryToBrowser(entry: CoverTelemetryEntry): void {
  if (typeof localStorage === 'undefined') return;
  const key = 'redcard-cover-telemetry';
  const current = JSON.parse(localStorage.getItem(key) || '[]') as CoverTelemetryEntry[];
  localStorage.setItem(key, JSON.stringify([entry, ...current].slice(0, 100)));
}

async function appendTelemetryJsonl(entry: CoverTelemetryEntry): Promise<void> {
  const fs = await importNodeModule<typeof import('node:fs/promises')>('node:fs/promises');
  const path = await importNodeModule<typeof import('node:path')>('node:path');
  const output = path.resolve(telemetryPath());
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.appendFile(output, `${JSON.stringify(entry)}\n`, 'utf8');
}

function telemetryPath(): string {
  const proc = (globalThis as any).process;
  return proc?.env?.COVER_TELEMETRY_PATH || 'snapshots/cover/telemetry.jsonl';
}

function createTelemetryId(): string {
  const cryptoApi = (globalThis as any).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `cover-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function performanceNow(): number {
  return (globalThis as any).performance?.now?.() ?? Date.now();
}

function isNodeRuntime(): boolean {
  const proc = (globalThis as any).process;
  return Boolean(proc?.versions?.node);
}

function importNodeModule<T>(specifier: string): Promise<T> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (value: string) => Promise<T>;
  return dynamicImport(specifier);
}
