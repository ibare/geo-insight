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

export interface PointGeometry {
  type: 'Point';
  coordinates: Position;
}
export interface MultiPointGeometry {
  type: 'MultiPoint';
  coordinates: Position[];
}
export interface LineStringGeometry {
  type: 'LineString';
  coordinates: Position[];
}
export interface MultiLineStringGeometry {
  type: 'MultiLineString';
  coordinates: Position[][];
}
/**
 * 레이어 지오메트리 — 점(화산/도시), 선(해류/경계), 면(기후대/수심) 모두 담는다.
 * GeoJSON 표준 기하 그대로 — 편집기가 출력하는 점/선/면이 이 형태로 들어온다.
 */
export type LayerGeometry =
  | PointGeometry
  | MultiPointGeometry
  | LineStringGeometry
  | MultiLineStringGeometry
  | PolygonGeometry
  | MultiPolygonGeometry;

/**
 * 큐레이션 레이어 feature — 사용자 저작이 아닌, 앱(이후 전문가 편집기)이 제공하는
 * 지리 데이터. 점/선/면을 담고 properties 로 유형별 변별을 표현한다.
 *
 * 편집기 데이터 유형(앞단 분류)과 properties 매핑:
 *   - 흐름선/경계선: geometry=LineString, kind=색군/종류, (흐름선은 좌표 순서가 방향)
 *   - 점 마커:       geometry=Point,      kind=범주, size=등급/크기
 *   - 범주 면:       geometry=Polygon,    kind=범주
 *   - 정량 필드:     geometry=Polygon,    value=연속 값(컬러스케일, 추후)
 */
export interface LayerFeature {
  type: 'Feature';
  id: string;
  properties: {
    name: string;
    kor: string;
    /** 분류/색군 — 해류면 'warm'|'cold', 점/면이면 범주. */
    kind?: string;
    /** 점 마커 크기/등급(예: 화산 규모, 도시 인구 단계). */
    size?: number;
    /** 정량 값 — 컬러스케일용(수심·기온 등, 추후 렌더). */
    value?: number;
    /**
     * 비주얼 프리미티브 종류. 'flow' = 흐름 화살표(geometry=중심선 제어점,
     * 카디널 스플라인 보간). 의미는 kind 가, 표현은 아래 파라미터가 결정한다.
     */
    prim?: 'flow';
    /** 흐름 두께(stroke-width). 미지정 시 kind 기반 기본값. */
    width?: number;
    /** 화살촉 표시 여부(흐름 끝). 기본 true. */
    arrow?: boolean;
    /** 점선 여부(예: 추정 흐름). 기본 false. */
    dash?: boolean;
    [key: string]: unknown;
  };
  geometry: LayerGeometry;
}

/** 국가/행정구역 폴리곤 한 조각 (GeoJSON Feature 최소형). */
export interface GeoFeature {
  type: 'Feature';
  /** ADM0=ccn3('729'), ADM1=adm1_code('USA-3521'). 그룹 feature 는 멤버 국가 코드. */
  id: string;
  properties: {
    /** 영문 표시명 (world-countries name.common / NE name). */
    name: string;
    /** 한글 표시명 (translations.kor.common / NE name_ko). 없으면 영문 fallback. */
    kor: string;
    cca2: string;
    cca3: string;
    region: string;
    subregion: string;
    /** 행정 레벨 — 0=국가(기본/생략), 1=ADM1(주/도), 2=ADM2(시/군). */
    level?: 0 | 1 | 2;
    /** ADM1 의 iso_3166_2 (예: 'US-CA'). */
    iso?: string;
    /** 소속 국가 ccn3 (ADM1/2). */
    adm0?: string;
    /** 행정구역 유형 (State/Province 등). */
    type?: string;
  };
  geometry: CountryGeometry;
}

/** ADM1 gazetteer 항목 — 지오메트리 없이 이름→{국가,코드} 해석용(번들 동봉). */
export interface Adm1IndexEntry {
  /** adm1_code — 전역 유일 식별자, GeoFeature.id 와 동일. */
  code: string;
  /** 소속 국가 ccn3. */
  adm0: string;
  /** 소속 국가 ISO3 (cca3). */
  adm0iso: string;
  /** iso_3166_2. */
  iso: string;
  name: string;
  kor: string;
  type: string;
  /** normalizeName 적용된 별칭들(name/en/local/ko/iso). */
  aliases: string[];
}

/** 국가별 ADM1 묶음 — assets/adm1/<ccn3>.json 의 형태(지연 로딩 단위). */
export interface Adm1FeatureCollection {
  type: 'FeatureCollection';
  adm0: string;
  adm0iso: string;
  features: GeoFeature[];
}

export type ResolveResult =
  | { kind: 'country'; key: string; display: string; features: GeoFeature[] }
  | { kind: 'group'; key: string; display: string; features: GeoFeature[] }
  | { kind: 'adm1'; key: string; display: string; features: GeoFeature[]; adm0: string }
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
  /**
   * 거친(저해상도) 전체 국가 목록 — 회전/팬 드래그 중 faint world 배경을 값싸게
   * 재투영하기 위한 110m 변형. 미구현 시 호출부가 allCountries 로 폴백.
   */
  coarseCountries?(): GeoFeature[];
  /**
   * 해당 국가의 **이미 로드된** ADM1 feature 목록 (없으면 빈 배열).
   * 로딩은 외부(런타임 fetch/Node fs)가 loadAdm1 로 주입 — compile 은 동기·순수 유지.
   */
  adm1(ccn3: string): GeoFeature[];
  /** ADM1 지오메트리 주입(2단계 로딩의 write 측). */
  loadAdm1(ccn3: string, features: GeoFeature[]): void;
  /**
   * 해당 레이어의 **이미 로드된** feature 목록(없으면 빈 배열). 키는 DSL 이름('해류').
   * ADM1 과 같은 2단계 로딩 — 외부 로더가 loadLayer 로 주입, compile 은 동기·순수 유지.
   */
  layer(name: string): LayerFeature[];
  /** 레이어 지오메트리 주입(2단계 로딩의 write 측). */
  loadLayer(name: string, features: LayerFeature[]): void;
}
