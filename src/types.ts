export type ThemeKey =
  | 'plain_markdown'
  | 'editorial_narrative'
  | 'swiss_grid'
  | 'architectural_frame'
  | 'terminal_tech';

export type WorkflowStep = 'raw' | 'spec' | 'article' | 'cover' | 'cards' | 'review' | 'export';

export type RuleScope = 'global' | 'article' | 'cover' | 'cards' | 'export';
export type RuleStatus = 'draft' | 'active' | 'revised' | 'disabled';
export type CoverPaletteFamily = 'auto' | 'red' | 'amber' | 'blue' | 'neon';
export type CoverSourceRole = 'person' | 'scene' | 'screenshot';

export interface ReviewRule {
  id: string;
  scope: RuleScope;
  status: RuleStatus;
  title: string;
  body: string;
  version: number;
  supersedes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TextProviderConfig {
  provider: 'claude_relay' | 'claude_direct' | 'openai_compatible';
  apiKey: string;
  relayUrl: string;
  model: string;
}

export interface ImageProviderConfig {
  provider: 'openai_images' | 'openai_responses' | 'custom_relay';
  apiKey: string;
  authHeader?: string;
  relayUrl: string;
  model: string;
  size: string;
  quality: string;
}

export interface ProviderConfig {
  text: TextProviderConfig;
  image: ImageProviderConfig;
}

export interface ReferenceImage {
  id: string;
  name: string;
  dataUrl: string;
  role?: CoverSourceRole;
}

export interface CoverGeneration {
  id: string;
  image: string;
  prompt: string;
  instruction: string;
  createdAt: string;
  telemetry?: Record<string, unknown>;
}

export interface RevisionEntry {
  id: string;
  step: WorkflowStep;
  instruction: string;
  result: string;
  createdAt: string;
}

export interface RedCardProject {
  id: string;
  name: string;
  rawInput: string;
  articleDraft: string;
  dbCheckReport: string;
  cardText: string;
  publishCaption: string;
  articleInstruction: string;
  coverInstruction: string;
  coverVisualInstruction: string;
  cardInstruction: string;
  coverTitle: string;
  coverSubtitle: string;
  coverSeries: string;
  coverRedAccent: string;
  coverPaletteFamily: CoverPaletteFamily;
  coverMode: 'auto' | 'dark' | 'light';
  accountName: string;
  coverPrompt: string;
  coverImage: string | null;
  avatarImage: string;
  coverHistory: CoverGeneration[];
  referenceImages: ReferenceImage[];
  theme: ThemeKey;
  fontSize: number;
  revisionLog: RevisionEntry[];
  createdAt: string;
  updatedAt: string;
}
