/**
 * '@geo-insight/core/validate' — 렌더 없이 소스를 검증한다.
 *
 * LLM 생성 파이프라인(Temporal worker 등)이 쓰는 진입점. 목적은 SVG 가 아니라 **진단**이라
 * 지오메트리(world-atlas)와 투영·카메라·emit 파이프라인을 전부 뺐다. 그래서:
 *
 *  - 그래프에 JSON import 가 없다 → Node 20/22+ 에서도 그냥 돈다(배럴은 죽는다).
 *  - world-atlas 840KB + topojson 디코딩 비용이 없다.
 *
 * 검출력은 compile 보다 **높다**. compile 은 미지 entity/link 속성, 잘못된 fit 값,
 * 존재하지 않는 색 토큰을 조용히 무시하지만 여기서는 전부 진단으로 잡는다.
 * 렌더 경로(build-scene)는 건드리지 않으므로 기존 출력은 바이트 하나 바뀌지 않는다.
 *
 * ── compile 과의 판정 차이 ─────────────────────────────────────────────────
 * ADM1 은 게이저티어 전체를 대상으로 해석한다(지오메트리 로드 여부 무관). 브라우저
 * 런타임은 필요한 국가를 자동 로드하므로 이 기준이 실제 렌더 결과와 일치한다.
 * 반면 데이터를 주입하지 않은 맨 compile() 은 같은 이름을 미해석으로 처리한다.
 */

import { checkName, type NameCheck } from '@geo-insight/data/names';
import { listLayers } from '@geo-insight/data/names';
import type { Ast, PropMap, Statement } from './ast.js';
import { error, warning, hasError, type Diagnostic, type Span } from './diagnostics.js';
import { parse } from './parser.js';
import { COLOR_TOKENS } from './theme.js';

// ── 어휘 ────────────────────────────────────────────────────────────────────
// 검사와 문서(spec)가 같은 표를 읽도록 vocabulary.ts 를 단일 출처로 쓴다.

import {
  ANCHORS,
  BORDERS,
  CENTER_KEYWORDS,
  DSL_VOCABULARY,
  ENTITY_PROPS,
  FIT_MODES,
  HEADS,
  LABEL_ATS,
  LABEL_PROPS,
  LINK_KEYWORDS,
  LINK_PROPS,
  LINK_TYPES,
  PROJECTIONS,
  SCENE_KEYS,
  THEME_KEYS,
} from './vocabulary.js';

export { DSL_VOCABULARY };

// ── 근접 제안 ───────────────────────────────────────────────────────────────

/** 편집 거리 ≤ 2 인 후보들(오타 교정 제안용). */
function nearest(input: string, candidates: readonly string[]): string[] {
  const lower = input.toLowerCase();
  const scored: Array<[string, number]> = [];
  for (const c of candidates) {
    const d = editDistance(lower, c.toLowerCase());
    if (d <= 2) scored.push([c, d]);
  }
  return scored.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([c]) => c).slice(0, 3);
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length]!;
}

// ── 값 검사 ─────────────────────────────────────────────────────────────────

/**
 * CSS 기본 색 이름 — resolveColor 는 named 토큰이 아니면 값을 그대로 흘리므로, 이 이름들은
 * SVG 에서 실제로 유효하다. 여기 없는 알파벳 단어는 오타로 보고 경고한다.
 *
 * 주의: DSL 은 `#` 을 주석으로 읽으므로 `fill: #ff8800` 같은 hex 표기는 렉서 단계에서
 * 깨진다(파싱 에러). 그래서 색은 named 토큰이나 CSS 색 이름으로만 쓸 수 있다.
 */
