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
    expect(el.querySelector('.gi-edit-gizmo')).toBeNull();
    instance.destroy();
  });
});

describe('editing — 회전 기즈모(center)', () => {
  it('기즈모가 렌더되고 현재 center 를 라벨로 보인다', () => {
    const el = document.createElement('div');
    const instance = mount(el, 'earth "t":\n  center: 태평양\n  show: 아프리카', { editable: true });
    const label = el.querySelector('.gi-gizmo-label');
    expect(label?.textContent).toContain('180'); // 태평양 = 180
    instance.destroy();
  });

  it('기즈모를 우측으로 돌리면 center 가 동경(~90E)으로 갱신된다', () => {
    const el = document.createElement('div');
    let lastSource = '';
    const instance = mount(el, 'earth:\n  show: 아프리카', {
      editable: true,
      onChange: (s) => {
        lastSource = s;
      },
    });
    const giz = el.querySelector<SVGSVGElement>('.gi-edit-gizmo svg')!;
    Object.defineProperty(giz, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 76, height: 76, right: 76, bottom: 76, x: 0, y: 0 }),
    });
    // 중심(38,38) 기준 우측 → 90E
    el.querySelector('.gi-edit-gizmo')!.dispatchEvent(
      new MouseEvent('pointerdown', { clientX: 38, clientY: 38, bubbles: true }),
    );
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 74, clientY: 38 }));
    window.dispatchEvent(new MouseEvent('pointerup', {}));
    expect(lastSource).toMatch(/center: 9\d/); // 약 90E
    instance.destroy();
  });
});

describe('editing — 선택된 국가 메뉴(링크)', () => {
  /** 선택된 국가(수단) 클릭 → 메뉴 오픈 헬퍼. */
  function clickSudan(el: HTMLElement, instance: ReturnType<typeof mount>): void {
    const svg = el.querySelector('svg')!;
    const meta = instance.getResult()!.meta;
    stubRect(svg, meta.width, meta.height);
    const cam = cameraFromMeta(meta);
    const px = cam.project([30, 15])!;
    svg.dispatchEvent(new MouseEvent('pointerdown', { clientX: px[0], clientY: px[1], bubbles: true }));
    svg.dispatchEvent(new MouseEvent('pointerup', { clientX: px[0], clientY: px[1], bubbles: true }));
  }

  it('선택된 국가 클릭 시 다른 선택 국가 목록 메뉴가 뜬다', () => {
    const el = document.createElement('div');
    const instance = mount(el, 'earth:\n  show: 수단, 인도', { editable: true });
    clickSudan(el, instance);
    const menu = el.querySelector('.gi-edit-menu');
    expect(menu).toBeTruthy();
    const items = [...el.querySelectorAll('.gi-edit-menu-item')].map((n) => n.textContent ?? '');
    expect(items.some((t) => t.includes('인도'))).toBe(true);
    expect(items.some((t) => t.includes('제거'))).toBe(true);
    instance.destroy();
  });

  it('메뉴에서 국가 선택 → link 추가', () => {
    const el = document.createElement('div');
    let lastSource = '';
    const instance = mount(el, 'earth:\n  show: 수단, 인도', {
      editable: true,
      onChange: (s) => {
        lastSource = s;
      },
    });
    clickSudan(el, instance);
    const indiaItem = [...el.querySelectorAll<HTMLButtonElement>('.gi-edit-menu-item')].find(
      (n) => (n.textContent ?? '').includes('인도'),
    )!;
    indiaItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(lastSource).toContain('link: 수단 -> 인도');
    instance.destroy();
  });

  it('이미 연결된 국가 선택 → link 해제', () => {
    const el = document.createElement('div');
    let lastSource = '';
    const instance = mount(el, 'earth:\n  show: 수단, 인도\n  link: 수단 -> 인도', {
      editable: true,
      onChange: (s) => {
        lastSource = s;
      },
    });
    clickSudan(el, instance);
    const indiaItem = [...el.querySelectorAll<HTMLButtonElement>('.gi-edit-menu-item')].find(
      (n) => (n.textContent ?? '').includes('인도'),
    )!;
    // 연결됨 표시(✓)
    expect(indiaItem.classList.contains('connected')).toBe(true);
    indiaItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(lastSource).not.toContain('link:');
    instance.destroy();
  });

  it('메뉴 밖(백드롭) 클릭 시 메뉴가 닫힌다', () => {
    const el = document.createElement('div');
    const instance = mount(el, 'earth:\n  show: 수단, 인도', { editable: true });
    clickSudan(el, instance);
    expect(el.querySelector('.gi-edit-menu')).toBeTruthy();
    const backdrop = el.querySelector<HTMLElement>('.gi-edit-backdrop')!;
    backdrop.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(el.querySelector('.gi-edit-menu')).toBeNull();
    expect(el.querySelector('.gi-edit-backdrop')).toBeNull();
    instance.destroy();
  });

  it('메뉴 제거 항목 → show 에서 제거', () => {
    const el = document.createElement('div');
    let lastSource = '';
    const instance = mount(el, 'earth:\n  show: 수단, 인도', {
      editable: true,
      onChange: (s) => {
        lastSource = s;
      },
    });
    clickSudan(el, instance);
    const removeItem = el.querySelector<HTMLButtonElement>('.gi-edit-menu-item.danger')!;
    removeItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(lastSource).not.toContain('수단');
    expect(lastSource).toContain('인도');
    instance.destroy();
  });
});
