// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { mountGeoInsight } from '../src/mount.js';

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
