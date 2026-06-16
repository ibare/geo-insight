/**
 * DSL 소스에서 "어느 국가의 ADM1 을 로드해야 하는지"(ccn3 목록) 산출.
 *
 * 2단계 로딩의 1단계 — 런타임/호스트가 이 목록으로 ADM1 지오메트리를 fetch 한 뒤
 * DataSource 에 주입하고 compile 한다. gazetteer 는 지오메트리 없이 동봉되므로,
 * 아직 아무것도 로드되지 않은 상태에서도 'California → 미국' 을 알 수 있다.
 *
 * 트리거:
 *  - show/엔티티/링크끝점/arrange 에 등장한 **국가** → 그 국가의 ADM1 로드(주를 추가 가능하게)
 *  - **ADM1 이름**(gazetteer 일치) → 소속 국가 로드(그 이름을 해석 가능하게)
 *  - 'A.B' 점표기 → A(국가) 로드
 * 그룹(대륙/권역)은 멤버 폭증을 막으려 제외.
 */

import { adm1NameIndex, createResolver, normalizeName, type Resolver } from '@geo-insight/data';
import { parse } from './parser.js';

/** 소스에 등장하는 모든 장소 이름 토큰(점표기는 양쪽으로 분해). */
function collectNameTokens(source: string): string[] {
  const { ast } = parse(source);
  const raw: string[] = [];
  if (ast.title) {
    /* title 은 장소명이 아니므로 제외 */
  }
  for (const s of ast.statements) {
    switch (s.kind) {
      case 'prop':
        if (s.key === 'show') raw.push(...(s.list ?? [s.raw])); // 단일 show 는 raw 에 들어온다
        else if (s.relation) raw.push(s.relation.from, s.relation.to);
        else if (s.key === 'showOnly' || s.key === 'center') raw.push(s.raw);
        break;
      case 'entity':
        raw.push(s.name);
        break;
      case 'link':
        raw.push(s.from, s.to);
        break;
      case 'label':
        if (s.target !== 'all') raw.push(s.target);
        break;
    }
  }
  // 점표기 분해 + 공백 정리 + 중복 제거
  const out = new Set<string>();
  for (const r of raw) {
    const t = r.trim();
    if (!t) continue;
    if (t.includes('.')) {
      const i = t.indexOf('.');
      out.add(t.slice(0, i).trim());
      out.add(t.slice(i + 1).trim());
    } else {
      out.add(t);
    }
  }
  return [...out].filter(Boolean);
}

/** 소스가 필요로 하는 ADM1 국가(ccn3) 목록. 결정적(정렬). */
export function adm1CountriesFor(source: string, resolver?: Resolver): string[] {
  const r = resolver ?? createResolver();
  const nameIdx = adm1NameIndex();
  const ccn3s = new Set<string>();

  for (const token of collectNameTokens(source)) {
    // gazetteer(이름→국가) 우선 — ADM1 이름은 여기서 확정한다. base resolver 의 느슨한
    // 부분일치(예: 'Texas' 끝의 'as' → American Samoa 코드)에 오염되지 않게.
    const gaz = nameIdx.get(normalizeName(token));
    if (gaz && gaz.length > 0) {
      for (const e of gaz) ccn3s.add(e.adm0);
      continue;
    }
    // ADM1 이름이 아니면 국가로 — 국가가 표시되면 그 ADM1 도 로드(주를 추가 가능하게).
    const res = r.resolve(token);
    if (res.kind === 'country') ccn3s.add(res.key);
    else if (res.kind === 'adm1') ccn3s.add(res.adm0);
    // group/unknown 은 제외
  }
  return [...ccn3s].sort();
}
