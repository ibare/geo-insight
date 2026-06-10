/**
 * ADM1(주/도) 전처리 빌드 스크립트.
 *
 * Natural Earth 10m admin_1_states_provinces → 국가별(ccn3) GeoJSON 분리 + 경량
 * gazetteer 인덱스. 빌드타임 전용(런타임/번들 비종속). 산출물:
 *   - assets/adm1/<ccn3>.json   : 국가별 ADM1 FeatureCollection(지연 로딩 단위)
 *   - assets/adm1-index.json    : 이름→{국가, 코드} gazetteer(번들 동봉, 지오메트리 없음)
 *
 * 파이프라인: NE 10m geojson → mapshaper(필드정리·단순화·adm0_a3 분리) → ccn3 매핑
 * → 정리. 명칭은 NE 원본(name/name_en/name_local/name_ko/iso_3166_2) 그대로 사용.
 *
 * 사용: node scripts/build-adm1.mjs   (mapshaper 는 devDependency 의 로컬 bin 사용)
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');

const SRC_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson';
const CACHE = resolve(pkgRoot, '.cache');
const SRC = resolve(CACHE, 'ne_adm1_10m.geojson');
const SPLIT_DIR = resolve(CACHE, 'adm1_split');
const OUT_DIR = resolve(pkgRoot, 'assets/adm1');
const INDEX_FILE = resolve(pkgRoot, 'assets/adm1-index.json');

/** groups.ts 의 normalizeName 과 동일 규칙(소문자 + 공백/하이픈/언더스코어 제거). */
const normalizeName = (s) => String(s).toLowerCase().replace(/[\s\-_]/g, '');

// ── ring winding 보정 ────────────────────────────────────────────────────────
// NE GeoJSON 은 RFC 7946(외곽 CCW)이지만 d3-geo 는 외곽 CW 를 기대한다(world-atlas 와
// 동일). 어긋나면 d3 가 폴리곤을 구면 여집합으로 해석해 bbox 가 전세계로 폭주한다.
// 외곽 ring 을 CW(신호면적<0), hole 을 CCW 로 맞춘다.
const ringSignedArea = (ring) => {
  let a = 0;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return a / 2;
};
const rewindRing = (ring, wantCW) => {
  const isCW = ringSignedArea(ring) < 0;
  if (wantCW !== isCW) ring.reverse();
};
const rewindGeometry = (geom) => {
  if (geom.type === 'Polygon') {
    geom.coordinates.forEach((ring, i) => rewindRing(ring, i === 0));
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) poly.forEach((ring, i) => rewindRing(ring, i === 0));
  }
  return geom;
};

function ensureSource() {
  if (existsSync(SRC)) return;
  mkdirSync(CACHE, { recursive: true });
  console.log('[adm1] NE 10m 소스 다운로드…');
  execFileSync('curl', ['-sL', '--max-time', '300', '-o', SRC, SRC_URL], { stdio: 'inherit' });
}

function runMapshaper() {
  rmSync(SPLIT_DIR, { recursive: true, force: true });
  mkdirSync(SPLIT_DIR, { recursive: true });
  const bin = resolve(pkgRoot, 'node_modules/.bin/mapshaper');
  const cmd = existsSync(bin) ? bin : 'mapshaper';
  console.log('[adm1] mapshaper 단순화·분리…');
  execFileSync(
    cmd,
    [
      SRC,
      '-filter-fields',
      'adm0_a3,adm1_code,iso_3166_2,name,name_en,name_local,name_ko,type_en',
      '-simplify',
      '12%',
      'visvalingam',
      'keep-shapes',
      '-split',
      'adm0_a3',
      '-o',
      `${SPLIT_DIR}/`,
      'format=geojson',
    ],
    { stdio: 'inherit' },
  );
}

function buildIso3ToCcn3() {
  const wc = require('world-countries');
  const map = new Map();
  const korByCcn3 = new Map();
  for (const c of wc) {
    map.set(c.cca3, c.ccn3);
    korByCcn3.set(c.ccn3, c.translations?.kor?.common ?? c.name.common);
  }
  return { map, korByCcn3 };
}

function aliasesFor(p, iso) {
  const out = new Set();
  for (const v of [p.name, p.name_en, p.name_local, p.name_ko, iso]) {
    if (v) out.add(normalizeName(v));
  }
  return [...out].filter(Boolean);
}

function main() {
  ensureSource();
  runMapshaper();
  const { map: iso3ToCcn3 } = buildIso3ToCcn3();

  mkdirSync(OUT_DIR, { recursive: true });
  // 기존 산출물 정리(재현성).
  for (const f of readdirSync(OUT_DIR)) {
    if (f.endsWith('.json')) rmSync(resolve(OUT_DIR, f));
  }

  const files = readdirSync(SPLIT_DIR).filter((f) => f.endsWith('.json'));
  const index = [];
  let countries = 0;
  let provinces = 0;
  const skipped = [];

  for (const file of files.sort()) {
    const iso3 = file.replace(/\.json$/, '');
    const ccn3 = iso3ToCcn3.get(iso3);
    if (!ccn3) {
      skipped.push(iso3);
      continue;
    }
    const fc = JSON.parse(readFileSync(resolve(SPLIT_DIR, file), 'utf8'));
    const features = [];
    for (const f of fc.features) {
      const p = f.properties ?? {};
      const code = p.adm1_code; // NE 고유 식별자(전역 유일)
      const iso = p.iso_3166_2 || '';
      const name = p.name || p.name_en || code;
      const kor = p.name_ko || name;
      const type = p.type_en || '';
      features.push({
        type: 'Feature',
        id: code,
        properties: { name, kor, cca2: '', cca3: iso3, region: '', subregion: '', level: 1, adm0: ccn3, iso, type },
        geometry: rewindGeometry(f.geometry),
      });
      index.push({ code, adm0: ccn3, adm0iso: iso3, iso, name, kor, type, aliases: aliasesFor(p, iso) });
      provinces++;
    }
    // id(adm1_code) 오름차순 — 결정적.
    features.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    writeFileSync(
      resolve(OUT_DIR, `${ccn3}.json`),
      JSON.stringify({ type: 'FeatureCollection', adm0: ccn3, adm0iso: iso3, features }),
    );
    countries++;
  }

  index.sort((a, b) => a.code.localeCompare(b.code));
  writeFileSync(INDEX_FILE, JSON.stringify(index));

  console.log(`[adm1] 완료: ${countries}개국, ${provinces}개 ADM1 → assets/adm1/`);
  console.log(`[adm1] gazetteer: ${index.length} 항목 → assets/adm1-index.json`);
  if (skipped.length) console.log(`[adm1] ccn3 미매핑(생략): ${skipped.join(', ')}`);
}

main();
