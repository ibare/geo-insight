/**
 * world-atlas(50m) topojson + world-countries 메타데이터를 조인해
 * ccn3 색인된 국가 feature 목록을 만든다.
 *
 * - 지오메트리: world-atlas countries-50m(고해상도). topojson `id` 가 ccn3 숫자 문자열.
 * - 메타데이터: world-countries. ccn3 로 조인해 한글명/region/subregion/ISO 부여.
 * - 조인 실패(예: 분쟁지역 id "-99")는 지오메트리는 보존하되 메타는 properties.name
 *   기반 최소값으로 채운다 — 이름·코드로는 해석 불가하지만 그림에서 빠지지 않게.
 */

import { feature } from 'topojson-client';
import type {
  CountryGeometry,
  DataSource,
  GeoFeature,
  LayerFeature,
  MultiPolygonGeometry,
  PolygonGeometry,
} from './types.js';
// 거대한 JSON 리터럴 타입으로 인한 tsc 성능 저하를 피하려 unknown 캐스트로 받는다.
// (world-atlas JSON 은 json-modules.d.ts 에서 unknown 으로 선언)
import worldCountriesRaw from 'world-countries';
import topology50mRaw from 'world-atlas/countries-50m.json';
import topology110mRaw from 'world-atlas/countries-110m.json';

interface RawCountry {
  ccn3: string;
  cca2: string;
  cca3: string;
  name: { common: string; official: string };
  translations: { kor?: { common: string; official: string } };
  region: string;
  subregion: string;
  altSpellings: string[];
  /** 주권 독립국 여부. 이름 충돌(예: '인도' India↔영국령 인도양 지역) 시 타이브레이크. */
  independent: boolean;
  unMember: boolean;
}

interface TopoGeometry {
  id?: string | number;
  type: string;
  properties?: { name?: string };
  arcs: unknown;
}
interface Topology {
  type: 'Topology';
  objects: { countries: { type: 'GeometryCollection'; geometries: TopoGeometry[] } };
  arcs: unknown;
  transform?: unknown;
}

interface FeatureCollectionLike {
  features: Array<{
    id?: string | number;
    properties?: { name?: string } | null;
    geometry: { type: string; coordinates: unknown } | null;
  }>;
}

const worldCountries = worldCountriesRaw as unknown as RawCountry[];
const topology50m = topology50mRaw as unknown as Topology;
const topology110m = topology110mRaw as unknown as Topology;

/** ccn3 → 메타데이터 색인. */
const metaByCode = new Map<string, RawCountry>();
for (const c of worldCountries) {
  metaByCode.set(c.ccn3, c);
}

function toCountryGeometry(geom: {
  type: string;
  coordinates: unknown;
} | null): CountryGeometry | null {
  if (!geom) return null;
  if (geom.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geom.coordinates } as PolygonGeometry;
  }
  if (geom.type === 'MultiPolygon') {
    return { type: 'MultiPolygon', coordinates: geom.coordinates } as MultiPolygonGeometry;
  }
  return null;
}

function buildFeatures(topology: Topology): GeoFeature[] {
  const fc = feature(
    topology as never,
    topology.objects.countries as never,
  ) as unknown as FeatureCollectionLike;

  const out: GeoFeature[] = [];
  for (const f of fc.features) {
    const geometry = toCountryGeometry(f.geometry);
    if (!geometry) continue;
    const id = f.id == null ? '' : String(f.id);
    const meta = metaByCode.get(id);
    const fallbackName = f.properties?.name ?? id ?? 'Unknown';
    out.push({
      type: 'Feature',
      id,
      properties: meta
        ? {
            name: meta.name.common,
            kor: meta.translations.kor?.common ?? meta.name.common,
            cca2: meta.cca2,
            cca3: meta.cca3,
            region: meta.region,
            subregion: meta.subregion,
          }
        : {
            name: fallbackName,
            kor: fallbackName,
            cca2: '',
            cca3: '',
            region: '',
            subregion: '',
          },
      geometry,
    });
  }
  // 안정 순서: ccn3(숫자) 오름차순. 빈 id 는 뒤로.
  out.sort((a, b) => {
    const na = a.id ? Number(a.id) : Number.POSITIVE_INFINITY;
    const nb = b.id ? Number(b.id) : Number.POSITIVE_INFINITY;
    if (na !== nb) return na - nb;
    return a.properties.name.localeCompare(b.properties.name);
  });
  return out;
}

let cached: GeoFeature[] | null = null;
function features(): GeoFeature[] {
  if (!cached) cached = buildFeatures(topology50m);
  return cached;
}

let cachedCoarse: GeoFeature[] | null = null;
/** 110m 거친 국가 목록 — 드래그 중 faint world 배경 재투영용(값싼 재렌더). */
function coarseFeatures(): GeoFeature[] {
  if (!cachedCoarse) cachedCoarse = buildFeatures(topology110m);
  return cachedCoarse;
}

/** 기본 DataSource — 번들된 world-atlas 50m + world-countries. ADM1 은 주입 전까지 비어있다. */
export function createDefaultDataSource(): DataSource {
  const byCode = new Map<string, GeoFeature>();
  for (const f of features()) {
    if (f.id) byCode.set(f.id, f);
  }
  // ccn3 → 로드된 ADM1 feature 목록. 외부 로더가 loadAdm1 로 채운다.
  const adm1Store = new Map<string, GeoFeature[]>();
  // 레이어 이름('해류') → 로드된 LayerFeature 목록. 외부 로더가 loadLayer 로 채운다.
  const layerStore = new Map<string, LayerFeature[]>();
  return {
    countryByCode: (ccn3) => byCode.get(ccn3),
    allCountries: () => features(),
    coarseCountries: () => coarseFeatures(),
    adm1: (ccn3) => adm1Store.get(ccn3) ?? [],
    loadAdm1: (ccn3, fs) => {
      adm1Store.set(ccn3, fs);
    },
    layer: (name) => layerStore.get(name) ?? [],
    loadLayer: (name, fs) => {
      layerStore.set(name, fs);
    },
  };
}

/** world-countries 메타 원본 접근 (resolver 가 이름 색인 구축에 사용). */
export function rawCountries(): readonly RawCountry[] {
  return worldCountries;
}

export type { RawCountry };
