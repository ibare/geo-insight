/**
 * Project & Fit 패스.
 *
 * projection 생성 → rotate(center) 적용 → fit 모드에 따라 fitExtent → lon/lat→화면
 * 좌표 확정. rotate 는 fit 보다 먼저 적용한다(구현지침 §2.3).
 *
 * dominant: 각 엔티티의 최대 면적 클러스터들의 합집합에 카메라를 맞춘다 — 전체
 * 지오메트리는 그대로 그리되 프레이밍만 주 클러스터에. 해외 영토로 인한 폭주 방지.
 */

import type { GeoFeature, Resolver } from '@geoinsight/data';
import { createResolver, normalizeName } from '@geoinsight/data';
import { geoPath } from 'd3-geo';
import { centroidOf, largestPolygon } from '../geometry.js';
import { createPathString, createProjection, type Projection, round } from '../projection.js';
import type { Entity, ProjectionType, SceneMeta } from '../types.js';
import type { SceneConfig } from './build-scene.js';

export interface Camera {
  project(lonlat: [number, number]): [number, number] | null;
  /** GeoJSON 객체 → 화면 path d 문자열(반올림). */
  path(object: unknown): string;
  width: number;
  height: number;
  meta: SceneMeta;
  fallbackProjection?: ProjectionType;
}

export interface CameraOptions {
  width: number;
  height: number;
  precision: number;
  /** fit:world / 배경 faint world 용 전체 sphere 패딩. */
  padding?: number;
  resolver?: Resolver;
}

/** 중앙 자오선 프리셋 — normalizeName 적용된 키. */
const PRESET_CENTERS: Record<string, number> = {
  pacific: 180,
  태평양: 180,
  atlantic: -30,
  대서양: -30,
  indian: 80,
  인도양: 80,
  greenwich: 0,
  본초자오선: 0,
};

export function createCamera(entities: Entity[], config: SceneConfig, opts: CameraOptions): Camera {
  const { width, height, precision } = opts;
  const padding = opts.padding ?? Math.round(Math.min(width, height) * 0.06);
  const resolver = opts.resolver ?? createResolver();

  const centerLon = resolveCenterLon(config, entities, resolver);
  const { projection, fallbackFrom } = createProjection(config.projectionType);
  projection.rotate([-centerLon, 0]);

  const fitObject = fitGeometry(config, entities, centerLon);
  const extent: [[number, number], [number, number]] = [
    [padding, padding],
    [width - padding, height - padding],
  ];
  projection.fitExtent(extent, fitObject as never);

  const path = createPathString(projection, precision);
  const scale = projection.scale();
  const translate = projection.translate();

  const meta: SceneMeta = {
    viewBox: [0, 0, width, height],
    width,
    height,
    precision,
    projectionParams: {
      type: config.projectionType,
      rotate: [-centerLon, 0],
      scale: round(scale, 4),
      translate: [round(translate[0], 4), round(translate[1], 4)],
    },
  };

  const cam: Camera = {
    width,
    height,
    meta,
    path,
    project(ll) {
      const p = (projection as (xy: [number, number]) => [number, number] | null)(ll);
      if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
      return [round(p[0], precision), round(p[1], precision)];
    },
  };
  if (fallbackFrom) cam.fallbackProjection = fallbackFrom;
  return cam;
}

function resolveCenterLon(config: SceneConfig, entities: Entity[], resolver: Resolver): number {
  if (config.arrange) {
    const a = centroidLonFor(config.arrange.from, entities, resolver);
    const b = centroidLonFor(config.arrange.to, entities, resolver);
    if (a != null && b != null) return arrangeCenter(a, b);
  }
  const raw = config.centerRaw?.trim();
  if (!raw) return 0;
  // 숫자
  const asNum = Number(raw);
  if (raw !== '' && !Number.isNaN(asNum)) return asNum;
  // 프리셋 (한/영)
  const preset = PRESET_CENTERS[normalizeName(raw)];
  if (preset != null) return preset;
  // 엔티티명
  const lon = centroidLonFor(raw, entities, resolver);
  return lon ?? 0;
}

