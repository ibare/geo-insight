/**
 * 레이어 디스크 로더 — Node 전용(테스트·빌드·서버 렌더).
 *
 * 브라우저 번들에 node:fs 가 새지 않도록 '@geo-insight/data/node' 서브경로로 분리.
 * 결국 DataSource.loadLayer 로 주입 — ADM1 의 loadAdm1FromDisk 와 같은 패턴.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DataSource, LayerFeature } from './types.js';

function readJson(rel: string): unknown {
  const path = fileURLToPath(new URL(rel, import.meta.url));
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** 레이어명('해류')의 LayerFeature[] 을 디스크에서. 미등록/없음이면 빈 배열. */
export function readLayerFile(name: string): LayerFeature[] {
  const idx = readJson('../assets/layers/index.json') as Record<string, { file: string }> | null;
  const entry = idx?.[name];
  if (!entry) return [];
  const fc = readJson(`../assets/layers/${entry.file}.json`) as { features?: LayerFeature[] } | null;
  return Array.isArray(fc?.features) ? fc!.features : [];
}

/** 디스크에서 읽어 DataSource 에 주입(2단계 로딩의 Node 측). 이미 로드돼 있으면 skip. */
export function loadLayerFromDisk(ds: DataSource, name: string): LayerFeature[] {
  const existing = ds.layer(name);
  if (existing.length > 0) return existing;
  const features = readLayerFile(name);
  ds.loadLayer(name, features);
  return features;
}
