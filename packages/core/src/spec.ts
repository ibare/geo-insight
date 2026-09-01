/**
 * '@geo-insight/core/spec' — LLM 프롬프트에 그대로 주입하는 DSL 명세.
 *
 * 표·목록은 전부 vocabulary.ts 와 데이터(그룹·레이어)에서 **파생**한다. 손으로 적은 표가
 * 없으므로 어휘가 바뀌면 문서가 따라 바뀐다 — README 가 실동작과 어긋나 있던 문제를
 * 구조적으로 없앤다.
 *
 * 서술은 영어다(프롬프트 토큰 효율). 다만 예제의 지명은 한글 그대로 둔다 — DSL 의 입력
 * 언어이고, 번역하면 실제로 해석되지 않는 이름이 되기 때문이다.
 *
 * 내용의 기준은 README 가 아니라 **실동작**이다. 무시되는 속성(`arrow:`, `place:`)과
 * 쓸 수 없는 표기(hex 색)를 숨기지 않고 "무시된다/깨진다"고 적는다. LLM 에게는 되는 것과
 * 안 되는 것의 경계가 문법 자체보다 중요하다.
 */

import { listGroups, listLayers } from '@geo-insight/data/names';
import { COLOR_TOKENS } from './theme.js';
import {
  ANCHORS,
  BORDERS,
  CENTER_KEYWORDS,
  DEFAULTS,
  ENTITY_PROPS,
  FIT_MODES,
  HEADS,
  LABEL_ATS,
  LINK_PROPS,
  LINK_TYPES,
  PROJECTIONS,
  ROLES,
} from './vocabulary.js';

/** 검증을 통과하는 것이 테스트로 강제되는 예제들. spec 의 few-shot 이자 회귀 기준. */
export interface SpecExample {
  /** 무엇을 보여주는 예제인지(영문 한 줄). */
  title: string;
  source: string;
}

export const SPEC_EXAMPLES: readonly SpecExample[] = [
  {
    title: 'Minimal — roles are inferred',
    source: `earth:
  show: 아프리카, 수단, 인도
  link: 수단 -> 인도`,
  },
  {
    title: 'Explicit roles, styles and a labelled link',
    source: `earth "대권 항로":
  center: 60
  projection: naturalEarth1

  group 아시아 { fill: amber, borders: keep }
  focus 한국 { fill: coral }
  focus 인도 { fill: coral }

  link 한국 -> 인도 {
    head: taper
    geodesic: true
    color: teal
    anchor: border
    label: "항로"
    labelAt: mid
  }`,
  },
  {
    title: 'Flow types — wind and current use their own keywords',
    source: `earth "무역풍과 해류":
  show: 아시아, 아메리카
  wind: 아시아 -> 아메리카 "무역풍"
  current: 일본 -> 미국 "쿠로시오"`,
  },
  {
    title: 'Curated layers — only 해류 and 바람 exist',
    source: `earth "전지구 해류":
  layers: 해류
  show: 아시아, 아메리카
  fit: world`,
  },
  {
    title: 'showOnly — isolate one country and highlight its subdivisions',
    source: `earth "미국 서부":
  showOnly: 미국
  show: California, Texas`,
  },
  {
    title: 'Scoped subdivision name — disambiguate with 국가.지역',
    source: `earth:
  show: 미국.캘리포니아, 일본.홋카이도`,
  },
  {
    title: 'Globe view with a fixed bounding box',
    source: `earth "인도양":
  projection: orthographic
  center: 인도양
  fit: [20, -40, 120, 30]
  show: 인도, 아프리카`,
  },
  {
    title: 'Theme override and label control',
    source: `earth:
  show: 유럽, 프랑스, 독일
  theme { ocean: powderblue, linkColor: coral }
  label 프랑스 { collide: true }`,
  },
];

// ── 표 생성 헬퍼 ────────────────────────────────────────────────────────────

const list = (xs: readonly string[]): string => xs.map((x) => `\`${x}\``).join(' | ');
const fence = (src: string): string => '```geoinsight\n' + src + '\n```';

function colorTokenTable(): string {
  return Object.entries(COLOR_TOKENS)
    .map(([name, hex]) => `\`${name}\` (${hex})`)
    .join(', ');
}

