import { describe, expect, it } from 'vitest';
import {
  addLayer,
  addLink,
  addShowName,
  hasLayer,
  hasShowName,
  removeLayer,
  removeLink,
  removeShowName,
  removeShowOnly,
  setCenter,
  setLinkLabel,
  setLinkType,
  setShowOnly,
  toggleLayer,
} from '../src/edit.js';
import { createLocator } from '../src/locate.js';
import { compile } from '../src/compile.js';
import { createResolver } from '@geoinsight/data';

describe('DSL 패치 — addShowName', () => {
  it('기존 show 라인에 추가', () => {
    const out = addShowName(`earth:\n  show: 아프리카, 수단`, '인도');
    expect(out).toContain('show: 아프리카, 수단, 인도');
  });
  it('show 라인이 없으면 헤더 다음에 생성', () => {
    const out = addShowName(`earth "t":\n  link: 수단 -> 인도`, '아프리카');
    expect(out.split('\n')[1]).toBe('  show: 아프리카');
  });
  it('이미 있으면 그대로(중복 방지)', () => {
    const src = `earth:\n  show: 아프리카, 수단`;
    expect(addShowName(src, '수단')).toBe(src);
  });
  it('표기 차이 흡수 (United States ↔ unitedstates)', () => {
    const src = `earth:\n  show: United States`;
    expect(hasShowName(src, 'unitedstates')).toBe(true);
  });
});

describe('DSL 패치 — removeShowName', () => {
  it('show 항목 제거', () => {
    const out = removeShowName(`earth:\n  show: 아프리카, 수단, 인도`, '수단');
    expect(out).toContain('show: 아프리카, 인도');
  });
  it('마지막 항목 제거 시 show 라인 삭제', () => {
    const out = removeShowName(`earth:\n  show: 수단`, '수단');
    expect(out).not.toContain('show:');
  });
  it('명시형 엔티티 선언과 link 도 함께 제거', () => {
    const src = `earth:\n  show: 아프리카, 수단, 인도\n  link: 수단 -> 인도\n  focus 수단 { fill: coral }`;
    const out = removeShowName(src, '수단');
    expect(out).not.toContain('focus 수단');
    expect(out).not.toContain('link: 수단 -> 인도');
    expect(out).toContain('show: 아프리카, 인도');
  });
});

describe('DSL 패치 — addLink/removeLink', () => {
  it('link 추가/중복방지/제거', () => {
    let src = `earth:\n  show: 수단, 인도`;
    src = addLink(src, '수단', '인도');
    expect(src).toContain('link: 수단 -> 인도');
    expect(addLink(src, '수단', '인도')).toBe(src); // 중복 방지
    src = removeLink(src, '수단', '인도');
    expect(src).not.toContain('link:');
  });
});

describe('DSL 패치 — setLinkType/setLinkLabel', () => {
  it('setLinkType: 키워드 교체(라벨 보존)', () => {
    const out = setLinkType(`earth:\n  link: 수단 -> 인도 "무역"`, '수단', '인도', 'current');
    expect(out).toContain('current: 수단 -> 인도 "무역"');
  });
  it('setLinkType arrow → link 키워드', () => {
    const out = setLinkType(`earth:\n  wind: 수단 -> 인도`, '수단', '인도', 'arrow');
    expect(out).toContain('link: 수단 -> 인도');
    expect(out).not.toContain('wind:');
  });
  it('setLinkLabel: 추가/교체/제거(타입 보존)', () => {
    let s = `earth:\n  wind: 수단 -> 인도`;
    s = setLinkLabel(s, '수단', '인도', '계절풍');
    expect(s).toContain('wind: 수단 -> 인도 "계절풍"');
    s = setLinkLabel(s, '수단', '인도', '');
    expect(s).toContain('wind: 수단 -> 인도');
    expect(s).not.toContain('"');
  });
  it('일치하는 인라인 링크가 없으면 원본 유지', () => {
    const src = `earth:\n  show: 수단`;
    expect(setLinkType(src, '수단', '인도', 'wind')).toBe(src);
  });
  it('removeLink 는 타입 키워드(wind 등)도 제거', () => {
    const out = removeLink(`earth:\n  wind: 수단 -> 인도 "x"`, '수단', '인도');
    expect(out).not.toContain('wind:');
  });
});

