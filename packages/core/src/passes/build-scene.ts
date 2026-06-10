/**
 * Resolve → Roles/Layers → Geometry 통합 패스.
 *
 * AST 를 받아 이름을 feature 로 해석하고, 역할(group/focus/plain)을 추론·적용하고,
 * z-order 와 구면 centroid/bbox 를 채운 엔티티 목록과 link/label 사양을 만든다.
 */

import { createResolver, normalizeName, type DataSource, type Resolver } from '@geoinsight/data';
import type { Ast, PropMap, Role } from '../ast.js';
import { type Diagnostic, error } from '../diagnostics.js';
import { boundsOf, centroidOf, largestPolygon } from '../geometry.js';
import { resolveColor } from '../theme.js';
import type {
  ArrowHead,
  ArrowStyle,
  Entity,
  FitSpec,
  LinkType,
  ProjectionType,
  ResolvedStyle,
  Theme,
} from '../types.js';

export interface LinkSpec {
  from: string; // entity key
  to: string; // entity key
  anchor: 'border' | 'centroid';
  curve: number;
  geodesic: boolean;
  type: LinkType;
  label?: string;
  labelAt: 'start' | 'mid' | 'end';
  style: ArrowStyle;
}

/** link 계열 scene 키워드 → 타입. (link = arrow 기본) */
const LINK_KEYWORDS: Record<string, LinkType> = {
  link: 'arrow',
  arrow: 'arrow',
  wind: 'wind',
  current: 'current',
  route: 'route',
};

interface LinkDeclEntry {
  from: string;
  to: string;
  props: PropMap;
  span: Diagnostic['span'];
  /** scene 키워드(wind/current 등)에서 온 타입. props.type 보다 우선. */
  type?: LinkType;
  /** 인라인 트레일링 문자열 라벨. props.label 보다 우선. */
  label?: string;
}

export interface LabelSpec {
  text: string;
  entityKey: string;
  at: [number, number];
  collide: boolean;
}

export interface SceneConfig {
  title?: string;
  projectionType: ProjectionType;
  /** center 원시 값 (lon 숫자 문자열 | 엔티티명 | pacific/atlantic). */
  centerRaw?: string;
  arrange?: { from: string; to: string };
  fit: FitSpec;
  /** fit 이 명시적으로 지정됐는지(showOnly 자동 fit 과 구분). */
  fitExplicit?: boolean;
  /** showOnly 대상 — 처음엔 원시 국가명, 해석 후 ccn3 로 치환. */
  showOnly?: string;
  themeOverride: Partial<Theme>;
}

export interface BuiltScene {
  config: SceneConfig;
  entities: Entity[];
  links: LinkSpec[];
  labels: LabelSpec[];
  diagnostics: Diagnostic[];
}

const PROJECTIONS: ReadonlySet<ProjectionType> = new Set<ProjectionType>([
  'naturalEarth1',
  'equirectangular',
  'mercator',
  'orthographic',
  'robinson',
  'winkel3',
]);

export interface BuildOptions {
  resolver?: Resolver;
  /** showOnly 의 ADM1 열거에 사용 (없으면 showOnly 는 ADM0 실루엣으로 폴백). */
  dataSource?: DataSource;
  theme: Theme;
  defaultProjection: ProjectionType;
  defaultCenter?: number | string;
}

