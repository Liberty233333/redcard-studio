import type { ComponentType } from 'react';

export interface BodyCardProps {
  id: number;
  content: string[];
  fontSize: number;
  cardIndex: number;
  totalCards: number;
}

export interface ThemeRenderer {
  BodyCard: ComponentType<BodyCardProps>;
}
