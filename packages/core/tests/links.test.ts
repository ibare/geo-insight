import { describe, expect, it } from 'vitest';
import { compile } from '../src/compile.js';
import { hasError } from '../src/diagnostics.js';

describe('링크 타입/라벨 — IR', () => {
  it('기본 link 은 arrow 타입', () => {
    const { scene } = compile(`earth:\n  show: 수단, 인도\n  link: 수단 -> 인도`);
    expect(scene.links[0]!.type).toBe('arrow');
    expect(scene.links[0]!.style.head).toBe('taper');
  });

  it('wind/current scene 키워드 + 인라인 라벨', () => {
    const { scene, diagnostics } = compile(
      `earth:\n  show: 일본, 인도\n  wind: 일본 -> 인도 "편서풍"\n  current: 인도 -> 일본 "해류"`,
    );
    expect(hasError(diagnostics)).toBe(false);
    const wind = scene.links.find((l) => l.type === 'wind')!;
    const current = scene.links.find((l) => l.type === 'current')!;
    expect(wind.label).toBe('편서풍');
    expect(wind.style.dash).toBeDefined();
    expect(current.label).toBe('해류');
  });

  it('명시형 블록 type/label/head', () => {
    const { scene } = compile(
      `earth:\n  show: 일본, 미국\n  link 일본 -> 미국 {\n    type: current\n    label: "쿠로시오 해류"\n    color: sky\n  }`,
    );
    const l = scene.links[0]!;
    expect(l.type).toBe('current');
    expect(l.label).toBe('쿠로시오 해류');
    expect(l.style.color).toBe('#5aa8d6'); // sky 토큰
  });

  it('SVG 에 링크 라벨 텍스트가 들어간다', () => {
    const { svg } = compile(`earth:\n  show: 수단, 인도\n  link: 수단 -> 인도 "무역풍"`);
    expect(svg).toContain('gi-link-label');
    expect(svg).toContain('무역풍');
  });

  it('route 타입은 점선(가는 선), head 없음', () => {
    const { scene } = compile(`earth:\n  show: 수단, 인도\n  route: 수단 -> 인도`);
    const l = scene.links[0]!;
    expect(l.type).toBe('route');
    expect(l.style.head).toBe('none');
  });
});
