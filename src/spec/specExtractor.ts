import type { TextProviderConfig } from '../types.ts';
import { callTextProvider, type TextPromptInput } from '../llm/client.ts';
import type { Case, PromptTemplate, StyleProfile } from '../knowledge/knowledgeBase.ts';
import { getPromptTemplate, getStyleProfile, searchCases } from '../knowledge/knowledgeBase.ts';
import { isContentSpec, normalizeContentSpec, type ContentSpec } from './contentSpec.ts';

export interface SpecExtractorKnowledgeBase {
  getStyleProfile?: () => StyleProfile | Promise<StyleProfile>;
  searchCases?: (query: { tags?: string[]; limit?: number }) => Case[] | Promise<Case[]>;
  getPromptTemplate?: (key: string) => PromptTemplate | Promise<PromptTemplate>;
  textProvider?: TextProviderConfig;
  callTextProvider?: (
    cfg: TextProviderConfig,
    input: TextPromptInput,
    opts?: { maxTokens?: number; temperature?: number }
  ) => Promise<string>;
}

export async function extractSpec(
  rawMaterial: string,
  knowledgeBase: SpecExtractorKnowledgeBase = {}
): Promise<ContentSpec> {
  const material = rawMaterial.trim();
  if (!material) throw new Error('Cannot extract Content SPEC from empty material.');

  const template = await resolveTemplate(knowledgeBase);
  const styleProfile = await resolveStyleProfile(knowledgeBase);
  const cases = await resolveCases(knowledgeBase);
  const cfg = knowledgeBase.textProvider;
  const generate = knowledgeBase.callTextProvider || callTextProvider;
  if (!cfg) {
    throw new Error('extractSpec requires knowledgeBase.textProvider for LLM extraction.');
  }

  const prompt = buildSpecPrompt({
    rawMaterial: material,
    styleProfile,
    cases,
  });
  const response = await generate(
    cfg,
    {
      prompt,
      messages: [
        { role: 'system', content: template.content },
        { role: 'user', content: prompt },
      ],
      metadata: { promptTemplate: template.key, caseIds: cases.map((item) => item.id) },
    },
    { temperature: 0.2, maxTokens: 1200 }
  );

  return parseSpecResponse(response);
}

function buildSpecPrompt(input: {
  rawMaterial: string;
  styleProfile: StyleProfile;
  cases: Case[];
}): string {
  return `Extract a Content SPEC for this source material.

Style profile:
${input.styleProfile.content || 'No style profile yet. Use the supplied cases as the voice anchor.'}

Relevant cases:
${formatCases(input.cases)}

Source material:
\`\`\`text
${input.rawMaterial}
\`\`\`

Return strict JSON only.`;
}

function formatCases(cases: Case[]): string {
  if (!cases.length) return 'No cases available.';
  return cases.map((item, index) => `Case ${index + 1} (${item.id})
Tags: ${Object.entries(item.tags).filter(([, value]) => value).map(([key, value]) => `${key}=${value}`).join(', ') || 'none'}
Source:
${item.sourceMaterial.slice(0, 700)}
Final article excerpt:
${item.finalArticle.slice(0, 900)}`).join('\n\n');
}

function parseSpecResponse(response: string): ContentSpec {
  const jsonText = extractJsonObject(response);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    try {
      parsed = JSON.parse(repairUnescapedStringQuotes(jsonText));
    } catch {
      throw new Error(`Content SPEC extractor returned invalid JSON: ${(error as Error).message}`);
    }
  }
  if (!isContentSpec(parsed)) {
    throw new Error('Content SPEC extractor returned JSON that does not match ContentSpec shape.');
  }
  const spec = normalizeContentSpec(parsed);
  if (!spec.mustKeepFacts.length) {
    throw new Error('Content SPEC extractor returned empty mustKeepFacts.');
  }
  return spec;
}

function repairUnescapedStringQuotes(jsonText: string): string {
  return jsonText.split('\n').map((line) => {
    const property = line.match(/^(\s*"[^"]+"\s*:\s*")(.*)("\s*,?\s*)$/);
    if (property) return `${property[1]}${property[2].replaceAll('"', '“')}${property[3]}`;
    const arrayItem = line.match(/^(\s*")(.*)("\s*,?\s*)$/);
    if (arrayItem) return `${arrayItem[1]}${arrayItem[2].replaceAll('"', '“')}${arrayItem[3]}`;
    return line;
  }).join('\n');
}

function extractJsonObject(response: string): string {
  const trimmed = response.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

async function resolveTemplate(kb: SpecExtractorKnowledgeBase): Promise<PromptTemplate> {
  return kb.getPromptTemplate ? kb.getPromptTemplate('spec-extractor') : getPromptTemplate('spec-extractor');
}

async function resolveStyleProfile(kb: SpecExtractorKnowledgeBase): Promise<StyleProfile> {
  return kb.getStyleProfile ? kb.getStyleProfile() : getStyleProfile();
}

async function resolveCases(kb: SpecExtractorKnowledgeBase): Promise<Case[]> {
  return kb.searchCases ? kb.searchCases({ tags: ['AI', '工作流'], limit: 2 }) : searchCases({ tags: ['AI', '工作流'], limit: 2 });
}
