import { patternRegistry } from './_patterns.generated.ts';
import type { ContentSpec } from '../spec/contentSpec.ts';

export type ViolationCategory = 'syntax' | 'phrase' | 'empty-praise' | 'opening' | 'spec-must-keep' | 'spec-must-avoid';

export interface LintViolation {
  level: 'violation' | 'warn';
  pattern: string;
  category: ViolationCategory;
  location: {
    start: number;
    end: number;
    excerpt: string;
  };
  fixInstruction: string;
  note?: string;
  occurrence?: {
    count: number;
    max: number;
  };
}

export interface LintResult {
  passed: boolean;
  violations: LintViolation[];
  warnings: LintViolation[];
  fixPromptForModel: string;
}

interface CompiledRegistry {
  syntax: Array<{ regex: RegExp; pattern: string; maxOccurrences: number | null }>;
  phrase: string[];
  emptyPraise: string[];
  opening: Array<{ regex: RegExp; pattern: string }>;
  fixTemplates: typeof patternRegistry.fixTemplates;
}

const registry: CompiledRegistry = {
  syntax: patternRegistry.syntax.map((item) => ({
    pattern: item.pattern,
    regex: new RegExp(item.source, item.flags || 'g'),
    maxOccurrences: item.maxOccurrences ?? null,
  })),
  phrase: [...patternRegistry.phrase],
  emptyPraise: [...patternRegistry.emptyPraise],
  opening: patternRegistry.opening.map((item) => ({ pattern: item.pattern, regex: new RegExp(item.source, 'g') })),
  fixTemplates: patternRegistry.fixTemplates,
};

export function lintLongform(text: string, spec?: ContentSpec | null): LintResult {
  const violations: LintViolation[] = [];
  const warnings: LintViolation[] = [];
  const source = text || '';

  for (const item of registry.syntax) {
    const matches = [...source.matchAll(reset(item.regex))];
    const allowedCount = item.maxOccurrences ?? 0;
    const reportable = item.maxOccurrences === null ? matches : matches.slice(allowedCount);
    for (const match of reportable) {
      const matchedText = match[0];
      const start = match.index ?? 0;
      const occurrenceIndex = matches.indexOf(match) + 1;
      violations.push(createViolation(
        source,
        item.pattern,
        'syntax',
        start,
        start + matchedText.length,
        item.maxOccurrences === null
          ? undefined
          : {
              note: `已出现 ${occurrenceIndex} 次（上限 ${item.maxOccurrences} 次）`,
              occurrence: { count: occurrenceIndex, max: item.maxOccurrences },
            }
      ));
    }
  }

  for (const phrase of registry.phrase) {
    collectLiteralViolations(source, phrase, 'phrase', violations);
  }

  for (const phrase of registry.emptyPraise) {
    collectLiteralViolations(source, phrase, 'empty-praise', violations);
  }

  const trimmedStartOffset = source.length - source.trimStart().length;
  const openingText = source.trimStart().slice(0, 50);
  for (const item of registry.opening) {
    for (const match of openingText.matchAll(reset(item.regex))) {
      const matchedText = match[0];
      const start = trimmedStartOffset + (match.index ?? 0);
      violations.push(createViolation(source, item.pattern, 'opening', start, start + matchedText.length));
    }
  }

  if (spec) {
    collectSpecViolations(source, spec, violations, warnings);
  }

  const sorted = violations.sort((a, b) => a.location.start - b.location.start || a.pattern.localeCompare(b.pattern));
  const sortedWarnings = warnings.sort((a, b) => a.location.start - b.location.start || a.pattern.localeCompare(b.pattern));
  return {
    passed: sorted.length === 0,
    violations: sorted,
    warnings: sortedWarnings,
    fixPromptForModel: sorted.length ? buildFixPrompt(sorted) : '',
  };
}

function collectLiteralViolations(
  source: string,
  phrase: string,
  category: Extract<ViolationCategory, 'phrase' | 'empty-praise'>,
  violations: LintViolation[]
) {
  let index = source.indexOf(phrase);
  while (index >= 0) {
    violations.push(createViolation(source, phrase, category, index, index + phrase.length));
    index = source.indexOf(phrase, index + phrase.length);
  }
}

function createViolation(
  source: string,
  pattern: string,
  category: ViolationCategory,
  start: number,
  end: number,
  metadata: { note?: string; occurrence?: LintViolation['occurrence'] } = {}
): LintViolation {
  return {
    level: metadata.note?.startsWith('WARN:') ? 'warn' : 'violation',
    pattern,
    category,
    location: {
      start,
      end,
      excerpt: excerpt(source, start, end),
    },
    fixInstruction: fixInstructionFor(category, pattern),
    note: metadata.note,
    occurrence: metadata.occurrence,
  };
}

