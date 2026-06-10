import { describe, expect, it } from 'vitest';
import { ADM1_INDEX, adm1InCountry, createDefaultDataSource, createResolver } from '../src/index.js';
import { loadAdm1FromDisk, readAdm1File } from '../src/adm1-fs.js';

const USA = '840';

/** 신호면적(shoelace, y=lat up): <0 = CW(외곽), >0 = CCW. d3-geo 는 외곽 CW 기대. */
function outerSign(geom: { type: string; coordinates: number[][][] | number[][][][] }): number {
  const poly = geom.type === 'Polygon' ? (geom.coordinates as number[][][]) : (geom.coordinates as number[][][][])[0]!;
  const ring = poly[0]!;
  let a = 0;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    a += ring[j]![0]! * ring[i]![1]! - ring[i]![0]! * ring[j]![1]!;
  }
  return Math.sign(a);
}

describe('ADM1 gazetteer', () => {
  it('인덱스가 채워져 있고 California 항목을 포함', () => {
    expect(ADM1_INDEX.length).toBeGreaterThan(4000);
    const ca = ADM1_INDEX.find((e) => e.name === 'California');
    expect(ca).toBeTruthy();
    expect(ca!.adm0).toBe(USA);
    expect(ca!.kor).toBe('캘리포니아');
    expect(ca!.aliases).toContain('california');
    expect(ca!.aliases).toContain('캘리포니아');
  });

  it('adm1InCountry 로 국가 스코프 조회', () => {
    expect(adm1InCountry(USA, 'California').map((e) => e.iso)).toContain('US-CA');
    // 다른 국가 스코프에서는 안 잡힘
    expect(adm1InCountry('410', 'California')).toHaveLength(0); // 410=한국
  });
});

describe('ADM1 디스크 로드', () => {
  it('미국 ADM1 파일을 읽어 51개 주 + d3 규약(외곽 CW) winding', () => {
    const feats = readAdm1File(USA);
    expect(feats.length).toBe(51);
    const ca = feats.find((f) => f.properties.name === 'California')!;
    expect(ca.properties.level).toBe(1);
    expect(ca.properties.iso).toBe('US-CA');
    // winding 회귀 가드: 외곽 ring 은 CW(-1) 여야 한다. CCW 면 d3 가 전세계로 폭주.
    expect(outerSign(ca.geometry)).toBe(-1);
  });

  it('존재하지 않는 국가는 빈 배열', () => {
    expect(readAdm1File('99999')).toHaveLength(0);
  });
});

describe('resolver — ADM1 해석(2단계 로딩)', () => {
  it('로드 전에는 ADM1 이름이 해석되지 않는다', () => {
    const ds = createDefaultDataSource();
    const r = createResolver({ dataSource: ds });
    expect(r.resolve('California').kind).toBe('unknown');
  });

  it('로드 후 영문/한글/ISO/점표기로 해석', () => {
    const ds = createDefaultDataSource();
    loadAdm1FromDisk(ds, USA);
    const r = createResolver({ dataSource: ds });
    for (const q of ['California', '캘리포니아', 'US-CA', '미국.California', '미국.캘리포니아']) {
      const res = r.resolve(q);
      expect(res.kind, q).toBe('adm1');
      if (res.kind === 'adm1') {
        expect(res.key).toBe('USA-3521');
        expect(res.features).toHaveLength(1);
        expect(res.adm0).toBe(USA);
      }
    }
  });

  it('국가 이름이 ADM1 보다 우선 (Georgia → 국가)', () => {
    const ds = createDefaultDataSource();
    loadAdm1FromDisk(ds, USA); // 미국 주 로드(조지아 주 포함)
    const r = createResolver({ dataSource: ds });
    const res = r.resolve('Georgia');
    expect(res.kind).toBe('country'); // 조지아 국가가 우선
  });

  it('loadAdm1 이 멱등(중복 로드 skip)', () => {
    const ds = createDefaultDataSource();
    const a = loadAdm1FromDisk(ds, USA);
    const b = loadAdm1FromDisk(ds, USA);
    expect(a).toBe(b);
  });
});
