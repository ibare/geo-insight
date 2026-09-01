// 생성 파일 — 직접 수정하지 말 것.
// scripts/build-name-index.mjs 가 world-countries + assets/adm1-index.json 에서 생성한다.
// 재생성: pnpm --filter @geo-insight/data build:names
import type { CountryNameEntry, Adm1NameEntry } from '../name-types.js';

export declare const COUNTRY_NAMES: readonly CountryNameEntry[];
export declare const ADM1_NAMES: readonly Adm1NameEntry[];
export declare const LAYER_NAMES: readonly string[];
