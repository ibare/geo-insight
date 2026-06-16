# @geo-insight/tiptap

> Tiptap NodeView for **GeoInsight** — embed deterministic, semantic geographic diagrams (*"Mermaid for maps"*) inside your document via a ```` ```geoinsight ```` fence.

장소 이름(`미국`·`남미`·`인도`)과 관계(`수단 -> 인도`)를 1급 시민으로 다루는 시맨틱 DSL을
결정적 SVG로 렌더하는 GeoInsight를, Tiptap 에디터에 **단일 의존성**으로 통합하는 self-contained ESM 번들입니다.

`@geo-insight/host-tiptap` + `runtime` + `core` + `data`를 모두 Rollup으로 인라인했기 때문에
peer 의존성은 `@tiptap/core`·`@tiptap/pm` 둘뿐입니다 (runtime이 vanilla DOM이라 React 불필요).

## 설치

```bash
npm install @geo-insight/tiptap @tiptap/core @tiptap/pm
```

```bash
pnpm add @geo-insight/tiptap @tiptap/core @tiptap/pm
```

`@tiptap/core`·`@tiptap/pm`는 peer 의존성입니다 (`^3.22.5`).

## 사용법

```ts
import { Editor } from '@tiptap/core';
import { GeoInsightExtension, bootstrapGeoInsight } from '@geo-insight/tiptap';

bootstrapGeoInsight();                                  // 앱 부팅 시 1회 (styles.css 주입)

new Editor({
  extensions: [GeoInsightExtension /* , StarterKit, … */],
});
```

번들 import 시점에 `geoinsight-*` prefix를 가진 styles.css가 `<head>`에 1회 주입됩니다
(호스트 전역 CSS와 충돌 위험 낮음).

### 코드 분할(lazy load) 권장

번들에 지오메트리 데이터가 인라인되어 크기가 큽니다. 호스트에서 동적 import로 lazy 로드하세요:

```ts
let bootstrapped = false;

async function loadGeoInsight() {
  const m = await import('@geo-insight/tiptap');
  if (!bootstrapped) { m.bootstrapGeoInsight(); bootstrapped = true; }
  return m.GeoInsightExtension;
}
```

## DSL

마크다운 펜스로 임베딩합니다 — Mermaid와 동일한 모델.

````markdown
```geoinsight
earth:
  show: 아프리카, 수단, 인도
  link: 수단 -> 인도
```
````

문법 전체는 [GeoInsight README](https://github.com/ibare/geo-insight#readme)를 참고하세요.

## Exports

```ts
import {
  GeoInsightExtension,          // Tiptap 익스텐션
  GEOINSIGHT_NODE_NAME,         // 노드명 (geoinsightBlock)
  bootstrapGeoInsight,          // styles.css 주입 (1회)
  createGeoInsightNodeView,
  mountGeoInsight,
  GEOINSIGHT_FENCE_LANG,        // 'geoinsight'
  GEOINSIGHT_FENCE_RE,          // 마크다운 펜스 정규식
  renderGeoInsightFenceHTML,
  renderGeoInsightFenceMeta,
  parseGeoInsightFenceMeta,
  geoInsightNodeToMarkdown,     // 노드 → 마크다운 round-trip
} from '@geo-insight/tiptap';

import type {
  GeoInsightExtensionOptions,
  GeoMountOptions,
  GeoMountHandle,
  GeoInsightFenceMeta,
} from '@geo-insight/tiptap';
```

## License

MIT © ibare (Mintae Kim)
