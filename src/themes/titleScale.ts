/**
 * Per-theme title font auto-scale.
 *
 * Each theme has different title container width and typography
 * (font family, weight, letter-spacing). A "one-size-fits-all" curve
 * makes the same title wrap to different line counts across themes.
 *
 * scaleTitleByFit() instead computes the size that makes the LONGEST
 * line fit exactly in the theme's actual container, capped by maxPx
 * (visual ceiling for short titles) and minPx (floor for very long).
 *
 * Each theme cover passes its own containerPx for each variant, so a
 * 14-char title naturally renders at the same line count regardless
 * of which theme is active (modulo chars-per-line at the chosen size).
 */

export interface ScaleTitleOpts {
  /** Width in px of the title's container (or height for vertical writing). */
  containerPx: number;
  /** Hard ceiling — even very short titles won't grow past this. */
  maxPx: number;
  /** Floor — even very long titles won't shrink below this. */
  minPx: number;
  /**
   * Effective glyph advance as a fraction of fontSize.
   * 0.92 fits typical CJK serif/sans regular.
   * Use 0.98 for bold (extra ink width), 0.85 for italic narrow,
   * 0.62 for monospace (Latin-heavy mono is much narrower).
   */
  charRatio?: number;
  /**
   * Try wrapping the title across up to N lines, pick the layout that
   * yields the largest fitting font. Default 2 — a 14-char title that
   * would render at ~25px on one line gets ~50px when allowed to wrap.
   * User-typed `\n` always wins (those are respected as-is).
   */
  maxLines?: number;
}

export function scaleTitleByFit(title: string, opts: ScaleTitleOpts): number {
  const { containerPx, maxPx, minPx, charRatio = 0.92, maxLines = 2 } = opts;
  const explicit = title.split('\n');
  // user-typed line breaks are canonical
  if (explicit.length > 1) {
    const longest = Math.max(1, ...explicit.map((l) => l.length));
    return Math.max(minPx, Math.min(maxPx, Math.floor(containerPx / (longest * charRatio))));
  }
  const total = explicit[0].length || 1;
  let best = minPx;
  for (let n = 1; n <= Math.max(1, maxLines); n++) {
    const charsPerLine = Math.ceil(total / n);
    const sized = Math.min(maxPx, Math.floor(containerPx / (charsPerLine * charRatio)));
    if (sized > best) best = sized;
  }
  return Math.max(minPx, best);
}

/**
 * Legacy fixed-tier scale, kept for callers that don't need fit math.
 * Prefer scaleTitleByFit for accuracy.
 */
export function scaleTitle(title: string, maxPx: number, minPx: number): number {
  const lines = title.split('\n');
  const longest = Math.max(1, ...lines.map((l) => l.length));
  const range = maxPx - minPx;
  if (longest <= 4)  return maxPx;
  if (longest <= 7)  return Math.round(minPx + range * 0.83);
  if (longest <= 10) return Math.round(minPx + range * 0.67);
  if (longest <= 14) return Math.round(minPx + range * 0.50);
  if (longest <= 18) return Math.round(minPx + range * 0.33);
  if (longest <= 24) return Math.round(minPx + range * 0.17);
  return minPx;
}
