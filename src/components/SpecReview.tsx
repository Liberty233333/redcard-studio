import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { ContentSpec } from '../spec/contentSpec.ts';
import {
  addSpecArrayItem,
  createSpecReviewActions,
  removeSpecArrayItem,
  SPEC_REVIEW_LABELS,
  updateSpecArrayItem,
  updateSpecTextField,
  type SpecArrayField,
} from './specReviewModel.ts';

interface SpecReviewProps {
  spec: ContentSpec;
  busy?: boolean;
  onRegenerate: (spec: ContentSpec) => void | Promise<void>;
  onBack: () => void;
}

const ARRAY_FIELDS: SpecArrayField[] = ['mustKeepFacts', 'mustAvoid', 'voiceAnchors', 'platformConventions', 'staleInsights'];

export function SpecReview({ spec, busy = false, onRegenerate, onBack }: SpecReviewProps) {
  const [draft, setDraft] = useState<ContentSpec>(spec);
  useEffect(() => {
    setDraft(spec);
  }, [spec]);
  const actions = useMemo(
    () => createSpecReviewActions({ getDraft: () => draft, onRegenerate, onBack }),
    [draft, onBack, onRegenerate]
  );

  return (
    <section className="spec-review" aria-label="Content SPEC 审阅">
      <div className="spec-review-head">
        <div>
          <span className="label">CONTENT SPEC</span>
          <h2 className="panel-title">查看 / 编辑本篇 SPEC</h2>
        </div>
      </div>

      <div className="spec-review-grid">
        <label className="spec-field full">
          <span>{SPEC_REVIEW_LABELS.thesis}</span>
          <input
            value={draft.thesis}
            onChange={(event) => setDraft((current) => updateSpecTextField(current, 'thesis', event.target.value))}
          />
        </label>

        <label className="spec-field">
          <span>{SPEC_REVIEW_LABELS.targetReader}</span>
          <textarea
            value={draft.targetReader}
            onChange={(event) => setDraft((current) => updateSpecTextField(current, 'targetReader', event.target.value))}
          />
        </label>

        <label className="spec-field">
          <span>{SPEC_REVIEW_LABELS.hookAngle}</span>
          <textarea
            value={draft.hookAngle || ''}
            placeholder="未提供，可选填"
            onChange={(event) => setDraft((current) => updateSpecTextField(current, 'hookAngle', event.target.value))}
          />
        </label>

        <label className="spec-field full">
          <span>{SPEC_REVIEW_LABELS.structureHint}</span>
          <textarea
            value={draft.structureHint || ''}
            placeholder="未提供，可选填"
            onChange={(event) => setDraft((current) => updateSpecTextField(current, 'structureHint', event.target.value))}
          />
        </label>

        {ARRAY_FIELDS.map((field) => (
          <div key={field} className="spec-array">
            <div className="spec-array-head">
              <span>{SPEC_REVIEW_LABELS[field]}</span>
              <button className="mini-btn bordered" onClick={() => setDraft((current) => addSpecArrayItem(current, field))}>
                <Plus className="w-3 h-3" />
                添加一条
              </button>
            </div>
            <div className="spec-array-list">
              {draft[field].map((item, index) => (
                <div key={`${field}-${index}`} className="spec-array-row">
                  <input
                    value={item}
                    onChange={(event) => setDraft((current) => updateSpecArrayItem(current, field, index, event.target.value))}
                  />
                  <button className="mini-square" title="删除" onClick={() => setDraft((current) => removeSpecArrayItem(current, field, index))}>
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {!draft[field].length && <p className="small-note">暂无条目，可点击添加。</p>}
            </div>
          </div>
        ))}
      </div>

      <div className="spec-review-footer">
        <button className="black-btn" onClick={actions.regenerate} disabled={busy}>
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
          用此 SPEC 重新生成
        </button>
        <button className="mini-btn bordered" onClick={actions.back} disabled={busy}>
          返回结果
        </button>
      </div>
    </section>
  );
}
