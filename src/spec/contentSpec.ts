export interface ContentSpec {
  thesis: string;
  mustKeepFacts: string[];
  mustAvoid: string[];
  targetReader: string;
  voiceAnchors: string[];
  platformConventions: string[];
  staleInsights: string[];
  structureHint?: string;
  hookAngle?: string;
}

export function normalizeContentSpec(value: ContentSpec): ContentSpec {
  return {
    ...value,
    mustKeepFacts: normalizeStringArray(value.mustKeepFacts),
    mustAvoid: normalizeStringArray(value.mustAvoid),
    voiceAnchors: normalizeStringArray(value.voiceAnchors),
    platformConventions: normalizeStringArray((value as Partial<ContentSpec>).platformConventions),
    staleInsights: normalizeStringArray((value as Partial<ContentSpec>).staleInsights),
    structureHint: value.structureHint || '',
    hookAngle: value.hookAngle || '',
  };
}

export function isContentSpec(value: unknown): value is ContentSpec {
  if (!value || typeof value !== 'object') return false;
  const spec = value as Partial<ContentSpec>;
  return (
    typeof spec.thesis === 'string' &&
    spec.thesis.trim().length > 0 &&
    Array.isArray(spec.mustKeepFacts) &&
    spec.mustKeepFacts.every((item) => typeof item === 'string') &&
    Array.isArray(spec.mustAvoid) &&
    spec.mustAvoid.every((item) => typeof item === 'string') &&
    typeof spec.targetReader === 'string' &&
    spec.targetReader.trim().length > 0 &&
    Array.isArray(spec.voiceAnchors) &&
    spec.voiceAnchors.every((item) => typeof item === 'string') &&
    Array.isArray(spec.platformConventions) &&
    spec.platformConventions.every((item) => typeof item === 'string') &&
    Array.isArray(spec.staleInsights) &&
    spec.staleInsights.every((item) => typeof item === 'string') &&
    (spec.structureHint === undefined || typeof spec.structureHint === 'string') &&
    (spec.hookAngle === undefined || typeof spec.hookAngle === 'string')
  );
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
