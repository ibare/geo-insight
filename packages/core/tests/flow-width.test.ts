import { describe, expect, it } from 'vitest';
import { DEFAULT_FLOW_WIDTH_PARAMS, resolveFlowWidth, type FlowWidthParams } from '../src/flow-width.js';

const P = DEFAULT_FLOW_WIDTH_PARAMS;

describe('resolveFlowWidth — 가시성(63빌딩 규칙)', () => {
  it('실제 화면 두께가 hideBelowPx 미만이면 숨김', () => {
    // 20km 폭 × 0.02 px/km = 0.4px < 1px → 사라짐
    expect(resolveFlowWidth(20, 0.02, P).visible).toBe(false);
  });

  it('가시 임계 이상이면 표시', () => {
    // 100km × 0.02 = 2px ≥ 1px → 보임
    expect(resolveFlowWidth(100, 0.02, P).visible).toBe(true);
  });

  it('같은 줌에서 굵은 해류는 보이고 가는 해류는 사라진다', () => {
    const pxPerKm = 0.015; // 아시아 전반 줌 가정
    expect(resolveFlowWidth(100, pxPerKm, P).visible).toBe(true); // 쿠로시오
    expect(resolveFlowWidth(20, pxPerKm, P).visible).toBe(false); // 북한한류
  });

  it('가는 해류도 충분히 줌인하면 등장', () => {
    expect(resolveFlowWidth(20, 0.015, P).visible).toBe(false); // 멀리
    expect(resolveFlowWidth(20, 0.1, P).visible).toBe(true); // 가까이(2px)
  });
});

describe('resolveFlowWidth — 줌 감도(gamma)', () => {
  it('gamma=1: 렌더 두께가 실제 물리 두께에 비례', () => {
    const r = resolveFlowWidth(100, 0.05, { ...P, gamma: 1, maxPx: 100 });
    expect(r.strokeWidthPx).toBeCloseTo(100 * 0.05, 5); // 5px
  });

  it('gamma=0: 줌(pxPerKm)이 변해도 렌더 두께 고정(화면 고정)', () => {
    const params: FlowWidthParams = { ...P, gamma: 0, maxPx: 100, refPxPerKm: 0.05 };
    const a = resolveFlowWidth(100, 0.05, params).strokeWidthPx;
    const b = resolveFlowWidth(100, 0.2, params).strokeWidthPx; // 4배 줌인
    expect(a).toBeCloseTo(b, 5); // 두께 동일
    expect(a).toBeCloseTo(100 * 0.05, 5); // refPxPerKm 기준
  });

  it('gamma=0.5: 두 극단 사이(중간)', () => {
    const wide = { ...P, maxPx: 1000 };
    const g1 = resolveFlowWidth(100, 0.2, { ...wide, gamma: 1 }).strokeWidthPx;
    const g0 = resolveFlowWidth(100, 0.2, { ...wide, gamma: 0, refPxPerKm: 0.05 }).strokeWidthPx;
    const gh = resolveFlowWidth(100, 0.2, { ...wide, gamma: 0.5, refPxPerKm: 0.05 }).strokeWidthPx;
    expect(gh).toBeGreaterThan(Math.min(g0, g1));
    expect(gh).toBeLessThan(Math.max(g0, g1));
  });
});

describe('resolveFlowWidth — 클램프 / 페이드', () => {
  it('렌더 두께는 [minPx, maxPx] 로 클램프', () => {
    expect(resolveFlowWidth(100, 1, { ...P, maxPx: 16 }).strokeWidthPx).toBe(16); // 100px → 16
    // 가시성은 통과하되 렌더 두께 하한 보장(2px 물리 → min 1px 이상)
    expect(resolveFlowWidth(100, 0.02, { ...P, minPx: 3 }).strokeWidthPx).toBe(3);
  });

  it('가시 임계~fadeTo 구간에서 opacity 가 0→1', () => {
    // physicalPx = 1.5px (1~2 사이) → 0 < opacity < 1
    const mid = resolveFlowWidth(100, 0.015, P); // 1.5px
    expect(mid.opacity).toBeGreaterThan(0);
    expect(mid.opacity).toBeLessThan(1);
    // 충분히 두꺼우면 opacity 1
    expect(resolveFlowWidth(100, 0.05, P).opacity).toBe(1);
  });
});
