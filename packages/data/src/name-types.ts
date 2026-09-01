/**
 * 이름 검증 경로 전용 타입.
 *
 * 지오메트리(DataSource·GeoFeature)와 완전히 분리해 둔다 — 이 경로의 존재 이유가
 * "world-atlas 를 그래프에 들이지 않는 것"이기 때문이다. types.ts 를 import 하면
 * 타입만 쓰더라도 실수로 값 import 가 섞일 여지가 생기므로 파일을 따로 둔다.
 */

/** 이름 해석에 필요한 국가 필드만 추린 항목. generated/name-index.js 가 담는다. */
export interface CountryNameEntry {
  ccn3: string;
  cca2: string;
  cca3: string;
  common: string;
  official: string;
  /** 한글 통용명. 없으면 빈 문자열. */
  kor: string;
  korOfficial: string;
  alt: readonly string[];
  region: string;
  subregion: string;
  /** 독립 주권국(UN 회원) — 이름 충돌 시 타이브레이크. */
  sovereign: boolean;
}

/** ADM1(주/도) 게이저티어 항목 — 지오메트리 없이 이름만. */
export interface Adm1NameEntry {
  /** adm1_code — GeoFeature.id 와 동일. */
  code: string;
  /** 소속 국가 ccn3. */
  adm0: string;
  name: string;
  kor: string;
  /** normalizeName 이 적용된 별칭들. */
  aliases: readonly string[];
}

export type NameKind = 'country' | 'group' | 'adm1' | 'unknown';

/** 이름 하나의 해석 결과. */
export interface NameCheck {
  /** 입력 원문. */
  input: string;
  kind: NameKind;
  /** country=ccn3, group=group:xxx, adm1=adm1_code. unknown 이면 없음. */
  key?: string;
  /** 한글 표시명. */
  display?: string;
  /** adm1 일 때 소속 국가 ccn3. */
  adm0?: string;
  /** unknown/모호 일 때의 후보(최대 8, 한글 가나다순). */
  suggestions?: string[];
}
