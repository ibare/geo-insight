/**
 * 선택 면색 팔레트 — 하이브리드(시드 + 자동확장) × 안정 해시.
 *
 * 전략:
 *   - 큐레이션한 시드 색(theme.selectPalette)을 톤 앵커로 둔다.
 *   - 시드 수를 넘는 색이 필요하면 시드의 평균 채도·명도(S·L)를 유지한 채
 *     색상(Hue)만 황금각(137.508°)으로 회전해 자동 생성 → 톤 일관 + 무한 확장.
 *   - 색 배정은 등장 순서가 아니라 엔티티 key 의 안정 해시로 — "같은 지역은 언제나 같은 색".
 *
 * 의존성 0(순수 함수). 결정적이라 스냅샷·diff 가능.
 */

/** 시드를 확장한 총 색 수(시드 8 + 자동생성). 인접 동색 충돌을 충분히 낮춘다. */
const PALETTE_SIZE = 24;
/** 황금각 — 연속 hue 회전 시 인접 색이 잘 갈린다. */
const GOLDEN_ANGLE = 137.508;

/** #rrggbb → [h(0..360), s(0..1), l(0..1)]. */
export function hexToHsl(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0.5];
  const int = parseInt(m[1]!, 16);
  const r = ((int >> 16) & 0xff) / 255;
  const g = ((int >> 8) & 0xff) / 255;
  const b = (int & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

/** [h(0..360), s(0..1), l(0..1)] → #rrggbb. */
export function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360 / 360;
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2rgb = (t: number): number => {
      let tt = t;
      if (tt < 0) tt += 1;
      if (tt > 1) tt -= 1;
      if (tt < 1 / 6) return p + (q - p) * 6 * tt;
      if (tt < 1 / 2) return q;
      if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
      return p;
    };
    r = hue2rgb(hh + 1 / 3);
    g = hue2rgb(hh);
    b = hue2rgb(hh - 1 / 3);
  }
  const to2 = (x: number): string =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

/** FNV-1a 32bit — 결정적 문자열 해시. */
export function stableHash(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * 시드 배열 → PALETTE_SIZE 개로 확장.
 * 시드를 앞에 두고, 부족분은 시드 평균 S·L 을 유지한 채 hue 를 황금각 회전해 채운다.
 */
export function buildSelectPalette(seeds: string[]): string[] {
  if (seeds.length === 0) return [];
  if (seeds.length >= PALETTE_SIZE) return seeds.slice();
  // 시드 평균 채도·명도(톤 앵커) — 생성색이 시드와 같은 파스텔 명도/채도를 따르게.
  let sSum = 0;
  let lSum = 0;
  let lastHue = 0;
  for (const hex of seeds) {
    const [h, s, l] = hexToHsl(hex);
    sSum += s;
    lSum += l;
    lastHue = h;
  }
  const avgS = sSum / seeds.length;
  const avgL = lSum / seeds.length;
  const out = seeds.slice();
  for (let i = seeds.length; i < PALETTE_SIZE; i++) {
    const hue = lastHue + GOLDEN_ANGLE * (i - seeds.length + 1);
    out.push(hslToHex(hue, avgS, avgL));
  }
  return out;
}

/** 확장 팔레트 캐시(시드 배열 동일성 기준) — 엔티티마다 재생성 방지. */
const paletteCache = new WeakMap<string[], string[]>();

function extendedPalette(seeds: string[]): string[] {
  let p = paletteCache.get(seeds);
  if (!p) {
    p = buildSelectPalette(seeds);
    paletteCache.set(seeds, p);
  }
  return p;
}

/**
 * 엔티티 key 로 선택 면색을 고른다(안정 해시).
 * 같은 key → 항상 같은 색. 시드가 비면 fallback 색 반환.
 */
export function pickSelectFill(key: string, seeds: string[], fallback: string): string {
  const palette = extendedPalette(seeds);
  if (palette.length === 0) return fallback;
  return palette[stableHash(key) % palette.length]!;
}
