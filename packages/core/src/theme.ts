/**
 * 테마 토큰 — 기본 다크 카토그래픽.
 *
 * named 토큰(amber/coral/teal 등)을 hex 로 해석한다. DSL `theme { }` 블록이나
 * CompileOptions.theme 로 부분 오버라이드 가능.
 */

import type { Theme } from "./types.js";

/** named 색 토큰 → hex. */
export const COLOR_TOKENS: Record<string, string> = {
  amber: "#d98a3a",
  coral: "#e1604f",
  teal: "#3fb6ab",
  slate: "#5b6b7a",
  indigo: "#5a6abf",
  moss: "#6a9a52",
  sand: "#cdb892",
  rose: "#d06a8c",
  sky: "#5aa8d6",
};

export const DEFAULT_THEME: Theme = {
  ocean: "#B7DBEA", // 오션(sphere)
  worldFaint: "#FCF8F7", // 비선택 국가
  worldStroke: "#626056",
  graticule: "#8ABFD5",
  groupPalette: [
    "#E6E1C9",
    "#899CA5",
    "#C17D5B",
    "#D06A8C",
    "#CEDFB0",
    "#F5D8CE",
  ],
  // 선택 국가·지역(plain) 면색 시드 — 크림 배경용 파스텔. 안정 해시로 배정,
  // 부족 시 평균 톤 유지한 채 Hue 자동 회전 확장(color.ts buildSelectPalette).
  selectPalette: [
    "#A9C7E8", // soft blue
    "#F3C3A6", // soft coral
    "#C7D8A8", // soft sage
    "#EAD9AE", // soft sand
    "#ECC2CE", // soft rose
    "#A9D6CD", // soft teal
    "#CFC4E1", // soft lilac
    "#F0E2A6", // soft butter
  ],
  focusAccent: ["#e1604f", "#3fb6ab"],
  linkColor: "#3fb6ab",
  label: {
    fill: "#eef2f7",
    halo: "#0f1726",
    font: "system-ui, sans-serif",
    size: 13,
  },
  oceanLabel: { fill: "#46586f", size: 15, spacing: 2 },
  // ADM1 강조 fill(슬레이트 국가색과 구분되는 청록), 경계, 인접 행정구역 배경선,
  // showOnly 격리 면(어두운 배경 위 중립 패널 + 또렷한 경계).
  subdivision: {
    fill: "#3f7fa6",
    stroke: "#2a3850",
    contextStroke: "#33455e",
  },
  // 런타임 hover 하이라이트 — 커서 아래 지역 면(반투명)/아웃라인.
  hover: { fill: "rgba(255,255,255,0.18)", stroke: "#181818", width: 1 },
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
    subdivision: {
      ...DEFAULT_THEME.subdivision,
      ...(override.subdivision ?? {}),
    },
    hover: { ...DEFAULT_THEME.hover, ...(override.hover ?? {}) },
    tokens: { ...DEFAULT_THEME.tokens, ...(override.tokens ?? {}) },
  };
}
