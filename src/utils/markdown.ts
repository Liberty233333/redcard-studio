export type MdLine =
  | { kind: 'h1'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'h3'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'divider' }
  | { kind: 'list'; text: string; ordered: boolean; index?: number }
  | { kind: 'p'; text: string }
  | { kind: 'blank' };

/** Parse one body line into a structured kind. */
export function parseLine(raw: string): MdLine {
  const line = raw.trimEnd();
  if (line.trim().length === 0) return { kind: 'blank' };

  if (/^###\s+/.test(line)) return { kind: 'h3', text: line.replace(/^###\s+/, '') };
  if (/^##\s+/.test(line))  return { kind: 'h2', text: line.replace(/^##\s+/, '') };
  if (/^#\s+/.test(line))   return { kind: 'h1', text: line.replace(/^#\s+/, '') };
  if (/^>\s+/.test(line))    return { kind: 'quote', text: line.replace(/^>\s+/, '') };
  if (/^(\*\*\*|___)$/.test(line.trim())) return { kind: 'divider' };

  const ol = line.match(/^(\d+)\.\s+(.*)$/);
  if (ol) return { kind: 'list', text: ol[2], ordered: true, index: parseInt(ol[1], 10) };

  const ul = line.match(/^[-*]\s+(.*)$/);
  if (ul) return { kind: 'list', text: ul[1], ordered: false };

  return { kind: 'p', text: line };
}

/**
 * Visual-line weight for pagination. Headings consume more vertical space
 * than body text. Returned in "body-line equivalents" so paginate can
 * sum them against MAX_LINES_PER_CARD.
 */
export function lineWeight(line: MdLine, charLines: number): number {
  switch (line.kind) {
    case 'h1':    return Math.max(2.4, charLines * 1.8);
    case 'h2':    return Math.max(1.8, charLines * 1.4);
    case 'h3':    return Math.max(1.4, charLines * 1.2);
    case 'quote': return charLines + 0.3;
    case 'divider': return 1;
    case 'blank': return 1;
    case 'list':  return charLines + 0.2; // small bullet padding
    case 'p':     return charLines;
  }
}

/** Strip markdown markers to plain text (for visual width measurement). */
export function plainText(line: string): string {
  return line
    .replace(/^#{1,3}\s+/, '')
    .replace(/^>\s+/, '')
    .replace(/^(\*\*\*|___)$/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/^[-*]\s+/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1');
}

/** Parse inline markdown (**bold**, *italic*) into spans. */
export type InlineSpan =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string };

export function parseInline(text: string): InlineSpan[] {
  const out: InlineSpan[] = [];
  // tokenize via combined regex: **bold** or *italic* or plain text run
  const re = /\*\*([^*]+?)\*\*|\*([^*]+?)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
    if (m[1] !== undefined) {
      const inner = m[1].replace(/^[\[【]/, '').replace(/[\]】]$/, '');
      out.push({ kind: 'bold', text: inner });
    } else if (m[2] !== undefined) {
      out.push({ kind: 'italic', text: m[2] });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}
