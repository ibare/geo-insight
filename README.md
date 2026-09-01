# GeoInsight

> 교육적 지리 설명을 위한 시맨틱 DSL → 결정적 SVG 렌더 엔진. "지도를 위한 Mermaid".

`미국`·`남미`·`인도` 같은 **장소 이름**과 `수단 -> 인도` 같은 **관계**를 1급 시민으로 다루고,
위경도·투영·SVG 좌표는 전부 뒤로 숨긴다. 사용자는 "무엇을, 어떤 관계로" 쓰고, 컴파일러가
"어디에, 어떻게 그릴지"를 결정한다.

DSL은 독립 파일이 아니라 마크다운 펜스(```` ```geoinsight ````)로 임베딩된다 — Mermaid와 동일한 모델.

```geoinsight
earth:
  show: 아프리카, 수단, 인도
  link: 수단 -> 인도
```

## 패키지

| 패키지 | 역할 | 의존 |
|---|---|---|
| `@geo-insight/data` | 지오메트리(world-atlas 110m) + 이름 resolver(한·영·ISO, 그룹) | world-atlas, world-countries, topojson-client |
| `@geo-insight/core` | DSL → IR → SVG 컴파일러. 프레임워크/DOM 0 | `@geo-insight/data`, d3-geo |
| `@geo-insight/runtime` | 바닐라 DOM 마운트 + 줌/팬. 프레임워크 0 | `@geo-insight/core` |
| `@geo-insight/host-tiptap` | Tiptap 펜스 블록 익스텐션 (소스) | core, runtime; peer `@tiptap/*` |
| `@geo-insight/tiptap` | 위 전체를 인라인한 self-contained ESM 번들 (npm 배포) | peer `@tiptap/core`, `@tiptap/pm` |
| `@geo-insight/layer-editor` | 환경 레이어(해류·바람 등 흐름) 데이터 편집기 (Electron 데스크탑) | core, runtime, data; electron, react, radix |

## DSL

### 최소형 (역할 추론)

```geoinsight
earth:
  show: 아프리카, 수단, 인도
  link: 수단 -> 인도
```

- 대륙/권역(아시아·아프리카·남미·동남아시아 …) → `group`
- `link` 끝점 → `focus` (group 위에 그려짐)
- 그 외 → `plain`

### 명시형 (완전 제어)

```geoinsight
earth "대권 항로":
  center: 60            # lon 숫자 | 엔티티명 | pacific/태평양/atlantic/대서양
  fit: dominant         # entities | dominant | world | [w,s,e,n]
  projection: naturalEarth1

  group 아시아 { fill: amber, borders: keep }
  focus 한국   { fill: coral }
  focus 인도   { fill: coral }

  link 한국 -> 인도 {
    head: taper         # 끝이 굵어지는 wedge (arrow: 가 아니라 head:)
    geodesic: true      # 대권선 샘플링 후 투영
    color: teal
    anchor: border      # border(국경 출발) | centroid
  }

  label all { collide: true }
```

### 키워드

| 키 | 위치 | 값 |
|---|---|---|
| `show` | scene | 이름 리스트 |
| `showOnly` | scene | **단일 국가** — 그 나라만 격리해 행정구역(ADM1)으로 캔버스를 채운다. `fit`/`center` 자동 |
| `layers` | scene | 큐레이션 레이어 — `해류` \| `바람` |
| `link` / `wind` / `current` / `route` | scene | `A -> B "라벨"` (관계 타입별 키워드, 트레일링 문자열은 라벨) |
| `center` | scene | lon 숫자 \| 엔티티명 \| `pacific`/`태평양`/`atlantic`/`대서양`/`인도양` |
| `arrange` | scene | `A -> B` (좌→우, center 자동 산출) |
| `fit` | scene | `entities` \| `dominant` \| `world` \| `[w,s,e,n]` |
| `projection` | scene | `naturalEarth1` \| `equirectangular` \| `mercator` \| `orthographic` \| `robinson`* \| `winkel3`* |
| `group`/`focus`/`plain` | entity | `{ fill, stroke, borders, label, opacity }` |
| `link … { }` | scene | `{ type, label, labelAt, head, curve, color, anchor, geodesic }` |
| `theme` | scene | `{ ocean, linkColor, worldFaint, graticule }` |

**기본값**: `projection: equirectangular` · `fit: dominant` · `curve: 0.25` · `anchor: border` ·
`geodesic: false` · `collide: true` · `labelAt: mid`.

**주의(실동작)** — `arrow:` 는 무시된다(정식 키는 `head:`, `arrow: line` 만 하위호환).
`label { place: … }` 도 무시되며 라벨은 항상 centroid 에 놓인다. `#` 은 주석이라 `#ff8800`
같은 hex 색은 쓸 수 없다 — 색은 토큰이나 CSS 색 이름으로 쓴다.

> DSL 명세의 **정본은 `DSL_SPEC`** 이다(아래 [LLM 파이프라인](#llm-파이프라인-parse--validate--spec) 참조).
> 어휘·그룹·레이어 목록을 코드에서 파생시키므로 이 README 보다 항상 최신이다.

**링크 타입**: `arrow`(기본, taper wedge+화살촉) · `wind`(점선 흐름) · `current`(물결, 해류) · `route`(가는 점선). 최소형은 타입 키워드로(`wind: 태평양 -> 인도양 "무역풍"`), 명시형은 `link … { type: current, label: "쿠로시오", labelAt: mid }`. `head`(`taper`\|`triangle`\|`none`)로 화살촉 모양 조정. 새 타입은 `registerLinkRenderer(type, fn)`로 확장 가능.

\* `robinson`/`winkel3`은 d3-geo-projection이 필요하다. 미등록 시 naturalEarth1로 폴백(경고).
Node CLI 등에서 `registerExtProjection('robinson', geoRobinson)`로 주입할 수 있다.

## 프로그래밍 API

```ts
import { compile } from '@geo-insight/core';

const { svg, scene, diagnostics, meta } = compile(source, { width: 960 });
// svg: 결정적 SVG 문자열 (동일 입력 = 바이트 동일)
// scene: IR (entities/links/labels/projectionParams)
// diagnostics: 미해석 이름 등 (error/warning + suggestions)
```

### LLM 파이프라인 (`parse` / `validate` / `spec`)

배럴(`@geo-insight/core`)은 지오메트리까지 끌고 오므로(2.5MB) 검증만 하는 호출자에겐 과하고,
JSON 정적 import 때문에 Node 20/22+ 에서는 import 자체가 실패한다. 용도별 경량 진입점을 쓴다:

| 진입점 | 용도 | 번들 | Node |
|---|---|---|---|
| `@geo-insight/core/parse` | 문법만 (에디터 실시간 검사) | 6.9KB | ESM + CJS |
| `@geo-insight/core/validate` | 문법 + 지명 + 키/값 (생성 검증) | 777KB | ESM |
| `@geo-insight/core/spec` | LLM 프롬프트용 명세 | — | ESM |
| `@geo-insight/core` | 컴파일 + SVG | 2.5MB | 번들러 필요 |

```ts
import { validate } from '@geo-insight/core/validate';

const { ok, diagnostics, names } = validate(source);
// ok=false 면 diagnostics 로 재생성. names 는 지명 해석 결과(kind/key/display).
```

`validate` 의 검출력은 `compile` 보다 넓다 — 미지 entity/link 속성, 잘못된 `fit`, 없는 색
토큰처럼 `compile` 이 조용히 무시하던 것까지 잡는다. 지오메트리를 로드하지 않고도 ADM1
(`California`, `미국.캘리포니아`)을 해석한다.

```ts
import { DSL_SPEC } from '@geo-insight/core/spec';   // 영문 마크다운 ≈2.4k 토큰
```

CJS 워커에서는 동적 import 로 쓴다: `const { validate } = await import('@geo-insight/core/validate')`.

```ts
import { mount } from '@geo-insight/runtime';

const inst = mount(el, source, { interactive: true });
inst.zoomTo('729');  // 엔티티 key(ccn3 또는 group id)로 카메라 이동
inst.reset();
inst.destroy();
```

## Tiptap / Methii 연동

호스트(메티 등)는 번들을 동적 import → `bootstrapGeoInsight()` 1회 → `GeoInsightExtension` 등록.
content-analyzer가 ```` ```geoinsight ```` 펜스(또는 노드명 `geoinsightBlock`)를 감지해 lazy 로드한다.

```ts
// extension-registry.ts (호스트)
geoinsight: [
  async () => {
    const m = await import('@geo-insight/tiptap');
    if (!bootstrapped) { m.bootstrapGeoInsight(); bootstrapped = true; }
    return m.GeoInsightExtension;
  },
],
```

```ts
// content-analyzer.ts (호스트)
const nodeTypeToExtension = { /* … */ geoinsightBlock: 'geoinsight' };
const fenceLangToExtension = { /* … */ geoinsight: 'geoinsight' };
```

- 노드 모델: 블록 노드 `geoinsightBlock`, `content: 'text*'` — DSL 소스를 textContent로 보관(trama 패턴).
- NodeView: React 없는 vanilla DOM. `@geo-insight/runtime`의 줌/팬 맵을 마운트(FACET 패턴).
- 마크다운 round-trip: `geoInsightNodeToMarkdown(source, { height })` ↔ `GEOINSIGHT_FENCE_RE`.
- 높이 영속: `data-height` attr (하단 핸들 드래그로 갱신).
- peer: `@tiptap/core`, `@tiptap/pm` 둘뿐 (React 불요).

## 레이어 에디터 (`@geo-insight/layer-editor`)

해류·바람 같은 **환경 레이어 데이터**를 지도 위에서 직접 그려 편집하는 Electron 데스크탑 앱.
전문가(도메인 전문가, 디자이너 아님)가 데이터를 입력하면 `methii`가 그대로 렌더한다.

```bash
pnpm --filter @geo-insight/layer-editor dev    # 개발 실행
pnpm --filter @geo-insight/layer-editor build  # electron-vite 빌드
```

### 흐름(flow) 프리미티브

정의는 도메인("해류")이 아니라 **메커니즘**에 둔다 — 그래야 새 시각화 요구마다 "지원할까 말까"를
고민하지 않는다:

> **흐름 = 중심선을 따라 흐르는 방향성 띠 (directed ribbon along a centerline).**

해류·바람·이주·무역로·(작전도의) 공격축은 모두 이 **한 메커니즘의 인스턴스**이지 각각이 새
프리미티브가 아니다. `kind`만 바꾸면 무엇이든 된다(의미 중립). 사용자는 모양을 그리는 게 아니라
**시스템이 강제하는 곡선 위에서 길이·굴곡·두께·색만** 조절한다 — 누가 그려도 스타일·품질이 동일하다.
그리고 우리 목적(글에 임베드해 *설명*)에 비추면 흐름은 정량 벡터장이 아니라 **방향·이동을 이야기하는 띠**다.

```json
{
  "type": "Feature",
  "geometry": { "type": "LineString", "coordinates": [[제어점], …] },
  "properties": { "prim": "flow", "kind": "warm", "width": 100, "arrow": true, "dash": false, "kor": "쿠로시오 해류" }
}
```

- **geometry = 중심선 제어점**(최소 3점), **properties = 표현 파라미터**. 무손실 저장·복원.
- 보간은 `core`의 `cardinalSpline`(Catmull-Rom)을 편집기·렌더가 **공유** — 편집 중 곡선 = methii 곡선.
- 편집: 캔버스 직접 선택 → 제어점 드래그(끝점=길이, 중간=굴곡), 세그먼트 `+`로 중간점 추가,
  Alt+클릭으로 삭제. 두께 슬라이더·화살촉/점선 토글·`kind` 색 스와치.

#### 정의와 경계 — 무엇이 흐름이고 무엇이 아닌가

정체성과 파라미터를 갈라 두면, 새 케이스의 "지원 여부"가 취향이 아니라 **분류**가 된다:

- **정체성(불변)** — 중심선 · 방향성 · 띠 렌더. 이게 깨지면 흐름이 아니라 다른 프리미티브다.
- **파라미터(가변)** — 색(`kind`)·굵기·화살촉·(향후) 채널 수·추상화 모드. 바뀌어도 같은 흐름.

판단은 셋으로 환원된다: ① 중심선 위 방향 띠인가 → 아니면 흐름 밖, ② 기존 파라미터로 되나 → 그냥
데이터, ③ 새 표현이 필요하면 그게 **직교 파라미터**(다른 케이스에도 재사용되나)인지 확인 후 추가.

**두 레지스터(추상화 레벨)** — `width`의 의미를 모드로 분기해 충돌을 없앤다:

- **`geographic`**(현재 구현) — 경로 = 실제 위치, `width` = 실제 폭(km), 줌 종속 LOD(아래).
- **`schematic`**(향후) — 경로 = 도식, `width` = 강조 굵기, LOD off. 개념 순환도처럼 "이야기용" 띠.

**흐름이 *아닌* 것** — 정의의 핵심 가치는 거절에 있다. directed ribbon 으로 환원되지 않으므로
각자 **다른 프리미티브 군**이다: 수온·염도 같은 **스칼라장**(색/등치선·면), 용승·침강 같은 **수직
운동**(점·심볼), 소용돌이 같은 **닫힌 회전**(별도), 분포·밀도(면·히트맵).

#### `width` = 실제 폭(km), 줌 종속 LOD — `geographic` 레지스터

`width`는 화면 픽셀이 아니라 **해류의 실제 폭(km)** 이다(쿠로시오 ~100, 연안류 ~25). 화면 두께와
가시 여부가 이 값 하나에서 파생된다 — 작성자는 줌별 표시 규칙을 따로 관리하지 않는다.

```
화면 두께(px) = width(km) × pxPerKm(현재 줌의 해상도)
가시성        = 화면 두께 ≥ 1px 일 때만 표시
```

- **폭이 좁은 해류는 줌아웃하면 화면 1px 미만이 되어 자동으로 사라지고**(63빌딩이 100km 상공에선
  안 보이듯), 줌인하면 다시 나타난다. 굵은 대양 경계류(쿠로시오 등)는 줌아웃에도 남는다.
- **라벨은 도형보다 높은 임계로 먼저 사라진다**(이중 가시성, `labelHidePx`/`labelFadePx`). 도형(흐름선)은
  보여도 이름표는 먼저 빠진다 — 읽을 수 없는 크기의 라벨은 의미가 0이고, 무명 도형은 "이게 뭐지?
  확대해보자"는 탐색을 유발(detail-on-demand). 도형과 라벨은 각자 opacity 그룹으로 페이드한다.
- 줌인 굵기 정책(실폭 비례 ↔ 화면 고정)·가시 임계·페이드는 `core`의 `resolveFlowWidth` /
  `FlowWidthParams`(`gamma`·`min/maxPx`·`hideBelowPx`·`fadeToPx`)로 결정 — 정답을 코드에 박지 않고
  **라이브로 튜닝**한다(플레이그라운드 "흐름 튜닝" 슬라이더, `setFlowParams`).
- 렌더는 `gi-flows` 그룹(본체+화살촉+라벨)으로 **줌마다 재렌더**해 두께·가시성·opacity를 갱신한다.
  비대화형 `compile()`(줌 개념 없음)은 LOD를 끄고 모든 흐름을 그린다.

### 데이터 모델 (A 모델)

편집 대상은 `@geo-insight/data`의 빌드 자산(`packages/data/assets/layers/*.json`)이다.
`편집 → 저장 → git → @geo-insight/* 빌드 → methii` 로 직접 이어진다.

원본 직접 편집의 위험은 **작업본 분리(스테이징)**로 막는다:

- 편집·저장은 `userData/layers-workspace` 샌드박스에서만.
- **`배포`** 버튼으로만 원본에 반영 — 스키마 검증 통과 시 원자적 쓰기.
- **`시드 교체`**로 원본 → 작업본 재시드(원본이 외부에서 갱신됐을 때).
- `GEO_LAYERS_DIR` 환경변수로 편집 대상 디렉터리 오버라이드 가능.

## 개발

```bash
pnpm install
pnpm test         # vitest (resolver / parser / compile / golden / 마운트)
pnpm typecheck    # 전 패키지 tsc --noEmit
pnpm build        # 각 패키지 + @geo-insight/tiptap rollup 번들
```

## 불변 원칙

1. **의미 우선** — 입력은 좌표가 아니라 이름·역할·관계.
2. **결정적·diffable** — 같은 입력 = 바이트 동일 SVG (좌표 반올림, 안정 id/순서).
3. **프레임워크 비종속 core** — 순수 함수 `compile(source)`.
4. **헤드리스 core + 호스트 어댑터** — 마크다운/줌팬/프레임워크 바인딩은 별도 패키지.
5. **교육적 서사가 목적** — 정확한 수치 인코딩이 아니라 관계의 *이해*.
