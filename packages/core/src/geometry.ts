/**
 * 구면 기하 측정 — d3-geo 의 centroid/bounds/area/interpolate/distance 래핑.
 *
 * 모두 투영 비종속(구면). Geometry 패스(centroid/bbox)와 fit dominant(최대 면적
 * 클러스터), link routing(대권선)에서 쓴다.
 */

import { geoArea, geoBounds, geoCentroid, geoDistance, geoGraticule10, geoInterpolate } from 'd3-geo';
import type { GeoFeature } from '@geo-insight/data';

/** 경위도 격자(graticule) GeoJSON — 10° 간격. emit 배경 레이어용. */
export function graticule(): unknown {
  return geoGraticule10();
}

type LonLat = [number, number];

function featureCollection(features: GeoFeature[]): unknown {
  return { type: 'FeatureCollection', features };
}

/** 여러 feature 의 합집합 구면 centroid (lon,lat). */
export function centroidOf(features: GeoFeature[]): LonLat {
  if (features.length === 0) return [0, 0];
  const c = geoCentroid(featureCollection(features) as never);
  return [c[0], c[1]];
}

/** 합집합 구면 bbox [w,s,e,n]. */
export function boundsOf(features: GeoFeature[]): [number, number, number, number] {
  if (features.length === 0) return [0, 0, 0, 0];
  const b = geoBounds(featureCollection(features) as never);
  return [b[0][0], b[0][1], b[1][0], b[1][1]];
}

/** feature 1개의 구면 면적(스테라디안). */
export function areaOf(feature: GeoFeature): number {
  return geoArea(feature as never);
}

/**
 * 엔티티의 "주 클러스터" bbox — 가장 면적이 큰 단일 feature 의 bbox.
 *
 * 해외 영토가 있는 국가(프랑스·미국 등)에서 카메라 폭주를 막기 위해 fit:dominant
 * 가 사용. MultiPolygon 은 폴리곤별로 쪼개 면적 비교.
 */
export function dominantBoundsOf(features: GeoFeature[]): [number, number, number, number] {
  let best: GeoFeature | null = null;
  let bestArea = -1;
  for (const f of explodePolygons(features)) {
    const a = geoArea(f as never);
    if (a > bestArea) {
      bestArea = a;
      best = f;
    }
  }
  return best ? boundsOf([best]) : boundsOf(features);
}

/** 엔티티의 최대 면적 단일 폴리곤 feature — fit:dominant 프레이밍 객체용. */
export function largestPolygon(features: GeoFeature[]): GeoFeature | null {
  let best: GeoFeature | null = null;
  let bestArea = -1;
  for (const f of explodePolygons(features)) {
    const a = geoArea(f as never);
    if (a > bestArea) {
      bestArea = a;
      best = f;
    }
  }
  return best;
}

/** MultiPolygon 을 단일 Polygon feature 들로 분해. */
function explodePolygons(features: GeoFeature[]): GeoFeature[] {
  const out: GeoFeature[] = [];
  for (const f of features) {
    if (f.geometry.type === 'Polygon') {
      out.push(f);
    } else {
      f.geometry.coordinates.forEach((poly, i) => {
        out.push({
          ...f,
          id: `${f.id}#${i}`,
          geometry: { type: 'Polygon', coordinates: poly },
        });
      });
    }
  }
  return out;
}

/** 두 점 사이 대권선 거리(라디안). */
export function distance(a: LonLat, b: LonLat): number {
  return geoDistance(a, b);
}

/** 대권선 보간자 — t∈[0,1] → lon,lat. */
export function interpolator(a: LonLat, b: LonLat): (t: number) => LonLat {
  const fn = geoInterpolate(a, b);
  return (t: number) => {
    const p = fn(t);
    return [p[0], p[1]];
  };
}

/**
 * 여러 bbox 의 합집합 — antimeridian 을 고려하지 않는 단순 경위도 합집합.
 * fit dominant/entities 에서 카메라 프레이밍 bbox 산출에 사용.
 */
export function unionBounds(
  boxes: Array<[number, number, number, number]>,
): [number, number, number, number] {
  if (boxes.length === 0) return [-180, -90, 180, 90];
  let [w, s, e, n] = boxes[0]!;
  for (const [bw, bs, be, bn] of boxes.slice(1)) {
    w = Math.min(w, bw);
    s = Math.min(s, bs);
    e = Math.max(e, be);
    n = Math.max(n, bn);
  }
  return [w, s, e, n];
}
