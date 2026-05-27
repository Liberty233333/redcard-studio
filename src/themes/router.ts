import type { ThemeKey } from '../types';
import type { ThemeRenderer } from './types';

import { editorial } from './editorial';
import { swiss } from './swiss';
import { architectural } from './architectural';
import { plain } from './plain';
import { terminal } from './terminal';

export const THEME_RENDERERS: Record<ThemeKey, ThemeRenderer> = {
  plain_markdown: plain,
  editorial_narrative: editorial,
  swiss_grid: swiss,
  architectural_frame: architectural,
  terminal_tech: terminal,
};

export function getRenderer(theme: ThemeKey): ThemeRenderer {
  return THEME_RENDERERS[theme] || editorial;
}
