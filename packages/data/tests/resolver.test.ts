import { describe, expect, it } from 'vitest';
import { createResolver } from '../src/index.js';

const r = createResolver();

describe('resolver — 국가 정확 일치', () => {
  it('한글명으로 수단(SDN)을 해석한다', () => {
    const res = r.resolve('수단');
    expect(res.kind).toBe('country');
    if (res.kind !== 'country') return;
    expect(res.key).toBe('729');
    expect(res.display).toBe('수단');
    expect(res.features.length).toBeGreaterThan(0);
    expect(res.features[0]!.properties.cca3).toBe('SDN');
  });

  it('인도를 해석한다', () => {
    const res = r.resolve('인도');
    expect(res.kind).toBe('country');
    if (res.kind !== 'country') return;
    expect(res.features[0]!.properties.cca2).toBe('IN');
  });

  it('영문/ISO 코드로도 해석한다', () => {
    expect(r.resolve('India').kind).toBe('country');
    expect(r.resolve('US').kind).toBe('country');
    expect(r.resolve('KOR').kind).toBe('country');
  });

  it('수단과 남수단은 정확 일치로 구분된다', () => {
    const sd = r.resolve('수단');
    const ss = r.resolve('남수단');
    expect(sd.kind).toBe('country');
    expect(ss.kind).toBe('country');
    if (sd.kind === 'country' && ss.kind === 'country') {
      expect(sd.key).not.toBe(ss.key);
    }
  });
});

describe('resolver — 그룹 키워드', () => {
  it('아프리카는 group 으로 다수 국가를 묶는다', () => {
    const res = r.resolve('아프리카');
    expect(res.kind).toBe('group');
    if (res.kind !== 'group') return;
    expect(res.key).toBe('group:africa');
    expect(res.features.length).toBeGreaterThan(30);
  });

  it('동남아시아 subregion 그룹', () => {
    const res = r.resolve('동남아시아');
    expect(res.kind).toBe('group');
    if (res.kind !== 'group') return;
    expect(res.key).toBe('group:southeast-asia');
  });

  it('아메리카(region Americas) 그룹', () => {
    const res = r.resolve('아메리카');
    expect(res.kind).toBe('group');
    if (res.kind !== 'group') return;
    expect(res.key).toBe('group:americas');
  });

  it("'남아프리카'는 그룹이 아니라 국가(South Africa)로 해석된다", () => {
    const res = r.resolve('남아프리카');
    expect(res.kind).toBe('country');
    if (res.kind !== 'country') return;
    expect(res.features[0]!.properties.cca2).toBe('ZA');
  });
});

describe('resolver — 모호성/미해석', () => {
  it("'수'는 모호 → unknown + 수단·남수단 제안", () => {
    const res = r.resolve('수');
    expect(res.kind).toBe('unknown');
    if (res.kind !== 'unknown') return;
    expect(res.suggestions).toContain('수단');
    expect(res.suggestions).toContain('남수단');
  });

  it('완전 미지의 이름은 unknown', () => {
    const res = r.resolve('아틀란티스');
    expect(res.kind).toBe('unknown');
  });
});

describe('resolver — 결정성', () => {
  it('같은 입력은 같은 feature 순서를 낸다', () => {
    const a = r.resolve('아프리카');
    const b = r.resolve('아프리카');
    if (a.kind === 'group' && b.kind === 'group') {
      expect(a.features.map((f) => f.id)).toEqual(b.features.map((f) => f.id));
    }
  });
});
