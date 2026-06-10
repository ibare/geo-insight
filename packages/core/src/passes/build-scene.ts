/**
 * Resolve → Roles/Layers → Geometry 통합 패스.
 *
 * AST 를 받아 이름을 feature 로 해석하고, 역할(group/focus/plain)을 추론·적용하고,
 * z-order 와 구면 centroid/bbox 를 채운 엔티티 목록과 link/label 사양을 만든다.
 */

import { createResolver, normalizeName, type Resolver } from '@geoinsight/data';
import type { Ast, PropMap, Role } from '../ast.js';
import { type Diagnostic, error } from '../diagnostics.js';
import { boundsOf, centroidOf } from '../geometry.js';
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
    entitiesByKey.set(res.key, {
      key: res.key,
      display: rawName,
      role: res.kind === 'group' ? 'group' : 'plain',
      features: res.features,
      centroid: [0, 0],
      bbox: [0, 0, 0, 0],
      z: 0,
      style: neutralStyle(theme),
    });
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

  // 6. 역할 추론 + z-order + 스타일 + 7. geometry
  const entities = [...entitiesByKey.values()];
  let groupIdx = 0;
  let focusIdx = 0;
  entities.forEach((ent, i) => {
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

    // 스타일 기본값(역할별) → 명시 props 오버라이드
    ent.style = defaultStyleFor(ent.role, theme, ent.role === 'group' ? groupIdx : focusIdx);
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
    case 'arrange':
      if (stmt.relation) config.arrange = stmt.relation;
      break;
    case 'center':
      config.centerRaw = stmt.raw;
      break;
    case 'fit':
      config.fit = parseFit(stmt.raw);
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

function defaultStyleFor(role: Role, theme: Theme, idx: number): ResolvedStyle {
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