function collectSpecViolations(
  source: string,
  spec: ContentSpec,
  violations: LintViolation[],
  warnings: LintViolation[]
): void {
  for (const fact of spec.mustKeepFacts || []) {
    const keywords = extractSpecKeywords(fact).slice(0, 3);
    if (!keywords.length) continue;
    const found = keywords.some((keyword) => source.includes(keyword));
    if (!found) {
      warnings.push({
        level: 'warn',
        pattern: `mustKeepFact:${fact}`,
        category: 'spec-must-keep',
        location: {
          start: 0,
          end: 0,
          excerpt: `缺失事实：${fact}`,
        },
        fixInstruction: `补回 SPEC 要求保留的事实：${fact}。至少自然写入这些关键词之一：${keywords.join('、')}。不要编造新事实。`,
      });
    }
  }

  for (const avoid of spec.mustAvoid || []) {
    const pattern = specAvoidPattern(avoid);
    if (!pattern) continue;
    const match = source.match(pattern);
    if (!match) continue;
    const matchedText = match[0];
    const start = match.index ?? 0;
    violations.push({
      level: 'violation',
      pattern: `mustAvoid:${avoid}`,
      category: 'spec-must-avoid',
      location: {
        start,
        end: start + matchedText.length,
        excerpt: excerpt(source, start, start + matchedText.length),
      },
      fixInstruction: `删除或改写 SPEC 明确要求避免的内容：${avoid}。保留文章核心论点，但不要沿用这个方向、措辞或暗示。`,
    });
  }
}

function excerpt(source: string, start: number, end: number): string {
  const beforeStart = Math.max(0, start - 20);
  const afterEnd = Math.min(source.length, end + 20);
  const prefix = beforeStart > 0 ? '…' : '';
  const suffix = afterEnd < source.length ? '…' : '';
  return `${prefix}${source.slice(beforeStart, afterEnd)}${suffix}`.replace(/\s+/g, ' ');
}

function fixInstructionFor(category: ViolationCategory, pattern: string): string {
  if (category === 'spec-must-keep' || category === 'spec-must-avoid') return pattern;
  if (category === 'syntax') {
    return registry.fixTemplates.syntax[pattern as keyof typeof registry.fixTemplates.syntax] || '';
  }
  if (category === 'phrase') return registry.fixTemplates.phrase;
  if (category === 'empty-praise') return registry.fixTemplates.emptyPraise;
  return registry.fixTemplates.opening;
}

function buildFixPrompt(violations: LintViolation[]): string {
  const instructions: string[] = [];
  const syntaxInstructions = unique(violations.filter((v) => v.category === 'syntax').map((v) => v.fixInstruction));
  const phraseHits = unique(violations.filter((v) => v.category === 'phrase').map((v) => v.pattern));
  const emptyPraiseHits = unique(violations.filter((v) => v.category === 'empty-praise').map((v) => v.pattern));
  const hasOpening = violations.some((v) => v.category === 'opening');
  const specInstructions = unique(violations
    .filter((v) => v.category === 'spec-must-keep' || v.category === 'spec-must-avoid')
    .map((v) => v.fixInstruction));

  instructions.push(...specInstructions);
  instructions.push(...syntaxInstructions);
  if (phraseHits.length) {
    instructions.push(registry.fixTemplates.phrase.replace('[列出命中的词]', phraseHits.join('、')));
  }
  if (emptyPraiseHits.length) {
    instructions.push(registry.fixTemplates.emptyPraise.replace('[列出命中的词]', emptyPraiseHits.join('、')));
  }
  if (hasOpening) {
    instructions.push(registry.fixTemplates.opening);
  }

  const numbered = instructions.map((instruction, index) => `${index + 1}. ${instruction}`).join('\n');
  return `长文里出现了以下问题，请逐项修改：\n\n${numbered}\n\n修改后保持文章核心论点和事实不变，只调整这些表达问题。`;
}

function extractSpecKeywords(text: string): string[] {
  const cleaned = text
    .replace(/[^\p{Script=Han}A-Za-z0-9]+/gu, ' ')
    .split(/\s+/)
    .flatMap((part) => splitKeywordPart(part))
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
  return unique(cleaned).sort((a, b) => b.length - a.length);
}

function splitKeywordPart(part: string): string[] {
  if (!part) return [];
  if (/^[A-Za-z0-9]+$/.test(part)) return [part];
  if (part.length <= 4) return [part];
  const chunks: string[] = [];
  for (let i = 0; i < part.length; i += 4) {
    chunks.push(part.slice(i, i + 4));
  }
  chunks.push(part.slice(0, 6));
  return chunks;
}

function specAvoidPattern(text: string): RegExp | null {
  const literal = text.trim();
  if (!literal) return null;
  const regexLiteral = literal.match(/^\/(.+)\/([gimsuy]*)$/);
  if (regexLiteral) {
    return new RegExp(regexLiteral[1], regexLiteral[2].replace('g', '') || 'i');
  }
  return new RegExp(literal.split(/\s+/).map(escapeRegExp).join('\\s*'), 'i');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function reset(regex: RegExp): RegExp {
  return new RegExp(regex.source, regex.flags);
}
