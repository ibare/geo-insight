// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { cameraFromMeta, compile } from '@geoinsight/core';
import { attachZoomPan, type ViewBox } from '../src/zoom-pan.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

describe('zoom-pan — 줌아웃 한계', () => {
  it('outerBounds 가 없으면 base 너비 이상 줌아웃 불가(기존 동작)', () => {
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    const base: ViewBox = [0, 0, 100, 60];
    const ctrl = attachZoomPan(svg, base, { interactive: false });
    ctrl.setView([0, 0, 9999, 9999]); // 과도한 줌아웃 시도
    expect(ctrl.getView()[2]).toBeCloseTo(100, 5);
  });

  it('outerBounds(전세계)가 있으면 그 범위까지 줌아웃 가능', () => {
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    const base: ViewBox = [0, 0, 100, 60];
    const outer: ViewBox = [-450, -270, 1000, 600];
    const ctrl = attachZoomPan(svg, base, { interactive: false, outerBounds: outer });
    ctrl.setView([0, 0, 9999, 9999]);
    // maxW = max(base.w=100, outer.w=1000, outer.h/aspect=600/0.6=1000) = 1000
    expect(ctrl.getView()[2]).toBeCloseTo(1000, 5);
  });

  it('coverVertical(flat): 줌아웃을 세로 cover 까지만 — 가로 전체(outer.w)는 제외', () => {
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    const base: ViewBox = [0, 0, 100, 60]; // aspect 0.6
    // 2:1 전세계 sphere(가로가 세로의 2배) — 가로 전체를 보면 위아래가 빈다.
    const outer: ViewBox = [-1000, -250, 2000, 500];
    const ctrl = attachZoomPan(svg, base, { interactive: false, outerBounds: outer, coverVertical: true });
    ctrl.setView([0, 0, 9999, 9999]);
    // maxW = max(base.w=100, outer.h/aspect=500/0.6≈833) = 833 (outer.w=2000 제외)
    const w = ctrl.getView()[2];
    expect(w).toBeCloseTo(500 / 0.6, 2);
    // 최대 줌아웃 시 뷰 높이 = sphere 높이(세로 cover, 가로는 wrap 으로 탐색).
    expect(ctrl.getView()[3]).toBeCloseTo(500, 2);
  });
});

describe('전세계 범위 — 단일 국가 fit 이어도 sphere 범위는 훨씬 크다', () => {
  it('한국만 표시해도 전세계 bounds 가 viewBox 보다 크다', () => {
    const { meta } = compile('earth:\n  show: 한국');
    const b = cameraFromMeta(meta).bounds({ type: 'Sphere' });
    expect(b).toBeTruthy();
    const worldW = b![1][0] - b![0][0];
    // 한국에 타이트하게 fit 된 viewBox 보다 전세계 폭이 훨씬 커야 줌아웃이 의미있다.
    expect(worldW).toBeGreaterThan(meta.viewBox[2] * 2);
  });
});
