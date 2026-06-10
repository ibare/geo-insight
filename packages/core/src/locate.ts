/**
 * 역지오코딩 — 화면 클릭 위경도 → 국가.
 *
 * d3-geo geoContains 로 전체 국가 feature 를 순회한다(110m 기준 ~177개, O(n) 충분).
 * 편집 UI 가 "지도 클릭 → 어느 국가" 를 알아내는 데 쓴다. 대륙/권역은 식별하지
 * 않는다(클릭은 국가 단위).
 */

import { createDefaultDataSource, type DataSource, type GeoFeature } from '@geoinsight/data';
import { geoContains } from 'd3-geo';

export interface LocatedCountry {
  /** ccn3 키 — Entity.key 와 동일 체계. */
  key: string;
  /** 한글 표시명. */
  display: string;
  feature: GeoFeature;
}

export interface Locator {
  locate(lonlat: [number, number]): LocatedCountry | null;
}

export function createLocator(dataSource?: DataSource): Locator {
  const ds = dataSource ?? createDefaultDataSource();
  const countries = ds.allCountries();
  return {
    locate(lonlat) {
      for (const f of countries) {
        if (geoContains(f as never, lonlat)) {
          return { key: f.id, display: f.properties.kor, feature: f };
        }
      }
      return null;
    },
  };
}
