/**
 * 테마 토큰 — 기본 다크 카토그래픽.
 *
 * named 토큰(amber/coral/teal 등)을 hex 로 해석한다. DSL `theme { }` 블록이나
 * CompileOptions.theme 로 부분 오버라이드 가능.
 */

import type { Theme } from './types.js';

/** named 색 토큰 → hex. */
export const COLOR_TOKENS: Record<string, string> = {
  amber: '#d98a3a',
  coral: '#e1604f',
  teal: '#3fb6ab',
  slate: '#5b6b7a',
  indigo: '#5a6abf',
  moss: '#6a9a52',
  sand: '#cdb892',
  rose: '#d06a8c',
  sky: '#5aa8d6',
};

export const DEFAULT_THEME: Theme = {
  ocean: '#0f1726', // 다크 오션(sphere)
  worldFaint: '#1c2738', // 비선택 국가
  worldStroke: '#2a3850',
  graticule: '#1a2334',
  groupPalette: ['#d98a3a', '#6a9a52', '#5a6abf', '#d06a8c'],
  focusAccent: ['#e1604f', '#3fb6ab'],
  linkColor: '#3fb6ab',
  label: { fill: '#eef2f7', halo: '#0f1726', font: 'system-ui, sans-serif', size: 13 },
  oceanLabel: { fill: '#46586f', size: 15, spacing: 2 },
  tokens: COLOR_TOKENS,
};

/** named 토큰이면 hex 로, 아니면 입력 그대로(이미 hex/css color). */
export function resolveColor(value: string, theme: Theme): string {
  return theme.tokens[value] ?? value;
}

export function resolveTheme(override?: Partial<Theme>): Theme {
  if (!override) return { ...DEFAULT_THEME };
  return {
    ...DEFAULT_THEME,
    ...override,
    label: { ...DEFAULT_THEME.label, ...(override.label ?? {}) },
    oceanLabel: { ...DEFAULT_THEME.oceanLabel, ...(override.oceanLabel ?? {}) },
    tokens: { ...DEFAULT_THEME.tokens, ...(override.tokens ?? {}) },
  };
}
