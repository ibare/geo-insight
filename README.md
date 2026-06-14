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
| `@geoinsight/data` | 지오메트리(world-atlas 110m) + 이름 resolver(한·영·ISO, 그룹) | world-atlas, world-countries, topojson-client |
| `@geoinsight/core` | DSL → IR → SVG 컴파일러. 프레임워크/DOM 0 | `@geoinsight/data`, d3-geo |
| `@geoinsight/runtime` | 바닐라 DOM 마운트 + 줌/팬. 프레임워크 0 | `@geoinsight/core` |
| `@geoinsight/host-tiptap` | Tiptap 펜스 블록 익스텐션 (소스) | core, runtime; peer `@tiptap/*` |
| `@geoinsight/tiptap` | 위 전체를 인라인한 self-contained ESM 번들 (npm 배포) | peer `@tiptap/core`, `@tiptap/pm` |
| `@geoinsight/layer-editor` | 환경 레이어(해류·바람 등 흐름) 데이터 편집기 (Electron 데스크탑) | core, runtime, data; electron, react, radix |

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
    arrow: taper        # 끝이 굵어지는 wedge
    geodesic: true      # 대권선 샘플링 후 투영
    color: teal
    anchor: border      # border(국경 출발) | centroid
  }

  label all { place: centroid, collide: true }
```

### 키워드

| 키 | 위치 | 값 |
|---|---|---|
| `show` | scene | 이름 리스트 |
| `link` / `wind` / `current` / `route` | scene | `A -> B "라벨"` (관계 타입별 키워드, 트레일링 문자열은 라벨) |
| `center` | scene | lon 숫자 \| 엔티티명 \| `pacific`/`태평양`/`atlantic`/`대서양`/`인도양` |
| `arrange` | scene | `A -> B` (좌→우, center 자동 산출) |
| `fit` | scene | `entities` \| `dominant` \| `world` \| `[w,s,e,n]` |
| `projection` | scene | `naturalEarth1` \| `equirectangular` \| `mercator` \| `orthographic` \| `robinson`* \| `winkel3`* |
| `group`/`focus`/`plain` | entity | `{ fill, borders, label, opacity }` |
| `link … { }` | scene | `{ type, label, labelAt, head, curve, color, anchor, geodesic }` |
| `theme` | scene | `{ ocean, linkColor, worldFaint, graticule }` |

**링크 타입**: `arrow`(기본, taper wedge+화살촉) · `wind`(점선 흐름) · `current`(물결, 해류) · `route`(가는 점선). 최소형은 타입 키워드로(`wind: 태평양 -> 인도양 "무역풍"`), 명시형은 `link … { type: current, label: "쿠로시오", labelAt: mid }`. `head`(`taper`\|`triangle`\|`none`)로 화살촉 모양 조정. 새 타입은 `registerLinkRenderer(type, fn)`로 확장 가능.

\* `robinson`/`winkel3`은 d3-geo-projection이 필요하다. 미등록 시 naturalEarth1로 폴백(경고).
Node CLI 등에서 `registerExtProjection('robinson', geoRobinson)`로 주입할 수 있다.

## 프로그래밍 API

```ts
import { compile } from '@geoinsight/core';

const { svg, scene, diagnostics, meta } = compile(source, { width: 960 });
// svg: 결정적 SVG 문자열 (동일 입력 = 바이트 동일)
// scene: IR (entities/links/labels/projectionParams)
// diagnostics: 미해석 이름 등 (error/warning + suggestions)
```

```ts
import { mount } from '@geoinsight/runtime';

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
    const m = await import('@geoinsight/tiptap');
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
- NodeView: React 없는 vanilla DOM. `@geoinsight/runtime`의 줌/팬 맵을 마운트(FACET 패턴).
- 마크다운 round-trip: `geoInsightNodeToMarkdown(source, { height })` ↔ `GEOINSIGHT_FENCE_RE`.
- 높이 영속: `data-height` attr (하단 핸들 드래그로 갱신).
- peer: `@tiptap/core`, `@tiptap/pm` 둘뿐 (React 불요).

## 레이어 에디터 (`@geoinsight/layer-editor`)

해류·바람 같은 **환경 레이어 데이터**를 지도 위에서 직접 그려 편집하는 Electron 데스크탑 앱.
전문가(도메인 전문가, 디자이너 아님)가 데이터를 입력하면 `methii`가 그대로 렌더한다.

```bash
pnpm --filter @geoinsight/layer-editor dev    # 개발 실행
pnpm --filter @geoinsight/layer-editor build  # electron-vite 빌드
```

### 흐름(flow) 프리미티브

해류·바람·(작전도의) 공격축처럼 **굵기·색·굴곡·방향·화살촉을 가진 흐름 화살표**는 의미 중립
파라메트릭 오브젝트다. `kind`만 바꾸면 무엇이든 된다. 사용자는 모양을 그리는 게 아니라,
**시스템이 강제하는 곡선 위에서 길이·굴곡·두께·색만** 조절한다 — 누가 그려도 스타일·품질이 동일하다.

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

#### `width` = 실제 폭(km), 줌 종속 LOD

`width`는 화면 픽셀이 아니라 **해류의 실제 폭(km)** 이다(쿠로시오 ~100, 연안류 ~25). 화면 두께와
가시 여부가 이 값 하나에서 파생된다 — 작성자는 줌별 표시 규칙을 따로 관리하지 않는다.

```
화면 두께(px) = width(km) × pxPerKm(현재 줌의 해상도)
가시성        = 화면 두께 ≥ 1px 일 때만 표시
```

- **폭이 좁은 해류는 줌아웃하면 화면 1px 미만이 되어 자동으로 사라지고**(63빌딩이 100km 상공에선
  안 보이듯), 줌인하면 다시 나타난다. 굵은 대양 경계류(쿠로시오 등)는 줌아웃에도 남는다.
- 줌인 굵기 정책(실폭 비례 ↔ 화면 고정)·가시 임계·페이드는 `core`의 `resolveFlowWidth` /
  `FlowWidthParams`(`gamma`·`min/maxPx`·`hideBelowPx`·`fadeToPx`)로 결정 — 정답을 코드에 박지 않고
  **라이브로 튜닝**한다(플레이그라운드 "흐름 튜닝" 슬라이더, `setFlowParams`).
- 렌더는 `gi-flows` 그룹(본체+화살촉+라벨)으로 **줌마다 재렌더**해 두께·가시성·opacity를 갱신한다.
  비대화형 `compile()`(줌 개념 없음)은 LOD를 끄고 모든 흐름을 그린다.

### 데이터 모델 (A 모델)

편집 대상은 `@geoinsight/data`의 빌드 자산(`packages/data/assets/layers/*.json`)이다.
`편집 → 저장 → git → @geoinsight/* 빌드 → methii` 로 직접 이어진다.

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
pnpm build        # 각 패키지 + @geoinsight/tiptap rollup 번들
```

## 불변 원칙

1. **의미 우선** — 입력은 좌표가 아니라 이름·역할·관계.
2. **결정적·diffable** — 같은 입력 = 바이트 동일 SVG (좌표 반올림, 안정 id/순서).
3. **프레임워크 비종속 core** — 순수 함수 `compile(source)`.
4. **헤드리스 core + 호스트 어댑터** — 마크다운/줌팬/프레임워크 바인딩은 별도 패키지.
5. **교육적 서사가 목적** — 정확한 수치 인코딩이 아니라 관계의 *이해*.