function groupTable(): string {
  // 별칭까지 전량 — LLM 이 "동남아시아" 가 되는지 몰라 찍는 일을 없앤다.
  return listGroups()
    .map((g) => `- **${g.display}** — ${g.aliases.map((a) => `\`${a}\``).join(', ')}`)
    .join('\n');
}

/** 속성 표 — 키 목록은 어휘에서, 값 설명은 아래 맵에서. 새 키가 생기면 표에 자동 등장한다. */
function propTable(keys: readonly string[], values: Record<string, string>): string {
  return [
    '| Prop | Value |',
    '|---|---|',
    ...keys.map((k) => `| \`${k}\` | ${values[k] ?? '(undocumented)'} |`),
  ].join('\n');
}

const ENTITY_PROP_VALUES: Record<string, string> = {
  fill: 'color token, CSS color name',
  stroke: 'color token, CSS color name',
  borders: list(BORDERS),
  label: '`true` \\| `false` (also `none`/`off`)',
  opacity: 'number 0..1',
};

const LINK_PROP_VALUES: Record<string, string> = {
  type: list(LINK_TYPES),
  label: 'quoted string',
  labelAt: list(LABEL_ATS),
  head: list(HEADS),
  curve: 'number (0 = straight)',
  color: 'color token, CSS color name',
  anchor: list(ANCHORS),
  geodesic: '`true` \\| `false`',
};

function headDefaults(): string {
  return Object.entries(DEFAULTS.head)
    .map(([type, head]) => `\`${type}\`→\`${head}\``)
    .join(', ');
}

// ── 명세 ────────────────────────────────────────────────────────────────────

/**
 * LLM 시스템 프롬프트용 DSL 명세(영문 마크다운).
 *
 * 모듈 로드 시 한 번 조립된다. 그룹·레이어 목록이 데이터에서 오므로 최신 상태가 보장된다.
 */
