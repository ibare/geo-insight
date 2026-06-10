// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { cameraFromMeta } from '@geoinsight/core';
import { mount } from '../src/mount.js';

/** happy-dom 은 레이아웃이 없어 getBoundingClientRect 가 0 을 반환 → viewBox 와 동일한
 *  rect 로 스텁해 clientToBase 가 base 좌표를 그대로 돌려주게 한다. */
function stubRect(svg: SVGSVGElement, w: number, h: number): void {
  Object.defineProperty(svg, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, top: 0, width: w, height: h, right: w, bottom: h, x: 0, y: 0 }),
  });
}

describe('editing — 지도 클릭으로 국가 토글', () => {
  it('아프리카 그룹만 표시 중 수단 좌표 클릭 → show 에 수단 추가', () => {
    const el = document.createElement('div');
    let lastSource: string | null = null;
    const instance = mount(el, 'earth:\n  show: 아프리카', {
      editable: true,
      onChange: (s) => {
        lastSource = s;
      },
    });

    const svg = el.querySelector('svg')!;
    const meta = instance.getResult()!.meta;
    stubRect(svg, meta.width, meta.height);

    // 수단 중심부 [30,15] 를 화면 픽셀로 투영 → 그 픽셀을 클릭
    const cam = cameraFromMeta(meta);
    const px = cam.project([30, 15])!;
    expect(px).toBeTruthy();

    svg.dispatchEvent(new MouseEvent('pointerdown', { clientX: px[0], clientY: px[1], bubbles: true }));
    svg.dispatchEvent(new MouseEvent('pointerup', { clientX: px[0], clientY: px[1], bubbles: true }));

    expect(lastSource).toBeTruthy();
    expect(lastSource!).toContain('수단');
    expect(lastSource!).toContain('아프리카');

    instance.destroy();
  });

  it('드래그(임계값 초과)는 토글하지 않는다', () => {
    const el = document.createElement('div');
    let changed = false;
    const instance = mount(el, 'earth:\n  show: 아프리카', {
      editable: true,
      onChange: () => {
        changed = true;
      },
    });
    const svg = el.querySelector('svg')!;
    const meta = instance.getResult()!.meta;
    stubRect(svg, meta.width, meta.height);
    const cam = cameraFromMeta(meta);
    const px = cam.project([30, 15])!;

    svg.dispatchEvent(new MouseEvent('pointerdown', { clientX: px[0], clientY: px[1], bubbles: true }));
    // 50px 이동 후 up → 팬으로 간주
    svg.dispatchEvent(new MouseEvent('pointerup', { clientX: px[0] + 50, clientY: px[1], bubbles: true }));

    expect(changed).toBe(false);
    instance.destroy();
  });

  it('대륙 퀵칩이 렌더된다', () => {
    const el = document.createElement('div');
    const instance = mount(el, 'earth:\n  show: 아프리카', { editable: true });
    const chips = el.querySelectorAll('.gi-edit-chip');
    expect(chips.length).toBeGreaterThanOrEqual(6);
    instance.destroy();
  });

  it('editable=false 면 편집 오버레이가 없다', () => {
    const el = document.createElement('div');
    const instance = mount(el, 'earth:\n  show: 아프리카', { editable: false });
    expect(el.querySelectorAll('.gi-edit-chip').length).toBe(0);
    instance.destroy();
  });
});
