import { visualWidth, maxUnitsPerLine } from './visualWidth';
import { findSafeBreakpoint, unitsToCharIndex } from './breakpoint';
import { parseLine, lineWeight, plainText } from '../utils/markdown';

export interface PaginateOptions {
  /** Card content area width in px (450 - 2*32 padding = 386 by default). */
  contentPxWidth: number;
  /** Card content area height in px. */
  contentPxHeight: number;
  /** Body font size in px. */
  fontSize: number;
  /** Line-height multiplier. */
  lineHeight: number;
}

export interface BodyCard {
  id: number;
  content: string[];
}

/**
 * Paginate body lines into cards. Queue-based, never loses data.
 * - Empty lines = 1-line space
 * - Lines longer than 1 visual line wrap (consume multiple lines in budget)
 * - When a paragraph won't fit, cut at a safe breakpoint, push remainder back
 * - Avoid widow/orphan: a paragraph that can fit ≤ 2 lines on the current
 *   card but ≥ 3 lines total is moved entirely to the next card.
 */
export function paginate(lines: string[], opt: PaginateOptions): BodyCard[] {
  const unitsPerLine = maxUnitsPerLine(opt.contentPxWidth, opt.fontSize);
  const maxLinesPerCard = Math.floor(opt.contentPxHeight / (opt.fontSize * opt.lineHeight));

  if (unitsPerLine <= 0 || maxLinesPerCard <= 0) return [];

  const queue = normalizeLines(lines);
  const cards: BodyCard[] = [];
  let nextId = 0;

  while (queue.length > 0) {
    const chunk: string[] = [];
    let usedLines = 0;

    while (queue.length > 0) {
      const line = queue[0];

      // empty line — represents a paragraph break
      if (line.trim().length === 0) {
        if (chunk.length > 0 && usedLines + 1 <= maxLinesPerCard) {
          chunk.push('');
          usedLines += 1;
          queue.shift();
          continue;
        } else if (chunk.length === 0) {
          queue.shift(); // skip leading empties
          continue;
        } else {
          break; // no room — start a new card
        }
      }

      const md = parseLine(line);
      const w = visualWidth(plainText(line));
      const charLines = Math.max(1, Math.ceil(w / unitsPerLine));
      const weight = md.kind === 'blank' ? 1 : lineWeight(md, charLines);

      // widow/orphan check: a long paragraph (≥3 lines) about to start
      // with only 1-2 lines remaining on this card → push to next card
      const remaining = maxLinesPerCard - usedLines;
      if (usedLines + weight <= maxLinesPerCard) {
        chunk.push(line);
        usedLines += weight;
        queue.shift();
        continue;
      }

      // If the estimator thinks this line barely overflows but the visual
      // remainder would be only a few CJK chars, keep it on the current card.
      // This avoids the ugly case where the next card starts with "了。" or
      // 2-5 orphan characters even though the rendered line usually fits.
      const overflow = usedLines + weight - maxLinesPerCard;
      if (chunk.length > 0 && overflow <= 0.45 && plainText(line).length <= unitsPerLine * 1.15) {
        chunk.push(line);
        queue.shift();
        break;
      }

      // headings should never be split mid-text — push to next card
      if (md.kind === 'h1' || md.kind === 'h2' || md.kind === 'h3') {
        break;
      }

      // doesn't fit — try to take part of it
      const remainingLines = maxLinesPerCard - usedLines;
      if (remainingLines >= 1) {
        const unitsBudget = remainingLines * unitsPerLine;
        const idealCut = unitsToCharIndex(line, unitsBudget);
        if (idealCut > 10) {
          const safeCut = findClauseBreakpoint(line, idealCut) || findSafeBreakpoint(line, idealCut);
          if (safeCut > 0 && safeCut < line.length) {
            const head = line.slice(0, safeCut);
            const tail = line.slice(safeCut);
            const headLines = Math.max(1, Math.ceil(visualWidth(plainText(head)) / unitsPerLine));
            const tailLines = Math.max(1, Math.ceil(visualWidth(plainText(tail)) / unitsPerLine));
            if (headLines < 1 || tailLines < 1) {
              break;
            }
            const tailWidth = visualWidth(plainText(tail));
            if (tailWidth <= Math.max(5, unitsPerLine * 0.28)) {
              chunk.push(line);
              queue.shift();
            } else {
              chunk.push(head);
              queue[0] = tail.trimStart();
            }
          }
        }
      }
      break; // card full
    }

    if (chunk.length > 0) {
      const heading = trailingHeading(chunk);
      if (heading && chunk.some((line, idx) => idx < chunk.length - 1 && line.trim())) {
        chunk.pop();
        queue.unshift(heading);
      }
      cards.push({ id: nextId++, content: chunk });
    } else if (queue.length > 0) {
      // safety: if chunk is empty but queue still has content, force-take one
      // line to avoid infinite loop (shouldn't normally happen)
      cards.push({ id: nextId++, content: [queue.shift()!] });
    }
  }

  return rebalanceShortTail(cards, maxLinesPerCard, unitsPerLine);
}

function normalizeLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    const isRule = /^\s*(-{2,}|—{2,}|_{2,}|\*{2,}|={2,}|·{3,})\s*$/.test(line.trim());
    if (isRule) continue;
    if (!line.trim()) {
      const prev = out[out.length - 1];
      if (prev === undefined) continue;
      out.push('');
      continue;
    }
    out.push(line);
  }
  while (out.length && !out[0].trim()) out.shift();
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}

function trailingHeading(lines: string[]): string | null {
  const last = lines[lines.length - 1];
  if (!last) return null;
  const md = parseLine(last);
  return md.kind === 'h1' || md.kind === 'h2' || md.kind === 'h3' ? last : null;
}

function rebalanceShortTail(cards: BodyCard[], maxLinesPerCard: number, unitsPerLine: number): BodyCard[] {
  const next = cards.map((card) => ({ ...card, content: [...card.content] }));
  for (let i = 1; i < next.length; i++) {
    const prev = next[i - 1];
    const curr = next[i];
    while (curr.content.length > 0) {
      const candidate = trimOuterBlanks([curr.content[0]]);
      if (!candidate.length) {
        curr.content.shift();
        continue;
      }
      const candidateWeight = cardWeight(candidate, unitsPerLine);
      const prevWeightNow = cardWeight(prev.content, unitsPerLine);
      if (candidateWeight <= 3.2 && prevWeightNow + candidateWeight <= maxLinesPerCard + 0.5) {
        prev.content = trimTrailingBlanks([...prev.content, ...candidate]);
        curr.content.shift();
        continue;
      }
      const remaining = maxLinesPerCard - prevWeightNow;
      if (remaining >= 1 && remaining <= 3) {
        const split = takeClausePrefix(curr.content[0], remaining, unitsPerLine);
        if (split) {
          prev.content = trimTrailingBlanks([...prev.content, split.head]);
          curr.content[0] = split.tail;
          continue;
        }
      }
      break;
    }
    const currWeight = cardWeight(curr.content, unitsPerLine);
    const prevWeight = cardWeight(prev.content, unitsPerLine);
    if (currWeight > 0 && currWeight <= 2.4 && prevWeight + currWeight <= maxLinesPerCard + 0.5) {
      prev.content = trimTrailingBlanks([...prev.content, ...curr.content]);
      curr.content = [];
    }
  }
  return next
    .filter((card) => card.content.some((line) => line.trim()))
    .map((card, id) => ({ id, content: trimOuterBlanks(card.content) }));
}

function takeClausePrefix(line: string, remainingLines: number, unitsPerLine: number): { head: string; tail: string } | null {
  const md = parseLine(line);
  if (md.kind === 'h1' || md.kind === 'h2' || md.kind === 'h3' || md.kind === 'blank') return null;
  const budget = Math.max(1, remainingLines) * unitsPerLine;
  const ideal = unitsToCharIndex(line, budget);
  const cut = findClauseBreakpoint(line, ideal);
  if (!cut || cut < 6 || cut >= line.length) return null;
  const head = line.slice(0, cut).trimEnd();
  const tail = line.slice(cut).trimStart();
  if (!head || !tail) return null;
  const headLines = Math.max(1, Math.ceil(visualWidth(plainText(head)) / unitsPerLine));
  if (headLines > remainingLines + 0.35) return null;
  return { head, tail };
}

function findClauseBreakpoint(line: string, idealCut: number): number | null {
  if (idealCut <= 0) return null;
  const max = Math.min(line.length - 1, idealCut);
  const min = Math.max(1, Math.floor(max * 0.45));
  const preferred = /[。？！；;，,、：:]/;
  for (let i = max; i >= min; i--) {
    if (preferred.test(line[i - 1])) return i;
  }
  return null;
}

function cardWeight(lines: string[], unitsPerLine: number): number {
  return lines.reduce((sum, line) => {
    if (!line.trim()) return sum + 1;
    const md = parseLine(line);
    const w = visualWidth(plainText(line));
    const charLines = Math.max(1, Math.ceil(w / unitsPerLine));
    return sum + lineWeight(md, charLines);
  }, 0);
}

function trimOuterBlanks(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start++;
  while (end > start && !lines[end - 1].trim()) end--;
  return lines.slice(start, end);
}

function trimTrailingBlanks(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end--;
  return lines.slice(0, end);
}
