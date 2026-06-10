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
import type { Theme } from './types.js';
import { buildScene } from './passes/build-scene.js';
import { createCamera } from './passes/camera.js';
import { layoutLabels } from './passes/labels.js';
import { routeLinks } from './passes/links.js';
import { emit } from './passes/emit.js';
import type { CompileOptions, CompileResult, Entity, Label, Link, Scene } from './types.js';

export interface InternalOptions extends CompileOptions {
  /** 이름 해석기 교체. 기본은 번들 110m. */
  resolver?: Resolver;
  /** 지오메트리 공급원 교체. */
  dataSource?: DataSource;
}

export function compile(source: string, opts: InternalOptions = {}): CompileResult {
  const width = opts.width ?? 960;
  const height = opts.height ?? Math.round(width * 0.6);
  const precision = opts.precision ?? 2;
  const dataSource = opts.dataSource ?? createDefaultDataSource();
  const resolver = opts.resolver ?? createResolver({ dataSource });

  // Parse
  const { ast, diagnostics: parseDiags } = parse(source);
  const diagnostics: Diagnostic[] = [...parseDiags];

  // theme: DSL theme 블록 + 옵션 병합 후 최종 해석
  const themeOverride = extractThemeOverride(ast);
  const theme: Theme = resolveTheme({ ...opts.theme, ...themeOverride });

  // Resolve → Roles → Geometry
  const built = buildScene(ast, {
    resolver,
    theme,
    defaultProjection: opts.projection ?? 'naturalEarth1',
    defaultCenter: opts.center,
  });
  diagnostics.push(...built.diagnostics);

  const entityMap = new Map<string, Entity>(built.entities.map((e) => [e.key, e]));

  // Project & Fit
  const camera = createCamera(built.entities, built.config, {
    width,
    height,
    precision,
    resolver,
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

  // Scene IR (툴링/검사용)
  const links: Link[] = built.links.map((l) => ({
    from: l.from,
    to: l.to,
    anchor: l.anchor,
    curve: l.curve,
    geodesic: l.geodesic,
    style: l.style,
  }));
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

  // Emit
  const svg = emit({ scene, camera, entities: built.entities, links: routed, labels: placed, theme, dataSource });

  return { svg, scene, diagnostics, meta: camera.meta };
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
