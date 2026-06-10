/**
 * 구문 AST — Parse 패스 출력. 의미 없음(이름 해석·역할 추론 전).
 */

import type { Span } from './diagnostics.js';

export type Role = 'group' | 'focus' | 'plain';

/** 브레이스 블록 `{ k: v, ... }` 의 스칼라 속성 맵. */
export type PropValue = string | number | boolean;
export type PropMap = Record<string, PropValue>;

export interface RelationRef {
  from: string;
  to: string;
}

/** scene 레벨 `key: value` (show/link/center/arrange/fit/projection 등). */
export interface ScenePropStmt {
  kind: 'prop';
  key: string;
  /** 원시 값 텍스트 (콜론 이후, 개행 전). 해석은 후속 패스. */
  raw: string;
  /** show 처럼 콤마 리스트면 분해된 이름들. 아니면 undefined. */
  list?: string[];
  /** link/arrange 처럼 `A -> B` 면 분해. 아니면 undefined. */
  relation?: RelationRef;
  /** 관계 뒤 트레일링 문자열 = 링크 라벨 (예: `link: A -> B "무역풍"`). */
  label?: string;
  span: Span;
}

export interface EntityStmt {
  kind: 'entity';
  role: Role;
  name: string;
  props: PropMap;
  span: Span;
}

export interface LinkStmt {
  kind: 'link';
  from: string;
  to: string;
  props: PropMap;
  span: Span;
}

export interface LabelStmt {
  kind: 'label';
  /** 'all' 또는 엔티티 이름. */
  target: string;
  props: PropMap;
  span: Span;
}

export interface ThemeStmt {
  kind: 'theme';
  props: PropMap;
  span: Span;
}

export type Statement = ScenePropStmt | EntityStmt | LinkStmt | LabelStmt | ThemeStmt;

export interface Ast {
  /** `earth "title":` 의 title. 없으면 undefined. */
  title?: string;
  statements: Statement[];
}
