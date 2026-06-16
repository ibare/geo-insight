/**
 * 중간 표현(IR) + 공개 결과 타입.
 *
 * 모든 패스는 IR 을 입력받아 더 풍부한 IR 을 반환한다. meta 는 런타임 줌/팬과
 * 출력 재현성을 위해 투영 파라미터·viewBox 를 노출한다.
 */

import type { GeoFeature } from '@geo-insight/data';

export type ProjectionType =
  | 'naturalEarth1'
  | 'equirectangular'
  | 'mercator'
  | 'orthographic'
  | 'robinson'
  | 'winkel3';

export interface ProjSpec {
  type: ProjectionType;
  /** d3 projection.rotate([-centerLon, 0]) 로 적용될 회전. */
  rotate: [number, number];
}

export type FitMode = 'entities' | 'dominant' | 'world';
export type FitSpec = { mode: FitMode } | { mode: 'bbox'; bbox: [number, number, number, number] };

export interface ResolvedStyle {
  fill: string;
  stroke: string;
  /** group 내부 국경 유지 여부. */
  borders: boolean;
  /** 라벨 표시 여부. */
  label: boolean;
  opacity: number;
}

/** 링크 표현 종류. 렌더러 레지스트리로 확장 가능(미등록은 arrow 로 폴백). */
export type LinkType = 'arrow' | 'wind' | 'current' | 'route';
export type ArrowHead = 'taper' | 'triangle' | 'none';

export interface ArrowStyle {
  color: string;
  /** taper wedge 시작/끝 폭(px). */
  widthStart: number;
  widthEnd: number;
  /** arrowhead 길이(px). */
  headLength: number;
  /** arrowhead 폭(px). */
  headWidth: number;
  /** arrowhead 모양. */
  head: ArrowHead;
  /** stroke 기반 타입(wind/route)의 점선 패턴. */
  dash?: number[];
}

export interface Theme {
  ocean: string;
  worldFaint: string;
  worldStroke: string;
  graticule: string;
  groupPalette: string[];
  /**
   * 선택된 개별 국가·지역(plain) 면색 시드. 안정 해시로 key 마다 색을 배정하고,
   * 시드 수를 넘으면 평균 톤을 유지한 채 Hue 를 자동 회전해 확장한다(color.ts).
   */
  selectPalette: string[];
  focusAccent: string[];
  linkColor: string;
  label: { fill: string; halo: string; font: string; size: number };
  /** 5대양 라벨(항상 표시) 스타일. */
  oceanLabel: { fill: string; size: number; spacing: number };
  /**
   * ADM1/2 시각 구분.
   * - fill/stroke: 강조된(선택된) 행정구역.
   * - contextStroke: 소속 국가 인접구역 경계(일반 모드 배경선).
   * (showOnly 미선택 행정구역 면은 worldFaint/worldStroke 를 재사용한다.)
   */
  subdivision: {
    fill: string;
    stroke: string;
    contextStroke: string;
  };
  /** 런타임 hover 하이라이트(편집 오버레이) — 커서 아래 지역의 면/아웃라인. */
  hover: { fill: string; stroke: string; width: number };
  /**
   * 큐레이션 레이어 흐름선 색 — feature.properties.kind → 색.
   * 해류: warm(난류)/cold(한류). 바람: trade(무역풍)/westerly(편서풍)/polar(극동풍).
   */
  layers: Record<string, string>;
  /** named 토큰(amber/coral/teal 등) → hex. */
  tokens: Record<string, string>;
}
export type ResolvedTheme = Theme;

export type Role = 'group' | 'focus' | 'plain';

export interface Entity {
  /** 정규화 키 (ccn3 또는 group id). */
  key: string;
  /** 원본 이름 (라벨 기본값). */
  display: string;
  role: Role;
  /** 이름이 해석된 전체 지오메트리 (1..n 국가 폴리곤). */
  features: GeoFeature[];
  /** 구면 centroid (lon,lat). */
  centroid: [number, number];
  /** 구면 bbox [w,s,e,n]. */
  bbox: [number, number, number, number];
  /** 레이어 순서 (작을수록 아래). */
  z: number;
  /** 행정 레벨 — 0=국가(기본), 1=ADM1(주/도), 2=ADM2(시/군). */
  level: 0 | 1 | 2;
  /** ADM1/2 의 소속 국가 ccn3 (level>0 일 때). */
  adm0?: string;
  style: ResolvedStyle;
}

export interface Link {
  from: string; // Entity.key
  to: string; // Entity.key
  anchor: 'border' | 'centroid';
  curve: number;
  geodesic: boolean;
  /** 표현 종류 (arrow 기본). */
  type: LinkType;
  /** 링크 라벨(선택). */
  label?: string;
  /** 라벨 배치 지점. */
  labelAt: 'start' | 'mid' | 'end';
  style: ArrowStyle;
}

export interface Label {
  text: string;
  /** lon,lat (배치 전). 패스7에서 화면좌표 확정. */
  at: [number, number];
  entityKey: string;
  collide: boolean;
}

export interface SceneMeta {
  /** [minX, minY, width, height]. */
  viewBox: [number, number, number, number];
  width: number;
  height: number;
  precision: number;
  projectionParams: {
    type: ProjectionType;
    rotate: [number, number];
    /** fitExtent 결과 scale/translate (런타임 줌/팬 재현용). */
    scale: number;
    translate: [number, number];
  };
}

export interface Scene {
  title?: string;
  /** showOnly 모드의 대상 국가 ccn3 — 설정 시 emit 이 바다/이웃국/그래티큘을 생략(격리). */
  showOnly?: string;
  /** 켜진 큐레이션 레이어 이름들(예: ['해류']). emit 이 dataSource 에서 지오메트리 조회. */
  layers?: string[];
  projection: ProjSpec;
  fit: FitSpec;
  theme: ResolvedTheme;
  entities: Entity[];
  links: Link[];
  labels: Label[];
  meta: SceneMeta;
}

export interface CompileOptions {
  /** 출력 너비(px). 기본 960. */
  width?: number;
  /** 출력 높이(px). 기본 width*0.6. */
  height?: number;
  /** 좌표 반올림 자릿수. 기본 2. */
  precision?: number;
  /** 테마 토큰 부분 오버라이드. */
  theme?: Partial<Theme>;
  /** 기본 투영 오버라이드 (DSL projection 이 우선). */
  projection?: ProjectionType;
  /** 기본 center 오버라이드 (DSL center 가 우선). lon 숫자 또는 엔티티명/프리셋. */
  center?: number | string;
}

export interface CompileResult {
  svg: string;
  scene: Scene;
  diagnostics: import('./diagnostics.js').Diagnostic[];
  meta: SceneMeta;
}
