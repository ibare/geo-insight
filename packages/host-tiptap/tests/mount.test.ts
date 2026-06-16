// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { GeoFeature } from '@geo-insight/core';
import { mountGeoInsight } from '../src/mount.js';

/** California(US-CA) 더미 — id 는 실제 gazetteer adm1_code 와 일치해야 resolver 가 잡는다. */
const CALIFORNIA: GeoFeature = {
  type: 'Feature',
  id: 'USA-3521',
  properties: {
    name: 'California', kor: '캘리포니아', cca2: '', cca3: 'USA', region: '', subregion: '',
    level: 1, adm0: '840', iso: 'US-CA', type: 'State',
  },
  geometry: { type: 'Polygon', coordinates: [[[-124, 42], [-114, 42], [-114, 32], [-124, 32], [-124, 42]]] },
};

describe('mountGeoInsight (DOM)', () => {
  const dsl = `earth:\n  show: 아프리카, 수단, 인도\n  link: 수단 -> 인도`;

  it('컨테이너에 SVG 를 마운트한다', () => {
    const el = document.createElement('div');
    const handle = mountGeoInsight(el, { initialSource: dsl, initialHeight: 400 });
    expect(el.getAttribute('data-geoinsight-root')).toBe('true');
    expect(el.style.height).toBe('400px');
    const svg = el.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg!.getAttribute('viewBox')).toMatch(/^0 0 \d+ \d+$/);
    handle.destroy();
    expect(el.querySelector('svg')).toBeNull();
  });

  it('setSource 로 다시 렌더, setHeight 로 높이 변경', () => {
    const el = document.createElement('div');
    const handle = mountGeoInsight(el, { initialSource: dsl });
    handle.setSource(`earth:\n  show: 유럽`);
    expect(el.querySelector('svg')).toBeTruthy();
    handle.setHeight(600);
    expect(el.style.height).toBe('600px');
    handle.destroy();
  });

  it('loadAdm1 을 runtime 으로 전달 → ADM1 이 렌더된다', async () => {
    const el = document.createElement('div');
    const loadAdm1 = vi.fn(async (ccn3: string) => (ccn3 === '840' ? [CALIFORNIA] : null));
    const handle = mountGeoInsight(el, { initialSource: 'earth:\n  show: California', loadAdm1 });
    await vi.waitFor(() => expect(loadAdm1).toHaveBeenCalledWith('840'));
    await vi.waitFor(() => expect(el.querySelector('[data-key="USA-3521"]')).toBeTruthy());
    handle.destroy();
  });

  it('진단 콜백이 호출된다', () => {
    const el = document.createElement('div');
    let count = -1;
    const handle = mountGeoInsight(el, {
      initialSource: `earth:\n  show: 수`,
      onDiagnostics: (d) => {
        count = d.length;
      },
    });
    expect(count).toBeGreaterThan(0);
    handle.destroy();
  });
});
