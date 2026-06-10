/**
 * @geoinsight/data 공개 타입.
 *
 * core 는 이 타입들만 알면 된다 — d3-geo·topojson 구체 구현은 data 안에 숨긴다.
 * GeoFeature 는 GeoJSON Feature 의 최소 형태(Polygon/MultiPolygon 한정)로,
 * 프레임워크/라이브러리 비종속이도록 자체 정의한다.
 */

export type Position = [number, number];

export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: Position[][];
}

export interface MultiPolygonGeometry {
  type: 'MultiPolygon';
  coordinates: Position[][][];
}

export type CountryGeometry = PolygonGeometry | MultiPolygonGeometry;

/** 국가 폴리곤 한 조각 (GeoJSON Feature 최소형). */
export interface GeoFeature {
  type: 'Feature';
  /** ccn3 숫자 코드 문자열 (예: '729'). 그룹 feature 는 멤버 국가 코드. */
  id: string;
  properties: {
    /** 영문 표시명 (world-countries name.common). */
    name: string;
    /** 한글 표시명 (translations.kor.common). 없으면 영문 fallback. */
    kor: string;
    cca2: string;
    cca3: string;
    region: string;
    subregion: string;
  };
  geometry: CountryGeometry;
}

export type ResolveResult =
  | { kind: 'country'; key: string; display: string; features: GeoFeature[] }
  | { kind: 'group'; key: string; display: string; features: GeoFeature[] }
  | { kind: 'unknown'; suggestions: string[] };

export interface SearchHit {
  kind: 'country' | 'group';
  key: string;
  display: string;
}

export interface Resolver {
  /** 이름 → feature 집합 (동기). 미해석/모호는 unknown + suggestions. */
  resolve(name: string): ResolveResult;
  /** 부분 일치 검색 — 편집 UI 자동완성용. 국가·그룹 후보를 limit 개까지. */
  search(query: string, limit?: number): SearchHit[];
}

/**
 * 지오메트리 + 메타데이터 공급 포트.
 *
 * v1 기본 구현은 world-atlas(110m) + world-countries 를 번들 JSON 에서 읽지만,
 * 커스텀/고해상도 데이터 주입이나 런타임 fetch 로더를 별도 어댑터로 끼울 수 있도록
 * 인터페이스로 둔다.
 */
export interface DataSource {
  /** ccn3 → 국가 feature (단일 국가). 없으면 undefined. */
  countryByCode(ccn3: string): GeoFeature | undefined;
  /** 전체 국가 feature 목록 (안정 순서: ccn3 오름차순). */
  allCountries(): GeoFeature[];
}
