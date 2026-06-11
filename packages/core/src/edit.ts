/**
 * DSL 텍스트 패치 헬퍼.
 *
 * 편집 UI(국가 클릭 추가/제거 등)가 소스 of truth 인 DSL 문자열을 변형할 때 쓴다.
 * AST 재직렬화 대신 *타겟 텍스트 패치*로 구현 — show/link 라인만 수정해 사용자
 * 포맷·주석·명시형 블록을 그대로 보존한다(결정성·diffable 원칙).
 *
 * 이름 비교는 normalizeName(공백/하이픈 제거 + 소문자)으로 — 'United States' ↔
 * 'unitedstates' 같은 표기 차이를 흡수.
 */

import { normalizeName } from '@geoinsight/data';

const HEADER_RE = /^\s*earth\b/;

function splitLines(source: string): string[] {
  return source.split('\n');
}

/** 들여쓴 첫 statement 라인의 들여쓰기. 없으면 2칸. */
function detectIndent(lines: string[]): string {
  for (const line of lines) {
    const m = /^(\s+)\S/.exec(line);
    if (m && !HEADER_RE.test(line)) return m[1]!;
  }
  return '  ';
}

function headerIndex(lines: string[]): number {
  const i = lines.findIndex((l) => HEADER_RE.test(l));
  return i >= 0 ? i : 0;
}

/** `key: a, b, c` 형태 scene-prop 라인의 인덱스. */
function findPropLine(lines: string[], key: string): number {
  const re = new RegExp(`^\\s*${key}\\s*:`);
  return lines.findIndex((l) => re.test(l));
}

function parseList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function insertAfter(lines: string[], index: number, line: string): void {
  lines.splice(index + 1, 0, line);
}

/** show 리스트에 name 추가(이미 있으면 그대로). */
export function addShowName(source: string, name: string): string {
  const target = name.trim();
  if (!target) return source;
  const lines = splitLines(source);
  const indent = detectIndent(lines);
  const showIdx = findPropLine(lines, 'show');

  if (showIdx >= 0) {
    const colon = lines[showIdx]!.indexOf(':');
    const value = lines[showIdx]!.slice(colon + 1);
    const names = parseList(value);
    const norm = normalizeName(target);
    if (names.some((n) => normalizeName(n) === norm)) return source;
    names.push(target);
    lines[showIdx] = `${indent}show: ${names.join(', ')}`;
    return lines.join('\n');
  }

  // show 라인 없음 → 헤더 다음에 삽입
  insertAfter(lines, headerIndex(lines), `${indent}show: ${target}`);
  return lines.join('\n');
}

/**
 * 엔티티를 완전히 제거 — show 리스트 항목 + 명시형 엔티티 선언 라인 +
 * 해당 이름을 참조하는 단일 라인 link scene-prop 까지.
 */
