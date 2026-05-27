import React from 'react';
import { parseLine, parseInline } from '../../utils/markdown';
import type { BodyCardProps } from '../types';
import './arch.css';

export function ArchBodyCard({ id, content, fontSize, cardIndex, totalCards }: BodyCardProps) {
  const idx = String(cardIndex + 1).padStart(2, '0');
  const total = String(totalCards).padStart(2, '0');

  return (
    <div id={`card-${id}`} className="arch-card arch-body" style={{ fontSize: `${fontSize}px` }}>
      <div className="arch-body-head">
        <span className="arch-rule-mark" />
        <span className="arch-note">№ {idx}</span>
      </div>

      {/* markdown content */}
      <div className="arch-content">
        {content.map((raw, i) => renderMd(raw, i))}
      </div>

      {/* footer */}
      <div className="arch-footer">
        <span className="arch-circle" />
        <span className="arch-page-count">{idx} / {total}</span>
      </div>
    </div>
  );
}

function renderMd(raw: string, key: number) {
  const md = parseLine(raw);
  switch (md.kind) {
    case 'blank': return <div key={key} style={{ height: '1.05em' }} />;
    case 'h1': return <h1 key={key}>{renderInline(md.text)}</h1>;
    case 'h2': return <h2 key={key}>{renderInline(md.text)}</h2>;
    case 'h3': return <h3 key={key}>{renderInline(md.text)}</h3>;
    case 'quote': return <p key={key} className="arch-quote">{renderInline(md.text)}</p>;
    case 'divider': return <div key={key} className="arch-divider" />;
    case 'list':
      return (
        <p key={key} className="arch-list">
          <span className="arch-bullet">▸</span>
          {renderInline(md.text)}
        </p>
      );
    case 'p': return <p key={key}>{renderInline(md.text)}</p>;
  }
}

function renderInline(text: string) {
  return parseInline(text).map((s, i) => {
    if (s.kind === 'bold')   return <span key={i} className="arch-bold">{s.text}</span>;
    if (s.kind === 'italic') return <em key={i} className="arch-italic">{s.text}</em>;
    return <React.Fragment key={i}>{s.text}</React.Fragment>;
  });
}
