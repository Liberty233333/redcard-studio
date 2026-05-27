import { isV21Enabled } from '../config.ts';
import { exemplarRegistry } from './_exemplars.generated.ts';

export interface Exemplar {
  id: string;
  sourceMaterial: string;
  finalArticle: string;
  tags: {
    contentType: string;
    performedWellOn: string;
  };
}

export interface FewShotInjection {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  injectedExemplarIds: string[];
}

const exemplars: Exemplar[] = exemplarRegistry.map((item) => ({
  id: item.id,
  sourceMaterial: item.sourceMaterial,
  finalArticle: item.finalArticle,
  tags: {
    contentType: item.tags.contentType,
    performedWellOn: item.tags.performedWellOn,
  },
}));

export function injectFewShot(options: {
  count?: number;
  contentTypeHint?: string;
  pool?: Exemplar[];
} = {}): FewShotInjection {
  if (!isV21Enabled()) {
    return { messages: [], injectedExemplarIds: [] };
  }
  const count = options.count ?? 2;
  if (count <= 0) {
    return { messages: [], injectedExemplarIds: [] };
  }
  const candidates = options.pool ?? exemplars;
  if (!candidates.length) {
    console.warn('[few-shot] exemplar-articles.md 为空或未生成，已降级为 zero-shot。');
    return { messages: [], injectedExemplarIds: [] };
  }

  const matching = options.contentTypeHint
    ? candidates.filter((item) => item.tags.contentType === options.contentTypeHint)
    : [];
  const fallback = candidates.filter((item) => !matching.some((match) => match.id === item.id));
  const pool = [...shuffle(matching), ...shuffle(fallback)];
  const selected = pool.slice(0, Math.min(count, pool.length));
  if (selected.length < count) {
    console.warn(`[few-shot] 可用 exemplar 只有 ${selected.length} 个，少于请求的 ${count} 个。`);
  }

  return {
    messages: selected.flatMap((item) => [
      {
        role: 'user' as const,
        content: `以下是一段原始素材：\n\n${item.sourceMaterial}\n\n请按账号的风格整理成小红书长文。`,
      },
      { role: 'assistant' as const, content: item.finalArticle },
    ]),
    injectedExemplarIds: selected.map((item) => item.id),
  };
}

export function listExemplars(): Exemplar[] {
  return [...exemplars];
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
