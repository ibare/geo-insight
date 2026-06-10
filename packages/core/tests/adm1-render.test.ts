import { describe, expect, it } from 'vitest';
import { createDefaultDataSource, createResolver } from '@geoinsight/data';
import { loadAdm1FromDisk } from '@geoinsight/data/node';
import { compile } from '../src/compile.js';
import { DEFAULT_THEME } from '../src/theme.js';

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

  it('ADM1 시각 구분 — 강조 fill + level + 인접구역 배경 레이어', () => {
    const ds = usDataSource();
    const r = createResolver({ dataSource: ds });
    const { scene, svg } = compile('earth:\n  show: California, Texas', { dataSource: ds, resolver: r });
    for (const e of scene.entities) {
      expect(e.level).toBe(1);
      expect(e.adm0).toBe('840');
      // 명시 스타일 없는 ADM1 plain 은 국가 슬레이트가 아니라 subdivision 강조색.
      expect(e.style.fill).toBe(DEFAULT_THEME.subdivision.fill);
      expect(e.style.fill).not.toBe(DEFAULT_THEME.tokens.slate);
    }
    // 소속 국가(840)의 인접 주 경계 배경 레이어가 한 번 깔린다.
    const subs = svg.match(/class="gi-subdivisions" data-adm0="840"/g) ?? [];
    expect(subs).toHaveLength(1);
  });

  it('명시 focus 는 강조색 우선 (ADM1 기본 위에 override)', () => {
    const ds = usDataSource();
    const r = createResolver({ dataSource: ds });
    const { scene } = compile('earth:\n  show: California\n  focus California { fill: coral }', {
      dataSource: ds,
      resolver: r,
    });
    expect(scene.entities[0]!.style.fill).toBe(DEFAULT_THEME.tokens.coral);
  });

  it('showOnly — 격리 모드: 바다/이웃국 생략 + 국가 ADM1 자동 캔버스', () => {
    const ds = usDataSource();
    const r = createResolver({ dataSource: ds });
    const { scene, svg } = compile('earth:\n  showOnly: 미국\n  show: California', { dataSource: ds, resolver: r });
    expect(scene.showOnly).toBe('840');
    // 바다/그래티큘/이웃국(faint world)/대양라벨 모두 생략.
    expect(svg).not.toContain('gi-ocean');
    expect(svg).not.toContain('gi-graticule');
    expect(svg).not.toContain('gi-world');
    expect(svg).not.toContain('gi-ocean-label');
    // 미국 ADM1 이 자동으로 캔버스 엔티티가 된다(51개 안팎).
    expect(scene.entities.length).toBeGreaterThan(40);
    // 명시한 California 는 강조색, 자동 채운 주는 canvas 색.
    const cali = scene.entities.find((e) => e.display === 'California')!;
    expect(cali.style.fill).toBe(DEFAULT_THEME.subdivision.fill);
    const auto = scene.entities.find((e) => e.style.fill === DEFAULT_THEME.subdivision.canvasFill);
    expect(auto).toBeTruthy();
    // 강조 엔티티가 캔버스보다 위(z 큼).
    expect(cali.z).toBeGreaterThan(auto!.z);
  });

  it('showOnly — ADM1 미로드 시 국가(ADM0) 실루엣으로 폴백', () => {
    const ds = createDefaultDataSource(); // ADM1 로드 안 함
    const r = createResolver({ dataSource: ds });
    const { scene } = compile('earth:\n  showOnly: 프랑스', { dataSource: ds, resolver: r });
    expect(scene.showOnly).toBe('250');
    // ADM0 실루엣 1개.
    expect(scene.entities).toHaveLength(1);
    expect(scene.entities[0]!.level).toBe(0);
  });

  it('showOnly 가 국가가 아니면 에러 진단', () => {
    const ds = usDataSource();
    const r = createResolver({ dataSource: ds });
    const { diagnostics } = compile('earth:\n  showOnly: 아프리카', { dataSource: ds, resolver: r });
    expect(diagnostics.some((d) => d.level === 'error')).toBe(true);
  });

  it('ADM1 미로드 국가의 주 이름은 미해석(에러 진단)', () => {
    const ds = createDefaultDataSource(); // 아무것도 로드 안 함
    const r = createResolver({ dataSource: ds });
    const { diagnostics } = compile('earth:\n  show: California', { dataSource: ds, resolver: r });
    expect(diagnostics.some((d) => d.level === 'error')).toBe(true);
  });
});
