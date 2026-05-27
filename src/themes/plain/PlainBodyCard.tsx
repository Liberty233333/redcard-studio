import React from 'react';
import { parseLine, parseInline } from '../../utils/markdown';
import type { BodyCardProps } from '../types';

export function PlainBodyCard({ id, content, fontSize, cardIndex, totalCards }: BodyCardProps) {
  return (
    <div
      id={`card-${id}`}
      className="relative w-[450px] aspect-[3/4] overflow-hidden select-none border border-zinc-200 bg-white px-8 py-7 text-zinc-950 shadow-[0_30px_60px_-12px_rgba(0,0,0,0.10),0_18px_36px_-18px_rgba(0,0,0,0.12)]"
      style={{ fontSize: `${fontSize}px` }}
    >
      <div className="mb-5 flex items-center justify-between border-b border-zinc-200 pb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
        <span>Markdown</span>
        <span>{String(cardIndex + 1).padStart(2, '0')} / {String(totalCards).padStart(2, '0')}</span>
      </div>
      <div className="h-[492px] overflow-hidden whitespace-pre-wrap break-words font-sans leading-[1.78] text-zinc-900">
        {content.map((raw, index) => renderMd(raw, index))}
      </div>
    </div>
  );
}

function renderMd(raw: string, key: number) {
  const md = parseLine(raw);
  switch (md.kind) {
    case 'blank': return <div key={key} className="h-[1.05em]" />;
    case 'h1': return <h1 key={key} className="my-[0.45em] text-[1.65em] font-bold leading-[1.15]">{renderInline(md.text)}</h1>;
    case 'h2': return <h2 key={key} className="mb-[0.28em] mt-[0.6em] text-[1.32em] font-bold leading-[1.2]">{renderInline(md.text)}</h2>;
    case 'h3': return <h3 key={key} className="mb-[0.2em] mt-[0.45em] text-[1.08em] font-bold leading-[1.25] text-zinc-700">{renderInline(md.text)}</h3>;
    case 'quote': return <p key={key} className="border-l-2 border-zinc-300 pl-[0.8em] font-semibold text-zinc-700">{renderInline(md.text)}</p>;
    case 'divider': return <div key={key} className="my-[1em] h-px w-16 bg-zinc-300" />;
    case 'list':
      return (
        <p key={key} className="pl-[1.2em] -indent-[1.2em]">
          <span className="mr-[0.45em] font-bold text-zinc-500">{md.ordered ? `${md.index}.` : '-'}</span>
          {renderInline(md.text)}
        </p>
      );
    case 'p': return <p key={key}>{renderInline(md.text)}</p>;
  }
}

function renderInline(text: string) {
  return parseInline(text).map((span, index) => {
    if (span.kind === 'bold') return <span key={index} className="font-bold">{span.text}</span>;
    if (span.kind === 'italic') return <em key={index} className="italic text-zinc-700">{span.text}</em>;
    return <React.Fragment key={index}>{span.text}</React.Fragment>;
  });
}
