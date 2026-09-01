/**
 * '@geo-insight/data/names' — 지오메트리 없는 이름 해석기.
 *
 * resolver.ts 와 같은 판정을 하되 **지오메트리를 전혀 건드리지 않는다**. 검증만 하는
 * 호출자(LLM 생성 파이프라인, Temporal worker)에게 world-atlas 지오메트리(840KB)와
 * topojson 디코딩은 순수 낭비이고, JSON 정적 import 때문에 Node 에서는 아예 죽는다.
 *
 * 데이터는 generated/name-index.js — 빌드 타임에 구운 JS 모듈이라 JSON import 가 없다.
 *
 * ── resolver.ts 와의 유일한 의도적 차이 ────────────────────────────────────
 * resolver 의 ADM1 해석은 "지오메트리가 로드된 국가" 로 한정된다(로딩 전에는 미해석).
 * 여기서는 그 가드가 없다 — 게이저티어 전체를 대상으로 판정한다. 즉 **런타임이 필요한
 * ADM1 을 로드한 뒤의 상태** 를 기준으로 답한다. 브라우저 런타임(mount)은 adm1CountriesFor
 * 로 필요한 국가를 자동 로드하므로 이 기준이 실제 렌더 결과와 일치한다.
 */

import { GROUP_BY_ALIAS, GROUP_DEFS, normalizeName } from './groups.js';
import { ADM1_NAMES, COUNTRY_NAMES, LAYER_NAMES } from './generated/name-index.js';
import type { Adm1NameEntry, CountryNameEntry, NameCheck } from './name-types.js';

interface CountryHit {
  entry: CountryNameEntry;
  /** 표시명 — 한글 통용명 우선. */
  display: string;
}

const displayOf = (c: CountryNameEntry): string => c.kor || c.common;

/** 정규화 이름 → 국가들. 같은 이름에 복수 국가가 걸릴 수 있어 배열. */
let exactIndexCache: Map<string, CountryHit[]> | null = null;
function exactIndex(): Map<string, CountryHit[]> {
  if (exactIndexCache) return exactIndexCache;
  const idx = new Map<string, CountryHit[]>();
  const add = (name: string | undefined, c: CountryNameEntry): void => {
    if (!name) return;
    const n = normalizeName(name);
    if (!n) return;
    const list = idx.get(n) ?? [];
    if (!list.some((e) => e.entry.ccn3 === c.ccn3)) list.push({ entry: c, display: displayOf(c) });
    idx.set(n, list);
  };
  for (const c of COUNTRY_NAMES) {
    add(c.kor, c);
    add(c.korOfficial, c);
    add(c.common, c);
    add(c.official, c);
    add(c.cca2, c);
    add(c.cca3, c);
    for (const alt of c.alt) add(alt, c);
  }
  exactIndexCache = idx;
  return idx;
}

/** 정규화 별칭 → ADM1 항목들. */
let adm1IndexCache: Map<string, Adm1NameEntry[]> | null = null;
function adm1Index(): Map<string, Adm1NameEntry[]> {
  if (adm1IndexCache) return adm1IndexCache;
  const idx = new Map<string, Adm1NameEntry[]>();
  for (const e of ADM1_NAMES) {
    for (const a of e.aliases) {
      const list = idx.get(a);
      if (list) list.push(e);
      else idx.set(a, [e]);
    }
  }
  adm1IndexCache = idx;
  return idx;
}

function dedupeSorted(names: string[]): string[] {
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, 'ko')).slice(0, 8);
}

const asCountry = (h: CountryHit, input: string): NameCheck => ({
  input,
  kind: 'country',
  key: h.entry.ccn3,
  display: h.display,
});

const asAdm1 = (e: Adm1NameEntry, input: string): NameCheck => ({
  input,
  kind: 'adm1',
  key: e.code,
  display: e.kor || e.name,
  adm0: e.adm0,
});

const unknown = (input: string, suggestions: string[] = []): NameCheck =>
  suggestions.length > 0 ? { input, kind: 'unknown', suggestions } : { input, kind: 'unknown' };

/** 복수 후보 → 독립 주권국이 유일하면 그것으로 확정 (resolver.resolveCountry 와 동일 규칙). */
function pickCountry(hits: CountryHit[], input: string): NameCheck {
  if (hits.length === 1) return asCountry(hits[0]!, input);
  const sovereign = hits.filter((h) => h.entry.sovereign);
  if (sovereign.length === 1) return asCountry(sovereign[0]!, input);
  return unknown(input, dedupeSorted(hits.map((h) => h.display)));
}

