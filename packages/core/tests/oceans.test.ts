import { describe, expect, it } from 'vitest';
import { compile } from '../src/compile.js';

/** SVG 에서 대양 라벨 텍스트만 추출. */
function oceanLabels(svg: string): string[] {
  return [...svg.matchAll(/class="gi-ocean-label">([^<]+)</g)].map((m) => m[1] ?? '');
}

describe('5대양 라벨 — 항상 표시', () => {
  it('world fit 에서 5대양 모두 표시', () => {
    const { svg } = compile('earth:\n  fit: world\n  show: 아프리카');
    const oceans = oceanLabels(svg);
    for (const name of ['북극해', '태평양', '대서양', '인도양', '남극해']) {
      expect(oceans).toContain(name);
    }
  });

  it('지역 맵에서는 화면에 걸친 대양만 표시(가장자리 끌어오기)', () => {
    const { svg } = compile('earth:\n  show: 아프리카, 인도');
    const oceans = oceanLabels(svg);
    expect(oceans).toContain('인도양');
    // 프레임에서 멀리 떨어진 대양은 제외
    expect(oceans).not.toContain('태평양');
    expect(oceans).not.toContain('북극해');
  });

  it('orthographic 은 앞면 대양만(뒷면 제외)', () => {
    const { svg } = compile('earth:\n  projection: orthographic\n  center: 0\n  fit: world\n  show: 아프리카');
    const oceans = oceanLabels(svg);
    expect(oceans).toContain('대서양'); // 아프리카 정면 → 앞면
    expect(oceans).not.toContain('태평양'); // 지구 반대편 → 뒷면
  });

  it('대양 라벨은 항상 프레임 안쪽에 배치', () => {
    const { svg, scene } = compile('earth:\n  fit: world\n  show: 아프리카');
    const [, , w, h] = scene.meta.viewBox;
    const coords = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" class="gi-ocean-label"/g)];
    expect(coords.length).toBeGreaterThan(0);
    for (const m of coords) {
      const x = Number(m[1]);
      const y = Number(m[2]);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(w);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(h);
    }
  });
});
