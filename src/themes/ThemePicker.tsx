import type { ThemeKey } from '../types';
import type { CSSProperties } from 'react';
import { THEMES } from './registry';

interface Props {
  value: ThemeKey;
  onChange: (k: ThemeKey) => void;
}

export function ThemePicker({ value, onChange }: Props) {
  return (
    <div className="theme-picker-shell">
      <div className="theme-picker-label">卡片风格</div>
      <div className="theme-picker">
        {THEMES.map((t) => {
          const active = t.key === value;
          const disabled = !t.enabled;
          return (
            <button
              key={t.key}
              type="button"
              disabled={disabled}
              onClick={() => !disabled && onChange(t.key)}
              className={
                'theme-btn' +
                (active ? ' active' : '') +
                (disabled ? ' disabled' : '')
              }
              title={disabled ? `${t.name}（${t.phase}）` : t.name}
              style={{ '--theme-accent': t.accent } as CSSProperties}
            >
              <span className="theme-btn-radio" aria-hidden />
              <span className="theme-btn-name">{t.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
