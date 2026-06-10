export interface Preset {
  label: string;
  source: string;
}

export const PRESETS: Preset[] = [
  {
    label: '수단 → 인도 (최소형)',
    source: `earth:
  show: 아프리카, 수단, 인도
  link: 수단 -> 인도`,
  },
  {
    label: '무역풍 (좌우 배치)',
    source: `earth "무역풍":
  center: 태평양
  show: 아프리카, 동남아시아, 아메리카`,
  },
  {
    label: '대권 항로 (명시형 + geodesic)',
    source: `earth "대권 항로":
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

  label all { collide: true }`,
  },
  {
    label: '유럽 권역',
    source: `earth "유럽":
  center: 15
  show: 서유럽, 북유럽, 남유럽, 동유럽`,
  },
  {
    label: '미국 주 (ADM1)',
    source: `earth "미국 주":
  center: -98
  fit: bbox -125 24 -66 50
  show: California, Texas, Florida, New York`,
  },
  {
    label: 'showOnly — 미국 격리',
    source: `earth "미국":
  showOnly: 미국
  show: California, Texas, Florida`,
  },
];
