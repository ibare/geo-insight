# @geo-insight/runtime

> GeoInsight 런타임 — 컴파일된 지리 다이어그램을 바닐라 DOM에 마운트하고 줌/팬을 붙인다. 프레임워크 의존 0.

`@geo-insight/core`가 만든 SVG를 DOM에 마운트하고, 상호작용(줌·팬·엔티티 포커스)을 입힙니다.
React 등 프레임워크가 필요 없습니다.

## 설치

```bash
npm install @geo-insight/runtime
```

`@geo-insight/core`가 의존성으로 함께 설치됩니다.

## 사용법

```ts
import { mount } from '@geo-insight/runtime';
import '@geo-insight/runtime/styles.css';   // 줌/팬·라벨 스타일 (geoinsight-* prefix)

const inst = mount(el, source, { interactive: true });
inst.zoomTo('729');   // 엔티티 key(ccn3 또는 group id)로 카메라 이동
inst.reset();
inst.destroy();
```

DSL 문법 전체는 [GeoInsight README](https://github.com/ibare/geo-insight#readme)를 참고하세요.

## License

MIT © ibare (Mintae Kim)
