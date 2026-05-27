import type { RedCardProject } from '../types';

export function getDocumentTitle(text: string): string {
  const metaTitle = matchMeta(text, ['标题', '大标题', '主标题']);
  if (metaTitle) return metaTitle;
  const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading ? heading.replace(/^["“]|["”]$/g, '').trim() : '';
}

export function matchMeta(text: string, keys: string[]): string {
  for (const key of keys) {
    const found = text.match(new RegExp(`^#{0,3}\\s*${key}\\s*[:：]\\s*(.+)$`, 'm'))?.[1]?.trim();
    if (found) return found.replace(/^["“]|["”]$/g, '').trim();
  }
  return '';
}

export function projectDisplayTitle(project: RedCardProject): string {
  return project.coverTitle.trim()
    || getDocumentTitle(project.articleDraft)
    || getDocumentTitle(project.cardText)
    || (project.name && !/^小红书图文( \d+)?$/.test(project.name) ? project.name : '')
    || '小红书图文';
}
