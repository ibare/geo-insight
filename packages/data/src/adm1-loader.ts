/**
 * ADM1 브라우저 로더 — 번들러(Vite/Rollup)용 동적 import.
 *
 * `import('../assets/adm1/<ccn3>.json')` 템플릿을 번들러가 국가별 lazy 청크로 분해한다
 * (Vite dynamic-import-vars). Node fs 비종속이라 브라우저에서 안전. index.ts 에 두지 않고
 * '@geo-insight/data/browser' 서브경로로 분리해 host-tiptap 번들 오염을 막는다.
 */

import { decodeAdm1 } from './adm1.js';
import type { GeoFeature } from './types.js';

/** ccn3 국가의 ADM1 GeoFeature[]. 없거나 실패하면 빈 배열. */
export async function loadAdm1Browser(ccn3: string): Promise<GeoFeature[]> {
  try {
    const mod = (await import(`../assets/adm1/${ccn3}.json`)) as { default?: unknown };
    return decodeAdm1(mod.default ?? mod);
  } catch {
    return [];
  }
}
