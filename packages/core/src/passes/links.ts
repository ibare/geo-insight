/**
 * Link routing 패스.
 *
 * 끝점을 anchor 로 해석(centroid/border), geodesic 이면 대권선 샘플링, 아니면 화면
 * 이차 베지어(curve). 중심선은 공통이고, **타입별 렌더러**가 외형을 만든다:
 *   - arrow:   taper wedge(채움) + arrowhead, 또는 head 설정에 따라 가는 선
 *   - wind:    점선 stroke + 작은 arrowhead (흐름 느낌)
 *   - current: 물결(사인 오프셋) stroke + arrowhead (해류)
 *   - route:   가는 점선 (경로)
 * 라벨이 있으면 labelAt 지점의 화면 좌표를 함께 반환한다.
 *
 * 타입 렌더러는 registerLinkRenderer 로 확장 가능(미등록 타입은 arrow 폴백).
 */

import { interpolator } from '../geometry.js';
import { round } from '../projection.js';
import type { ArrowStyle, Entity, LinkType } from '../types.js';
import type { Camera } from './camera.js';
import type { LinkSpec } from './build-scene.js';

export interface RoutedPath {
  d: string;
  fill: string;
  stroke: string;
  width?: number;
  dash?: string;
}

export interface RoutedLink {
  paths: RoutedPath[];
  label?: { text: string; x: number; y: number };
}

type XY = [number, number];

/** 중심선 + 끝/접선 정보 — 타입 렌더러 입력. */
export interface LinkGeometry {
  /** 시작~wedgeEnd 까지의 본체 폴리라인(화면 좌표). */
  body: XY[];
  /** arrowhead 꼭짓점(도착 경계). */
  tip: XY;
  /** tip 에서의 단위 접선. */
  tangent: XY;
  style: ArrowStyle;
}

export type LinkRenderer = (geo: LinkGeometry) => RoutedPath[];

const SAMPLES = 64;
const rendererRegistry = new Map<string, LinkRenderer>();

/** 사용자 정의 링크 렌더러 등록(호스트/플러그인 확장). */
export function registerLinkRenderer(type: string, renderer: LinkRenderer): void {
  rendererRegistry.set(type, renderer);
}

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
    for (let i = 0; i < samples.length; i++) {
      if (!pointInAny(samples[i]!, fromExt)) {
        startIdx = i;
        break;
      }
    }
    for (let i = startIdx + 1; i < samples.length; i++) {
      if (pointInAny(samples[i]!, toExt)) {
        tipIdx = i;
        break;
      }
    }
  }

  let line = samples.slice(startIdx, tipIdx + 1);
  if (line.length < 2) line = samples.slice();
  if (line.length < 2) return null;

  const tip = line[line.length - 1]!;
  const tangent = unit(sub(tip, line[Math.max(0, line.length - 2)]!));
  const headLen = link.style.head === 'none' ? 0 : link.style.headLength;
  const wedgeEnd = addScaled(tip, tangent, -headLen);
  const body = headLen > 0 ? trimToLength(line, wedgeEnd) : line;

  const renderer = rendererRegistry.get(link.type) ?? builtinRenderer(link.type);
  const paths = renderer({ body, tip, tangent, style: link.style });

  const routed: RoutedLink = { paths };
  if (link.label) {
    const p = labelPoint(body, tip, link.labelAt);
    routed.label = { text: link.label, x: round(p[0], 2), y: round(p[1] - 8, 2) };
  }
  return routed;
}

// ── 타입별 빌트인 렌더러 ─────────────────────────────────────────────────────

function builtinRenderer(type: LinkType): LinkRenderer {
  switch (type) {
    case 'wind':
      return ({ body, tip, tangent, style }) => [
        { d: strokePath(body), fill: 'none', stroke: style.color, width: 2, dash: dashStr(style.dash) },
        ...headPaths(tip, tangent, style),
      ];
    case 'current':
      return ({ body, tip, tangent, style }) => [
        { d: wavyPath(body, 4, Math.max(2, Math.round(body.length / 8))), fill: 'none', stroke: style.color, width: 2.5 },
        ...headPaths(tip, tangent, style),
      ];
    case 'route':
      return ({ body, style }) => [
        { d: strokePath(body), fill: 'none', stroke: style.color, width: 1.5, dash: dashStr(style.dash) },
      ];
    case 'arrow':
    default:
      return ({ body, tip, tangent, style }) => {
        if (style.head === 'taper') {
          return [
            { d: wedgePath(body, style.widthStart, style.widthEnd), fill: style.color, stroke: 'none' },
            ...headPaths(tip, tangent, style),
          ];
        }
        return [
          { d: strokePath(body), fill: 'none', stroke: style.color, width: 2 },
          ...headPaths(tip, tangent, style),
        ];
      };
  }
}

function headPaths(tip: XY, tangent: XY, style: ArrowStyle): RoutedPath[] {
  if (style.head === 'none') return [];
  return [{ d: arrowheadPath(tip, tangent, style.headLength, style.headWidth), fill: style.color, stroke: 'none' }];
}

function dashStr(dash?: number[]): string | undefined {
  return dash && dash.length ? dash.join(' ') : undefined;
}

function labelPoint(body: XY[], tip: XY, at: 'start' | 'mid' | 'end'): XY {
  if (at === 'start') return body[0]!;
  if (at === 'end') return tip;
  return body[Math.floor(body.length / 2)]!;
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

// ── 외형 path ───────────────────────────────────────────────────────────────

function strokePath(pts: XY[]): string {
  if (pts.length === 0) return '';
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p[0], 2)},${round(p[1], 2)}`).join('');
}

/** 사인 오프셋 물결 stroke (해류). */
function wavyPath(line: XY[], amp: number, waves: number): string {
  const n = line.length;
  if (n < 2) return strokePath(line);
  const out: XY[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const tan = unit(sub(line[Math.min(i + 1, n - 1)]!, line[Math.max(i - 1, 0)]!));
    const perp: XY = [-tan[1], tan[0]];
    const off = amp * Math.sin(t * waves * 2 * Math.PI) * Math.sin(t * Math.PI); // 양끝 진폭 0
    out.push([line[i]![0] + perp[0] * off, line[i]![1] + perp[1] * off]);
  }
  return strokePath(out);
}

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
  return polygonPath([...left, ...right.reverse()]);
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
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p[0], 2)},${round(p[1], 2)}`).join('') + 'Z';
}

// ── 점-내포 판정 ─────────────────────────────────────────────────────────────

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
function trimToLength(line: XY[], end: XY): XY[] {
  if (line.length < 2) return line;
  const out = line.slice(0, line.length - 1);
  out.push(end);
  return out;
}
