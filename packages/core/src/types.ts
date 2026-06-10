/**
 * 중간 표현(IR) + 공개 결과 타입.
 *
 * 모든 패스는 IR 을 입력받아 더 풍부한 IR 을 반환한다. meta 는 런타임 줌/팬과
 * 출력 재현성을 위해 투영 파라미터·viewBox 를 노출한다.
 */

import type { GeoFeature } from '@geoinsight/data';

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

export interface ArrowStyle {
  color: string;
  /** taper wedge 시작/끝 폭(px). */
  widthStart: number;
  widthEnd: number;
  /** arrowhead 길이(px). */
  headLength: number;
  /** arrowhead 폭(px). */
  headWidth: number;
}

export interface Theme {
  ocean: string;
  worldFaint: string;
  worldStroke: string;
  graticule: string;
  groupPalette: string[];
  focusAccent: string[];
  linkColor: string;
  label: { fill: string; halo: string; font: string; size: number };
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
  style: ResolvedStyle;
}

export interface Link {
  from: string; // Entity.key
  to: string; // Entity.key
  anchor: 'border' | 'centroid';
  curve: number;
  geodesic: boolean;
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
