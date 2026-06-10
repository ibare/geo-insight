# 명시형 + 대권선

명시형은 역할·스타일·링크를 완전히 제어한다. `geodesic: true`면 대권선을 샘플링해
투영하므로 화살표가 지구 곡률을 따른다.

```geoinsight
earth "대권 항로":
  center: 60
  fit: dominant

  group 아시아 { fill: amber, borders: keep }
  focus 한국   { fill: coral }
  focus 인도   { fill: coral }

  link 한국 -> 인도 {
    arrow: taper
    geodesic: true
    color: teal
    anchor: border
  }

  label all { place: centroid, collide: true }
```
