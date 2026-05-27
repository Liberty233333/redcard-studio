import type { ThemeKey } from '../types';

export interface ThemeMeta {
  key: ThemeKey;
  name: string;
  accent: string;
  enabled: boolean;
  phase?: string;
}

export const THEMES: ThemeMeta[] = [
  {
    key: 'editorial_narrative',
    name: '编辑叙事',
    accent: '#C8281F',  // 朱砂红 · Vogue
    enabled: true,
  },
  {
    key: 'swiss_grid',
    name: '瑞士网格',
    accent: '#E23D2F',
    enabled: true,
  },
  {
    key: 'architectural_frame',
    name: '建筑几何',
    accent: '#1E3A5F',  // 普鲁士蓝 · 蓝铅笔 · per SPEC.md
    enabled: true,
  },
  {
    key: 'terminal_tech',
    name: '科技风格',
    accent: '#F7D44A',
    enabled: true,
  },
];

export function findTheme(key: ThemeKey): ThemeMeta {
  return THEMES.find((t) => t.key === key) || THEMES[0];
}
