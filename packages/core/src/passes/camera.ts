/**
 * Project & Fit 패스.
 *
 * projection 생성 → rotate(center) 적용 → fit 모드에 따라 fitExtent → lon/lat→화면
 * 좌표 확정. rotate 는 fit 보다 먼저 적용한다(구현지침 §2.3).
 *
 * dominant: 각 엔티티의 최대 면적 클러스터들의 합집합에 카메라를 맞춘다 — 전체
 * 지오메트리는 그대로 그리되 프레이밍만 주 클러스터에. 해외 영토로 인한 폭주 방지.
 */

import type { GeoFeature, Resolver } from '@geo-insight/data';
import { createResolver, normalizeName } from '@geo-insight/data';
import { geoCentroid, geoDistance, geoPath } from 'd3-geo';
import { centroidOf, largestPolygon } from '../geometry.js';
import { createPathString, createProjection, type Projection, round } from '../projection.js';
import type { Entity, ProjectionType, SceneMeta } from '../types.js';
import type { SceneConfig } from './build-scene.js';

export interface Camera {
  project(lonlat: [number, number]): [number, number] | null;
  /** GeoJSON 객체 → 화면 path d 문자열(반올림). */
  path(object: unknown): string;
  /**
   * 이 좌표가 보이는 면에 있는지 — orthographic(globe)에서 뒷면(중심 90° 밖)은 false.
   * raw projection 은 뒷면 점도 디스크에 투영하므로(겹침) 라벨/링크가 앞면에 잘못
   * 그려진다. 이 판정으로 컬링한다. 비클립 투영(flat 등)은 항상 true.
   */
  visible(lonlat: [number, number]): boolean;
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
  /**
   * 팬/회전 재투영용 — fitExtent 를 건너뛰고 이 파라미터로 카메라를 고정한다.
   * 최초 렌더의 fit 결과(scale/translate)를 그대로 재사용하고 rotate 만 바꿔
   * "프레이밍은 그대로, 지구만 회전" 시킨다. rotate=[λ,φ] (globe 는 φ 로 위도 회전).
   */
  fixed?: { rotate: [number, number]; scale: number; translate: [number, number] };
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
  // showOnly(행정구역 보기)는 한 국가만 격리 표시 — 여백을 더 줘 뷰포트의 ~80% 에 fit.
  const padFrac = config.showOnly ? 0.1 : 0.06;
  const padding = opts.padding ?? Math.round(Math.min(width, height) * padFrac);
  const resolver = opts.resolver ?? createResolver();

  const { projection, fallbackFrom } = createProjection(config.projectionType);

  let rotate: [number, number];
  let scale: number;
  let translate: [number, number];
  if (opts.fixed) {
    // 재투영(팬/회전) — fit 을 다시 돌리지 않고 고정 파라미터로 복원. rotate 만 변동.
    rotate = opts.fixed.rotate;
    projection.rotate(rotate).scale(opts.fixed.scale).translate(opts.fixed.translate);
    scale = opts.fixed.scale;
    translate = [opts.fixed.translate[0], opts.fixed.translate[1]];
  } else {
    const extent: [[number, number], [number, number]] = [
      [padding, padding],
      [width - padding, height - padding],
    ];
    if (config.projectionType === 'orthographic') {
      // globe — 디스크(전체 sphere)를 뷰포트 중앙에 맞춘다(dominant/entities fit 무시).
      // 회전으로는 disc 위치를 못 바꾸므로 항상 중앙 배치해야 캔버스 중심에 온다.
      // 포커스 지역이 정면을 향하도록 rotate 로 조준: center 가 명시되면 그 경도(위도 0),
      // 아니면 표시 지역 중심(경위도)을 정면에.
      const explicit = config.arrange != null || (config.centerRaw?.trim() ?? '') !== '';
      if (explicit) {
        rotate = [-resolveCenterLon(config, entities, resolver), 0];
      } else {
        const f = focusLonLat(config, entities);
        rotate = f ? [-f[0], -f[1]] : [0, 0];
      }
      projection.rotate(rotate);
      projection.fitExtent(extent, { type: 'Sphere' } as never);
    } else {
      const centerLon = resolveCenterLon(config, entities, resolver);
      rotate = [-centerLon, 0];
      projection.rotate(rotate);
      const fitObject = fitGeometry(config, entities, centerLon);
      // 전세계(Sphere)를 fit 하는 모든 경우 — fit:world 명시뿐 아니라 show/fit 없는 'earth:'
      // 처럼 대상이 없어 Sphere 로 폴백한 경우까지 — 는 cover 로 viewBox 를 빈틈없이 채운다.
      // fitExtent(meet)는 2:1 sphere 를 뷰포트에 내접시켜 종횡비 차만큼 여백을 남기므로,
      // 전세계는 처음부터 cover. 특정 영역(entities/bbox) fit 은 meet 로 여백을 둔다.
      const isSphere = (fitObject as { type?: string }).type === 'Sphere';
      if (isSphere) {
        fitCover(projection, width, height, fitObject);
      } else {
        projection.fitExtent(extent, fitObject as never);
      }
    }
    scale = projection.scale();
    const t = projection.translate();
    translate = [t[0]!, t[1]!];
  }