const CSS_COLOR_NAMES = new Set([
  'aliceblue','antiquewhite','aqua','aquamarine','azure','beige','bisque','black','blanchedalmond',
  'blue','blueviolet','brown','burlywood','cadetblue','chartreuse','chocolate','coral','cornflowerblue',
  'cornsilk','crimson','cyan','darkblue','darkcyan','darkgoldenrod','darkgray','darkgreen','darkgrey',
  'darkkhaki','darkmagenta','darkolivegreen','darkorange','darkorchid','darkred','darksalmon',
  'darkseagreen','darkslateblue','darkslategray','darkslategrey','darkturquoise','darkviolet','deeppink',
  'deepskyblue','dimgray','dimgrey','dodgerblue','firebrick','floralwhite','forestgreen','fuchsia',
  'gainsboro','ghostwhite','gold','goldenrod','gray','green','greenyellow','grey','honeydew','hotpink',
  'indianred','indigo','ivory','khaki','lavender','lavenderblush','lawngreen','lemonchiffon','lightblue',
  'lightcoral','lightcyan','lightgoldenrodyellow','lightgray','lightgreen','lightgrey','lightpink',
  'lightsalmon','lightseagreen','lightskyblue','lightslategray','lightslategrey','lightsteelblue',
  'lightyellow','lime','limegreen','linen','magenta','maroon','mediumaquamarine','mediumblue',
  'mediumorchid','mediumpurple','mediumseagreen','mediumslateblue','mediumspringgreen','mediumturquoise',
  'mediumvioletred','midnightblue','mintcream','mistyrose','moccasin','navajowhite','navy','oldlace',
  'olive','olivedrab','orange','orangered','orchid','palegoldenrod','palegreen','paleturquoise',
  'palevioletred','papayawhip','peachpuff','peru','pink','plum','powderblue','purple','rebeccapurple',
  'red','rosybrown','royalblue','saddlebrown','salmon','sandybrown','seagreen','seashell','sienna',
  'silver','skyblue','slateblue','slategray','slategrey','snow','springgreen','steelblue','tan','teal',
  'thistle','tomato','transparent','turquoise','violet','wheat','white','whitesmoke','yellow','yellowgreen',
]);

/** hex·rgb()·hsl() 표기 — 파서가 받아주지 못하더라도 값 자체는 색으로 인정한다. */
const CSS_FUNC_RE = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([^)]*\))$/i;

function isColorLike(v: string): boolean {
  const t = v.trim();
  if (t in COLOR_TOKENS) return true;
  if (CSS_COLOR_NAMES.has(t.toLowerCase())) return true;
  return CSS_FUNC_RE.test(t);
}

/** fit 은 모드 키워드이거나 [w,s,e,n] 숫자 4개. */
function isValidFit(raw: string): boolean {
  const t = raw.trim();
  if ((FIT_MODES as readonly string[]).includes(t)) return true;
  const nums = t.match(/-?\d+(?:\.\d+)?/g);
  return Boolean(nums && nums.length === 4);
}

// ── 검증 ────────────────────────────────────────────────────────────────────

export interface ValidateResult {
  ast: Ast;
  diagnostics: Diagnostic[];
  /** error 수준 진단이 하나도 없으면 true. warning 은 ok 를 깨지 않는다. */
  ok: boolean;
  /** 소스에 등장한 모든 지명의 해석 결과(등장 순서, 중복 제거). */
  names: NameCheck[];
}

/**
 * 소스를 파싱하고 문법·어휘·지명을 검증한다. 렌더도 데이터 로딩도 하지 않는다.
 *
 * error — 그대로 두면 렌더가 깨지거나 대상이 사라지는 것(미해석 지명, 미지 scene 키,
 *         잘못된 투영 등). warning — 렌더는 되지만 의도대로 동작하지 않는 것(무시되는
 *         속성, 미지 entity/link 속성 등).
 */
