import type { ContentSpec } from '../spec/contentSpec.ts';

export type SpecArrayField = 'mustKeepFacts' | 'mustAvoid' | 'voiceAnchors' | 'platformConventions' | 'staleInsights';
export type SpecTextField = 'thesis' | 'targetReader' | 'structureHint' | 'hookAngle';

export const SPEC_REVIEW_LABELS: Record<keyof ContentSpec, string> = {
  thesis: '核心判断',
  mustKeepFacts: '必须保留的事实',
  mustAvoid: '必须避免',
  targetReader: '目标读者',
  voiceAnchors: '风格锚点',
  platformConventions: '平台约定',
  staleInsights: '待淡化旧观点',
  structureHint: '结构建议',
  hookAngle: '切入角度',
};

export function updateSpecTextField(spec: ContentSpec, field: SpecTextField, value: string): ContentSpec {
  return {
    ...spec,
    [field]: value,
  };
}

export function updateSpecArrayItem(
  spec: ContentSpec,
  field: SpecArrayField,
  index: number,
  value: string
): ContentSpec {
  return {
    ...spec,
    [field]: spec[field].map((item, itemIndex) => (itemIndex === index ? value : item)),
  };
}

export function addSpecArrayItem(spec: ContentSpec, field: SpecArrayField): ContentSpec {
  return {
    ...spec,
    [field]: [...spec[field], ''],
  };
}

export function removeSpecArrayItem(spec: ContentSpec, field: SpecArrayField, index: number): ContentSpec {
  return {
    ...spec,
    [field]: spec[field].filter((_, itemIndex) => itemIndex !== index),
  };
}

export function createSpecReviewActions(input: {
  getDraft: () => ContentSpec;
  onRegenerate: (spec: ContentSpec) => void | Promise<void>;
  onBack: () => void;
}) {
  return {
    regenerate: () => input.onRegenerate(input.getDraft()),
    back: () => input.onBack(),
  };
}
