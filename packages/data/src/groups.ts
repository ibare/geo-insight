/**
 * 그룹 키워드 테이블 — 대륙(region) / 권역(subregion) 을 한·영 별칭으로 매핑.
 *
 * 그룹은 resolve 우선순위 1순위(국가 정확 일치보다 먼저). 따라서 별칭이 특정
 * 국가의 한글명과 겹치면 그 국가를 가려버린다. 대표 충돌: world-countries 의
 * South Africa 한글명은 '남아프리카', subregion 은 'Southern Africa'. 그래서
 * 'Southern Africa' 권역 별칭에 '남아프리카'를 넣지 않고 '남부아프리카'만 쓴다 —
 * '남아프리카'는 국가(South Africa)로 해석되게 둔다.
 */

import type { RawCountry } from './countries.js';

export interface GroupDef {
  /** 안정 키 — IR Entity.key 로 쓰인다 (예: 'group:africa'). */
  key: string;
  /** 기본 표시명(한글). */
  display: string;
  /** 정규화된 별칭들 (normalizeName 적용 결과와 비교). */
  aliases: string[];
  /** 멤버 국가 판별. */
  match: (c: RawCountry) => boolean;
}

/** 그룹/국가 이름 비교용 정규화: 소문자 + 공백·하이픈·언더스코어 제거. */
export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[\s\-_]/g, '');
}

const byRegion = (region: string) => (c: RawCountry) => c.region === region;
const bySubregion = (subregion: string) => (c: RawCountry) => c.subregion === subregion;

/** 정의 순서 = 안정성. 같은 별칭이 둘 이상이면 먼저 정의된 것이 이긴다. */
export const GROUP_DEFS: GroupDef[] = [
  // 대륙 (region)
  { key: 'group:africa', display: '아프리카', aliases: ['아프리카', 'africa'], match: byRegion('Africa') },
  { key: 'group:asia', display: '아시아', aliases: ['아시아', 'asia'], match: byRegion('Asia') },
  { key: 'group:europe', display: '유럽', aliases: ['유럽', 'europe'], match: byRegion('Europe') },
  { key: 'group:oceania', display: '오세아니아', aliases: ['오세아니아', 'oceania'], match: byRegion('Oceania') },
  {
    key: 'group:americas',
    display: '아메리카',
    aliases: ['아메리카', 'americas', 'america'],
    match: byRegion('Americas'),
  },
  {
    key: 'group:antarctica',
    display: '남극',
    aliases: ['남극', 'antarctica', 'antarctic'],
    match: byRegion('Antarctic'),
  },

  // 아시아 권역 (subregion)
  {
    key: 'group:southeast-asia',
    display: '동남아시아',
    aliases: ['동남아시아', '동남아', 'southeastasia', 'southeasternasia'],
    match: bySubregion('South-Eastern Asia'),
  },
  {
    key: 'group:east-asia',
    display: '동아시아',
    aliases: ['동아시아', 'eastasia', 'easternasia'],
    match: bySubregion('Eastern Asia'),
  },
  {
    key: 'group:south-asia',
    display: '남아시아',
    aliases: ['남아시아', 'southasia', 'southernasia'],
    match: bySubregion('Southern Asia'),
  },
  {
    key: 'group:west-asia',
    display: '서아시아',
    aliases: ['서아시아', '중동', 'westasia', 'westernasia', 'middleeast'],
    match: bySubregion('Western Asia'),
  },
  {
    key: 'group:central-asia',
    display: '중앙아시아',
    aliases: ['중앙아시아', 'centralasia'],
    match: bySubregion('Central Asia'),
  },

  // 아프리카 권역
  {
    key: 'group:north-africa',
    display: '북아프리카',
    aliases: ['북아프리카', 'northafrica', 'northernafrica'],
    match: bySubregion('Northern Africa'),
  },
  {
    key: 'group:west-africa',
    display: '서아프리카',
    aliases: ['서아프리카', 'westafrica', 'westernafrica'],
    match: bySubregion('Western Africa'),
  },
  {
    key: 'group:east-africa',
    display: '동아프리카',
    aliases: ['동아프리카', 'eastafrica', 'easternafrica'],
    match: bySubregion('Eastern Africa'),
  },
  {
    key: 'group:middle-africa',
    display: '중앙아프리카',
    aliases: ['중앙아프리카', '중부아프리카', 'middleafrica', 'centralafrica'],
    match: bySubregion('Middle Africa'),
  },
  {
    key: 'group:southern-africa',
    display: '남부아프리카',
    // '남아프리카'는 국가(South Africa)와 충돌 → 제외.
    aliases: ['남부아프리카', 'southernafrica'],
    match: bySubregion('Southern Africa'),
  },

  // 유럽 권역
  { key: 'group:north-europe', display: '북유럽', aliases: ['북유럽', 'northerneurope'], match: bySubregion('Northern Europe') },
  { key: 'group:west-europe', display: '서유럽', aliases: ['서유럽', 'westerneurope'], match: bySubregion('Western Europe') },
  { key: 'group:east-europe', display: '동유럽', aliases: ['동유럽', 'easterneurope'], match: bySubregion('Eastern Europe') },
  { key: 'group:south-europe', display: '남유럽', aliases: ['남유럽', 'southerneurope'], match: bySubregion('Southern Europe') },
  {
    key: 'group:central-europe',
    display: '중부유럽',
    aliases: ['중부유럽', '중앙유럽', 'centraleurope'],
    match: bySubregion('Central Europe'),
  },

  // 아메리카 권역
  {
    key: 'group:north-america',
    display: '북미',
    aliases: ['북미', '북아메리카', 'northamerica'],
    match: bySubregion('North America'),
  },
  {
    key: 'group:south-america',
    display: '남미',
    aliases: ['남미', '남아메리카', 'southamerica'],
    match: bySubregion('South America'),
  },
  {
    key: 'group:central-america',
    display: '중앙아메리카',
    aliases: ['중앙아메리카', '중미', 'centralamerica'],
    match: bySubregion('Central America'),
  },
  {
    key: 'group:caribbean',
    display: '카리브',
    aliases: ['카리브', 'caribbean'],
    match: bySubregion('Caribbean'),
  },
];

/** 정규화된 별칭 → GroupDef 색인 (정의 순서로 첫 등록 우선). */
export const GROUP_BY_ALIAS: Map<string, GroupDef> = (() => {
  const m = new Map<string, GroupDef>();
  for (const g of GROUP_DEFS) {
    for (const a of g.aliases) {
      const n = normalizeName(a);
      if (!m.has(n)) m.set(n, g);
    }
  }
  return m;
})();