export function validate(source: string): ValidateResult {
  const { ast, diagnostics: parseDiags } = parse(source);
  const diagnostics: Diagnostic[] = [...parseDiags];
  const names: NameCheck[] = [];
  const seenName = new Set<string>();

  /** 지명 하나를 해석해 결과를 모으고, 미해석이면 진단을 남긴다. */
  const useName = (raw: string, span: Span | undefined, what: string): void => {
    const t = raw.trim();
    if (!t) return;
    if (seenName.has(t)) return;
    seenName.add(t);
    const check = checkName(t);
    names.push(check);
    if (check.kind === 'unknown') {
      diagnostics.push(
        error(`${what}을(를) 해석할 수 없습니다: '${t}'`, span, check.suggestions ?? []),
      );
    }
  };

  const checkProps = (
    props: PropMap,
    allowed: readonly string[],
    span: Span,
    where: string,
  ): void => {
    for (const key of Object.keys(props)) {
      if (allowed.includes(key)) continue;
      diagnostics.push(
        warning(`${where}에 없는 속성입니다: '${key}'`, span, nearest(key, allowed)),
      );
    }
  };

  /** 열거값 검사 — 값이 있고 허용 목록에 없으면 진단. */
  const checkEnum = (
    props: PropMap,
    key: string,
    allowed: readonly string[],
    span: Span,
    level: 'error' | 'warning' = 'warning',
  ): void => {
    const v = props[key];
    if (v == null) return;
    const s = String(v);
    if (allowed.includes(s)) return;
    const d = level === 'error' ? error : warning;
    diagnostics.push(d(`'${key}' 의 값이 올바르지 않습니다: '${s}'`, span, nearest(s, allowed)));
  };

  const checkColorProp = (props: PropMap, key: string, span: Span, where: string): void => {
    const v = props[key];
    if (v == null) return;
    const s = String(v);
    if (isColorLike(s)) return;
    diagnostics.push(
      warning(
        `${where}의 '${key}' 가 색 토큰도 CSS 색도 아닙니다: '${s}'`,
        span,
        nearest(s, [...DSL_VOCABULARY.colorTokens, ...CSS_COLOR_NAMES]),
      ),
    );
  };

  for (const stmt of ast.statements) {
    switch (stmt.kind) {
      case 'prop':
        validateSceneProp(stmt, diagnostics, useName);
        break;

      case 'entity':
        useName(stmt.name, stmt.span, '엔티티 이름');
        checkProps(stmt.props, ENTITY_PROPS, stmt.span, '엔티티 속성');
        checkEnum(stmt.props, 'borders', BORDERS, stmt.span);
        checkColorProp(stmt.props, 'fill', stmt.span, '엔티티');
        checkColorProp(stmt.props, 'stroke', stmt.span, '엔티티');
        break;

      case 'link':
        useName(stmt.from, stmt.span, '링크 시작점');
        useName(stmt.to, stmt.span, '링크 끝점');
        checkProps(stmt.props, LINK_PROPS, stmt.span, '링크 속성');
        checkEnum(stmt.props, 'type', LINK_TYPES, stmt.span);
        checkEnum(stmt.props, 'anchor', ANCHORS, stmt.span);
        checkEnum(stmt.props, 'labelAt', LABEL_ATS, stmt.span);
        checkEnum(stmt.props, 'head', HEADS, stmt.span);
        checkColorProp(stmt.props, 'color', stmt.span, '링크');
        if (stmt.props.arrow != null && String(stmt.props.arrow) !== 'line') {
          diagnostics.push(
            warning(
              `'arrow: ${String(stmt.props.arrow)}' 는 무시됩니다 — 화살촉은 'head' 로 지정하세요.`,
              stmt.span,
              ['head'],
            ),
          );
        }
        break;

      case 'label':
        if (stmt.target !== 'all') useName(stmt.target, stmt.span, '라벨 대상');
        checkProps(stmt.props, LABEL_PROPS, stmt.span, '라벨 속성');
        if (stmt.props.place != null) {
          diagnostics.push(
            warning("'place' 는 현재 무시됩니다 — 라벨은 항상 centroid 에 놓입니다.", stmt.span),
          );
        }
        break;

      case 'theme':
        checkProps(stmt.props, THEME_KEYS, stmt.span, 'theme 속성');
        for (const k of THEME_KEYS) checkColorProp(stmt.props, k, stmt.span, 'theme');
        break;
    }
  }

  return { ast, diagnostics, ok: !hasError(diagnostics), names };
}

