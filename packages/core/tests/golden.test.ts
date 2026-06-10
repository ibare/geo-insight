import { describe, expect, it } from 'vitest';
import { compile } from '../src/compile.js';

/** 전체 SVG 의 결정적 체크섬(djb2) — 형태 변화 회귀 탐지. */
function checksum(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

/** 구조적 다이제스트 — 사람이 diff 가능한 골든. 전체 SVG 는 체크섬으로 동결. */
function digest(svg: string, scene: ReturnType<typeof compile>['scene']) {
  return {
    viewBox: scene.meta.viewBox,
    projection: scene.projection,
    entities: scene.entities.map((e) => ({
      key: e.key,
      display: e.display,
      role: e.role,
      z: e.z,
      fill: e.style.fill,
      borders: e.style.borders,
    })),
    links: scene.links.map((l) => ({ from: l.from, to: l.to, anchor: l.anchor, geodesic: l.geodesic })),
    labels: scene.labels.map((l) => l.text),
    svgChecksum: checksum(svg),
  };
}

describe('golden — africa-sudan-india (최소형)', () => {
  it('구조 다이제스트 스냅샷', () => {
    const { svg, scene } = compile(`earth:
  show: 아프리카, 수단, 인도
  link: 수단 -> 인도`);
    expect(digest(svg, scene)).toMatchSnapshot();
  });
});

describe('golden — trade-winds (좌우 배치)', () => {
  it('구조 다이제스트 스냅샷', () => {
    const { svg, scene } = compile(`earth "무역풍":
  center: 태평양
  show: 아프리카, 동남아시아, 아메리카`);
    expect(digest(svg, scene)).toMatchSnapshot();
  });
});

describe('golden — 명시형 + geodesic', () => {
  it('구조 다이제스트 스냅샷', () => {
    const { svg, scene } = compile(`earth "대권 항로":
  center: 60
  fit: dominant

  group 아시아 { fill: amber, borders: keep }
  focus 한국   { fill: coral }
  focus 인도   { fill: coral }

  link 한국 -> 인도 {
    arrow: taper
    geodesic: true
    color: teal
    anchor: border
  }

  label all { place: centroid, collide: true }`);
    const err = compile(`earth "대권 항로":
  center: 60
  group 아시아 { fill: amber }
  focus 한국 { fill: coral }
  focus 인도 { fill: coral }
  link 한국 -> 인도 { geodesic: true }`);
    expect(err.diagnostics.filter((d) => d.level === 'error')).toHaveLength(0);
    expect(digest(svg, scene)).toMatchSnapshot();
  });
});
