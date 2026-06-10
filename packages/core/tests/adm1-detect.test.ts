import { describe, expect, it } from 'vitest';
import { adm1CountriesFor } from '../src/adm1-detect.js';

describe('adm1CountriesFor — 로드 대상 국가 감지', () => {
  it('ADM1 이름 → 소속 국가(ccn3)', () => {
    expect(adm1CountriesFor('earth:\n  show: California, Texas')).toEqual(['840']);
  });
  it('단일 show(raw) 도 감지', () => {
    expect(adm1CountriesFor('earth:\n  show: California')).toEqual(['840']);
  });
  it("점표기 'A.B' 의 국가 감지", () => {
    expect(adm1CountriesFor('earth:\n  show: 미국.California')).toEqual(['840']);
  });
  it('국가가 표시되면 그 국가 ADM1 도 로드 대상(trigger a)', () => {
    expect(adm1CountriesFor('earth:\n  show: 미국')).toEqual(['840']);
  });
  it('느슨한 부분일치에 오염되지 않음 (Texas ↛ American Samoa)', () => {
    expect(adm1CountriesFor('earth:\n  show: Texas')).toEqual(['840']);
  });
  it('여러 국가의 ADM1 혼합', () => {
    expect(adm1CountriesFor('earth:\n  show: California, 경기도, Bavaria')).toEqual(['276', '410', '840']);
  });
  it('그룹(대륙)은 멤버 폭증 방지로 제외', () => {
    // 아프리카(그룹) 제외, 인도(국가)만
    expect(adm1CountriesFor('earth:\n  show: 아프리카, 인도')).toEqual(['356']);
  });
});
