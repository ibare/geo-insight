/**
 * 레이어 브라우저 로더 — 번들러(Vite/Rollup)용 동적 import.
 *
 * index.json(레이어명→파일) 은 정적 동봉, 데이터 파일은 `import('../assets/layers/<file>.json')`
 * 템플릿으로 lazy 청크 분해(Vite dynamic-import-vars). ADM1 로더와 같은 패턴.
 */

import layerIndex from '../assets/layers/index.json';
import type { LayerFeature } from './types.js';

interface IndexEntry {
  file: string;
  kind: string;
}

/** 레이어명('해류')의 LayerFeature[]. 미등록/실패 시 빈 배열. */
export async function loadLayerBrowser(name: string): Promise<LayerFeature[]> {
  const entry = (layerIndex as Record<string, IndexEntry>)[name];
  if (!entry) return [];
  try {
    const mod = (await import(`../assets/layers/${entry.file}.json`)) as { default?: unknown };
    const fc = (mod.default ?? mod) as { features?: LayerFeature[] };
    return Array.isArray(fc.features) ? fc.features : [];
  } catch {
    return [];
  }
}
