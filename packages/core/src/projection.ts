/**
 * 투영 포트 + d3-geo 기본 어댑터.
 *
 * core 의 나머지는 d3-geo 를 직접 import 하지 않고 이 모듈만 본다 — 나중에 투영
 * 구현을 교체할 수 있도록. d3-geo 의 역할은 "구면 좌표 → 화면 픽셀" 변환과
 * geoPath 의 `d` 문자열 생성으로 한정한다.
 *
 * robinson/winkel3 은 d3-geo-projection(optionalDependency)이 설치된 경우에만
 * 동기 require 로 로드. 없으면 naturalEarth1 로 폴백(호출자가 경고 처리).
 */

import {
  geoEquirectangular,
  geoMercator,
  geoNaturalEarth1,
  geoOrthographic,
  geoPath,
  type GeoProjection,
} from 'd3-geo';
import type { ProjectionType } from './types.js';

/** 투영 인스턴스 포트 — d3 GeoProjection 의 부분집합. */
export type Projection = GeoProjection;

/**
 * 확장 투영(robinson/winkel3) 레지스트리.
 *
 * d3-geo-projection 은 @types 가 없고 브라우저 번들에 node:module(createRequire)을
 * 끌어들이지 않으려 *동기 require 를 쓰지 않는다*. 대신 호스트(특히 Node CLI)가
 * 부팅 시 d3-geo-projection 의 팩토리를 주입한다:
 *
 *   import { geoRobinson, geoWinkel3 } from 'd3-geo-projection';
 *   registerExtProjection('robinson', geoRobinson);
 *   registerExtProjection('winkel3', geoWinkel3);
 *
 * 미등록 상태(기본)면 naturalEarth1 로 폴백(호출자가 경고). 브라우저 번들은 추가
 * 의존 없이 가볍게 유지된다.
 */
const extProjectionRegistry = new Map<string, () => GeoProjection>();

export function registerExtProjection(name: ProjectionType, factory: () => GeoProjection): void {
  extProjectionRegistry.set(name, factory);
}

export interface ProjectionResult {
  projection: Projection;
  /** 요청 투영이 사용 불가해 폴백했으면 채워진다. */
  fallbackFrom?: ProjectionType;
}

/** 투영 타입 → d3 projection 생성. 미지원/미설치는 naturalEarth1 폴백. */
export function createProjection(type: ProjectionType): ProjectionResult {
  switch (type) {
    case 'naturalEarth1':
      return { projection: geoNaturalEarth1() };
    case 'equirectangular':
      return { projection: geoEquirectangular() };
    case 'mercator':
      return { projection: geoMercator() };
    case 'orthographic':
      return { projection: geoOrthographic() };
    case 'robinson':
    case 'winkel3': {
      const factory = extProjectionRegistry.get(type);
      if (factory) return { projection: factory() };
      return { projection: geoNaturalEarth1(), fallbackFrom: type };
    }
    default:
      return { projection: geoNaturalEarth1() };
  }
}

/** GeoJSON 객체 → 화면 path `d` 문자열 생성기. */
export function createPathString(
  projection: Projection,
  precision: number,
): (object: unknown) => string {
  const path = geoPath(projection);
  return (object: unknown) => {
    const d = path(object as never);
    if (!d) return '';
    return roundPath(d, precision);
  };
}

/** path `d` 문자열의 숫자를 precision 자리로 반올림 — 결정적 출력. */
export function roundPath(d: string, precision: number): string {
  return d.replace(/-?\d+\.?\d*(?:e-?\d+)?/g, (m) => {
    const n = Number(m);
    if (!Number.isFinite(n)) return m;
    return round(n, precision).toString();
  });
}

export function round(n: number, precision: number): number {
  const f = 10 ** precision;
  // -0 회피 + 결정적 반올림.
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? 0 : r;
}
