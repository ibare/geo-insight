// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { buildModel, renderModel } from '@geo-insight/core';
import { applyViewState, captureViewState, type ViewState } from '../src/view-state.js';
import type { ViewBox } from '../src/zoom-pan.js';

/** 소스 → (model, 기본 fit 결과 meta, 기본 viewBox). */
function setup(src: string) {
  const model = buildModel(src);
  const result = renderModel(model);
  const view = result.meta.viewBox as ViewBox;
  return { model, meta: result.meta, view };
}

describe('view-state — 캡처', () => {
  it('flat: 기본 fit 의 화면 중심이 대상(한국) 근처 경위도로 잡힌다', () => {
    const { meta, view } = setup('earth:\n  show: 한국');
    const vs = captureViewState(meta, view);
    expect(vs).toBeTruthy();
    // 한국 ≈ 127°E, 37°N — fit 중심이 그 부근.
    expect(vs!.centerLon).toBeGreaterThan(110);
    expect(vs!.centerLon).toBeLessThan(140);
    expect(vs!.centerLat).toBeGreaterThan(25);
    expect(vs!.centerLat).toBeLessThan(50);
    expect(vs!.zoom).toBeGreaterThan(0);
  });
});

describe('view-state — 왕복 동등(같은 투영)', () => {
  const cases = ['earth:\n  show: 한국', 'earth:\n  show: 브라질', 'earth:\n  projection: orthographic\n  show: 인도'];
  for (const src of cases) {
    it(`capture→apply→capture 가 동일 상태로 수렴: ${src.split('\n').pop()}`, () => {
      const { model, meta, view } = setup(src);
      const vs1 = captureViewState(meta, view)!;
      const { result, view: view2 } = applyViewState(model, vs1);
      const vs2 = captureViewState(result.meta, view2)!;
      expect(vs2.centerLon).toBeCloseTo(vs1.centerLon, 1);
      expect(vs2.centerLat).toBeCloseTo(vs1.centerLat, 1);
      // 줌(위도 범위)은 투영 비선형성으로 약간 오차 — 5% 이내.
      expect(vs2.zoom).toBeGreaterThan(vs1.zoom * 0.95);
      expect(vs2.zoom).toBeLessThan(vs1.zoom * 1.05);
    });
  }
});

describe('view-state — 투영 전환', () => {
  it('flat → globe: 화면 중심 경위도가 보존된다(globe 정면 = 중심)', () => {
    const { meta, view } = setup('earth:\n  show: 인도');
    const vs = captureViewState(meta, view)!;
    // 같은 소스를 globe 로 컴파일한 모델에 ViewState 적용.
    const globeModel = buildModel('earth:\n  projection: orthographic\n  show: 인도');
    const { result } = applyViewState(globeModel, vs);
    // globe 정면(rotate = [-lon, -lat]) 이 중심과 일치.
    const pp = result.meta.projectionParams;
    expect(-pp.rotate[0]).toBeCloseTo(vs.centerLon, 1);
    expect(-pp.rotate[1]).toBeCloseTo(vs.centerLat, 1);
  });

  it('globe → flat: 위도가 rotate[1] 이 아니라 viewBox 세로 위치로 들어가 비틀리지 않는다', () => {
    // globe 에서 위도 30°N 를 정면으로 본 상태.
    const vs: ViewState = { centerLon: 80, centerLat: 30, zoom: 60 };
    const flatModel = buildModel('earth:\n  show: 인도');
    const { result, view } = applyViewState(flatModel, vs);
    // flat 은 위도 회전을 쓰지 않는다 — rotate[1] 은 0(비틀림 없음).
    expect(result.meta.projectionParams.rotate[1]).toBe(0);
    // 그리고 화면 중심을 역투영하면 원래 중심 위도(30°)가 복원된다.
    const back = captureViewState(result.meta, view)!;
    expect(back.centerLon).toBeCloseTo(80, 0);
    expect(back.centerLat).toBeCloseTo(30, 0);
  });
});