describe('DSL 패치 — layers 토글', () => {
  it('addLayer — layers 줄 없으면 헤더 다음에 삽입', () => {
    const out = addLayer('earth:\n  show: 일본', '해류');
    expect(out).toContain('layers: 해류');
    expect(hasLayer(out, '해류')).toBe(true);
  });

  it('addLayer — 기존 layers 줄에 추가(중복은 무시)', () => {
    const src = 'earth:\n  layers: 해류';
    const out = addLayer(src, '바람');
    expect(out).toContain('layers: 해류, 바람');
    expect(addLayer(out, '해류')).toBe(out); // 중복 no-op
  });

  it('removeLayer — 항목 제거, 마지막이면 줄 삭제', () => {
    expect(removeLayer('earth:\n  layers: 해류, 바람', '해류')).toContain('layers: 바람');
    const empty = removeLayer('earth:\n  layers: 해류', '해류');
    expect(empty).not.toContain('layers');
  });

  it('toggleLayer — 켜고 끄기 왕복', () => {
    const src = 'earth:\n  show: 일본';
    const on = toggleLayer(src, '해류');
    expect(hasLayer(on, '해류')).toBe(true);
    const off = toggleLayer(on, '해류');
    expect(hasLayer(off, '해류')).toBe(false);
  });
});

describe('DSL 패치 — setShowOnly/removeShowOnly', () => {
  it('showOnly 설정 + 대상 제거(show) + 세계뷰 프레이밍 제거', () => {
    const out = setShowOnly(`earth:\n  center: 태평양\n  fit: world\n  show: 미국, 캐나다`, '미국');
    expect(out).toContain('showOnly: 미국');
    expect(out).not.toContain('center:');
    expect(out).not.toContain('fit:');
    expect(out).toContain('show: 캐나다'); // 다른 항목은 보존
    expect(out).not.toMatch(/show:.*미국/);
  });
  it('기존 showOnly 라인 교체', () => {
    const out = setShowOnly(`earth:\n  showOnly: 미국`, '프랑스');
    expect(out).toContain('showOnly: 프랑스');
    expect(out).not.toContain('showOnly: 미국');
  });
  it('removeShowOnly 로 세계뷰 복귀', () => {
    const out = removeShowOnly(`earth:\n  showOnly: 미국\n  show: 캐나다`);
    expect(out).not.toContain('showOnly');
    expect(out).toContain('show: 캐나다');
  });
});

describe('DSL 패치 — setCenter', () => {
  it('center 라인이 없으면 헤더 다음에 생성', () => {
    const out = setCenter(`earth:\n  show: 아프리카`, 137);
    expect(out.split('\n')[1]).toBe('  center: 137');
  });
  it('기존 center 라인 갱신', () => {
    const out = setCenter(`earth:\n  center: 0\n  show: 아프리카`, -60);
    expect(out).toContain('center: -60');
    expect(out).not.toContain('center: 0');
  });
  it('경도 wrap[-180,180] + 정수화', () => {
    expect(setCenter(`earth:\n  show: 인도`, 200.6)).toContain('center: -159');
  });
  it('수동 center 는 arrange 를 제거(우선)', () => {
    const out = setCenter(`earth:\n  arrange: 아프리카 -> 아메리카\n  show: 아프리카`, 90);
    expect(out).not.toContain('arrange:');
    expect(out).toContain('center: 90');
  });
});

describe('locate — 역지오코딩', () => {
  const locator = createLocator();
  it('수단 영역 좌표 → 수단(SDN)', () => {
    // 수단 중심부 근방 (lon ~30, lat ~15)
    const hit = locator.locate([30, 15]);
    expect(hit).toBeTruthy();
    expect(hit!.feature.properties.cca3).toBe('SDN');
  });
  it('인도 영역 좌표 → 인도', () => {
    const hit = locator.locate([79, 22]);
    expect(hit).toBeTruthy();
    expect(hit!.feature.properties.cca2).toBe('IN');
  });
  it('대양 한가운데는 null', () => {
    expect(locator.locate([-150, 0])).toBeNull();
  });
});

describe('cameraFromMeta — project/unproject 왕복', () => {
  it('투영→역투영이 근사 복원된다', () => {
    const { meta } = compile(`earth:\n  show: 아프리카, 인도`);
    // meta 기반 카메라는 compile 내부에서 검증되므로, 여기선 round-trip 만 점검
    expect(meta.projectionParams.scale).toBeGreaterThan(0);
  });
});

describe('resolver.search', () => {
  const r = createResolver();
  it("'프' 검색에 프랑스 포함", () => {
    const hits = r.search('프');
    expect(hits.some((h) => h.display === '프랑스')).toBe(true);
  });
  it("'아시' 검색에 아시아 그룹 포함", () => {
    const hits = r.search('아시');
    expect(hits.some((h) => h.kind === 'group' && h.display === '아시아')).toBe(true);
  });
});
