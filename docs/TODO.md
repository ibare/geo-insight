# TODO — geo-insight 백로그

호스트(methii) 연동 과정에서 접수했거나 작업 중 발견한 항목. **당장 하지 않는다** — 착수 전
이 문서의 "현황"을 다시 검증할 것(코드가 그새 바뀌었을 수 있다).

기록일: 2026-09-01 · 기준 버전: v0.3.0

---

## A. `typesVersions` 폴백 — `parse` / `validate` / `spec`

**요청** 호스트가 서브경로 import에 `@ts-expect-error`를 2곳 쓰고 있다. 제거하고 싶다.

**현황 (검증됨)** 전 패키지에 `typesVersions` 필드가 없다. 서브경로 타입은 `exports` 맵의
`types` 조건으로만 노출된다:

```jsonc
// packages/core/package.json
"exports": {
  ".":         { "types": "./dist/index.d.ts",    "import": "./dist/index.js" },
  "./parse":   { "types": "./dist/parse.d.ts",    "import": "./dist/parse.js", "require": "./dist/cjs/parse.js" },
  "./validate":{ "types": "./dist/validate.d.ts", "import": "./dist/validate.js" },
  "./spec":    { "types": "./dist/spec.d.ts",     "import": "./dist/spec.js" }
}
```

**원인** TypeScript는 `moduleResolution`이 `node`(=node10)일 때 `exports` 맵을 **읽지 않는다**.
호스트 tsconfig가 그 설정이면 `@geo-insight/core/parse`의 타입을 찾지 못해 `@ts-expect-error`가
필요해진다. 런타임은 Vite/Rollup이 `exports`를 읽으므로 정상 동작한다 — **타입만의 문제**다.

**판단** 유효. 저비용이고 부작용이 거의 없다. 다만 근본 해법은 호스트 tsconfig를
`moduleResolution: "bundler"`(또는 `node16`)로 올리는 것이다. 호스트 사정으로 그게 어렵다면
우리가 폴백을 제공하는 게 맞다 — 라이브러리가 소비자 환경을 넓게 받는 편이 낫다.

**작업**

```jsonc
// packages/core/package.json — exports 는 그대로 두고 추가
"typesVersions": {
  "*": {
    "parse":    ["./dist/parse.d.ts"],
    "validate": ["./dist/validate.d.ts"],
    "spec":     ["./dist/spec.d.ts"]
  }
}
```

- `@geo-insight/data`의 `./names`·`./node`·`./browser`도 같은 문제를 안고 있다. 함께 넣을지
  결정할 것(호스트가 `data`를 직접 import하지 않는다면 불필요).
- **와일드카드 매핑(`"*": ["..."]`)은 쓰지 말 것.** 루트 `.`의 타입 해석까지 가로채 오히려
  깨진다. 서브경로만 명시적으로 나열한다.
- `files`에 `dist`가 이미 포함되므로 발행 산출물 변경은 없다.

**검증** node10 해석을 쓰는 임시 프로젝트로 확인한다. 이 조건이 재발하지 않게 테스트를 붙이는
게 이상적이다:

```jsonc
// 임시 tsconfig
{ "compilerOptions": { "moduleResolution": "node", "types": [] } }
```

```ts
import { parse } from '@geo-insight/core/parse';      // 에러 없이 타입이 잡혀야 한다
import { validate } from '@geo-insight/core/validate';
import { DSL_SPEC } from '@geo-insight/core/spec';
```

**영향** 타입 해석만 바뀐다. 런타임·번들 무변경. patch 릴리스로 충분.

---

## B. spec에 "제목·라벨은 서술 언어로 쓴다" 한 줄

**요청** `DSL_SPEC`에 *"titles/labels are written in the narration language"* 한 줄. 예제의 언어
편향을 없앤다.

**현황 (검증됨)** `DSL_SPEC` 10절은 지명에 대해 *"Korean or English names"*라고만 적고 있고,
**제목(`earth "…"`)과 라벨 문자열의 언어에 대한 지침은 없다**. 반면 `SPEC_EXAMPLES` 8개는
제목·라벨이 전부 한글이다(`earth "대권 항로"`, `wind: … "무역풍"`). LLM은 예제를 따라가므로
영어 문서를 쓰는 중에도 한글 제목을 붙일 공산이 크다.

