/**
 * 컴파일 파이프라인 오케스트레이션.
 *
 * compile(source) → { svg, scene, diagnostics, meta }. 순수 함수 — DOM/React 비종속.
 * Node 빌드타임에서도 브라우저 런타임에서도 동일하게 동작한다. error 가 있어도 가능한
 * 만큼 부분 렌더(graceful degradation).
 */

import { createDefaultDataSource, createResolver, type DataSource, type Resolver } from '@geoinsight/data';
import type { Ast } from './ast.js';
import { type Diagnostic, warning } from './diagnostics.js';
import { parse } from './parser.js';
import { resolveTheme } from './theme.js';
import type { ProjectionType, Theme } from './types.js';
import { buildScene, type BuiltScene } from './passes/build-scene.js';
import { cameraFromMeta, createCamera } from './passes/camera.js';
import { layoutLabels } from './passes/labels.js';
import { layoutOceans } from './passes/oceans.js';
import { routeLinks } from './passes/links.js';
import { emit, emitContent, type EmitInput } from './passes/emit.js';
import { createLocator, type Locator } from './locate.js';
import type { CompileOptions, CompileResult, Entity, Label, Link, Scene } from './types.js';

/** 기본 투영 — 두 모드 시스템의 기준은 flat(equirectangular). globe 는 orthographic. */
const DEFAULT_PROJECTION: ProjectionType = 'equirectangular';

export interface InternalOptions extends CompileOptions {
  /** 이름 해석기 교체. 기본은 번들 110m. */
  resolver?: Resolver;
  /** 지오메트리 공급원 교체. */
  dataSource?: DataSource;
}

/**
 * 컴파일의 무거운 전반부(parse → resolve → buildScene)를 한 번만 수행한 결과.
 * 런타임이 이 모델을 캐시해 두고 renderModel 로 카메라(rotate)만 바꿔 재투영하면
 * 회전/팬을 parse·resolve·지오메트리 fetch 없이 값싸게 다시 그릴 수 있다.
 */
export interface SceneModel {
  built: BuiltScene;
  theme: Theme;
  dataSource: DataSource;
  resolver: Resolver;
  /** 5대양 isWater 판정용 공유 locator(프레임마다 재생성 방지). */
  locator: Locator;
  width: number;
  height: number;
  precision: number;
  /** parse + build 진단(렌더와 무관, 모델 수준). */
  diagnostics: Diagnostic[];
}

/** parse → theme → buildScene. 카메라/투영 이전까지. */
export function buildModel(source: string, opts: InternalOptions = {}): SceneModel {
  const width = opts.width ?? 960;
  const height = opts.height ?? Math.round(width * 0.6);
  const precision = opts.precision ?? 2;
  const dataSource = opts.dataSource ?? createDefaultDataSource();
  const resolver = opts.resolver ?? createResolver({ dataSource });

  const { ast, diagnostics: parseDiags } = parse(source);
  const diagnostics: Diagnostic[] = [...parseDiags];

  const themeOverride = extractThemeOverride(ast);
  const theme: Theme = resolveTheme({ ...opts.theme, ...themeOverride });

  const built = buildScene(ast, {
    resolver,
    dataSource,
    theme,
    defaultProjection: opts.projection ?? DEFAULT_PROJECTION,
    defaultCenter: opts.center,
  });
  diagnostics.push(...built.diagnostics);

  return {
    built,
    theme,
    dataSource,
    resolver,
    locator: createLocator(dataSource),
    width,
    height,
    precision,
    diagnostics,
  };
}

export interface RenderOptions {
  /**
   * 팬/회전 재투영 — fitExtent 를 건너뛰고 이 파라미터(최초 fit 결과 + 새 rotate)로
   * 카메라를 고정한다. 미지정 시 모델 config 대로 fit.
   */
  fixed?: { rotate: [number, number]; scale: number; translate: [number, number] };
  /** 드래그 재투영 중 — faint world 를 거친 110m 으로(부드러운 회전, 놓으면 50m 스냅). */
  coarse?: boolean;
}

