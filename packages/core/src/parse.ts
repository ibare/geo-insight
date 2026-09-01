/**
 * '@geo-insight/core/parse' — 구문 파싱 전용 진입점.
 *
 * 배럴(`@geo-insight/core`)은 컴파일 파이프라인 전체를 끌고 오므로 `@geo-insight/data`
 * (world-atlas 지오메트리 + world-countries 메타 + ADM1 게이저티어)가 그래프에 딸려온다.
 * 문법만 보면 되는 호출자 — 에디터의 실시간 검사, Temporal worker 의 1차 게이트 — 에겐
 * 전부 낭비이고, Node 에서는 그 JSON 들이 import attribute 없이 emit 되어 아예 죽는다.
 *
 * 이 진입점의 그래프는 parser → lexer + diagnostics 셋뿐이다. JSON 0, 동적 import 0,
 * 데이터 패키지 0 — 그래서 번들러 플러그인도 Node 버전도 가리지 않는다.
 *
 * 주의: 여기서 잡히는 것은 **문법뿐**이다. 지명 해석('고구려' 같은 미존재 이름)이나
 * 속성 키·값 검증은 하지 않는다 — 그건 '@geo-insight/core/validate' 의 몫이다.
 */

export { parse } from './parser.js';
export { hasError } from './diagnostics.js';
export type { Diagnostic, Span } from './diagnostics.js';
export type {
  Ast,
  Statement,
  ScenePropStmt,
  EntityStmt,
  LinkStmt,
  LabelStmt,
  ThemeStmt,
  RelationRef,
  Role,
  PropMap,
  PropValue,
} from './ast.js';
