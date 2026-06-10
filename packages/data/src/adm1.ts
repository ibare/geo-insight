/**
 * ADM1(주/도) 데이터 접근.
 *
 * gazetteer 인덱스(assets/adm1-index.json)는 지오메트리 없이 이름→{국가,코드}만
 * 담아 번들에 동봉된다 — 지오메트리 로딩 전에도 "이 이름이 어느 국가의 ADM1 인지"를
 * 동기적으로 알 수 있다(닭-달걀 해소). 실제 지오메트리는 국가별 파일(assets/adm1/<ccn3>.json)
 * 을 외부 로더가 fetch/read 해 DataSource.loadAdm1 로 주입한다.
 */

import { normalizeName } from './groups.js';
import type { Adm1FeatureCollection, Adm1IndexEntry, GeoFeature } from './types.js';
// 788KB flat 배열 — resolveJsonModule 의 무거운 리터럴 타입을 피하려 unknown 으로 받는다.
import adm1IndexRaw from '../assets/adm1-index.json';

/** 전체 ADM1 gazetteer (4500여 항목). */
export const ADM1_INDEX: readonly Adm1IndexEntry[] = adm1IndexRaw as unknown as Adm1IndexEntry[];

let nameIndexCache: Map<string, Adm1IndexEntry[]> | null = null;

/** 정규화 별칭 → ADM1 항목들. 같은 별칭이 여러 국가에 있을 수 있어 배열. */
export function adm1NameIndex(): Map<string, Adm1IndexEntry[]> {
  if (nameIndexCache) return nameIndexCache;
  const idx = new Map<string, Adm1IndexEntry[]>();
  for (const e of ADM1_INDEX) {
    for (const a of e.aliases) {
      const list = idx.get(a);
      if (list) list.push(e);
      else idx.set(a, [e]);
    }
  }
  nameIndexCache = idx;
  return idx;
}

/** 특정 국가(ccn3) 안에서 이름으로 ADM1 항목 찾기 (스코프 해석용). */
export function adm1InCountry(ccn3: string, name: string): Adm1IndexEntry[] {
  const norm = normalizeName(name);
  return (adm1NameIndex().get(norm) ?? []).filter((e) => e.adm0 === ccn3);
}

/** 국가별 ADM1 파일(JSON) → GeoFeature[]. 외부 로더가 읽은 raw 를 검증·정규화. */
export function decodeAdm1(raw: unknown): GeoFeature[] {
  const fc = raw as Adm1FeatureCollection;
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) return [];
  return fc.features.filter((f) => f && f.geometry && f.id);
}
