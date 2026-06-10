/**
 * Link routing 패스.
 *
 * 끝점을 anchor 로 해석:
 *  - centroid: centroid↔centroid.
 *  - border: 출발/도착 폴리곤 경계에서 시작/도착하도록 화면상 점-내포 판정으로 자른다.
 * geodesic 이면 대권선(geoInterpolate)을 샘플링 후 투영, 아니면 화면 좌표 이차 베지어(curve).
 * 중심선을 따라 폭을 보간한 taper wedge(채워진 폴리곤) + 별도 arrowhead 삼각형 산출.
 */

import { interpolator } from '../geometry.js';
import { round } from '../projection.js';
import type { Entity } from '../types.js';
import type { Camera } from './camera.js';
import type { LinkSpec } from './build-scene.js';

export interface RoutedLink {
  /** 채워진 wedge path d. */
  wedge: string;
  /** arrowhead 삼각형 path d. */
  arrowhead: string;
  color: string;
}

type XY = [number, number];

const SAMPLES = 64;

export function routeLinks(
  camera: Camera,
  links: LinkSpec[],
  entities: Map<string, Entity>,
): RoutedLink[] {
  const out: RoutedLink[] = [];
  for (const link of links) {
    const from = entities.get(link.from);
    const to = entities.get(link.to);
    if (!from || !to) continue;
    const routed = routeOne(camera, link, from, to);
    if (routed) out.push(routed);
  }
  return out;
}

function routeOne(camera: Camera, link: LinkSpec, from: Entity, to: Entity): RoutedLink | null {
  const samples = link.geodesic
    ? geodesicSamples(camera, from.centroid, to.centroid)
    : bezierSamples(camera, from.centroid, to.centroid, link.curve);
  if (samples.length < 2) return null;

  let startIdx = 0;
  let tipIdx = samples.length - 1;

  if (link.anchor === 'border') {
    const fromExt = projectedExteriors(camera, from);
    const toExt = projectedExteriors(camera, to);
    // 출발: from 내부를 벗어나는 첫 지점.
    for (let i = 0; i < samples.length; i++) {
      if (!pointInAny(samples[i]!, fromExt)) {
        startIdx = i;
        break;
      }
    }
    // 도착: to 내부에 들어가는 첫 지점(끝쪽에서 가장 이른).
    for (let i = startIdx + 1; i < samples.length; i++) {
      if (pointInAny(samples[i]!, toExt)) {
        tipIdx = i;
        break;
      }
    }
  }

  let line = samples.slice(startIdx, tipIdx + 1);
  if (line.length < 2) line = samples.slice(); // 폴백: 전체
  if (line.length < 2) return null;

  const tip = line[line.length - 1]!;
  const tangent = unit(sub(tip, line[Math.max(0, line.length - 2)]!));
  const headLen = link.style.headLength;
  const headW = link.style.headWidth;

  // arrowhead 자리만큼 wedge 끝을 당긴다.
  const wedgeEnd = addScaled(tip, tangent, -headLen);
  const body = trimToLength(line, wedgeEnd);

  const wedge = wedgePath(body, link.style.widthStart, link.style.widthEnd);
  const arrowhead = arrowheadPath(tip, tangent, headLen, headW);
  return { wedge, arrowhead, color: link.style.color };
}

// ── 샘플링 ───────────────────────────────────────────────────────────────────

function geodesicSamples(camera: Camera, a: XY, b: XY): XY[] {
  const interp = interpolator(a, b);
  const out: XY[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const p = camera.project(interp(i / SAMPLES));
    if (p) out.push(p);
  }
  return out;
}

function bezierSamples(camera: Camera, a: XY, b: XY, curve: number): XY[] {
  const pa = camera.project(a);
  const pb = camera.project(b);
  if (!pa || !pb) return [];
  const mid: XY = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
  const dir = sub(pb, pa);
  const len = mag(dir);
  // 수직 방향으로 curve 만큼 제어점 오프셋.
  const perp: XY = len === 0 ? [0, 0] : [-dir[1] / len, dir[0] / len];
  const ctrl: XY = [mid[0] + perp[0] * curve * len, mid[1] + perp[1] * curve * len];
  const out: XY[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const u = 1 - t;
    out.push([
      u * u * pa[0] + 2 * u * t * ctrl[0] + t * t * pb[0],
      u * u * pa[1] + 2 * u * t * ctrl[1] + t * t * pb[1],
    ]);
  }
  return out;
}

