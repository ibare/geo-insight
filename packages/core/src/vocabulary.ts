/**
 * DSL 어휘 — 키·열거값·기본값의 단일 출처.
 *
 * validate(검사)와 spec(문서 생성)이 **같은 상수**를 읽는다. 그래서 어휘가 바뀌면 검사와
 * 문서가 함께 움직이고, 문서만 낡는 드리프트가 구조적으로 불가능하다.
 *
 * 여기 적힌 값은 README 가 아니라 **build-scene.ts 의 실동작** 기준이다. 둘이 어긋나면
 * 실동작이 맞다 — 이 표를 쓰는 쪽은 LLM 이고, LLM 에게는 "문서상 되는 것"이 아니라
 * "실제로 되는 것"만 의미가 있다.
 *
 * 데이터 의존이 없다(theme 의 색 토큰만 참조). 그래서 이 모듈은 어디서든 값싸게 쓸 수 있다.
 */

import { COLOR_TOKENS } from './theme.js';

/** link 계열 scene 키워드 — build-scene 의 LINK_KEYWORDS 와 일치해야 한다. */
export const LINK_KEYWORDS = ['link', 'arrow', 'wind', 'current', 'route'] as const;

/** scene 레벨 키 전량. */
export const SCENE_KEYS = [
  'show',
  'showOnly',
  'layers',
  'center',
  'arrange',
  'fit',
  'projection',
  ...LINK_KEYWORDS,
] as const;

export const ENTITY_PROPS = ['fill', 'stroke', 'borders', 'label', 'opacity'] as const;

export const LINK_PROPS = [
  'type',
  'label',
  'labelAt',
  'head',
  'curve',
  'color',
  'anchor',
  'geodesic',
  // 하위호환 별칭 — 값이 'line' 일 때만 의미가 있고 그 외는 무시된다.
  'arrow',
] as const;

export const LABEL_PROPS = ['collide', 'place'] as const;
export const THEME_KEYS = ['ocean', 'linkColor', 'worldFaint', 'graticule'] as const;

export const PROJECTIONS = [
  'naturalEarth1',
  'equirectangular',
  'mercator',
  'orthographic',
  'robinson',
  'winkel3',
] as const;
export const FIT_MODES = ['entities', 'dominant', 'world'] as const;
export const ANCHORS = ['border', 'centroid'] as const;
export const LABEL_ATS = ['start', 'mid', 'end'] as const;
export const HEADS = ['taper', 'wedge', 'triangle', 'none', 'line'] as const;
export const BORDERS = ['keep', 'true', 'false'] as const;
export const LINK_TYPES = ['arrow', 'wind', 'current', 'route'] as const;
export const ROLES = ['group', 'focus', 'plain'] as const;

/** center 의 방위 키워드. 그 외에는 경도 숫자이거나 엔티티 이름이다. */
export const CENTER_KEYWORDS = ['pacific', '태평양', 'atlantic', '대서양', '인도양'] as const;

/** 명시하지 않았을 때 실제로 적용되는 값 (build-scene/compile 기준). */
export const DEFAULTS = {
  projection: 'equirectangular',
  fit: 'dominant',
  curve: 0.25,
  anchor: 'border',
  geodesic: false,
  collide: true,
  labelAt: 'mid',
  /** 링크 타입별 기본 화살촉. */
  head: { arrow: 'taper', wind: 'triangle', current: 'triangle', route: 'none' },
} as const;

/** 어휘 전량 — 파이프라인이 코드로 대조하거나 spec 을 생성할 때 쓴다. */
export const DSL_VOCABULARY = {
  roles: ROLES,
  sceneKeys: SCENE_KEYS,
  linkKeywords: LINK_KEYWORDS,
  entityProps: ENTITY_PROPS,
  linkProps: LINK_PROPS,
  labelProps: LABEL_PROPS,
  themeKeys: THEME_KEYS,
  projections: PROJECTIONS,
  fitModes: FIT_MODES,
  anchors: ANCHORS,
  labelAts: LABEL_ATS,
  heads: HEADS,
  borders: BORDERS,
  linkTypes: LINK_TYPES,
  colorTokens: Object.keys(COLOR_TOKENS),
  centerKeywords: CENTER_KEYWORDS,
  defaults: DEFAULTS,
} as const;