export function removeShowName(source: string, name: string): string {
  const norm = normalizeName(name.trim());
  if (!norm) return source;
  let lines = splitLines(source);

  // 1. show 리스트에서 제거
  const showIdx = findPropLine(lines, 'show');
  if (showIdx >= 0) {
    const indent = /^(\s*)/.exec(lines[showIdx]!)![1]!;
    const colon = lines[showIdx]!.indexOf(':');
    const names = parseList(lines[showIdx]!.slice(colon + 1)).filter(
      (n) => normalizeName(n) !== norm,
    );
    if (names.length === 0) {
      lines.splice(showIdx, 1);
    } else {
      lines[showIdx] = `${indent}show: ${names.join(', ')}`;
    }
  }

  // 2. 명시형 엔티티 선언 라인 제거: `group|focus|plain <name> ...`
  lines = lines.filter((l) => {
    const m = /^\s*(group|focus|plain)\s+(.+?)(\s*\{.*)?$/.exec(l);
    if (!m) return true;
    return normalizeName(m[2]!.trim()) !== norm;
  });

  // 3. 이름을 참조하는 단일 라인 link scene-prop 제거: `link: A -> B`
  lines = lines.filter((l) => {
    const m = /^\s*link\s*:\s*(.+?)\s*->\s*(.+?)\s*$/.exec(l);
    if (!m) return true;
    return normalizeName(m[1]!) !== norm && normalizeName(m[2]!) !== norm;
  });

  return lines.join('\n');
}

/** show 리스트에 name 이 있는지(정규화 비교). */
export function hasShowName(source: string, name: string): boolean {
  const lines = splitLines(source);
  const showIdx = findPropLine(lines, 'show');
  if (showIdx < 0) return false;
  const colon = lines[showIdx]!.indexOf(':');
  const norm = normalizeName(name);
  return parseList(lines[showIdx]!.slice(colon + 1)).some((n) => normalizeName(n) === norm);
}

/** `link: from -> to` 추가(이미 있으면 그대로). */
export function addLink(source: string, from: string, to: string): string {
  const f = from.trim();
  const t = to.trim();
  if (!f || !t) return source;
  const lines = splitLines(source);
  const indent = detectIndent(lines);
  const nf = normalizeName(f);
  const nt = normalizeName(t);
  const exists = lines.some((l) => {
    const m = /^\s*link\s*:\s*(.+?)\s*->\s*(.+?)\s*$/.exec(l);
    return m != null && normalizeName(m[1]!) === nf && normalizeName(m[2]!) === nt;
  });
  if (exists) return source;
  // show 라인 다음, 없으면 헤더 다음에 삽입
  const showIdx = findPropLine(lines, 'show');
  const anchor = showIdx >= 0 ? showIdx : headerIndex(lines);
  insertAfter(lines, anchor, `${indent}link: ${f} -> ${t}`);
  return lines.join('\n');
}

/**
 * 중앙 자오선(center) 설정 — 회전 기즈모용. 경도(정수)를 center 라인에 기록한다.
 * 수동 center 는 arrange 보다 우선이어야 하므로(build-scene 은 arrange 를 먼저 봄)
 * 기존 arrange 라인을 제거한다.
 */
export function setCenter(source: string, lon: number): string {
  const v = Math.round(((((lon + 180) % 360) + 360) % 360) - 180); // wrap[-180,180]
  const lines = splitLines(source).filter((l) => !/^\s*arrange\s*:/.test(l));
  const idx = findPropLine(lines, 'center');
  if (idx >= 0) {
    const ind = /^(\s*)/.exec(lines[idx]!)![1]!;
    lines[idx] = `${ind}center: ${v}`;
  } else {
    insertAfter(lines, headerIndex(lines), `${detectIndent(lines)}center: ${v}`);
  }
  return lines.join('\n');
}

/**
 * showOnly(격리) 진입 — 대상 국가를 showOnly 로 설정. 그 국가가 ADM0 엔티티로
 * 중복 렌더되지 않게 show 리스트에서 빼고, 세계 뷰용 center/fit/arrange 를 제거해
 * 대상 국가에 자동 프레이밍되게 한다.
 */
export function setShowOnly(source: string, name: string): string {
  const target = name.trim();
  if (!target) return source;
  const norm = normalizeName(target);
  let lines = splitLines(source);

  // 1. show 리스트에서 대상 제거(없으면 그대로).
  const showIdx = findPropLine(lines, 'show');
  if (showIdx >= 0) {
    const ind = /^(\s*)/.exec(lines[showIdx]!)![1]!;
    const colon = lines[showIdx]!.indexOf(':');
    const names = parseList(lines[showIdx]!.slice(colon + 1)).filter((n) => normalizeName(n) !== norm);
    if (names.length === 0) lines.splice(showIdx, 1);
    else lines[showIdx] = `${ind}show: ${names.join(', ')}`;
  }

  // 2. 세계 뷰 프레이밍 prop 제거 → 대상 국가 자동 프레이밍.
  lines = lines.filter((l) => !/^\s*(center|fit|arrange)\s*:/.test(l));

  // 3. showOnly 라인 설정/교체.
  const idx = findPropLine(lines, 'showOnly');
  if (idx >= 0) {
    const ind = /^(\s*)/.exec(lines[idx]!)![1]!;
    lines[idx] = `${ind}showOnly: ${target}`;
  } else {
    insertAfter(lines, headerIndex(lines), `${detectIndent(lines)}showOnly: ${target}`);
  }
  return lines.join('\n');
}

/**
 * 투영 설정 — flat(equirectangular) ↔ globe(orthographic) 모드 토글용.
 * projection 라인을 설정/교체한다(없으면 헤더 다음 삽입). 회전/팬은 휘발 상태라
 * DSL 에 기록하지 않으므로 모드 전환만 소스에 남는다.
 */
export function setProjection(source: string, type: string): string {
  const lines = splitLines(source);
  const idx = findPropLine(lines, 'projection');
  if (idx >= 0) {
    const ind = /^(\s*)/.exec(lines[idx]!)![1]!;
    lines[idx] = `${ind}projection: ${type}`;
  } else {
    insertAfter(lines, headerIndex(lines), `${detectIndent(lines)}projection: ${type}`);
  }
  return lines.join('\n');
}

/** showOnly(격리) 해제 — showOnly 라인 제거(세계 뷰로 복귀). */
export function removeShowOnly(source: string): string {
  return splitLines(source)
    .filter((l) => !/^\s*showOnly\s*:/.test(l))
    .join('\n');
}

/** link 계열 키워드(인라인). */
const LINK_KEYWORD_RE = /^(\s*)(link|arrow|wind|current|route)\s*:\s*(.*)$/;
const LINK_TYPE_TO_KEYWORD: Record<string, string> = {
  arrow: 'link',
  wind: 'wind',
  current: 'current',
  route: 'route',
};

interface InlineLink {
  indent: string;
  keyword: string;
  from: string;
  to: string;
  label?: string;
}

/** 인라인 링크 라인 파싱 (`keyword: A -> B "label"`). */
function parseInlineLink(line: string): InlineLink | null {
  const m = LINK_KEYWORD_RE.exec(line);
  if (!m) return null;
  let rest = m[3]!.trim();
  let label: string | undefined;
  const qm = /\s*"([^"]*)"\s*$/.exec(rest);
  if (qm) {
    label = qm[1];
    rest = rest.slice(0, qm.index).trim();
  }
  const am = /^(.+?)\s*->\s*(.+)$/.exec(rest);
  if (!am) return null;
  const out: InlineLink = { indent: m[1]!, keyword: m[2]!, from: am[1]!.trim(), to: am[2]!.trim() };
  if (label !== undefined) out.label = label;
  return out;
}

