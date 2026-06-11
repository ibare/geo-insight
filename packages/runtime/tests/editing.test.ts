// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
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

  it('대륙 칩은 기본 접힘(⋯), ⋯ 클릭 시 펼쳐진다', () => {
    const el = document.createElement('div');
    const instance = mount(el, 'earth:\n  show: 아프리카', { editable: true });
    const toolbar = el.querySelector('.gi-edit-chips')!;
    expect(toolbar.classList.contains('expanded')).toBe(false);
    expect(el.querySelector('.gi-chip-more')).toBeTruthy();
    el.querySelector<HTMLButtonElement>('.gi-chip-more')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    expect(el.querySelector('.gi-edit-chips')!.classList.contains('expanded')).toBe(true);
    instance.destroy();
  });

  it('펼쳐진 상태에서 바깥(window) 클릭 시 다시 접힌다', () => {
    const el = document.createElement('div');
    const instance = mount(el, 'earth:\n  show: 아프리카', { editable: true });
    el.querySelector<HTMLButtonElement>('.gi-chip-more')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(el.querySelector('.gi-edit-chips')!.classList.contains('expanded')).toBe(true);
    // 툴바 바깥(여기선 window) pointerdown → 접힘
    window.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(el.querySelector('.gi-edit-chips')!.classList.contains('expanded')).toBe(false);
    instance.destroy();
  });

  it('펼친 상태에서 툴바 안 클릭은 접지 않는다', () => {
    const el = document.createElement('div');
    const instance = mount(el, 'earth:\n  show: 아프리카', { editable: true });
    const toolbar = el.querySelector('.gi-edit-chips')!;
    el.querySelector<HTMLButtonElement>('.gi-chip-more')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // 툴바 자체에서 발생한 pointerdown (target 이 toolbar 내부)
    toolbar.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(toolbar.classList.contains('expanded')).toBe(true);
    instance.destroy();
  });

  it('대륙 선택 후 재렌더되면 다시 접힌다 + show 에 추가', () => {
    const el = document.createElement('div');
    let lastSource = '';
    const instance = mount(el, 'earth:\n  show: 아프리카', {
      editable: true,
      onChange: (s) => {
        lastSource = s;
      },
    });
    el.querySelector<HTMLButtonElement>('.gi-chip-more')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const asia = [...el.querySelectorAll<HTMLButtonElement>('.gi-chip-list .gi-edit-chip')].find(
      (c) => c.textContent === '아시아',
    )!;
    asia.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(lastSource).toContain('아시아');
    // 재렌더된 새 toolbar 는 접힌 상태
    expect(el.querySelector('.gi-edit-chips')!.classList.contains('expanded')).toBe(false);
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

describe('editing — 링크 클릭 메뉴', () => {
  function stubLinkHit(dataLink: string | null): void {
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => (dataLink ? { getAttribute: (k: string) => (k === 'data-link' ? dataLink : null) } : null),
    });
  }

  it('링크 클릭 시 타입/라벨/제거 메뉴가 뜬다', () => {
    const el = document.createElement('div');
    const instance = mount(el, 'earth:\n  show: 수단, 인도\n  link: 수단 -> 인도', { editable: true });
    const svg = el.querySelector('svg')!;
    stubLinkHit('729>356'); // 수단>인도
    svg.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }));
    svg.dispatchEvent(new MouseEvent('pointerup', { clientX: 100, clientY: 100, bubbles: true }));
    const menu = el.querySelector('.gi-edit-menu');
    expect(menu).toBeTruthy();
    const items = [...el.querySelectorAll('.gi-edit-menu-item')].map((n) => n.textContent ?? '');
    expect(items.some((t) => t.includes('해류'))).toBe(true);
    expect(items.some((t) => t.includes('링크 제거'))).toBe(true);
    expect(el.querySelector('.gi-edit-menu-input')).toBeTruthy();
    stubLinkHit(null);
    instance.destroy();
  });

  it('타입 항목 클릭 → 키워드 변경', () => {
    const el = document.createElement('div');
    let lastSource = '';
    const instance = mount(el, 'earth:\n  show: 수단, 인도\n  link: 수단 -> 인도', {
      editable: true,
      onChange: (s) => {
        lastSource = s;
      },
    });
    const svg = el.querySelector('svg')!;
    stubLinkHit('729>356');
    svg.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }));
    svg.dispatchEvent(new MouseEvent('pointerup', { clientX: 100, clientY: 100, bubbles: true }));
    const current = [...el.querySelectorAll<HTMLButtonElement>('.gi-edit-menu-item')].find((n) =>
      (n.textContent ?? '').includes('해류'),
    )!;
    current.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(lastSource).toContain('current: 수단 -> 인도');
    stubLinkHit(null);
    instance.destroy();
  });

  it('라벨 input Enter → 라벨 설정', () => {
    const el = document.createElement('div');
    let lastSource = '';
    const instance = mount(el, 'earth:\n  show: 수단, 인도\n  link: 수단 -> 인도', {
      editable: true,
      onChange: (s) => {
        lastSource = s;
      },
    });
    const svg = el.querySelector('svg')!;
    stubLinkHit('729>356');
    svg.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }));
    svg.dispatchEvent(new MouseEvent('pointerup', { clientX: 100, clientY: 100, bubbles: true }));
    const input = el.querySelector<HTMLInputElement>('.gi-edit-menu-input')!;
    input.value = '무역풍';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(lastSource).toContain('"무역풍"');
    stubLinkHit(null);
    instance.destroy();
  });
});