export function buildScene(ast: Ast, opts: BuildOptions): BuiltScene {
  const resolver = opts.resolver ?? createResolver();
  const theme = opts.theme;
  const diagnostics: Diagnostic[] = [];

  // 1. AST → scene config + 선언 수집
  const config: SceneConfig = {
    projectionType: opts.defaultProjection,
    fit: { mode: 'dominant' },
    themeOverride: {},
  };
  if (ast.title) config.title = ast.title;
  if (opts.defaultCenter != null) config.centerRaw = String(opts.defaultCenter);

  const showNames: string[] = [];
  const entityDecls: Array<{ role: Role; name: string; props: PropMap; span: Diagnostic['span'] }> = [];
  const linkDecls: LinkDeclEntry[] = [];
  const labelDecls: Array<{ target: string; props: PropMap }> = [];

  for (const stmt of ast.statements) {
    switch (stmt.kind) {
      case 'prop':
        applySceneProp(stmt.key, stmt, config, showNames, linkDecls, diagnostics);
        break;
      case 'entity':
        entityDecls.push({ role: stmt.role, name: stmt.name, props: stmt.props, span: stmt.span });
        break;
      case 'link':
        linkDecls.push({ from: stmt.from, to: stmt.to, props: stmt.props, span: stmt.span });
        break;
      case 'label':
        labelDecls.push({ target: stmt.target, props: stmt.props });
        break;
      case 'theme':
        Object.assign(config.themeOverride, parseThemeProps(stmt.props, theme));
        break;
    }
  }

  // 2. 이름 수집 (안정 순서) — show → entity decl → link 끝점 → arrange 끝점
  const orderedNames: string[] = [];
  const seenName = new Set<string>();
  const pushName = (n: string) => {
    const t = n.trim();
    if (!t) return;
    const k = normalizeName(t);
    if (seenName.has(k)) return;
    seenName.add(k);
    orderedNames.push(t);
  };
  showNames.forEach(pushName);
  entityDecls.forEach((d) => pushName(d.name));
  linkDecls.forEach((d) => {
    pushName(d.from);
    pushName(d.to);
  });
  if (config.arrange) {
    pushName(config.arrange.from);
    pushName(config.arrange.to);
  }

  // 3. 이름 해석 → 엔티티 (key 로 중복 제거, 첫 등장 우선)
  const entitiesByKey = new Map<string, Entity>();
  const keyByName = new Map<string, string>(); // normalizeName(name) → entity key
  const inferredGroupKeys = new Set<string>();

  for (const rawName of orderedNames) {
    const res = resolver.resolve(rawName);
    if (res.kind === 'unknown') {
      diagnostics.push(
        error(`이름을 해석할 수 없습니다: '${rawName}'`, undefined, res.suggestions),
      );
      continue;
    }
    keyByName.set(normalizeName(rawName), res.key);
    if (entitiesByKey.has(res.key)) continue;
    if (res.kind === 'group') inferredGroupKeys.add(res.key);
    const level = levelOf(res.features);
    const ent: Entity = {
      key: res.key,
      display: rawName,
      role: res.kind === 'group' ? 'group' : 'plain',
      features: res.features,
      centroid: [0, 0],
      bbox: [0, 0, 0, 0],
      z: 0,
      level,
      style: neutralStyle(theme),
    };
    if (level > 0 && res.kind === 'adm1') ent.adm0 = res.adm0;
    entitiesByKey.set(res.key, ent);
  }

  // 4. 명시 역할/스타일 적용
  const explicitStyleProps = new Map<string, PropMap>();
  for (const decl of entityDecls) {
    const key = keyByName.get(normalizeName(decl.name));
    if (!key) continue;
    const ent = entitiesByKey.get(key);
    if (!ent) continue;
    ent.role = decl.role;
    explicitStyleProps.set(key, decl.props);
  }

  // 5. 링크 끝점 key 집합 (focus 추론용)
  const linkEndpointKeys = new Set<string>();
  for (const d of linkDecls) {
    const f = keyByName.get(normalizeName(d.from));
    const t = keyByName.get(normalizeName(d.to));
    if (f) linkEndpointKeys.add(f);
    if (t) linkEndpointKeys.add(t);
  }

  // 5.5 showOnly — 대상 국가의 ADM1 을 "격리 캔버스" 로 자동 채움(런던 노선도 스타일).
  //     명시(show/focus)된 ADM1 은 강조색 유지, 나머지는 중립 canvas 면.
  const autoKeys = new Set<string>();
  // 본토(최대 클러스터) 프레임 — 멀리 떨어진 영토(예: 알래스카/하와이)는 프레임 밖.
  let clusterBbox: [number, number, number, number] | null = null;
  if (config.showOnly) {
    const res = resolver.resolve(config.showOnly);
    if (res.kind === 'country') {
      const ccn3 = res.key;
      config.showOnly = ccn3; // 원시 이름 → ccn3
      const subs = opts.dataSource?.adm1(ccn3) ?? [];
      const baseFeatures = subs.length > 0 ? subs : compact([opts.dataSource?.countryByCode(ccn3)]);
      for (const f of baseFeatures) {
        if (entitiesByKey.has(f.id)) continue; // 명시 엔티티 우선
        autoKeys.add(f.id);
        entitiesByKey.set(f.id, {
          key: f.id,
          display: f.properties.kor,
          role: 'plain',
          features: [f],
          centroid: [0, 0],
          bbox: [0, 0, 0, 0],
          z: 0,
          level: (f.properties.level ?? 0) as 0 | 1 | 2,
          adm0: ccn3,
          style: canvasStyle(theme),
        });
      }
      // 본토(국가 ADM0 의 최대 폴리곤) 기준 프레이밍 — 외곽 영토 sprawl 방지.
      const countryFeat = opts.dataSource?.countryByCode(ccn3);
      const dom = countryFeat ? largestPolygon([countryFeat]) : null;
      if (dom) clusterBbox = boundsOf([dom]);
      if (!config.fitExplicit) {
        config.fit = clusterBbox ? { mode: 'bbox', bbox: clusterBbox } : { mode: 'entities' };
      }
      if (!config.centerRaw) {
        const c = dom ? centroidOf([dom]) : centroidOf(baseFeatures);
        if (Number.isFinite(c[0])) config.centerRaw = String(Math.round(c[0]));
      }
    } else {
      diagnostics.push(error(`showOnly 는 단일 국가여야 합니다: '${config.showOnly}'`));
      config.showOnly = undefined;
    }
  }

  // 6. 역할 추론 + z-order + 스타일 + 7. geometry
  const entities = [...entitiesByKey.values()];
  let groupIdx = 0;
  let focusIdx = 0;
  entities.forEach((ent, i) => {
    // showOnly 자동 캔버스 — 맨 아래에 깔고 canvas 스타일 유지(역할/스타일 재계산 skip).
    if (autoKeys.has(ent.key)) {
      ent.z = -100000 + i;
      ent.centroid = centroidOf(ent.features);
      ent.bbox = boundsOf(ent.features);
      // 본토 프레임 밖(예: 알래스카/하와이)은 라벨 생략 — 가장자리로 클램프되는 것 방지.
      if (clusterBbox && !pointInBbox(ent.centroid, clusterBbox, 0.15)) ent.style.label = false;
      return;
    }
    const explicit = explicitStyleProps.has(ent.key);
    if (!explicit) {
      // 추론: group(대륙/권역) → group, link 끝점 → focus, 그 외 plain
      if (inferredGroupKeys.has(ent.key)) ent.role = 'group';
      else if (linkEndpointKeys.has(ent.key)) ent.role = 'focus';
      else ent.role = 'plain';
    }
    // z: group(0) < plain(1) < focus(2). 동순위는 등장 인덱스로 안정화.
    const base = ent.role === 'group' ? 0 : ent.role === 'focus' ? 2 : 1;
    ent.z = base * 1000 + i;

    // 스타일 기본값(역할별, ADM1 구분) → 명시 props 오버라이드
    ent.style = defaultStyleFor(ent.role, theme, ent.role === 'group' ? groupIdx : focusIdx, ent.level);
    if (ent.role === 'group') groupIdx++;
    if (ent.role === 'focus') focusIdx++;
    const props = explicitStyleProps.get(ent.key);
    if (props) applyStyleProps(ent.style, props, theme);

    // geometry
    ent.centroid = centroidOf(ent.features);
    ent.bbox = boundsOf(ent.features);
  });
  // 그리기 순서: z 오름차순 (group 아래, focus 위). 부분집합 focus 는 group 다음에 자연히 온다.
  entities.sort((a, b) => a.z - b.z);

  // 8. 링크 사양
  const links: LinkSpec[] = [];
  for (const d of linkDecls) {
    const from = keyByName.get(normalizeName(d.from));
    const to = keyByName.get(normalizeName(d.to));
    if (!from || !to) {
      diagnostics.push(error(`링크 끝점을 해석할 수 없습니다: '${d.from} -> ${d.to}'`, d.span));
      continue;
    }
    const type = d.type ?? toLinkType(str(d.props.type)) ?? 'arrow';
    const label = d.label ?? str(d.props.label);
    const labelAt = toLabelAt(str(d.props.labelAt));
    const spec: LinkSpec = {
      from,
      to,
      anchor: (str(d.props.anchor) as 'border' | 'centroid') ?? 'border',
      curve: num(d.props.curve, 0.25),
      geodesic: bool(d.props.geodesic, false),
      type,
      labelAt,
      style: arrowStyleFrom(d.props, theme, type),
    };
    if (label) spec.label = label;
    links.push(spec);
  }

  // 9. 라벨 사양
  const labels: LabelSpec[] = [];
  const labelTargets = labelDecls.length > 0 ? labelDecls : [{ target: 'all', props: {} as PropMap }];
  for (const decl of labelTargets) {
    const collide = bool(decl.props.collide, true);
    if (decl.target === 'all') {
      for (const ent of entities) {
        if (!ent.style.label) continue;
        labels.push({ text: ent.display, entityKey: ent.key, at: ent.centroid, collide });
      }
    } else {
      const key = keyByName.get(normalizeName(decl.target));
      const ent = key ? entitiesByKey.get(key) : undefined;
      if (ent) labels.push({ text: ent.display, entityKey: ent.key, at: ent.centroid, collide });
    }
  }

  return { config, entities, links, labels, diagnostics };
}

