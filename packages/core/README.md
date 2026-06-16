# @geo-insight/core

> GeoInsight 컴파일러 — 시맨틱 지리 DSL → 결정적 SVG. 프레임워크·DOM 의존 0의 순수 함수.

장소 이름(`미국`·`남미`·`인도`)과 관계(`수단 -> 인도`)를 다루는 DSL을 IR(중간 표현)을 거쳐
**결정적 SVG**로 컴파일합니다. 같은 입력은 바이트 동일한 SVG를 냅니다.

## 설치

```bash
npm install @geo-insight/core
```

`@geo-insight/data`(지오메트리·이름 resolver)와 `d3-geo`가 의존성으로 함께 설치됩니다.
`robinson`·`winkel3` 투영을 쓰려면 선택적 의존성 `d3-geo-projection`이 필요합니다.

## 사용법

```ts
import { compile } from '@geo-insight/core';

const { svg, scene, diagnostics, meta } = compile(source, { width: 960 });
// svg:         결정적 SVG 문자열 (동일 입력 = 바이트 동일)
// scene:       IR (entities / links / labels / projectionParams)
// diagnostics: 미해석 이름 등 (error / warning + suggestions)
```

```geoinsight
earth:
  show: 아프리카, 수단, 인도
  link: 수단 -> 인도
```

DSL 문법 전체는 [GeoInsight README](https://github.com/ibare/geo-insight#readme)를 참고하세요.

## License

MIT © ibare (Mintae Kim)
