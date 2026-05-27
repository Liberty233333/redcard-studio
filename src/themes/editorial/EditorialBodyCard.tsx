import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { parseLine, parseInline } from '../../utils/markdown';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

import type { BodyCardProps } from '../types';

/**
 * Editorial-narrative body card (450×600). Renders markdown:
 *   # H1 / ## H2 / ### H3 / - list / 1. list / **bold** / *italic*
 */
export function EditorialBodyCard({ id, content, fontSize, cardIndex }: BodyCardProps) {
  const displayIndex = String(cardIndex + 1).padStart(2, '0');
  return (
    <div
      id={`card-${id}`}
      className={cn(
        'relative w-[450px] aspect-[3/4] p-8 flex flex-col overflow-hidden select-none',
        'bg-[#F9F7F2] text-black font-serif border border-black/5',
        'shadow-[0_30px_60px_-12px_rgba(0,0,0,0.1),0_18px_36px_-18px_rgba(0,0,0,0.12)]'
      )}
      style={{ fontSize: `${fontSize}px` }}
    >
      <div className="paper-texture" />

      <div className="flex items-center justify-center gap-4 mb-6 opacity-40">
        <div className="h-px w-12 bg-zinc-200" />
        <span className="text-[8px] tracking-[0.8em] font-sans text-zinc-500 uppercase">
          Insight
        </span>
        <div className="h-px w-12 bg-zinc-200" />
      </div>

      <div className="text-zinc-900 leading-[1.75] font-light text-justify tracking-tight overflow-hidden flex-1 whitespace-pre-wrap break-words">
        {content.map((raw, i) => renderMdLine(raw, i))}
      </div>

      <div className="mt-auto pt-2 flex justify-between items-end relative h-14 pb-1">
        <div className="flex flex-col gap-1">
          <div className="font-sans text-[12px] uppercase tracking-[0.2em] text-rose-600 font-black relative z-10">
            SPECIAL REPORT
          </div>
        </div>
        <div className="font-serif italic text-[90px] leading-none text-zinc-900/[0.03] absolute -bottom-4 -right-4 select-none z-0">
          {displayIndex}
        </div>
      </div>
    </div>
  );
}

function renderMdLine(raw: string, key: number) {
  const md = parseLine(raw);

  switch (md.kind) {
    case 'blank':
      return <div key={key} className="h-[1.05em]" />;

    case 'h1':
      return (
        <h1
          key={key}
          className="font-serif italic font-black text-[1.9em] leading-[1.15] my-[0.5em] tracking-tight text-black"
          style={{ fontFamily: "'Noto Serif SC', 'Noto Sans SC', serif", fontVariantNumeric: 'lining-nums' }}
        >
          {renderInline(md.text)}
        </h1>
      );

    case 'h2':
      return (
        <h2
          key={key}
          className="font-serif font-bold text-[1.4em] leading-[1.2] mt-[0.6em] mb-[0.3em] tracking-tight text-rose-600"
        >
          {renderInline(md.text)}
        </h2>
      );

    case 'h3':
      return (
        <h3
          key={key}
          className="font-sans font-bold text-[1.05em] leading-[1.3] mt-[0.4em] mb-[0.2em] tracking-tight text-zinc-800 uppercase"
          style={{ letterSpacing: '0.05em' }}
        >
          {renderInline(md.text)}
        </h3>
      );

    case 'quote':
      return (
        <p key={key} className="border-l-2 border-rose-600 pl-[0.8em] font-semibold tracking-tight text-rose-700">
          {renderInline(md.text)}
        </p>
      );

    case 'divider':
      return <div key={key} className="my-[1em] h-px w-16 bg-rose-600/40" />;

    case 'list':
      return (
        <p key={key} className="tracking-tight pl-[1.2em] -indent-[1.2em]">
          <span className="text-rose-600 font-bold mr-[0.4em]">
            {md.ordered ? `${md.index}.` : '·'}
          </span>
          {renderInline(md.text)}
        </p>
      );

    case 'p':
      return (
        <p key={key} className="tracking-tight">
          {renderInline(md.text)}
        </p>
      );
  }
}

function renderInline(text: string) {
  const spans = parseInline(text);
  return spans.map((s, i) => {
    switch (s.kind) {
      case 'bold':
        return (
          <span key={i} className="font-bold text-rose-600">
            {s.text}
          </span>
        );
      case 'italic':
        return (
          <em key={i} className="italic text-zinc-700">
            {s.text}
          </em>
        );
      case 'text':
        return <React.Fragment key={i}>{s.text}</React.Fragment>;
    }
  });
}