/** scene 레벨 `key: value` 한 줄. */
function validateSceneProp(
  stmt: Extract<Statement, { kind: 'prop' }>,
  diagnostics: Diagnostic[],
  useName: (raw: string, span: Span | undefined, what: string) => void,
): void {
  const { key, raw, span } = stmt;

  // link 계열 키워드 — 'A -> B' 형식이어야 한다.
  if ((LINK_KEYWORDS as readonly string[]).includes(key)) {
    if (!stmt.relation) {
      diagnostics.push(error(`${key} 은 'A -> B' 형식이어야 합니다.`, span));
      return;
    }
    useName(stmt.relation.from, span, '링크 시작점');
    useName(stmt.relation.to, span, '링크 끝점');
    return;
  }

  switch (key) {
    case 'show':
      for (const n of stmt.list ?? [raw]) useName(n, span, '이름');
      return;

    case 'showOnly': {
      const target = (stmt.list ?? [raw])[0]?.trim() ?? '';
      if (!target) return;
      const check = checkName(target);
      if (check.kind === 'unknown') {
        diagnostics.push(error(`showOnly 를 해석할 수 없습니다: '${target}'`, span, check.suggestions ?? []));
      } else if (check.kind !== 'country') {
        diagnostics.push(error(`showOnly 는 단일 국가여야 합니다: '${target}'`, span));
      }
      if ((stmt.list ?? []).length > 1) {
        diagnostics.push(warning('showOnly 는 첫 항목만 사용됩니다 — 나머지는 무시됩니다.', span));
      }
      return;
    }

    case 'layers': {
      const valid = listLayers();
      for (const n of (stmt.list ?? [raw]).map((s) => s.trim()).filter(Boolean)) {
        if (!valid.includes(n)) {
          diagnostics.push(error(`알 수 없는 레이어입니다: '${n}'`, span, nearest(n, valid)));
        }
      }
      return;
    }

    case 'arrange':
      if (!stmt.relation) {
        diagnostics.push(error("arrange 는 'A -> B' 형식이어야 합니다.", span));
        return;
      }
      useName(stmt.relation.from, span, 'arrange 시작점');
      useName(stmt.relation.to, span, 'arrange 끝점');
      return;

    case 'center': {
      const t = raw.trim();
      if (!t) return;
      // 경도 숫자이거나 방위 키워드이면 통과. 그 외에는 엔티티 이름으로 해석된다.
      if (Number.isFinite(Number(t))) return;
      if ((CENTER_KEYWORDS as readonly string[]).includes(t)) return;
      useName(t, span, 'center');
      return;
    }

    case 'fit':
      if (!isValidFit(raw)) {
        diagnostics.push(
          error(
            `fit 값이 올바르지 않습니다: '${raw.trim()}' — ${FIT_MODES.join(' | ')} 또는 [w,s,e,n].`,
            span,
            nearest(raw.trim(), FIT_MODES),
          ),
        );
      }
      return;

    case 'projection': {
      const p = raw.trim();
      if (!(PROJECTIONS as readonly string[]).includes(p)) {
        diagnostics.push(error(`알 수 없는 투영: '${p}'`, span, nearest(p, PROJECTIONS)));
      }
      return;
    }

    default:
      diagnostics.push(
        error(`알 수 없는 scene 속성: '${key}'`, span, nearest(key, SCENE_KEYS)),
      );
  }
}

export { parse, hasError };
export type { Diagnostic, Span } from './diagnostics.js';
export type { Ast } from './ast.js';
export type { NameCheck } from '@geo-insight/data/names';
export { checkName, checkNames, listGroups, listLayers } from '@geo-insight/data/names';
