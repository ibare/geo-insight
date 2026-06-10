/**
 * 이름 해석기.
 *
 * 매칭 우선순위 (구현지침 §5):
 *   1. 그룹 키워드(대륙/권역)
 *   2. 정확 일치 (kor/en common·official, cca2, cca3, altSpellings)
 *   3. 부분 일치 — 정확히 하나면 해석, 둘 이상이면 모호 → unknown + suggestions
 *   4. 그 외 → unknown + suggestions (부분 포함 후보)
 *
 * 모든 경로는 동기. 결과 feature 순서는 allCountries(ccn3 오름차순)를 따른다 — 결정적.
 */

import { adm1InCountry, adm1NameIndex } from './adm1.js';
import { createDefaultDataSource, rawCountries, type RawCountry } from './countries.js';
import { GROUP_BY_ALIAS, GROUP_DEFS, normalizeName } from './groups.js';
import type { Adm1IndexEntry, DataSource, GeoFeature, ResolveResult, Resolver, SearchHit } from './types.js';

interface NameIndexEntry {
  ccn3: string;
  display: string;
  independent: boolean;
}

function buildExactIndex(countries: readonly RawCountry[]): Map<string, NameIndexEntry[]> {
  const idx = new Map<string, NameIndexEntry[]>();
  const add = (name: string | undefined, c: RawCountry, display: string) => {
    if (!name) return;
    const n = normalizeName(name);
    if (!n) return;
    const list = idx.get(n) ?? [];
    if (!list.some((e) => e.ccn3 === c.ccn3)) {
      list.push({ ccn3: c.ccn3, display, independent: c.independent && c.unMember });
    }
    idx.set(n, list);
  };
  for (const c of countries) {
    const display = c.translations.kor?.common ?? c.name.common;
    add(c.translations.kor?.common, c, display);
    add(c.translations.kor?.official, c, display);
    add(c.name.common, c, display);
    add(c.name.official, c, display);
    add(c.cca2, c, display);
    add(c.cca3, c, display);
    for (const alt of c.altSpellings) add(alt, c, display);
  }
  return idx;
}

export interface ResolverOptions {
  /** 지오메트리 공급원 교체 (커스텀/고해상도). 기본은 번들 110m. */
  dataSource?: DataSource;
}

