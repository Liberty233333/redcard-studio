/**
 * Visual width estimation in "CJK character units".
 * 1 CJK char  = 1.00
 * 1 ASCII upper/digit = 0.58
 * 1 ASCII lower/punct = 0.48
 * Used to convert pixel-based card width into a per-line character budget
 * that handles CJK + Latin mixed text correctly.
 */
export function visualWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    // CJK Unified Ideographs + extension A + compat + fullwidth forms + CJK punct
    if (
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      w += 1.0;
    } else if (/[A-Z0-9]/.test(ch)) {
      w += 0.58;
    } else {
      w += 0.48;
    }
  }
  return w;
}

/** How many "CJK char units" fit on one line at given pixel width and font size. */
export function maxUnitsPerLine(pxWidth: number, fontSize: number): number {
  // 0.92 multiplier matches the artistic-tool empirical heuristic for
  // CJK glyph advance vs. nominal fontSize.
  return Math.floor(pxWidth / (fontSize * 0.92));
}
