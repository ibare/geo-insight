# @geo-insight/data

> GeoInsight 지오메트리 + 이름 resolver — world-atlas 토폴로지, ADM1 행정구역, 다국어 장소명 해석.

GeoInsight 컴파일러가 쓰는 데이터 계층입니다. 국가·대륙·권역 지오메트리(world-atlas 110m/50m),
국가별 ADM1 행정구역(234국), 그리고 한글·영문·ISO·그룹명을 받아 엔티티로 해석하는 resolver를 제공합니다.

## 설치

```bash
npm install @geo-insight/data
```

## 진입점

```ts
import { resolveName, /* … */ } from '@geo-insight/data';            // 공통 (이름 resolver + 지오메트리)
import { /* … */ } from '@geo-insight/data/node';                   // Node 환경 (fs 기반 자산 로드)
import { /* … */ } from '@geo-insight/data/browser';                // 브라우저 환경 (동적 import 청크)
```

- **assets 동봉**: ADM1 234국 + 환경 레이어(해류·바람) JSON이 패키지에 포함됩니다.
  국가별 ADM1은 `import('../assets/adm1/<ccn3>.json')` **동적 import**로 로드되므로,
  소비자 측 번들러(Vite·webpack·Rollup)가 이를 lazy 청크로 분해합니다.

## License

MIT © ibare (Mintae Kim)