export const DSL_SPEC: string = `# GeoInsight DSL

A semantic DSL that compiles to deterministic SVG maps. You write **place names and
relations**; the compiler decides coordinates, projection and layout. Never emit
latitude/longitude except in an explicit \`fit\` bounding box.

Output is a fenced block. The host extracts it by the \`geoinsight\` language tag:

${fence(`earth:
  show: 아프리카, 수단, 인도
  link: 수단 -> 인도`)}

## 1. Structure

Every scene starts with \`earth\` and an optional quoted title, then \`:\`. Statements are
indented lines. \`#\` starts a comment **and therefore hex colors like \`#ff8800\` are
impossible** — they are read as comments and break the parse. Use color tokens or CSS
color names instead.

Statement forms:

| Form | Example |
|---|---|
| scene property | \`show: 한국, 일본\` |
| relation | \`link: 한국 -> 일본 "교역"\` |
| entity block | \`focus 한국 { fill: coral }\` |
| label block | \`label 한국 { collide: true }\` |
| theme block | \`theme { ocean: powderblue }\` |

Entity roles: ${list(ROLES)}. If you omit them, roles are **inferred** — continents and
regions become \`group\`, everything else becomes \`plain\`. Prefer the minimal form; only
declare roles when you need to override styling.

## 2. Scene properties

| Key | Value | Notes |
|---|---|---|
| \`show\` | comma-separated names | The entities to draw. |
| \`showOnly\` | a **single country** | Isolates that country and fills the canvas with its subdivisions. Not a group, not a list. Sets \`fit\`/\`center\` automatically and **removes every entity outside that country**. |
| \`layers\` | ${list(listLayers())} | Curated environmental layers. These are the only valid values. |
| \`center\` | longitude number \\| entity name \\| ${list(CENTER_KEYWORDS)} | |
| \`arrange\` | \`A -> B\` | Places A left of B and derives \`center\`. |
| \`fit\` | ${list(FIT_MODES)} \\| \`[w,s,e,n]\` | Any other value is an error. |
| \`projection\` | ${list(PROJECTIONS)} | \`robinson\`/\`winkel3\` need an optional dependency; they fall back to \`naturalEarth1\` with a warning. |
| \`link\` \\| \`wind\` \\| \`current\` \\| \`route\` | \`A -> B "label"\` | The keyword *is* the relation type. The trailing quoted string is the label. |

## 3. Entity properties — \`group\`/\`focus\`/\`plain NAME { … }\`

${propTable(ENTITY_PROPS, ENTITY_PROP_VALUES)}

Anything else is ignored — including plausible-looking names like \`size\` or \`weight\`.

## 4. Link properties — \`link A -> B { … }\`

${propTable(LINK_PROPS.filter((p) => p !== 'arrow'), LINK_PROP_VALUES)}

Link types differ in appearance: \`arrow\` is a tapered wedge, \`wind\` is a dashed flow,
\`current\` is a wave (ocean currents), \`route\` is a thin dotted line.

## 5. Label and theme blocks

\`label all { … }\` or \`label NAME { … }\` accepts \`collide\` (\`true\`/\`false\`).

**If you write any \`label\` statement, only the named targets get labels** — the implicit
"label everything" default is replaced. To label one entity *in addition to* the rest,
do not use a \`label\` block; set \`label: false\` on the entities you want to suppress.

\`theme { … }\` accepts exactly four keys: ${list(['ocean', 'linkColor', 'worldFaint', 'graticule'])}.

## 6. Defaults

Omitted values resolve to:

| | Default |
|---|---|
| \`projection\` | \`${DEFAULTS.projection}\` |
| \`fit\` | \`${DEFAULTS.fit}\` |
| \`curve\` | \`${DEFAULTS.curve}\` |
| \`anchor\` | \`${DEFAULTS.anchor}\` |
| \`geodesic\` | \`${DEFAULTS.geodesic}\` |
| \`collide\` | \`${DEFAULTS.collide}\` |
| \`labelAt\` | \`${DEFAULTS.labelAt}\` |
| \`head\` | per link type: ${headDefaults()} |

## 7. Precedence

- A trailing quoted string on a relation **beats** \`label:\` inside the block.
- The relation keyword (\`wind\`/\`current\`/\`route\`) **beats** \`type:\` inside the block.
- An explicit \`fit\` beats the automatic framing that \`showOnly\` would apply.

## 8. What silently does nothing

These parse but have no effect. Do not emit them:

- \`arrow: taper\` / \`arrow: triangle\` — **ignored**. The real key is \`head\`. (\`arrow: line\`
  is kept for backward compatibility and means \`head: none\`.)
- \`place: …\` in a label block — **ignored**. Labels always sit at the centroid.
- Any key not listed in the tables above.

## 9. Colors

Named tokens: ${colorTokenTable()}.

CSS color names (\`steelblue\`, \`tomato\`, …) also work. **Hex is not expressible** — \`#\`
starts a comment. Group and selection fills are assigned automatically from a palette;
only set \`fill\` when a specific color carries meaning.

## 10. Which names resolve

Three kinds of names, and nothing else:

1. **Modern sovereign states and dependent territories** — Korean or English names, ISO
   alpha-2/alpha-3 codes, and common alternate spellings.
2. **Groups** (continents and regions) — the full list, with every accepted alias:

${groupTable()}

3. **First-level subdivisions (ADM1)** — states, provinces, prefectures, etc. Use the bare
   name (\`California\`, \`텍사스\`) when it is unambiguous, or the scoped form
   \`국가.지역\` (\`미국.캘리포니아\`) when it is not.

**Historical and ancient names do not resolve.** 고구려, 페르시아, 오스만 제국,
소련, 유고슬라비아 and the like are unknown names and will fail. There is no historical
geography in this dataset — express historical narratives using the modern territories
they correspond to.

Ambiguous fragments fail too: a name must match exactly one entity.

## 11. Examples

${SPEC_EXAMPLES.map((e) => `### ${e.title}\n\n${fence(e.source)}`).join('\n\n')}
`;

/** spec 의 바이트 길이·대략 토큰 수 — 프롬프트 예산 계산용. */
export function specSize(): { chars: number; approxTokens: number } {
  return { chars: DSL_SPEC.length, approxTokens: Math.ceil(DSL_SPEC.length / 3.5) };
}

export { DSL_VOCABULARY } from './vocabulary.js';