  const path = createPathString(projection, precision);

  const meta: SceneMeta = {
    viewBox: [0, 0, width, height],
    width,
    height,
    precision,
    projectionParams: {
      type: config.projectionType,
      rotate,
      scale: round(scale, 4),
      translate: [round(translate[0], 4), round(translate[1], 4)],
    },
  };

  // orthographic 뒷면 판정용 — 디스크 정중앙의 지리 좌표 [경도, 위도].
  const isOrtho = config.projectionType === 'orthographic';
  const visCenter: [number, number] = [-rotate[0], -rotate[1]];

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
    visible(ll) {
      if (!isOrtho) return true;
      return geoDistance(ll, visCenter) <= Math.PI / 2 - 0.02;
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

/**
 * globe 정면 조준용 포커스 지역 중심 [lon, lat]. fitGeometry(dominant/entities)의
 * 구면 중심을 쓴다 — 표시 지역이 디스크 정면에 오게. 비어있으면(전세계) null.
 */
function focusLonLat(config: SceneConfig, entities: Entity[]): [number, number] | null {
  const fit = fitGeometry(config, entities, 0);
  if (!fit || (fit as { type?: string }).type === 'Sphere') return null;
  const c = geoCentroid(fit as never);
  if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
  return [c[0], c[1]];
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

/**
 * cover fit — object 가 viewBox(width×height)를 빈틈없이 덮도록 scale/translate 설정.
 * d3 의 fitExtent 는 meet(내접, 여백 발생)만 지원하므로, scale=1 기준 bounds 로 cover
 * 배율(짧은 축이 채워지는 max 비율)을 구한 뒤 중심을 viewBox 중앙에 맞춘다. rotate 는
 * 호출부에서 이미 적용된 상태를 유지한다(scale/translate 만 건드림).
 */
function fitCover(projection: Projection, width: number, height: number, object: unknown): void {
  projection.scale(1).translate([0, 0]);
  const b0 = geoPath(projection).bounds(object as never);
  const w0 = b0[1][0] - b0[0][0];
  const h0 = b0[1][1] - b0[0][1];
  if (!(w0 > 0) || !(h0 > 0)) {
    // 폴백 — 비유한/퇴화 bounds 면 기존 meet fit 으로.
    projection.fitExtent(
      [
        [0, 0],
        [width, height],
      ],
      object as never,
    );
    return;
  }
  projection.scale(Math.max(width / w0, height / h0));
  const b1 = geoPath(projection).bounds(object as never);
  projection.translate([
    (width - (b1[1][0] + b1[0][0])) / 2,
    (height - (b1[1][1] + b1[0][1])) / 2,
  ]);
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
