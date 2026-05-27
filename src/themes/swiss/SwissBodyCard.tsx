import React from 'react';
import { parseLine, parseInline } from '../../utils/markdown';
import type { BodyCardProps } from '../types';
import './swiss.css';

export function SwissBodyCard({ id, content, fontSize, cardIndex, totalCards }: BodyCardProps) {
  const idx = String(cardIndex + 1).padStart(2, '0');
  const total = String(totalCards).padStart(2, '0');

  return (
    <div id={`card-${id}`} className="swiss-card sw-body" style={{ fontSize: `${fontSize}px` }}>
      <div className="sw-body-head">
        <span className="sw-head-left">
          <span className="sw-mark" />
          <span>INSIGHT</span>
        </span>
        <span className="sw-page-count">{idx} / {total}</span>
      </div>

      {/* MARKDOWN content */}
      <div className="sw-body-content">
        {content.map((raw, i) => renderMd(raw, i))}
      </div>

      <div className="sw-bottom-bar" />
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
    case 'quote': return <p key={key} className="sw-quote">{renderInline(md.text)}</p>;
    case 'divider': return <div key={key} className="sw-divider" />;
    case 'list':
      return (
        <p key={key} className="sw-list">
          <span className="sw-bullet" />
          {renderInline(md.text)}
        </p>
      );
    case 'p': return <p key={key}>{renderInline(md.text)}</p>;
  }
}

function renderInline(text: string) {
  return parseInline(text).map((s, i) => {
    if (s.kind === 'bold')   return <span key={i} className="sw-bold">{s.text}</span>;
    if (s.kind === 'italic') return <em key={i} className="sw-italic">{s.text}</em>;
    return <React.Fragment key={i}>{s.text}</React.Fragment>;
  });
}