**판단** 유효하고, 이 방향이 맞다. 대안은 "출력 언어를 옵션으로 받는 것"인데 그건 spec이 할 일이
아니다 — **제목·라벨은 자유 문자열이라 이미 어떤 언어든 쓸 수 있다.** 모르는 건 LLM뿐이므로
문서로 알려주면 끝난다. 지명과 자유 문자열의 성격이 다르다는 점을 함께 적어야 오해가 없다:

- **지명** — 해석 대상. 한국어/영어/ISO 코드만 해석되고, **쓴 그대로 라벨이 된다**(C 참조).
- **제목·링크 라벨** — 자유 문자열. 해석하지 않으므로 어떤 언어든 무방하다.

**작업** `packages/core/src/spec.ts`. 1절(Structure) 또는 10절(Which names resolve) 말미에 추가.
초안:

> Titles (`earth "…"`) and link label strings are free text — they are never resolved, so write
> them in the language of the surrounding document. Place names are different: they must resolve,
> and they appear on the map exactly as you write them (see §10).

예제의 한글 편향 자체는 **그대로 두는 편이 낫다** — 지명이 한글이어야 자연스러운 예제이고,
영어 예제로 바꾸면 §10의 "한국어 지명도 해석된다"는 사실이 흐려진다. 대신 예제 하나 정도를
영어 제목 + 영어 지명으로 추가해 양쪽을 보여주는 선택지가 있다(`SPEC_EXAMPLES`에 추가하면
`spec.test.ts`가 자동으로 검증한다).

**영향** 문서 문자열만. `spec.test.ts`의 토큰 예산 상한(4,000)에 여유가 있다(현재 ≈2,360).

---

## C. 라벨 언어 — "display가 한국어 고정"

**요청** `display`가 `translations.kor ?? name.common`으로 한국어 고정이라 다국어 트리에서 지도
라벨이 한국어로 뜬다. `locale` 옵션은 패스스루 미구현.

**현황 (검증됨) — 지적이 부분적으로만 맞다.** 라벨 생성 경로가 넷이고, 언어가 고정된 것은
**둘**이다:

| 경로 | 값의 출처 | 언어 | 코드 |
|---|---|---|---|
| `show`/entity로 **명시한 이름** | 사용자가 쓴 원문(rawName) | **입력 언어를 따름** | `build-scene.ts` `display: rawName` |
| `showOnly` 자동 채움 ADM1 | `properties.kor` | 한국어 고정 | `build-scene.ts` `display: f.properties.kor` |
| 흐름 레이어(해류·바람) 라벨 | `properties.kor` | **한국어 고정** | `emit.ts:231, 389` |
| 5대양 라벨 | 소스에 하드코딩 | **한국어 고정** | `oceans.ts:29` |

실측:

```
show: 한국              → 라벨 '한국'
show: South Korea, Japan → 라벨 'South Korea', 'Japan'   ← 이미 패스스루
layers: 해류            → SVG에 '멕시코 만류'만, 'Gulf Stream' 없음
fit: world              → SVG에 '태평양' 하드코딩
```

즉 **명시 지명은 이미 입력 언어를 그대로 따른다.** 영어로 쓰면 영어 라벨이 나온다.
`showOnly` 자동 ADM1은 `display`가 한국어로 채워지지만 `canvasStyle`이 `label: false`라
**라벨로 출력되지는 않는다**(hover/`Entity.display`를 소비하는 경로에서만 노출).

따라서 실제로 고쳐야 할 것은 **자동 생성 라벨 2곳(흐름·5대양)** 과 **`locale` 배선**이다.

**`locale` 옵션 현황 (검증됨)** 인터페이스에만 있고 **어디로도 전달되지 않는 dead option**이다:

- `host-tiptap/src/mount.ts:20`, `node.ts:10`, `node-view.ts:24` — `locale?: string` 선언
- `node.ts:53` — `locale: undefined`로 넘김
- `runtime`의 `MountOptions`에 `locale` **없음** → 여기서 끊긴다
- `core`의 `CompileOptions`에도 **없음**(`types.ts:171`)

**판단** 유효. 다만 "`display`를 다국어로 만든다"가 아니라 **"자동 생성 라벨에 언어 선택을
배선한다"** 가 맞는 문제 정의다. 데이터에는 영어명이 이미 있다 — 국가는
`properties.name`, ADM1은 `name`, 레이어는 `properties.name`(`Gulf Stream`, `Kuroshio`).
새 데이터가 필요 없다.