/** 모델 + 카메라 파라미터 → SVG. parse/resolve 없이 카메라 이후 패스만 재실행. */
/** 카메라 이후 모든 패스를 실행해 emit 입력 + IR + meta 를 구성(emit/emitContent 공용). */
function composeScene(
  model: SceneModel,
  opts: RenderOptions,
): { input: EmitInput; scene: Scene; meta: Scene['meta']; diagnostics: Diagnostic[] } {
  const { built, theme, dataSource, resolver, locator, width, height, precision } = model;
  const diagnostics: Diagnostic[] = [...model.diagnostics];

  const entityMap = new Map<string, Entity>(built.entities.map((e) => [e.key, e]));

  // Project & Fit (재투영 시 fixed 로 고정)
  const camera = createCamera(built.entities, built.config, {
    width,
    height,
    precision,
    resolver,
    ...(opts.fixed ? { fixed: opts.fixed } : {}),
  });
  if (camera.fallbackProjection) {
    diagnostics.push(
      warning(
        `투영 '${camera.fallbackProjection}' 을(를) 사용할 수 없어 naturalEarth1 로 대체했습니다. (d3-geo-projection 미설치)`,
      ),
    );
  }

  // Label layout
  const placed = layoutLabels(camera, built.labels, entityMap, theme);

  // Link routing
  const routed = routeLinks(camera, built.links, entityMap);

  // 5대양 라벨 (항상 표시) — unproject/역지오코딩으로 가장자리 끌어오기 보정
  const metaCam = cameraFromMeta(camera.meta);
  const oceans = layoutOceans({
    project: (ll) => camera.project(ll),
    unproject: (xy) => metaCam.unproject(xy),
    width,
    height,
    projType: built.config.projectionType,
    centerLon: -camera.meta.projectionParams.rotate[0],
    isWater: (ll) => locator.locate(ll) === null,
  });

  // Scene IR (툴링/검사용)
  const links: Link[] = built.links.map((l) => {
    const link: Link = {
      from: l.from,
      to: l.to,
      anchor: l.anchor,
      curve: l.curve,
      geodesic: l.geodesic,
      type: l.type,
      labelAt: l.labelAt,
      style: l.style,
    };
    if (l.label) link.label = l.label;
    return link;
  });
  const labels: Label[] = built.labels.map((l) => ({
    text: l.text,
    at: l.at,
    entityKey: l.entityKey,
    collide: l.collide,
  }));
  const scene: Scene = {
    projection: { type: built.config.projectionType, rotate: camera.meta.projectionParams.rotate },
    fit: built.config.fit,
    theme,
    entities: built.entities,
    links,
    labels,
    meta: camera.meta,
  };
  if (built.config.title) scene.title = built.config.title;
  if (built.config.showOnly) scene.showOnly = built.config.showOnly;

  const input: EmitInput = {
    scene,
    camera,
    entities: built.entities,
    links: routed,
    labels: placed,
    oceans,
    theme,
    dataSource,
    ...(opts.coarse ? { coarseWorld: true } : {}),
  };
  return { input, scene, meta: camera.meta, diagnostics };
}

/** 모델 + 카메라 파라미터 → 완전한 SVG(CompileResult). */
export function renderModel(model: SceneModel, opts: RenderOptions = {}): CompileResult {
  const { input, scene, meta, diagnostics } = composeScene(model, opts);
  return { svg: emit(input), scene, diagnostics, meta };
}

/**
 * 모델 + 카메라 파라미터 → gi-content 그룹 내부 마크업만(런타임 회전/팬 재투영용).
 * 런타임은 이 문자열을 기존 svg 의 .gi-content 에 그대로 주입해 리스너·편집 오버레이를
 * 보존한 채 지오메트리만 다시 그린다. 새 scene/meta 도 함께 반환(편집 카메라 갱신용).
 */
export function renderContent(
  model: SceneModel,
  opts: RenderOptions = {},
): { content: string; scene: Scene; meta: Scene['meta']; diagnostics: Diagnostic[] } {
  const { input, scene, meta, diagnostics } = composeScene(model, opts);
  return { content: emitContent(input), scene, meta, diagnostics };
}

/**
 * 컴파일 파이프라인 — buildModel + renderModel. 순수 함수, DOM/React 비종속.
 * 비대화형 사용(마크다운 export 등)은 이 한 함수만 쓰면 된다. 대화형 런타임은
 * buildModel/renderModel 을 직접 호출해 모델을 캐시하고 회전/팬을 값싸게 재투영한다.
 */
export function compile(source: string, opts: InternalOptions = {}): CompileResult {
  return renderModel(buildModel(source, opts));
}

/** theme 블록 속성만 가볍게 추출 (entity 스타일링 전에 최종 테마 확정용). */
function extractThemeOverride(ast: Ast): Partial<Theme> {
  const base = resolveTheme();
  const out: Partial<Theme> = {};
  for (const stmt of ast.statements) {
    if (stmt.kind !== 'theme') continue;
    const p = stmt.props;
    const color = (v: unknown) => base.tokens[String(v)] ?? String(v);
    if (p.ocean != null) out.ocean = color(p.ocean);
    if (p.linkColor != null) out.linkColor = color(p.linkColor);
    if (p.worldFaint != null) out.worldFaint = color(p.worldFaint);
    if (p.graticule != null) out.graticule = color(p.graticule);
  }
  return out;
}