export function createResolver(opts: ResolverOptions = {}): Resolver {
  const dataSource = opts.dataSource ?? createDefaultDataSource();
  const countries = rawCountries();
  const exactIndex = buildExactIndex(countries);

  /** ccn3 멤버 목록 → feature 목록 (allCountries 순서 보존, 지오메트리 없는 멤버는 skip). */
  const featuresForCodes = (codes: Set<string>): GeoFeature[] =>
    dataSource.allCountries().filter((f) => codes.has(f.id));

  const resolveGroup = (norm: string): ResolveResult | null => {
    const def = GROUP_BY_ALIAS.get(norm);
    if (!def) return null;
    const codes = new Set<string>();
    for (const c of countries) if (def.match(c)) codes.add(c.ccn3);
    return { kind: 'group', key: def.key, display: def.display, features: featuresForCodes(codes) };
  };

  const asCountry = (e: NameIndexEntry): ResolveResult => {
    const f = dataSource.countryByCode(e.ccn3);
    return { kind: 'country', key: e.ccn3, display: e.display, features: f ? [f] : [] };
  };

  // ── ADM1 (주/도) — gazetteer 는 항상 있지만 지오메트리가 로드된 국가만 해석 대상.
  const adm1Names = adm1NameIndex();
  const isLoaded = (ccn3: string): boolean => dataSource.adm1(ccn3).length > 0;
  const adm1Feature = (e: Adm1IndexEntry): GeoFeature | undefined =>
    dataSource.adm1(e.adm0).find((f) => f.id === e.code);
  const asAdm1 = (e: Adm1IndexEntry): ResolveResult => {
    const f = adm1Feature(e);
    return { kind: 'adm1', key: e.code, display: e.kor || e.name, features: f ? [f] : [], adm0: e.adm0 };
  };
  /** 로드된 국가들 안에서 이름이 정확히 하나의 ADM1 로 해석되면 그것. 아니면 null. */
  const resolveAdm1 = (norm: string): ResolveResult | null => {
    const matches = (adm1Names.get(norm) ?? []).filter((e) => isLoaded(e.adm0));
    if (matches.length === 1) return asAdm1(matches[0]!);
    return null; // 0개(미로드/없음) 또는 복수(국가 스코프 필요) → 상위 흐름에 위임
  };
  /** 'A.B' 스코프 표기 — A=국가, B=그 국가의 ADM1. */
  const resolveScoped = (raw: string): ResolveResult | null => {
    const dot = raw.indexOf('.');
    if (dot < 0) return null;
    const parentName = raw.slice(0, dot).trim();
    const childName = raw.slice(dot + 1).trim();
    if (!parentName || !childName) return null;
    const parentEntries = exactIndex.get(normalizeName(parentName));
    const parent = parentEntries && parentEntries.length > 0 ? resolveCountry(parentEntries) : null;
    if (!parent || parent.kind !== 'country') return null;
    const cands = adm1InCountry(parent.key, childName).filter((e) => isLoaded(e.adm0));
    if (cands.length >= 1) return asAdm1(cands[0]!);
    return { kind: 'unknown', suggestions: adm1InCountry(parent.key, childName).map((e) => e.kor) };
  };

  const resolveCountry = (entries: NameIndexEntry[]): ResolveResult => {
    if (entries.length === 1) return asCountry(entries[0]!);
    // 복수 → 독립 주권국(UN 회원)이 유일하면 그것으로 결정 (예: '인도' India↔영국령 인도양 지역).
    const sovereign = entries.filter((e) => e.independent);
    if (sovereign.length === 1) return asCountry(sovereign[0]!);
    return { kind: 'unknown', suggestions: dedupeSorted(entries.map((e) => e.display)) };
  };

  const partialCandidates = (norm: string): NameIndexEntry[] => {
    const seen = new Set<string>();
    const out: NameIndexEntry[] = [];
    for (const [name, entries] of exactIndex) {
      if (name.includes(norm) || norm.includes(name)) {
        for (const e of entries) {
          if (seen.has(e.ccn3)) continue;
          seen.add(e.ccn3);
          out.push(e);
        }
      }
    }
    return out;
  };

  return {
    resolve(rawName: string): ResolveResult {
      // 0. 'A.B' 스코프 표기 (국가.ADM1)
      if (rawName.includes('.')) {
        const scoped = resolveScoped(rawName);
        if (scoped) return scoped;
      }

      const norm = normalizeName(rawName);
      if (!norm) return { kind: 'unknown', suggestions: [] };

      // 1. 그룹
      const group = resolveGroup(norm);
      if (group) return group;

      // 2. 국가 정확 일치 (ADM1 보다 우선 — 예: Georgia 는 국가)
      const exact = exactIndex.get(norm);
      if (exact && exact.length > 0) return resolveCountry(exact);

      // 3. ADM1 (로드된 국가 한정, 정확히 하나일 때)
      const adm1 = resolveAdm1(norm);
      if (adm1) return adm1;

      // 4/5. 부분 일치
      const partial = partialCandidates(norm);
      if (partial.length === 1) return resolveCountry(partial);
      if (partial.length > 1) {
        return { kind: 'unknown', suggestions: dedupeSorted(partial.map((e) => e.display)) };
      }

      // 그룹 별칭 부분 일치도 제안에 포함
      const groupSuggest = GROUP_DEFS.filter((g) =>
        g.aliases.some((a) => {
          const n = normalizeName(a);
          return n.includes(norm) || norm.includes(n);
        }),
      ).map((g) => g.display);

      return { kind: 'unknown', suggestions: dedupeSorted(groupSuggest) };
    },

    search(query: string, limit = 10): SearchHit[] {
      const q = normalizeName(query);
      if (!q) return [];
      const hits: SearchHit[] = [];
      const seen = new Set<string>();

      // 그룹(대륙/권역) 먼저
      for (const g of GROUP_DEFS) {
        if (g.aliases.some((a) => normalizeName(a).includes(q)) && !seen.has(g.key)) {
          seen.add(g.key);
          hits.push({ kind: 'group', key: g.key, display: g.display });
        }
      }

      // 국가 — 정확>접두>부분, 독립 주권국 가산
      const scored: Array<{ hit: SearchHit; score: number }> = [];
      for (const c of countries) {
        const display = c.translations.kor?.common ?? c.name.common;
        const names = [c.translations.kor?.common, c.name.common, c.cca2, c.cca3];
        let best = 0;
        for (const nm of names) {
          if (!nm) continue;
          const n = normalizeName(nm);
          if (n === q) best = Math.max(best, 3);
          else if (n.startsWith(q)) best = Math.max(best, 2);
          else if (n.includes(q)) best = Math.max(best, 1);
        }
        if (best > 0 && !seen.has(c.ccn3)) {
          scored.push({
            hit: { kind: 'country', key: c.ccn3, display },
            score: best + (c.independent && c.unMember ? 0.5 : 0),
          });
        }
      }
      scored.sort((a, b) => b.score - a.score || a.hit.display.localeCompare(b.hit.display, 'ko'));
      for (const s of scored) {
        if (seen.has(s.hit.key)) continue;
        seen.add(s.hit.key);
        hits.push(s.hit);
      }
      return hits.slice(0, limit);
    },
  };
}

function dedupeSorted(names: string[]): string[] {
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, 'ko')).slice(0, 8);
}