// ── scene prop 적용 ─────────────────────────────────────────────────────────

function applySceneProp(
  key: string,
  stmt: { raw: string; list?: string[]; relation?: { from: string; to: string }; label?: string; span: Diagnostic['span'] },
  config: SceneConfig,
  showNames: string[],
  linkDecls: LinkDeclEntry[],
  diagnostics: Diagnostic[],
): void {
  // link 계열 키워드(link/wind/current/route) → 해당 타입의 링크
  const linkType = LINK_KEYWORDS[key];
  if (linkType) {
    if (stmt.relation) {
      const entry: LinkDeclEntry = {
        from: stmt.relation.from,
        to: stmt.relation.to,
        props: {},
        span: stmt.span,
        type: linkType,
      };
      if (stmt.label) entry.label = stmt.label;
      linkDecls.push(entry);
    } else {
      diagnostics.push(error(`${key} 은 'A -> B' 형식이어야 합니다.`, stmt.span));
    }
    return;
  }
  switch (key) {
    case 'show':
      (stmt.list ?? [stmt.raw]).forEach((n) => showNames.push(n));
      break;
    case 'showOnly':
      // 단일 국가만 — 원시 이름 저장(후속에서 ccn3 로 해석). 첫 항목만.
      config.showOnly = (stmt.list ?? [stmt.raw])[0]?.trim();
      break;
    case 'arrange':
      if (stmt.relation) config.arrange = stmt.relation;
      break;
    case 'center':
      config.centerRaw = stmt.raw;
      break;
    case 'fit':
      config.fit = parseFit(stmt.raw);
      config.fitExplicit = true;
      break;
    case 'projection': {
      const p = stmt.raw.trim() as ProjectionType;
      if (PROJECTIONS.has(p)) config.projectionType = p;
      else diagnostics.push(error(`알 수 없는 투영: '${stmt.raw}'`, stmt.span));
      break;
    }
    default:
      diagnostics.push(error(`알 수 없는 scene 속성: '${key}'`, stmt.span));
  }
}

