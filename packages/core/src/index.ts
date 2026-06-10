/**
 * @geoinsight/core — DSL → IR → SVG 컴파일러. 프레임워크/DOM 비종속.
 */

export { compile, type InternalOptions } from './compile.js';
export { parse } from './parser.js';
export { registerExtProjection } from './projection.js';

export type {
  CompileOptions,
  CompileResult,
  Scene,
  SceneMeta,
  Entity,
  Link,
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

export type { Ast, Statement, ScenePropStmt, EntityStmt, LinkStmt, LabelStmt, ThemeStmt } from './ast.js';
export type { Diagnostic, Span } from './diagnostics.js';
export { hasError } from './diagnostics.js';
export { DEFAULT_THEME, COLOR_TOKENS, resolveTheme, resolveColor } from './theme.js';

// 데이터 레이어 재노출 (호스트가 resolver/dataSource 를 주입할 때 편의)
export {
  createResolver,
  createDefaultDataSource,
  type Resolver,
  type DataSource,
  type GeoFeature,
  type ResolveResult,
} from '@geoinsight/data';
