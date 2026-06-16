import { describe, expect, it } from 'vitest';
import { createDefaultDataSource } from '@geo-insight/data';
import { loadLayerFromDisk, readLayerFile } from '@geo-insight/data/node';
import { compile } from '../src/compile.js';

describe('layers — 큐레이션 레이어(해류) 파이프라인', () => {
  it('디스크에서 해류 데이터를 읽는다(LineString feature)', () => {
    const feats = readLayerFile('해류');
    expect(feats.length).toBeGreaterThan(5);
    const f = feats[0]!;
    expect(f.geometry.type).toBe('LineString');
    expect(['warm', 'cold']).toContain(f.properties.kind);
  });

  it('미등록 레이어는 빈 배열', () => {
    expect(readLayerFile('없는레이어')).toEqual([]);
  });

  it('layers: 해류 → scene.layers + gi-layer 흐름선 렌더', () => {
    const ds = createDefaultDataSource();
    loadLayerFromDisk(ds, '해류');
    const { svg, scene } = compile('earth:\n  layers: 해류', { dataSource: ds });

    expect(scene.layers).toEqual(['해류']);
    // 난류/한류 두 색이 모두 path 로 나온다.
    expect(svg).toContain('gi-layer-warm');
    expect(svg).toContain('gi-layer-cold');
    expect(svg).toContain('data-layer="해류"');
    // 해류 feature 수만큼 gi-layer path.
    const count = (svg.match(/class="gi-layer /g) ?? []).length;
    expect(count).toBe(readLayerFile('해류').length);
  });

  it('해류 라벨(한국어 이름) + 방향 화살촉이 렌더된다', () => {
    const ds = createDefaultDataSource();
    loadLayerFromDisk(ds, '해류');
    const { svg } = compile('earth:\n  layers: 해류', { dataSource: ds });
    expect(svg).toContain('gi-layer-label');
    expect(svg).toContain('gi-layer-arrow'); // 흐름 방향 화살촉
    // 흐름 방향 그라데이션 — 꼬리(투명)→화살표(진함).
    expect(svg).toContain('<linearGradient');
    expect(svg).toContain('stop-opacity="0.04"');
    // 데이터의 kor 이름이 텍스트로 들어간다.
    expect(svg).toContain('쿠로시오 해류');
    expect(svg).toContain('멕시코 만류');
  });

  it('바람 레이어 — 무역/편서/극동 흐름선 + 화살촉 + 라벨', () => {
    const ds = createDefaultDataSource();
    loadLayerFromDisk(ds, '바람');
    const { svg, scene } = compile('earth:\n  layers: 바람', { dataSource: ds });
    expect(scene.layers).toEqual(['바람']);
    expect(svg).toContain('gi-layer-trade');
    expect(svg).toContain('gi-layer-westerly');
    expect(svg).toContain('gi-layer-polar');
    expect(svg).toContain('gi-layer-arrow');
    expect(svg).toContain('편서풍');
  });

  it('점 레이어 → 마커(원) + 라벨, 면 레이어 → 반투명 폴리곤', () => {
    const ds = createDefaultDataSource();
    // 합성 데이터: 점 1개 + 면 1개.
    ds.loadLayer('테스트', [
      {
        type: 'Feature',
        id: 'pt:volcano',
        properties: { name: 'Volcano', kor: '화산', kind: 'warm', size: 2 },
        geometry: { type: 'Point', coordinates: [10, 20] },
      },
      {
        type: 'Feature',
        id: 'area:zone',
        properties: { name: 'Zone', kor: '구역', kind: 'cold' },
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
      },
    ]);
    const { svg } = compile('earth:\n  layers: 테스트', { dataSource: ds });
    expect(svg).toContain('gi-layer-marker'); // 점 마커
    expect(svg).toContain('<circle');
    expect(svg).toContain('gi-layer-area'); // 면
    expect(svg).toContain('fill-opacity="0.18"');
    expect(svg).toContain('화산');
  });

  it('해류와 바람을 동시에 표시한다', () => {
    const ds = createDefaultDataSource();
    loadLayerFromDisk(ds, '해류');
    loadLayerFromDisk(ds, '바람');
    const { svg, scene } = compile('earth:\n  layers: 해류, 바람', { dataSource: ds });
    expect(scene.layers).toEqual(['해류', '바람']);
    expect(svg).toContain('gi-layer-warm');
    expect(svg).toContain('gi-layer-trade');
  });

  it('데이터 미주입(로드 안 함) 이면 레이어 path 가 없다 — 조용히 생략', () => {
    const ds = createDefaultDataSource();
    const { svg } = compile('earth:\n  layers: 해류', { dataSource: ds });
    expect(svg).not.toContain('gi-layer');
  });

  it('showOnly(격리) 모드에서는 해류를 생략한다(바다가 없음)', () => {
    const ds = createDefaultDataSource();
    loadLayerFromDisk(ds, '해류');
    const { svg } = compile('earth:\n  showOnly: 프랑스\n  layers: 해류', { dataSource: ds });
    expect(svg).not.toContain('gi-layer');
  });
});