function parseFit(raw: string): FitSpec {
  const t = raw.trim();
  if (t === 'entities' || t === 'dominant' || t === 'world') return { mode: t };
  const nums = t.match(/-?\d+(?:\.\d+)?/g);
  if (nums && nums.length === 4) {
    const [w, s, e, n] = nums.map(Number) as [number, number, number, number];
    return { mode: 'bbox', bbox: [w, s, e, n] };
  }
  return { mode: 'dominant' };
}

// ── 스타일 ──────────────────────────────────────────────────────────────────

function neutralStyle(theme: Theme): ResolvedStyle {
  return { fill: theme.worldFaint, stroke: theme.worldStroke, borders: true, label: true, opacity: 1 };
}

/** showOnly 격리 모드의 미선택 행정구역 면(중립 패널 + 또렷한 경계). */
function canvasStyle(theme: Theme): ResolvedStyle {
  return {
    fill: theme.subdivision.canvasFill,
    stroke: theme.subdivision.canvasStroke,
    borders: true,
    label: true,
    opacity: 1,
  };
}

function compact<T>(arr: (T | undefined)[]): T[] {
  return arr.filter((x): x is T => x != null);
}

/** 점이 bbox[w,s,e,n] 안(margin 비율만큼 확장)에 있는지. */
function pointInBbox(
  [lon, lat]: [number, number],
  [w, s, e, n]: [number, number, number, number],
  margin: number,
): boolean {
  const mx = (e - w) * margin;
  const my = (n - s) * margin;
  return lon >= w - mx && lon <= e + mx && lat >= s - my && lat <= n + my;
}

/** feature 집합의 행정 레벨 (가장 큰 값). 국가=0, ADM1=1, ADM2=2. */
function levelOf(features: { properties: { level?: 0 | 1 | 2 } }[]): 0 | 1 | 2 {
  let lvl: 0 | 1 | 2 = 0;
  for (const f of features) {
    const l = f.properties.level ?? 0;
    if (l > lvl) lvl = l;
  }
  return lvl;
}

