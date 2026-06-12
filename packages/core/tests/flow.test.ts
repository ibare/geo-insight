import { describe, expect, it } from 'vitest';
import { cardinalSpline, type FlowPt } from '../src/flow.js';

describe('cardinalSpline', () => {
  it('제어점 2개 이하는 보간 없이 원본 반환(직선)', () => {
    const one: FlowPt[] = [[0, 0]];
    const two: FlowPt[] = [
      [0, 0],
      [10, 10],
    ];
    expect(cardinalSpline(one)).toEqual(one);
    expect(cardinalSpline(two)).toEqual(two);
  });

  it('제어점 3개 이상은 매끄러운 곡선으로 리샘플', () => {
    const pts: FlowPt[] = [
      [0, 0],
      [10, 10],
      [20, 0],
    ];
    const out = cardinalSpline(pts, 16);
    // 구간 2개 × 16 + 끝점 = 33
    expect(out.length).toBe(2 * 16 + 1);
  });

  it('시작·끝 제어점을 정확히 지난다', () => {
    const pts: FlowPt[] = [
      [0, 0],
      [5, 8],
      [12, 3],
      [20, 9],
    ];
    const out = cardinalSpline(pts, 12);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([20, 9]);
  });

  it('모든 제어점을 통과한다(카디널 스플라인 보간성)', () => {
    const pts: FlowPt[] = [
      [0, 0],
      [10, 10],
      [20, 0],
      [30, 10],
    ];
    const out = cardinalSpline(pts, 16);
    for (const cp of pts) {
      const hit = out.some((p) => Math.abs(p[0] - cp[0]) < 1e-6 && Math.abs(p[1] - cp[1]) < 1e-6);
      expect(hit).toBe(true);
    }
  });

  it('samplesPerSeg 가 작으면 보간 없이 원본', () => {
    const pts: FlowPt[] = [
      [0, 0],
      [10, 10],
      [20, 0],
    ];
    expect(cardinalSpline(pts, 1)).toEqual(pts);
  });
});