describe('editing — 모드 토글(flat ↔ globe)', () => {
  it('flat 기본 → 토글 버튼이 지구본(🌐) 제안, 클릭 시 orthographic 기록', () => {
    const el = document.createElement('div');
    let lastSource = '';
    const instance = mount(el, 'earth:\n  show: 아프리카', {
      editable: true,
      onChange: (s) => {
        lastSource = s;
      },
    });
    const btn = el.querySelector<HTMLButtonElement>('.gi-edit-mode')!;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe('🌐'); // flat → 지구본으로 전환 제안
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(lastSource).toContain('projection: orthographic');
    instance.destroy();
  });

  it('globe(orthographic) → 토글 버튼이 펼친 지도(🗺) 제안, 클릭 시 equirectangular 기록', () => {
    const el = document.createElement('div');
    let lastSource = '';
    const instance = mount(el, 'earth:\n  projection: orthographic\n  show: 아프리카', {
      editable: true,
      onChange: (s) => {
        lastSource = s;
      },
    });
    const btn = el.querySelector<HTMLButtonElement>('.gi-edit-mode')!;
    expect(btn.textContent).toBe('🗺');
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(lastSource).toContain('projection: equirectangular');
    instance.destroy();
  });
});

describe('editing — 회전 패닝(재투영)', () => {
  it('좌우 드래그 → 경도 rotate 가 갱신되고 재투영된다(flat)', async () => {
    const el = document.createElement('div');
    const instance = mount(el, 'earth:\n  show: 아프리카');
    const svg = el.querySelector('svg')!;
    stubRect(svg, 960, 576);
    const before = instance.getResult()!.meta.projectionParams.rotate[0];
    svg.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }));
    svg.dispatchEvent(new MouseEvent('pointermove', { clientX: 260, clientY: 100, bubbles: true }));
    svg.dispatchEvent(new MouseEvent('pointerup', { clientX: 260, clientY: 100, bubbles: true }));
    await vi.waitFor(() =>
      expect(instance.getResult()!.meta.projectionParams.rotate[0]).not.toBe(before),
    );
    // flat 은 위도 회전 없음(상하 패닝 없음).
    expect(instance.getResult()!.meta.projectionParams.rotate[1]).toBe(0);
    instance.destroy();
  });

  it('globe 는 상하 드래그로 위도 rotate 도 갱신된다', async () => {
    const el = document.createElement('div');
    const instance = mount(el, 'earth:\n  projection: orthographic\n  show: 아프리카');
    const svg = el.querySelector('svg')!;
    stubRect(svg, 960, 576);
    const before = instance.getResult()!.meta.projectionParams.rotate[1];
    svg.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }));
    svg.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, clientY: 220, bubbles: true }));
    svg.dispatchEvent(new MouseEvent('pointerup', { clientX: 100, clientY: 220, bubbles: true }));
    await vi.waitFor(() =>
      expect(instance.getResult()!.meta.projectionParams.rotate[1]).not.toBe(before),
    );
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