**작업 범위 (배선이 4계층을 관통하므로 작지 않다)**

1. `core/types.ts` — `CompileOptions.locale?: 'ko' | 'en'` 추가. 기본 `'ko'`(현행 유지).
2. `oceans.ts` — 5대양 라벨을 `{ ko, en }` 쌍으로. 하드코딩 문자열 제거.
3. `emit.ts:231,389` — `f.properties.kor` → locale에 따라 `kor`/`name` 선택. `kor`이 비면 `name`
   폴백(현재도 `if (f.properties.kor)` 가드가 있어 빈 값이면 라벨이 아예 사라진다).
4. `build-scene.ts` — `showOnly` 자동 ADM1의 `display`도 동일 규칙.
5. `runtime/mount.ts` → `MountOptions.locale` 추가, `compileOpts`로 전달.
6. `host-tiptap` — 이미 있는 `locale`을 runtime으로 실제 전달(현재 끊긴 지점 연결).

**결정이 필요한 것**

- **명시 지명은 건드리지 않는다**가 기본선이다. `show: 한국`에 `locale: 'en'`을 걸어 `Korea`로
  바꾸면, 사용자가 쓴 것과 화면이 달라져 "쓴 대로 나온다"는 예측 가능성이 깨진다. 다국어 트리가
  정말 필요하면 **소스를 그 언어로 생성하는 것**이 옳다 — LLM 파이프라인이므로 어렵지 않다.
  (B 항목이 바로 그 이야기다.)
- 그렇다면 `locale`의 의미는 **"자동 생성 라벨의 언어"** 로 좁혀 정의되어야 한다. 이름이
  오해를 부르면 `autoLabelLocale` 같은 이름을 고려.

**함께 볼 기존 결함** 같은 영역이라 한 번에 처리하는 게 낫다:

- **점표기 라벨이 그대로 노출된다.** `show: 미국.캘리포니아` → 라벨 텍스트가
  **`미국.캘리포니아`**. `display = rawName`이라서다. resolve 결과의 표시명으로 정규화해야
  한다(`res.display`). 원문은 매칭에만 쓰고 표시에는 쓰지 않는다.

**영향** 렌더 출력이 바뀐다 — **골든 스냅샷 갱신이 필요**하고, 기본값을 `'ko'`로 두어 기존
출력이 유지되는지 확인해야 한다. minor 릴리스.

---

## 그 밖의 백로그 (연동 검토 중 발견, 미착수)

렌더 동작을 바꾸므로 위 3건과 분리해 판단한다.

| 항목 | 내용 | 비고 |
|---|---|---|
| compile 진단 강화 | `compile()`은 미지 entity/link 속성·잘못된 `fit`·없는 색 토큰에 침묵한다. `validate`는 이미 잡는다 | 같은 화이트리스트(`vocabulary.ts`)를 `build-scene`에서 재사용하면 됨. `CompileOptions.strict` 검토 |
| `label { place }` 실구현 | 현재 파싱되지만 무시되고 라벨은 항상 centroid | 구현하거나 문법에서 제거. 현재는 spec 8절에 "무시됨"으로 명시 |
| `arrow` → `head` 정식 별칭 | `arrow: taper`는 무시된다(기본값이 taper라 우연히 결과가 같을 뿐). `arrow: triangle`은 조용히 taper가 된다 | 별칭으로 정식 지원하거나 경고 유지 |
| `label X {}` 병합 규칙 | `label` 선언이 하나라도 있으면 나머지 엔티티 라벨이 전부 사라진다 | 의도된 설계인지 확정 후 spec 5절과 일치시킬 것 |
| ADM1 프리로드 헬퍼 | 맨 `compile()`은 ADM1을 해석하지 못한다(지오메트리 미로드). 호출자가 `adm1CountriesFor` → `loadAdm1*` → `compile`을 직접 조립해야 함 | 서버에서 SVG를 렌더할 일이 생기면 필요. 현재 worker는 `validate`만 쓰므로 불필요 |
| 배럴의 Node 비호환 | `@geo-insight/core`·`data`는 JSON import attribute 누락으로 Node 20/22+에서 import 즉시 크래시 | 경량 진입점으로 우회 완료. 배럴 자체를 고치려면 world-atlas JSON까지 JS 모듈로 프리빌드해야 함 |
