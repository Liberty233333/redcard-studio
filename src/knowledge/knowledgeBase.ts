import { exemplarRegistry } from '../llm/_exemplars.generated.ts';
import { knowledgeRegistry } from './_knowledge.generated.ts';

export type RuleScope = 'article' | 'cards' | 'cover' | 'global' | string;

export interface Rule {
  id: string;
  scope: RuleScope;
  status: 'active';
  content: string;
}

export interface Case {
  id: string;
  sourceMaterial: string;
  finalArticle: string;
  tags: {
    contentType?: string;
    performedWellOn?: string;
    [key: string]: string | undefined;
  };
}

export interface StyleProfile {
  key: string;
  content: string;
}

export interface PromptTemplate {
  key: string;
  content: string;
}

export interface SearchCasesQuery {
  contentType?: string;
  tags?: string[];
  minScore?: number;
  limit?: number;
}

export function getActiveRules(scope: RuleScope): Rule[] {
  const applies = scope === 'article' || scope === 'global' || scope === 'longform';
  if (!applies || !knowledgeRegistry.rules.bannedPatterns) return [];
  return [
    {
      id: 'banned-patterns',
      scope: 'article',
      status: 'active',
      content: knowledgeRegistry.rules.bannedPatterns,
    },
  ];
}

export function searchCases(query: SearchCasesQuery = {}): Case[] {
  const limit = query.limit ?? Number.MAX_SAFE_INTEGER;
  const requestedTags = (query.tags || []).map((tag) => tag.toLowerCase());
  return exemplarRegistry
    .filter((item) => !query.contentType || item.tags.contentType === query.contentType)
    .filter((item) => {
      if (!requestedTags.length) return true;
      const values = Object.values(item.tags).join(' ').toLowerCase();
      return requestedTags.every((tag) => values.includes(tag));
    })
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      sourceMaterial: item.sourceMaterial,
      finalArticle: item.finalArticle,
      tags: { ...item.tags },
    }));
}

export function getStyleProfile(key: keyof typeof knowledgeRegistry.styleProfile = 'accountVoice'): StyleProfile {
  const content = knowledgeRegistry.styleProfile[key];
  if (!content) {
    throw new Error(`Style profile not found: ${String(key)}`);
  }
  return {
    key: String(key),
    content,
  };
}

export function getPromptTemplate(key: string): PromptTemplate {
  const content = knowledgeRegistry.prompts[key as keyof typeof knowledgeRegistry.prompts];
  if (!content) {
    throw new Error(`Prompt template not found: ${key}`);
  }
  return { key, content };
}

export function auditCaseAgainstSkill() {
  return {
    passed: true,
    warnings: ['auditCaseAgainstSkill is a v2.2 skeleton placeholder.'],
  };
}