function centroidLonFor(name: string, entities: Entity[], resolver: Resolver): number | null {
  const norm = normalizeName(name);
  const ent = entities.find((e) => normalizeName(e.display) === norm);
  if (ent) return ent.centroid[0];
  const res = resolver.resolve(name);
  if (res.kind === 'unknown') {
    const preset = PRESET_CENTERS[norm];
    return preset ?? null;
  }
  return centroidOf(res.features)[0];
}

/** A 가 왼쪽, B 가 오른쪽이 되도록 중앙 자오선 역산. */
function arrangeCenter(aLon: number, bLon: number): number {
  const d = wrapLon(bLon - aLon);
  let c = wrapLon(aLon + d / 2);
  // A 가 오른쪽(offset>0)이면 반대편 중점으로 뒤집어 A 를 왼쪽으로.
  if (wrapLon(aLon - c) > 0) c = wrapLon(c + 180);
  return c;
}

export function wrapLon(x: number): number {
  return ((((x + 180) % 360) + 360) % 360) - 180;
}

/** fit 모드 → fitExtent 대상 GeoJSON 객체. */
function fitGeometry(config: SceneConfig, entities: Entity[], _centerLon: number): unknown {
  const fit = config.fit;
  if (fit.mode === 'world') return { type: 'Sphere' };
  if (fit.mode === 'bbox') {
    return bboxPolygon(fit.bbox);
  }
  const features: GeoFeature[] = [];
  if (fit.mode === 'dominant') {
    for (const e of entities) {
      const dom = largestPolygon(e.features);
      if (dom) features.push(dom);
    }
  } else {
    // entities
    for (const e of entities) features.push(...e.features);
  }
  if (features.length === 0) return { type: 'Sphere' };
  return { type: 'FeatureCollection', features };
}

function bboxPolygon([w, s, e, n]: [number, number, number, number]): unknown {
  // Polygon 으로 주면 d3-geo 가 ring winding 을 구면상 여집합(전세계)으로 해석해
  // fit 이 전세계로 폭주한다. winding 모호성이 없는 둘레 샘플 MultiPoint 로 대체 —
  // fitExtent 는 점들의 투영 bounds 를 쓰므로 곡선 변까지 포함해 정확히 프레이밍.
  const STEPS = 16;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    pts.push([w + (e - w) * t, s]); // 아래 변
    pts.push([w + (e - w) * t, n]); // 위 변
    pts.push([w, s + (n - s) * t]); // 왼 변
    pts.push([e, s + (n - s) * t]); // 오른 변
  }
  return { type: 'MultiPoint', coordinates: pts };
}

/**
 * meta.projectionParams 로 투영을 재구성한 카메라 — 런타임이 hover 하이라이트
 * (feature → path)와 클릭 역변환(unproject)에 쓴다. fitExtent 를 다시 돌리지 않고
 * scale/translate/rotate 를 그대로 복원하므로 emit 과 동일한 좌표계를 보장한다.
 */
export interface MetaCamera {
  project(lonlat: [number, number]): [number, number] | null;
  unproject(xy: [number, number]): [number, number] | null;
  path(object: unknown): string;
  /** GeoJSON 객체의 화면(viewBox) 좌표 bbox [[x0,y0],[x1,y1]]. 비유한이면 null. */
  bounds(object: unknown): [[number, number], [number, number]] | null;
}

export function cameraFromMeta(meta: SceneMeta): MetaCamera {
  const { type, rotate, scale, translate } = meta.projectionParams;
  const { projection } = createProjection(type);
  projection.rotate(rotate).scale(scale).translate(translate);
  const path = createPathString(projection, meta.precision);
  const pathGen = geoPath(projection);
  const fn = projection as (xy: [number, number]) => [number, number] | null;
  return {
    project(ll) {
      const p = fn(ll);
      if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
      return [round(p[0], meta.precision), round(p[1], meta.precision)];
    },
    unproject(xy) {
      const inv = projection.invert?.(xy);
      if (!inv || !Number.isFinite(inv[0]) || !Number.isFinite(inv[1])) return null;
      return [inv[0], inv[1]];
    },
    path,
    bounds(object) {
      const b = pathGen.bounds(object as never);
      if (!b.every((p) => p.every(Number.isFinite))) return null;
      return b as [[number, number], [number, number]];
    },
  };
}

export type { Projection };