function defaultStyleFor(role: Role, theme: Theme, idx: number, level: 0 | 1 | 2 = 0): ResolvedStyle {
  // ADM1/2 가 plain 으로 추론되면 국가 슬레이트가 아니라 강조색으로 — 국가 배경과 구분.
  if (role === 'plain' && level > 0) {
    return { fill: theme.subdivision.fill, stroke: theme.subdivision.stroke, borders: true, label: true, opacity: 1 };
  }
  if (role === 'group') {
    return {
      fill: theme.groupPalette[idx % theme.groupPalette.length]!,
      stroke: theme.worldStroke,
      borders: true,
      label: true,
      opacity: 1,
    };
  }
  if (role === 'focus') {
    // 관계의 양 끝점은 같은 강조색(coral)으로 — 링크색(teal)과 구분. idx 무시.
    return {
      fill: theme.focusAccent[0]!,
      stroke: theme.worldStroke,
      borders: true,
      label: true,
      opacity: 1,
    };
  }
  return { fill: theme.tokens.slate!, stroke: theme.worldStroke, borders: true, label: true, opacity: 1 };
}

function applyStyleProps(style: ResolvedStyle, props: PropMap, theme: Theme): void {
  if (props.fill != null) style.fill = resolveColor(String(props.fill), theme);
  if (props.stroke != null) style.stroke = resolveColor(String(props.stroke), theme);
  if (props.borders != null) {
    const b = String(props.borders);
    style.borders = b === 'keep' || b === 'true';
  }
  if (props.label != null) {
    const l = String(props.label);
    style.label = !(l === 'false' || l === 'none' || l === 'off');
  }
  if (props.opacity != null && typeof props.opacity === 'number') style.opacity = props.opacity;
}

function toLinkType(v: string | undefined): LinkType | undefined {
  if (v && v in LINK_KEYWORDS) return LINK_KEYWORDS[v];
  return undefined;
}

function toLabelAt(v: string | undefined): 'start' | 'mid' | 'end' {
  return v === 'start' || v === 'end' ? v : 'mid';
}

function mapHead(v: string | undefined): ArrowHead | undefined {
  if (!v) return undefined;
  if (v === 'taper' || v === 'wedge') return 'taper';
  if (v === 'triangle') return 'triangle';
  if (v === 'none' || v === 'line') return 'none';
  return undefined;
}

/** 타입별 기본 외형 + props 오버라이드(color/head). */
function arrowStyleFrom(props: PropMap, theme: Theme, type: LinkType): ArrowStyle {
  const color = props.color != null ? resolveColor(String(props.color), theme) : theme.linkColor;
  let head: ArrowHead;
  let widthStart: number;
  let widthEnd: number;
  let dash: number[] | undefined;
  switch (type) {
    case 'wind':
      head = 'triangle';
      widthStart = 2;
      widthEnd = 2;
      dash = [7, 5];
      break;
    case 'current':
      head = 'triangle';
      widthStart = 2.5;
      widthEnd = 2.5;
      break;
    case 'route':
      head = 'none';
      widthStart = 1.5;
      widthEnd = 1.5;
      dash = [2, 5];
      break;
    case 'arrow':
    default:
      // 하위호환: arrow: line → head none(가는 선)
      head = str(props.arrow) === 'line' ? 'none' : 'taper';
      widthStart = head === 'taper' ? 1.5 : 2;
      widthEnd = head === 'taper' ? 6 : 2;
      break;
  }
  const overrideHead = mapHead(str(props.head));
  if (overrideHead) head = overrideHead;
  const style: ArrowStyle = { color, widthStart, widthEnd, headLength: 14, headWidth: 12, head };
  if (dash) style.dash = dash;
  return style;
}

function parseThemeProps(props: PropMap, theme: Theme): Partial<Theme> {
  const out: Partial<Theme> = {};
  if (props.ocean != null) out.ocean = resolveColor(String(props.ocean), theme);
  if (props.linkColor != null) out.linkColor = resolveColor(String(props.linkColor), theme);
  if (props.worldFaint != null) out.worldFaint = resolveColor(String(props.worldFaint), theme);
  if (props.graticule != null) out.graticule = resolveColor(String(props.graticule), theme);
  return out;
}

// ── prop 코어션 ───────────────────────────────────────────────────────────

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function num(v: unknown, fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}
function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v === 'true';
  return fallback;
}