// ── taper wedge / arrowhead ──────────────────────────────────────────────────

function wedgePath(line: XY[], wStart: number, wEnd: number): string {
  const n = line.length;
  if (n < 2) return '';
  const left: XY[] = [];
  const right: XY[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const w = (wStart + (wEnd - wStart) * t) / 2;
    const tan = unit(sub(line[Math.min(i + 1, n - 1)]!, line[Math.max(i - 1, 0)]!));
    const perp: XY = [-tan[1], tan[0]];
    left.push([line[i]![0] + perp[0] * w, line[i]![1] + perp[1] * w]);
    right.push([line[i]![0] - perp[0] * w, line[i]![1] - perp[1] * w]);
  }
  const pts = [...left, ...right.reverse()];
  return polygonPath(pts);
}

function arrowheadPath(tip: XY, tangent: XY, len: number, width: number): string {
  const base = addScaled(tip, tangent, -len);
  const perp: XY = [-tangent[1], tangent[0]];
  const p1: XY = [base[0] + perp[0] * (width / 2), base[1] + perp[1] * (width / 2)];
  const p2: XY = [base[0] - perp[0] * (width / 2), base[1] - perp[1] * (width / 2)];
  return polygonPath([tip, p1, p2]);
}

function polygonPath(pts: XY[]): string {
  if (pts.length === 0) return '';
  const parts = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p[0], 2)},${round(p[1], 2)}`);
  return parts.join('') + 'Z';
}

// ── 점-내포 판정 (화면 좌표 ray casting) ─────────────────────────────────────

function projectedExteriors(camera: Camera, entity: Entity): XY[][] {
  const rings: XY[][] = [];
  for (const f of entity.features) {
    if (f.geometry.type === 'Polygon') {
      pushRing(rings, camera, f.geometry.coordinates[0]);
    } else {
      for (const poly of f.geometry.coordinates) pushRing(rings, camera, poly[0]);
    }
  }
  return rings;
}

function pushRing(rings: XY[][], camera: Camera, ring: number[][] | undefined): void {
  if (!ring) return;
  const projected: XY[] = [];
  for (const c of ring) {
    const p = camera.project([c[0]!, c[1]!]);
    if (p) projected.push(p);
  }
  if (projected.length >= 3) rings.push(projected);
}

function pointInAny(pt: XY, rings: XY[][]): boolean {
  for (const ring of rings) if (pointInRing(pt, ring)) return true;
  return false;
}

function pointInRing(pt: XY, ring: XY[]): boolean {
  let inside = false;
  const [px, py] = pt;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0];
    const yi = ring[i]![1];
    const xj = ring[j]![0];
    const yj = ring[j]![1];
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// ── 벡터 유틸 ────────────────────────────────────────────────────────────────

function sub(a: XY, b: XY): XY {
  return [a[0] - b[0], a[1] - b[1]];
}
function mag(a: XY): number {
  return Math.hypot(a[0], a[1]);
}
function unit(a: XY): XY {
  const m = mag(a);
  return m === 0 ? [1, 0] : [a[0] / m, a[1] / m];
}
function addScaled(a: XY, dir: XY, s: number): XY {
  return [a[0] + dir[0] * s, a[1] + dir[1] * s];
}

/** line 을 끝점이 target 근처가 되도록 자른다(arrowhead 공간 확보). */
function trimToLength(line: XY[], end: XY): XY[] {
  // end 가 마지막 세그먼트 위에 있다고 가정 — 단순히 마지막 점을 end 로 치환.
  if (line.length < 2) return line;
  const out = line.slice(0, line.length - 1);
  out.push(end);
  return out;
}
