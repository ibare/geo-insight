/**
 * 이름 검증 전용 경량 색인 생성기.
 *
 *   world-countries(687KB) + assets/adm1-index.json(792KB)
 *     → src/generated/name-index.js  (+ .d.ts)
 *
 * 왜 JSON 을 그대로 쓰지 않고 JS 모듈로 굽는가:
 *  1. Node — `import x from './x.json'` 은 import attribute 없이는 Node 20/22+ 에서
 *     ERR_IMPORT_ATTRIBUTE_MISSING 으로 죽는다. `with { type: 'json' }` 은 Node 20.10+
 *     에서만 파싱되므로 구버전에서 되레 SyntaxError 다. JS 모듈은 전 버전·전 번들러에서
 *     조건 없이 동작한다.
 *  2. 크기 — 이름 해석에 필요한 필드만 남긴다(지오메트리·행정 메타 전부 버림).
 *
 * .ts 가 아니라 .js + .d.ts 로 굽는 이유: 거대한 배열 리터럴을 tsc 가 타입 추론하면
 * 체크 시간이 급증한다. 값은 검사 대상에서 빼고 타입만 선언으로 준다.
 *
 * 재생성: pnpm --filter @geo-insight/data build:names
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));

/** 그룹/국가 이름 비교용 정규화 — groups.ts 의 normalizeName 과 반드시 동일해야 한다. */
const normalizeName = (s) => s.toLowerCase().replace(/[\s\-_]/g, '');

const countries = require('world-countries');
const adm1Index = JSON.parse(readFileSync(here('../assets/adm1-index.json'), 'utf8'));
const layerIndex = JSON.parse(readFileSync(here('../assets/layers/index.json'), 'utf8'));

/** 국가 — 이름 해석·그룹 판정에 필요한 필드만. */
const COUNTRIES = countries.map((c) => ({
  ccn3: c.ccn3,
  cca2: c.cca2,
  cca3: c.cca3,
  common: c.name.common,
  official: c.name.official,
  kor: c.translations.kor?.common ?? '',
  korOfficial: c.translations.kor?.official ?? '',
  alt: c.altSpellings ?? [],
  region: c.region ?? '',
  subregion: c.subregion ?? '',
  // 이름 충돌 타이브레이크용(예: '인도' India ↔ 영국령 인도양 지역).
  sovereign: Boolean(c.independent && c.unMember),
}));

/** ADM1 — 매칭(aliases)·표시(kor/name)·소속(adm0)·식별(code) 만. */
const ADM1 = adm1Index.map((e) => ({
  code: e.code,
  adm0: e.adm0,
  name: e.name,
  kor: e.kor,
  aliases: e.aliases,
}));

const banner = `// 생성 파일 — 직접 수정하지 말 것.
// scripts/build-name-index.mjs 가 world-countries + assets/adm1-index.json 에서 생성한다.
// 재생성: pnpm --filter @geo-insight/data build:names
`;

mkdirSync(here('../src/generated'), { recursive: true });

writeFileSync(
  here('../src/generated/name-index.js'),
  `${banner}export const COUNTRY_NAMES = ${JSON.stringify(COUNTRIES)};\n` +
    `export const ADM1_NAMES = ${JSON.stringify(ADM1)};\n` +
    `export const LAYER_NAMES = ${JSON.stringify(Object.keys(layerIndex))};\n`,
);

writeFileSync(
  here('../src/generated/name-index.d.ts'),
  `${banner}import type { CountryNameEntry, Adm1NameEntry } from '../name-types.js';

export declare const COUNTRY_NAMES: readonly CountryNameEntry[];
export declare const ADM1_NAMES: readonly Adm1NameEntry[];
export declare const LAYER_NAMES: readonly string[];
`,
);

// 정규화 별칭이 런타임과 어긋나지 않는지 즉시 자가검증(생성기와 groups.ts 의 규칙 일치).
const sample = ADM1[0];
if (sample && sample.aliases.some((a) => a !== normalizeName(a))) {
  throw new Error('adm1-index 의 aliases 가 정규화되어 있지 않다 — 생성 규칙 불일치');
}

const kb = (p) => (readFileSync(here(p)).length / 1024).toFixed(0);
console.log(
  `name-index.js 생성: ${kb('../src/generated/name-index.js')}KB ` +
    `(국가 ${COUNTRIES.length} / ADM1 ${ADM1.length})`,
);
