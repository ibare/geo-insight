// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { GeoFeature } from '@geoinsight/core';
import { mount } from '../src/mount.js';

/** California(US-CA) 더미 — id 는 실제 gazetteer adm1_code 와 일치해야 resolver 가 잡는다. */
const CALIFORNIA: GeoFeature = {
  type: 'Feature',
  id: 'USA-3521',
  properties: {
    name: 'California',
    kor: '캘리포니아',
    cca2: '',
    cca3: 'USA',
    region: '',
    subregion: '',
    level: 1,
    adm0: '840',
    iso: 'US-CA',
    type: 'State',
  },
  // 외곽 CW(신호면적<0) — d3 규약.
  geometry: { type: 'Polygon', coordinates: [[[-124, 42], [-114, 42], [-114, 32], [-124, 32], [-124, 42]]] },
};

describe('mount — ADM1 지연 로딩', () => {
  it('show 의 ADM1 국가를 감지해 loadAdm1 호출 후 엔티티 렌더', async () => {
    const el = document.createElement('div');
    const loadAdm1 = vi.fn(async (ccn3: string) => (ccn3 === '840' ? [CALIFORNIA] : null));

    const inst = mount(el, 'earth:\n  show: California', { interactive: false, loadAdm1 });

    // 840(미국)의 ADM1 을 요청한다.
    await vi.waitFor(() => expect(loadAdm1).toHaveBeenCalledWith('840'));
    // 로드 후 California 엔티티가 SVG 에 들어간다.
    await vi.waitFor(() => {
      expect(el.querySelector('[data-key="USA-3521"]')).toBeTruthy();
    });

    inst.destroy();
  });

  it('showOnly — ADM1 클릭으로 show 토글 + 대륙칩/기즈모 숨김', async () => {
    const el = document.createElement('div');
    let last: string | null = null;
    const inst = mount(el, 'earth:\n  showOnly: 미국', {
      editable: true,
      interactive: false,
      loadAdm1: async (c) => (c === '840' ? [CALIFORNIA] : null),
      onChange: (s) => {
        last = s;
      },
    });

    // 미국 ADM1 로드 → California 가 캔버스 엔티티로 렌더.
    await vi.waitFor(() => expect(el.querySelector('[data-key="USA-3521"]')).toBeTruthy());
    // showOnly 에선 대륙 칩·기즈모 숨김.
    expect(el.querySelector<HTMLElement>('.gi-edit-chips')!.style.display).toBe('none');
    expect(el.querySelector<HTMLElement>('.gi-edit-gizmo')!.style.display).toBe('none');

    // California path 를 클릭 → show 에 추가(선택).
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => ({ getAttribute: (k: string) => (k === 'data-key' ? 'USA-3521' : null) }),
    });
    const svg = el.querySelector('svg')!;
    svg.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }));
    svg.dispatchEvent(new MouseEvent('pointerup', { clientX: 100, clientY: 100, bubbles: true }));
    expect(last).toBeTruthy();
    expect(last!).toContain('캘리포니아'); // 엔티티 display(kor) 가 show 에 추가됨

    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
    inst.destroy();
  });

  it('loadAdm1 미제공 시 ADM1 은 미해석(엔티티 없음)', async () => {
    const el = document.createElement('div');
    const diags: unknown[] = [];
    mount(el, 'earth:\n  show: California', {
      interactive: false,
      onDiagnostics: (d) => diags.push(...d),
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(el.querySelector('[data-key="USA-3521"]')).toBeNull();
  });
});
