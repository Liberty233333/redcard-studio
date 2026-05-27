export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isCJKHeavy(s: string): boolean {
  if (!s) return false;
  let cjk = 0;
  let total = 0;
  for (const ch of s) {
    if (/\s/.test(ch)) continue;
    total++;
    if (/[一-鿿㐀-䶿豈-﫿]/.test(ch)) cjk++;
  }
  return total > 0 && cjk / total >= 0.5;
}

/**
 * Convert ASCII punctuation to Chinese full-width.
 * Per-line so we can preserve markdown line prefixes (#, ##, ###, "1. ", "- ", "* ").
 * URLs are stashed and restored to avoid breaking https://.
 */
export function normalizePunctuation(s: string): string {
  return s.split('\n').map(normalizeLine).join('\n');
}

function normalizeLine(line: string): string {
  const prefixMatch = line.match(/^(\s*)((#{1,3}\s)|(\d+\.\s)|([-*]\s))/);
  let prefix = '';
  let body = line;
  if (prefixMatch) {
    prefix = prefixMatch[0];
    body = line.slice(prefix.length);
  }

  const urlRe = /https?:\/\/[^\s]+/g;
  const urls: string[] = [];
  body = body.replace(urlRe, (m) => {
    urls.push(m);
    return 'URLPLACEHOLDER' + (urls.length - 1) + 'END';
  });

  body = body
    .replace(/,/g, '，')
    .replace(/\./g, '。')
    .replace(/\?/g, '？')
    .replace(/!/g, '！')
    .replace(/:/g, '：')
    .replace(/;/g, '；')
    .replace(/\(/g, '（')
    .replace(/\)/g, '）')
    .replace(/"([^"]*)"/g, '“$1”');

  body = body.replace(/URLPLACEHOLDER(\d+)END/g, (_m, i) => urls[Number(i)] || '');

  return prefix + body;
}
