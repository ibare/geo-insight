import { describe, expect, it } from 'vitest';
import { createDefaultDataSource, createResolver } from '@geoinsight/data';
import { loadAdm1FromDisk } from '@geoinsight/data/node';
import { compile } from '../src/compile.js';

function usDataSource() {
  const ds = createDefaultDataSource();
  loadAdm1FromDisk(ds, '840'); // 미국 ADM1 주입
  return ds;
}

describe('ADM1 렌더 통합', () => {
  it('show 의 ADM1 이 엔티티로 해석·렌더되고 bbox 가 정상(전세계 아님)', () => {
    const ds = usDataSource();
    const r = createResolver({ dataSource: ds });
    const { scene, svg, diagnostics } = compile('earth:\n  show: California, Texas, Florida', {
      dataSource: ds,
      resolver: r,
    });
    expect(diagnostics.filter((d) => d.level === 'error')).toHaveLength(0);
    const names = scene.entities.map((e) => e.display).sort();
    expect(names).toEqual(['California', 'Florida', 'Texas']);

    // 회귀 가드: winding 이 어긋나면 bbox 가 [-180,-90,180,90] 로 폭주한다.
    for (const e of scene.entities) {
      const [w, s, ee, n] = e.bbox;
      expect(ee - w, `${e.display} 경도폭`).toBeLessThan(60);
      expect(n - s, `${e.display} 위도폭`).toBeLessThan(40);
    }
    // 엔티티 path 가 SVG 에 들어간다
    expect(svg).toContain('gi-entity');
  });

  it('ADM1 미로드 국가의 주 이름은 미해석(에러 진단)', () => {
    const ds = createDefaultDataSource(); // 아무것도 로드 안 함
    const r = createResolver({ dataSource: ds });
    const { diagnostics } = compile('earth:\n  show: California', { dataSource: ds, resolver: r });
    expect(diagnostics.some((d) => d.level === 'error')).toBe(true);
  });
});
