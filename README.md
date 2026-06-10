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
