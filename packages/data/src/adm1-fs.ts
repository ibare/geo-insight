/**
 * ADM1 디스크 로더 — Node 전용(테스트·빌드·서버 렌더).
 *
 * 브라우저 번들에 node:fs 가 새지 않도록 index.ts 에서 export 하지 않는다. 런타임
 * (브라우저)은 이 대신 fetch 기반 로더를 쓴다. 둘 다 결국 DataSource.loadAdm1 로 주입.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeAdm1 } from './adm1.js';
import type { DataSource, GeoFeature } from './types.js';

/** assets/adm1/<ccn3>.json 을 읽어 GeoFeature[] 로. 없으면 빈 배열. */
export function readAdm1File(ccn3: string): GeoFeature[] {
  const url = new URL(`../assets/adm1/${ccn3}.json`, import.meta.url);
  const path = fileURLToPath(url);
  if (!existsSync(path)) return [];
  return decodeAdm1(JSON.parse(readFileSync(path, 'utf8')));
}

/** 디스크에서 읽어 DataSource 에 주입(2단계 로딩의 Node 측). 이미 로드돼 있으면 skip. */
export function loadAdm1FromDisk(ds: DataSource, ccn3: string): GeoFeature[] {
  const existing = ds.adm1(ccn3);
  if (existing.length > 0) return existing;
  const features = readAdm1File(ccn3);
  ds.loadAdm1(ccn3, features);
  return features;
}
