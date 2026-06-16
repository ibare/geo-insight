# GeoInsight — v1 구현 프롬프트

> 이 문서는 Claude Code에 그대로 투입하는 구현 스펙이다. 단순 코드 라이브러리가 아니라 **교육적 지리 설명을 위한 시맨틱 DSL → 결정적 SVG 렌더 엔진**을 만든다. "지도도 그릴 수 있는 차트 라이브러리"가 아니라 "지도를 위한 Mermaid"를 지향한다.
>
> **DSL은 독립 파일로 존재하지 않는다.** 마크다운 펜스 코드블록(` ```geoinsight `)으로 임베딩된다 — Mermaid와 동일한 모델. 따라서 파일 확장자·파일 로딩 개념은 없다.

---

## 0. 정체성과 설계 원칙

GeoInsight는 `미국`, `남미`, `인도` 같은 **장소 이름**과 `수단 -> 인도` 같은 **관계**를 1급 시민으로 다루고, 위경도·투영·SVG 좌표는 전부 뒤로 숨긴다. 사용자는 "무엇을, 어떤 관계로 설명할지"만 쓰고, 컴파일러가 "어디에, 어떻게 그릴지"를 결정한다.

다섯 가지 불변 원칙:

1. **의미 우선** — 입력은 좌표가 아니라 이름과 역할(group/focus)과 관계(link)다.
2. **결정적·diffable 출력** — 같은 입력은 바이트 단위로 같은 SVG를 낳는다. 좌표 정밀도·id 순서·레이어 순서가 안정적이어야 스냅샷 테스트와 버전 관리가 가능하다.
3. **프레임워크 비종속 core** — core는 DOM도 React도 모른다. 순수 함수 `compile(source) → { svg, scene, diagnostics, meta }`. Node 빌드타임에서도 브라우저 런타임에서도 동일하게 돈다.
4. **헤드리스 core + 호스트 어댑터(익스텐션)** — 마크다운 통합·줌/팬·인터랙션·프레임워크 바인딩은 전부 별도 패키지(markdown/runtime/react/cli)가 담당한다. core를 교체 없이 어느 호스트에든 얹을 수 있다. (Methii 에디터에는 Fizzex·Depix와 같은 방식으로, `geoinsight` 펜스를 인식하는 블록 익스텐션으로 들어간다.)
5. **교육적 서사가 목적** — 차트의 정확한 수치 인코딩이 아니라, "이 지역과 이 지역이 이런 관계"라는 *이해*를 돕는 게 목표. 라벨·강조·화살표·좌우 배치가 핵심 표현 수단이다.

---

## 1. 모노레포 구조 (pnpm)

```
geoinsight/
├─ pnpm-workspace.yaml
├─ package.json
├─ tsconfig.base.json
├─ configs/                     # 공유 tsup / tsconfig / eslint / vitest 프리셋
│   ├─ tsconfig.lib.json
│   ├─ tsup.base.ts
│   └─ eslint.config.js
├─ packages/
│   ├─ core/        @geo-insight/core      # DSL → IR → SVG. 프레임워크/DOM 의존 0
│   ├─ data/        @geo-insight/data      # 지리 데이터 + 이름 해석(resolver)
│   ├─ runtime/     @geo-insight/runtime   # 바닐라 DOM 마운트 + 줌/팬 (프레임워크 0)
│   ├─ markdown/    @geo-insight/markdown  # 마크다운 펜스(```geoinsight) 어댑터
│   ├─ react/       @geo-insight/react     # React 어댑터 (react = peerDependency)
│   └─ cli/         @geo-insight/cli       # 마크다운에서 펜스 추출 → 정적 SVG (빌드타임)
└─ examples/
    ├─ trade-winds.md             # ```geoinsight 블록 포함 마크다운
    ├─ africa-sudan-india.md
    └─ ...
```

**빌드/배포**: 각 패키지 `tsup`으로 ESM+CJS+`.d.ts` 동시 출력. 테스트 `vitest`(스냅샷). 배포는 npm Trusted Publishing(OIDC), 장기 토큰 없음. 공유 설정은 `configs/`에서 상속(methii-oss-tooling 패턴).

**의존성 규칙 (엄수)**:

| 패키지 | 허용 의존 | 금지 |
|---|---|---|
| `core` | `@geo-insight/data`, `d3-geo`(+필요 시 `d3-geo-projection`), `topojson-client` | React/Vue/DOM/window |
| `data` | `world-atlas`, `world-countries` (또는 번들 JSON) | core |
| `runtime` | `@geo-insight/core`, 브라우저 DOM | React/Vue |
| `markdown` | `@geo-insight/core`; (인터랙티브 하이드레이션 시 `runtime`) | React/Vue |
| `react` | `runtime`, `core`; `react`는 peer | — |
| `cli` | `core`, `data`, `markdown` | DOM |

> `d3-geo`·`topojson-client`는 "프레임워크"가 아니라 순수 수학/파싱 유틸이므로 core 의존으로 허용한다. 단 core 내부에서 투영 연산은 `Projection` 포트(인터페이스) 뒤에 두고 d3-geo를 기본 어댑터로 주입한다 — 나중에 교체 가능하게. d3-geo의 역할은 "구면 좌표 → 화면 픽셀" 변환, antimeridian 절단·클리핑·리샘플링을 처리하는 `geoPath`의 `d` 문자열 생성, 그리고 구면 측정(`geoCentroid`/`geoBounds`/`geoInterpolate`(대권선)/`geoDistance`/`geoContains`) + `geoGraticule`로 한정된다. DSL 파싱·이름 해석·역할·테마·SVG 조립·결정성은 전부 우리 코드다.

---

## 2. DSL 사양

### 2.0 임베딩 (마크다운 펜스)

DSL은 마크다운 안에서 `geoinsight` info string을 가진 코드블록으로만 존재한다. 호스트(마크다운 렌더러·Methii 에디터)는 이 펜스를 만나면 본문을 `compile()`에 넘기고 결과 SVG로 치환한다.

````md
설명 텍스트…

```geoinsight
earth:
  show: 아프리카, 수단, 인도
  link: 수단 -> 인도
```

이어지는 설명…
````

아래 사양 예시들은 펜스 본문(DSL 그 자체)만 보여준다. 들여쓰기 기반 블록 문법이며 **최소형(역할 추론)** 과 **명시형(완전 제어)** 두 단계 충실도를 모두 지원한다.

### 2.1 최소형

```geo
earth:
  show: 아프리카, 수단, 인도
  link: 수단 -> 인도
```

역할 추론 규칙(이 세 줄로 첨부 레퍼런스 이미지가 재현되어야 한다):

- 입력이 **대륙/권역**(아시아·유럽·아프리카·북미·남미·오세아니아 등)이면 → `group`
- 입력이 **link의 끝점**이면 → `focus` (group 위에 그려짐)
- 그 외 → `plain`

### 2.2 명시형

```geo
earth "무역풍":
  center: 태평양            # 좌우 배치: lon 숫자 | 명명 엔티티 | 프리셋(pacific/atlantic)
  fit: dominant             # entities | dominant | world | [w,s,e,n]
  projection: naturalEarth1 # 기본값

  group 아프리카  { fill: amber, borders: keep }
  focus 수단      { fill: coral }
  focus 인도      { fill: coral }

  link 수단 -> 인도 {
    arrow: taper            # 끝이 굵어지는 wedge
    curve: 0.25             # 0 = 직선, 양수 = 곡률
    color: teal
    anchor: border          # border(국경에서 출발) | centroid
    geodesic: true          # 대권선 샘플링 후 투영
  }

  label all { place: centroid, collide: true }
```

### 2.3 키워드 사양

| 키 | 위치 | 값 | 기본 |
|---|---|---|---|
| `show` | scene | 이름 리스트 | — |
| `link` | scene | `A -> B` (여러 줄 가능) | — |
| `center` | scene | lon(number) \| 엔티티명 \| `pacific`\|`atlantic` | `0` |
| `arrange` | scene | `A -> B` (좌→우 순서, center 자동 산출) | — |
| `fit` | scene | `entities`\|`dominant`\|`world`\|`[w,s,e,n]` | `dominant` |
| `projection` | scene | `naturalEarth1`\|`equirectangular`\|`mercator`\|`robinson`* | `naturalEarth1` |
| `group/focus/plain` | entity | `{ fill, borders, label, ... }` | 추론 |
| `link ... { }` | scene | `{ arrow, curve, color, anchor, geodesic }` | 위 예시 |
| `theme` | scene | 토큰 오버라이드 객체 | 기본 다크 테마 |

\* `naturalEarth1`·`equirectangular`·`mercator`·`orthographic`은 `d3-geo` 본체. `robinson`·`winkel3` 등 확장 투영은 `d3-geo-projection` 추가 의존이 필요하므로, 해당 투영을 요청할 때만 lazy-load.

**중요 결정 (논의 결과 반영)**:

- **본토 필터링은 하지 않는다.** 프랑스·미국 등의 해외 영토 지오메트리를 그대로 전부 그린다. 대신 카메라는 `fit: dominant`로 주 클러스터에 맞춰 시각적 폭주를 막고, 멀리 떨어진 조각은 런타임 줌/팬으로 사용자가 탐색한다. `parts: mainland` 모디파이어는 v1 범위 밖.
- **좌우 배치는 `center` 회전 하나로 해결.** `center`는 화면 중앙에 놓일 자오선. 내부적으로 `projection.rotate([-centerLon, 0])`. `center: 동남아시아`처럼 엔티티명을 주면 그 centroid 경도를 중앙에 둔다. `arrange: 아프리카 -> 아메리카`는 "왼쪽…오른쪽" 순서를 만족하는 center 경도를 컴파일러가 역산(두 외곽 엔티티 사이 호의 중점; 해가 둘이면 가운데에 와야 할 영역을 포함하는 쪽 선택). rotate는 **fit보다 먼저** 적용한다.

---

## 3. 중간 표현 (IR)

파싱·해석을 거친 뒤의 정규화된 장면. 모든 패스는 IR을 입력받아 더 풍부한 IR을 반환한다. `meta`는 런타임 줌/팬과 출력 재현성을 위해 투영 파라미터를 노출한다.

```ts
interface Scene {
  title?: string;
  projection: ProjSpec;          // { type, rotate:[number,number], ... }
  fit: FitSpec;                  // resolved bbox 또는 모드
  theme: ResolvedTheme;
  entities: Entity[];            // 이름이 features로 해석된 상태
  links: Link[];
  labels: Label[];
  meta: SceneMeta;               // { viewBox, projectionParams, precision }
}

interface Entity {
  key: string;                   // 정규화 키 (ccn3 또는 group id)
  display: string;               // 원본 이름 (라벨 기본값)
  role: "group" | "focus" | "plain";
  features: GeoFeature[];        // 1..n 국가 폴리곤 (전체 지오메트리)
  centroid: [number, number];    // 구면 centroid (lon,lat)
  bbox: [number, number, number, number];
  z: number;                     // 레이어 순서
  style: ResolvedStyle;
}

interface Link {
  from: string; to: string;      // Entity.key
  anchor: "border" | "centroid";
  curve: number;
  geodesic: boolean;
  style: ArrowStyle;
}

interface Label {
  text: string;
  at: [number, number];          // lon,lat (배치 전) → 패스7에서 화면좌표 확정
  entityKey: string;
  collide: boolean;
}

interface Diagnostic {
  level: "error" | "warning";
  message: string;
  span?: { line: number; col: number };   // 펜스 본문 기준 라인/컬럼
  suggestions?: string[];        // "수단 vs 남수단" 같은 제안
}
```

---

## 4. 컴파일러 파이프라인

각 패스는 순수 함수 `(IR, ctx) → { ir, diagnostics }`. 패스 경계마다 스냅샷 테스트가 가능해야 한다(Depix 멀티패스 방식).

1. **Lex** — 펜스 본문 → 토큰. 들여쓰기/콜론/`->`/`{}` 인식.
2. **Parse** — 토큰 → 구문 AST. 순수 구문만, 의미 없음. 문법 오류는 span과 함께 diagnostic.
3. **Resolve** — 엔티티 이름 → feature 집합 (`@geo-insight/data` resolver 호출). 미해석/모호 이름은 여기서 error + `suggestions`.
4. **Roles/Layers** — 추론 규칙 + 명시 역할 적용. z-order 계산(group 아래, focus 위). group의 부분집합인 focus(예: 아프리카 안의 수단)는 group *다음에* 그려 위로 올린다.
5. **Geometry** — 엔티티별 구면 centroid·bbox 산출(`geoCentroid`/`geoBounds`). group은 내부 국경 유지(`borders: keep`) 또는 dissolve 선택.
6. **Project & Fit** — projection 생성 → `rotate` 적용 → `fit` 모드에 따라 `fitExtent`. `dominant`는 각 엔티티의 최대 면적 클러스터들의 합집합 bbox로 카메라를 맞춘다(전체 지오메트리는 그대로 그리되 프레이밍만). 결과로 lon/lat→화면 좌표 확정, `meta.viewBox`·`projectionParams` 기록.
7. **Label layout** — centroid를 투영해 배치 후 충돌 회피(간단 displacement; 겹치면 밀어내고 프레임 안쪽 클램프). group 라벨과 focus 라벨 충돌 우선순위 규칙 포함.
8. **Link routing** — 끝점을 anchor로 해석. `border`면 출발/도착 폴리곤 경계와 직선/대권선을 교차시켜 *국경에서 출발*하게 자른다. `geodesic`면 `geoInterpolate`로 대권선을 샘플링 후 투영, 아니면 화면좌표 이차 베지어(`curve`). taper wedge outline + arrowhead 폴리곤 산출.
9. **Emit** — 결정적 SVG 문자열. 레이어 순서 고정: `sphere(ocean) → graticule → faint world → group fills → focus fills → links → arrowheads → labels`. 좌표는 `precision`(기본 2자리)로 반올림, id는 안정적 순서.

전 패스의 diagnostic은 누적되어 `CompileResult.diagnostics`로 반환. error가 있어도 가능한 만큼 부분 렌더(graceful degradation).

---

## 5. 데이터 / 이름 해석 (`@geo-insight/data`)

- **지오메트리**: `world-atlas` countries-110m 기본, 50m 옵션. `topojson-client`로 GeoJSON 변환.
- **메타데이터**: `world-countries` — `ccn3`로 지오메트리와 조인, `translations.kor.common`(한글명), `region`/`subregion`.
- **Resolver API**:

```ts
interface Resolver {
  resolve(name: string): ResolveResult;   // 동기
}
type ResolveResult =
  | { kind: "country"; key: string; features: GeoFeature[] }
  | { kind: "group";   key: string; features: GeoFeature[] }
  | { kind: "unknown"; suggestions: string[] };
```

- 매칭 우선순위: 그룹 키워드(대륙/권역) → 정확 일치(kor/en/cca2/cca3) → 부분 일치. 모호하면(`수단`↔`남수단`) `unknown` + suggestions로 빼서 호출자가 명확화하게.
- 그룹 키워드 테이블은 `region`/`subregion` 기반(아시아=region Asia, 남미=subregion South America 등). 한/영 별칭 포함.
- **로딩 전략**: v1은 110m + 메타데이터를 트리셰이킹 가능한 import JSON으로 번들. 단 `DataSource` 인터페이스를 두어 커스텀/고해상도 데이터 주입 가능하게(포트). 런타임 fetch 로더는 별도 어댑터로 열어둔다.

---

## 6. 렌더링 / 테마

- **레이어 순서**: 패스9 명세대로.
- **화살표**: 단순 stroke가 아니라 베지어 중심선을 따라 폭을 보간한 **채워진 wedge**(taper). arrowhead는 별도 삼각형 폴리곤. `anchor: border`면 국경에서 출발.
- **테마 토큰**(기본 다크 카토그래픽; 데모와 동일 계열):

```ts
interface Theme {
  ocean: string;        // 바다(sphere)
  worldFaint: string;   // 비선택 국가
  worldStroke: string;
  graticule: string;
  groupPalette: string[]; // group 채움 순환 (amber 등)
  focusAccent: string[];  // focus 채움 (coral 등)
  linkColor: string;      // teal
  label: { fill: string; halo: string; font: string };
}
```

- `theme:` DSL 블록 또는 API 옵션으로 오버라이드. 색은 named 토큰(`amber`,`coral`,`teal`)을 테마에서 hex로 해석.
- **결정성**: 좌표 반올림, 안정적 id/순서. 동일 입력 → 바이트 동일 SVG.

---

## 7. 패키지별 공개 API

```ts
// @geo-insight/core
export function compile(source: string, opts?: CompileOptions): CompileResult;
export interface CompileResult {
  svg: string;
  scene: Scene;             // IR (툴링/검사용)
  diagnostics: Diagnostic[];
  meta: SceneMeta;          // viewBox, projectionParams
}
export function parse(source: string): { ast: Ast; diagnostics: Diagnostic[] }; // 부분 노출

// @geo-insight/markdown  (코어만; 호스트 통합의 주 진입점)
// remark/rehype 플러그인 + markdown-it 플러그인 둘 다 제공.
// lang === "geoinsight" 코드블록을 찾아 compile() 결과 SVG로 치환.
// 인터랙티브가 필요하면 runtime 하이드레이션 마커를 남긴다.
export function remarkGeoInsight(opts?: AdapterOptions): Plugin;
export function markdownItGeoInsight(md: MarkdownIt, opts?: AdapterOptions): void;

// @geo-insight/runtime  (바닐라, DOM만)
export function mount(el: HTMLElement, src: string | CompileResult, opts?: MountOptions): GeoInstance;
export interface GeoInstance {
  update(src: string | CompileResult): void;
  zoomTo(entityKey: string): void;   // 멀리 떨어진 조각 탐색
  reset(): void;
  destroy(): void;
}
// 줌/팬: 휠/드래그/핀치. viewBox 변환 기반(좌표는 core가 준 meta 사용).
// 펜스로 렌더된 정적 SVG를 진보적 향상으로 하이드레이트.

// @geo-insight/react
export function GeoInsight(props: {
  source: string;
  options?: CompileOptions & MountOptions;
  onSelect?(entityKey: string): void;
  onError?(d: Diagnostic[]): void;
}): JSX.Element;   // 내부에서 runtime 사용, react는 peer

// @geo-insight/cli  (빌드타임)
// $ geoinsight build "docs/**/*.md"   # 마크다운의 geoinsight 펜스 → SVG로 인라인/추출
// $ geoinsight render -                # stdin DSL → stdout SVG  [--width 960 --center 태평양 --theme light]
```

---

## 8. 테스트 / 품질 게이트

- **스냅샷**: 패스별 IR 스냅샷 + 골든 SVG. 레퍼런스로 `africa-sudan-india.md`의 최소형 펜스가 첨부 이미지를 재현(테마 제외 형태 일치)하는 것을 **수용 기준**으로 삼는다.
- **결정성 테스트**: 동일 입력 두 번 컴파일 → 바이트 동일.
- **Resolver 테스트**: 한글명/영문/ISO, 그룹 전개, 모호성(`수단`↔`남수단`) 제안.
- **좌우 배치 테스트**: `center: 태평양`일 때 아프리카가 아메리카보다 화면 x좌표가 작은지(왼쪽) 검증.
- **fit 테스트**: 해외 영토가 있는 국가에서 `fit: dominant`가 카메라 폭주를 막는지.
- **마크다운 어댑터 테스트**: `geoinsight` 펜스만 변환하고 다른 코드블록은 건드리지 않는지, span 오프셋이 펜스 본문 기준으로 맞는지.
- 커버리지 게이트 + SonarQube(기존 인프라) 연동.

---

## 9. v1 범위

**포함**: 마크다운 `geoinsight` 펜스 어댑터(remark + markdown-it) / 최소형+명시형 파싱 / resolve(국가+대륙·권역, 한·영·ISO) / group·focus·plain 역할 / center·rotate + arrange / fit dominant·entities·world·bbox / 기본 충돌회피 라벨 / taper 화살표 + border anchor + 대권선 옵션 / 결정적 SVG emit / 바닐라 runtime 줌·팬 / react 어댑터 / cli(펜스 추출·정적 SVG) / 스냅샷·골든 테스트.

**제외(차기)**: 도시 단위 / `parts: mainland` 필터링(현재는 전체 렌더) / 애니메이션 / 멀티 scene 전환 / Vega-Lite·ECharts compile-target 백엔드 / MDX 컴포넌트 바인딩(코드블록 어댑터는 포함, JSX 임베드는 차기) / choropleth·데이터 바인딩 / 타임라인.

---

## 10. 권장 빌드 순서 (PLAN.md 체크포인트)

각 단계는 테스트 통과 + 체크포인트로 마감한다.

- **P0** 모노레포 스캐폴드 + 공유 configs + 빈 패키지 6개 + CI(OIDC 배포 스텁)
- **P1** `@geo-insight/data`: topojson 변환 + world-countries 조인 + Resolver(+테스트)
- **P2** core: Lex → Parse → AST + diagnostics(+테스트)
- **P3** core: Resolve → Roles/Layers → Geometry 패스
- **P4** core: Project&Fit(rotate→fit, dominant) → Label layout
- **P5** core: Link routing(anchor·curve·geodesic·taper)
- **P6** core: Emit + Theme + 결정성 보장. → 골든 SVG 수용 테스트 통과
- **P7** `@geo-insight/runtime`: mount + 줌/팬 + zoomTo
- **P8** `@geo-insight/markdown`(remark + markdown-it) + `@geo-insight/react` + `@geo-insight/cli`
- **P9** examples(trade-winds 등 마크다운) + 전체 스냅샷/골든 정비 + README

---

## 부록 A. 수용 예제

`examples/africa-sudan-india.md` (최소형, 첨부 이미지 재현):

````md
# 수단에서 인도로

```geoinsight
earth:
  show: 아프리카, 수단, 인도
  link: 수단 -> 인도
```
````

`examples/trade-winds.md` (좌우 배치):

````md
# 무역풍

```geoinsight
earth "무역풍":
  center: 태평양
  show: 아프리카, 동남아시아, 아메리카
```
````

기대 동작: 첫 예제는 아프리카(amber, 내부 국경 유지) 위에 수단(coral)이 올라가고 인도(coral)로 taper 화살표가 국경에서 출발. 둘째 예제는 아프리카가 좌측, 아메리카가 우측, 태평양/동남아가 중앙에 오도록 회전.