/** 'A.B' 스코프 표기 — A=국가, B=그 국가의 ADM1. */
function resolveScoped(raw: string): NameCheck | null {
  const dot = raw.indexOf('.');
  if (dot < 0) return null;
  const parentName = raw.slice(0, dot).trim();
  const childName = raw.slice(dot + 1).trim();
  if (!parentName || !childName) return null;
  const parentHits = exactIndex().get(normalizeName(parentName));
  if (!parentHits || parentHits.length === 0) return null;
  const parent = pickCountry(parentHits, parentName);
  if (parent.kind !== 'country') return null;
  const cands = (adm1Index().get(normalizeName(childName)) ?? []).filter((e) => e.adm0 === parent.key);
  if (cands.length >= 1) return asAdm1(cands[0]!, raw);
  return unknown(raw, dedupeSorted(adm1InCountryNames(parent.key!)));
}

/** 국가(ccn3) 소속 ADM1 표시명 목록 — 스코프 표기 실패 시 제안용. */
function adm1InCountryNames(ccn3: string): string[] {
  const out: string[] = [];
  for (const e of ADM1_NAMES) if (e.adm0 === ccn3) out.push(e.kor || e.name);
  return out;
}

/** 부분 일치 후보 — 정확 색인 이름과 서로 포함 관계인 국가들. */
function partialCandidates(norm: string): CountryHit[] {
  const seen = new Set<string>();
  const out: CountryHit[] = [];
  for (const [name, hits] of exactIndex()) {
    if (!name.includes(norm) && !norm.includes(name)) continue;
    for (const h of hits) {
      if (seen.has(h.entry.ccn3)) continue;
      seen.add(h.entry.ccn3);
      out.push(h);
    }
  }
  return out;
}

/**
 * 이름 하나를 해석한다. 우선순위는 resolver.ts 와 동일:
 * 스코프 표기 → 그룹 → 국가 정확 → ADM1 → 부분 일치.
 */
export function checkName(raw: string): NameCheck {
  const input = raw.trim();
  if (!input) return unknown(raw);

  // 0. 'A.B' 스코프 표기
  if (input.includes('.')) {
    const scoped = resolveScoped(input);
    if (scoped) return scoped;
  }

  const norm = normalizeName(input);
  if (!norm) return unknown(input);

  // 1. 그룹(대륙/권역) — 국가 정확 일치보다 우선.
  const group = GROUP_BY_ALIAS.get(norm);
  if (group) return { input, kind: 'group', key: group.key, display: group.display };

  // 2. 국가 정확 일치 (ADM1 보다 우선 — 예: Georgia 는 국가).
  const exact = exactIndex().get(norm);
  if (exact && exact.length > 0) return pickCountry(exact, input);

  // 3. ADM1 — 정확히 하나일 때만. 복수면 국가 스코프가 필요하므로 부분 일치로 넘긴다.
  const adm1 = adm1Index().get(norm) ?? [];
  if (adm1.length === 1) return asAdm1(adm1[0]!, input);

  // 4. 부분 일치.
  const partial = partialCandidates(norm);
  if (partial.length === 1) return pickCountry(partial, input);
  if (partial.length > 1) return unknown(input, dedupeSorted(partial.map((h) => h.display)));

  // 5. 복수 ADM1 이었다면 그 후보를, 아니면 그룹 별칭 부분 일치를 제안한다.
  if (adm1.length > 1) {
    return unknown(input, dedupeSorted(adm1.map((e) => `${e.kor || e.name}(${countryDisplay(e.adm0)})`)));
  }
  const groupSuggest = GROUP_DEFS.filter((g) =>
    g.aliases.some((a) => {
      const n = normalizeName(a);
      return n.includes(norm) || norm.includes(n);
    }),
  ).map((g) => g.display);
  return unknown(input, dedupeSorted(groupSuggest));
}

/** ccn3 → 한글 표시명. 모르면 코드 그대로. */
export function countryDisplay(ccn3: string): string {
  for (const c of COUNTRY_NAMES) if (c.ccn3 === ccn3) return displayOf(c);
  return ccn3;
}

/** 여러 이름을 한 번에. 입력 순서를 보존한다. */
export function checkNames(names: readonly string[]): NameCheck[] {
  return names.map((n) => checkName(n));
}

/** 그룹(대륙/권역) 전량 — LLM 프롬프트 주입·문서 생성용. */
export function listGroups(): Array<{ key: string; display: string; aliases: readonly string[] }> {
  return GROUP_DEFS.map((g) => ({ key: g.key, display: g.display, aliases: g.aliases }));
}

/** 켤 수 있는 큐레이션 레이어 이름 전량(`layers:` 의 유효값). */
export function listLayers(): readonly string[] {
  return LAYER_NAMES;
}

export type { Adm1NameEntry, CountryNameEntry, NameCheck, NameKind } from './name-types.js';