function buildInlineLink(l: InlineLink, keyword: string, label: string | undefined): string {
  const tail = label ? ` "${label}"` : '';
  return `${l.indent}${keyword}: ${l.from} -> ${l.to}${tail}`;
}

/** from→to 인라인 링크 라인을 찾아 변형. 못 찾으면(블록형 등) 원본 유지. */
function patchInlineLink(
  source: string,
  from: string,
  to: string,
  fn: (l: InlineLink) => string,
): string {
  const nf = normalizeName(from);
  const nt = normalizeName(to);
  const lines = splitLines(source);
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseInlineLink(lines[i]!);
    if (parsed && normalizeName(parsed.from) === nf && normalizeName(parsed.to) === nt) {
      lines[i] = fn(parsed);
      return lines.join('\n');
    }
  }
  return source;
}

/** 링크 타입 변경(키워드 교체, 라벨 보존). type: arrow|wind|current|route. */
export function setLinkType(source: string, from: string, to: string, type: string): string {
  const keyword = LINK_TYPE_TO_KEYWORD[type] ?? 'link';
  return patchInlineLink(source, from, to, (l) => buildInlineLink(l, keyword, l.label));
}

/** 링크 라벨 설정/변경/제거(빈 문자열이면 제거, 키워드/타입 보존). */
export function setLinkLabel(source: string, from: string, to: string, label: string): string {
  const trimmed = label.trim();
  return patchInlineLink(source, from, to, (l) => buildInlineLink(l, l.keyword, trimmed || undefined));
}

/** `link: from -> to` (또는 wind/current/route 인라인) 제거. */
export function removeLink(source: string, from: string, to: string): string {
  const nf = normalizeName(from);
  const nt = normalizeName(to);
  const lines = splitLines(source).filter((l) => {
    const parsed = parseInlineLink(l);
    if (!parsed) return true;
    return !(normalizeName(parsed.from) === nf && normalizeName(parsed.to) === nt);
  });
  return lines.join('\n');
}
