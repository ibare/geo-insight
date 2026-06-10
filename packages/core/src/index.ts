/**
 * @geoinsight/core — DSL → IR → SVG 컴파일러. 프레임워크/DOM 비종속.
 */

export { compile, type InternalOptions } from './compile.js';
export { parse } from './parser.js';
export { registerExtProjection } from './projection.js';
export { cameraFromMeta, type MetaCamera } from './passes/camera.js';
export { createLocator, type Locator, type LocatedCountry } from './locate.js';
export {
  addShowName,
  removeShowName,
  hasShowName,
  addLink,
  removeLink,
  setLinkType,
  setLinkLabel,
  setCenter,
} from './edit.js';

export type {
  CompileOptions,
  CompileResult,
  Scene,
  SceneMeta,
  Entity,
  Link,
  LinkType,
  ArrowHead,
  Label,
  Role,
  ProjSpec,
  ProjectionType,
  FitSpec,
  FitMode,
  ResolvedStyle,
  ArrowStyle,
  Theme,
  ResolvedTheme,
} from './types.js';

export { registerLinkRenderer, type LinkRenderer, type LinkGeometry, type RoutedPath } from './passes/links.js';

export type { Ast, Statement, ScenePropStmt, EntityStmt, LinkStmt, LabelStmt, ThemeStmt } from './ast.js';
export type { Diagnostic, Span } from './diagnostics.js';
export { hasError } from './diagnostics.js';
export { DEFAULT_THEME, COLOR_TOKENS, resolveTheme, resolveColor } from './theme.js';

// 데이터 레이어 재노출 (호스트가 resolver/dataSource 를 주입할 때 편의)
export {
  createResolver,
  createDefaultDataSource,
  GROUP_DEFS,
  type Resolver,
  type SearchHit,
  type DataSource,
  type GeoFeature,
  type ResolveResult,
  type GroupDef,
} from '@geoinsight/data';
