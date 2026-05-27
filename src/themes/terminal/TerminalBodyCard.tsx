import React from 'react';
import { parseLine, parseInline } from '../../utils/markdown';
import type { BodyCardProps } from '../types';
import './terminal.css';

export function TerminalBodyCard({ id, content, fontSize, cardIndex, totalCards }: BodyCardProps) {
  const idx = String(cardIndex + 1).padStart(2, '0');
  const total = String(totalCards).padStart(2, '0');

  return (
    <div id={`card-${id}`} className="terminal-card" style={{ fontSize: `${fontSize}px` }}>
      <div className="terminal-topbar">
        <span>{idx}</span>
        <span>{total}</span>
      </div>
      <div className="terminal-content">
        {content.map((raw, index) => renderMd(raw, index))}
      </div>
      <div className="terminal-prompt">
        → {idx}
      </div>
    </div>
  );
}

function renderMd(raw: string, key: number) {
  const md = parseLine(raw);
  switch (md.kind) {
    case 'blank': return <div key={key} className="terminal-blank" />;
    case 'h1': return <h1 key={key}>{renderInline(md.text)}</h1>;
    case 'h2': return <h2 key={key}>{renderInline(md.text)}</h2>;
    case 'h3': return <h3 key={key}>{renderInline(md.text)}</h3>;
    case 'quote': return <p key={key} className="terminal-quote">{renderInline(md.text)}</p>;
    case 'divider': return <div key={key} className="terminal-divider" />;
    case 'list':
      return (
        <p key={key} className="terminal-list">
          <span>{md.ordered ? `${md.index}.` : '>'}</span>
          {renderInline(md.text)}
        </p>
      );
    case 'p': return <p key={key}>{renderInline(md.text)}</p>;
  }
}

function renderInline(text: string) {
  return parseInline(text).map((span, index) => {
    if (span.kind === 'bold') return <span key={index} className="terminal-bold">{span.text}</span>;
    if (span.kind === 'italic') return <em key={index} className="terminal-italic">{span.text}</em>;
    return <React.Fragment key={index}>{span.text}</React.Fragment>;
  });
}
