import { describe, expect, it } from 'vitest';
import { buildSelectPalette, hexToHsl, hslToHex, pickSelectFill, stableHash } from '../src/color.js';
import { DEFAULT_THEME } from '../src/theme.js';

const SEEDS = DEFAULT_THEME.selectPalette;

describe('color — HSL 왕복', () => {
  it('hex → hsl → hex 가 원본에 근사', () => {
    for (const hex of ['#a9c7e8', '#f3c3a6', '#000000', '#ffffff', '#3fb6ab']) {
      const [h, s, l] = hexToHsl(hex);
      const back = hslToHex(h, s, l);
      // 반올림 오차 ±2/255 허용.
      for (let i = 1; i < 7; i += 2) {
        const a = parseInt(hex.slice(i, i + 2), 16);
        const b = parseInt(back.slice(i, i + 2), 16);
        expect(Math.abs(a - b)).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('color — 안정 해시', () => {
  it('같은 key 는 항상 같은 해시', () => {
    expect(stableHash('840')).toBe(stableHash('840'));
    expect(stableHash('250')).not.toBe(stableHash('840'));
  });
});

describe('color — 확장 팔레트', () => {
  it('시드를 24색으로 확장하고 시드를 앞에 보존', () => {
    const p = buildSelectPalette(SEEDS);
    expect(p).toHaveLength(24);
    expect(p.slice(0, SEEDS.length)).toEqual(SEEDS);
  });

  it('자동 생성색은 시드 평균 명도/채도 톤을 따른다(파스텔 유지)', () => {
    const p = buildSelectPalette(SEEDS);
    const seedL = SEEDS.map((c) => hexToHsl(c)[2]);
    const avgL = seedL.reduce((a, b) => a + b, 0) / seedL.length;
    for (const gen of p.slice(SEEDS.length)) {
      const [, , l] = hexToHsl(gen);
      // 생성색 명도가 시드 평균 ±0.02 이내.
      expect(Math.abs(l - avgL)).toBeLessThan(0.02);
    }
  });

  it('빈 시드면 빈 배열', () => {
    expect(buildSelectPalette([])).toEqual([]);
  });
});

describe('color — pickSelectFill', () => {
  it('같은 key 는 언제나 같은 색(안정 해시)', () => {
    const a = pickSelectFill('840', SEEDS, '#000');
    const b = pickSelectFill('840', SEEDS, '#000');
    expect(a).toBe(b);
  });

  it('고른 색은 확장 팔레트 안의 색', () => {
    const palette = buildSelectPalette(SEEDS);
    for (const key of ['840', '250', '392', 'asia', 'x']) {
      expect(palette).toContain(pickSelectFill(key, SEEDS, '#000'));
    }
  });

  it('시드가 비면 fallback 반환', () => {
    expect(pickSelectFill('840', [], '#abcabc')).toBe('#abcabc');
  });
});
