import { visualWidth } from './visualWidth';

/**
 * Find a safe character index to cut a paragraph for mid-paragraph wrapping.
 * The cut MUST land outside any **bold** marker pair, outside any URL,
 * and outside any English word. Prefers (in order):
 *   1. After a sentence terminator (。？！；.!?;)
 *   2. After a clause separator (，、,)
 *   3. After whitespace
 *   4. CJK ↔ ASCII transition
 *   5. Hard fallback: idealCut itself
 *
 * `idealCut` is the visual-width-based target; we search backward from there
 * within a window so the cut doesn't drift too far.
 */
export function findSafeBreakpoint(line: string, idealCut: number): number {
  if (idealCut >= line.length) return line.length;
  if (idealCut <= 0) return 0;

  const searchWindow = Math.max(8, Math.floor(idealCut * 0.25));
  const minCut = Math.max(1, idealCut - searchWindow);

  // forbidden ranges: ** bold ** pairs, URLs
  const forbidden = forbiddenRanges(line);
  const isInside = (i: number) => forbidden.some(([a, b]) => i > a && i < b);

  const scoreAt = (i: number): number => {
    if (i <= 0 || i >= line.length) return -1;
    if (isInside(i)) return -1;
    const prev = line[i - 1];
    const cur = line[i];

    // 1. after sentence terminator
    if (/[。？！；.!?;]/.test(prev)) return 100;
    // 2. after clause separator
    if (/[，、,]/.test(prev)) return 80;
    // 3. after whitespace
    if (/\s/.test(prev)) return 60;
    // 4. CJK ↔ ASCII transition
    const prevIsCJK = /[一-鿿]/.test(prev);
    const curIsCJK = /[一-鿿]/.test(cur);
    if (prevIsCJK !== curIsCJK) return 40;
    // 5. inside English word? bad
    if (/[A-Za-z]/.test(prev) && /[A-Za-z]/.test(cur)) return -1;
    // default: between two CJK chars is fine
    if (prevIsCJK && curIsCJK) return 20;
    return 10;
  };

  let bestIdx = -1;
  let bestScore = -1;
  for (let i = idealCut; i >= minCut; i--) {
    const s = scoreAt(i);
    if (s > bestScore) {
      bestScore = s;
      bestIdx = i;
      if (s >= 100) break;
    }
  }

  if (bestIdx < 0 || bestScore < 0) {
    // hard fallback: nudge forward to escape forbidden range, else use ideal
    for (let i = idealCut; i < line.length; i++) {
      if (!isInside(i) && scoreAt(i) >= 0) return i;
    }
    return idealCut;
  }
  return bestIdx;
}

function forbiddenRanges(line: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];

  // ** bold ** pairs
  const boldRe = /\*\*[\s\S]+?\*\*/g;
  let m: RegExpExecArray | null;
  while ((m = boldRe.exec(line)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }

  // URLs (http(s)://... up to whitespace or CJK boundary)
  const urlRe = /https?:\/\/[^\s一-鿿]+/g;
  while ((m = urlRe.exec(line)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }

  return ranges;
}

/** Convert a visual-width budget back into a character index for `line`. */
export function unitsToCharIndex(line: string, unitsBudget: number): number {
  let acc = 0;
  for (let i = 0; i < line.length; i++) {
    acc += visualWidth(line[i]);
    if (acc > unitsBudget) return i;
  }
  return line.length;
}
