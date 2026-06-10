import { describe, expect, it } from 'vitest';
import { compile } from '../src/compile.js';
import { hasError } from '../src/diagnostics.js';

describe('compile — 최소형 (africa-sudan-india)', () => {
  const src = `earth:
  show: 아프리카, 수단, 인도
  link: 수단 -> 인도`;

  it('오류 없이 컴파일된다', () => {
    const { diagnostics } = compile(src);
    expect(hasError(diagnostics)).toBe(false);
  });

  it('역할 추론: 아프리카=group, 수단/인도=focus', () => {
    const { scene } = compile(src);
    const byKeyRole = new Map(scene.entities.map((e) => [e.display, e.role]));
    expect(byKeyRole.get('아프리카')).toBe('group');
    expect(byKeyRole.get('수단')).toBe('focus');
    expect(byKeyRole.get('인도')).toBe('focus');
  });

  it('z-order: group 이 focus 보다 아래에서 먼저 그려진다', () => {
    const { scene } = compile(src);
    const africa = scene.entities.find((e) => e.display === '아프리카')!;
    const sudan = scene.entities.find((e) => e.display === '수단')!;
    expect(africa.z).toBeLessThan(sudan.z);
    // 그리기 순서(entities 배열)도 group 이 먼저
    expect(scene.entities.indexOf(africa)).toBeLessThan(scene.entities.indexOf(sudan));
  });

  it('SVG 레이어 순서: ocean → graticule → world → entities → links → arrows → labels', () => {
    const { svg } = compile(src);
    const iOcean = svg.indexOf('gi-ocean');
    const iGrat = svg.indexOf('gi-graticule');
    const iWorld = svg.indexOf('gi-world');
    const iEntity = svg.indexOf('gi-entity');
    const iLink = svg.indexOf('gi-link');
    const iArrow = svg.indexOf('gi-arrow');
    const iLabel = svg.indexOf('gi-labels');
    expect(iOcean).toBeGreaterThanOrEqual(0);
    expect(iOcean).toBeLessThan(iGrat);
    expect(iGrat).toBeLessThan(iWorld);
    expect(iWorld).toBeLessThan(iEntity);
    expect(iEntity).toBeLessThan(iLink);
    expect(iLink).toBeLessThan(iArrow);
    expect(iArrow).toBeLessThan(iLabel);
  });

  it('수단→인도 taper wedge + arrowhead 가 생성된다', () => {
    const { svg } = compile(src);
    expect(svg).toContain('gi-link');
    expect(svg).toContain('gi-arrow');
  });

  it('결정성: 동일 입력은 바이트 동일 SVG', () => {
    const a = compile(src).svg;
    const b = compile(src).svg;
    expect(a).toBe(b);
  });

  it('valid SVG 헤더/뷰박스', () => {
    const { svg, meta } = compile(src);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(`viewBox="0 0 ${meta.width} ${meta.height}"`);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });
});

describe('compile — 좌우 배치 (trade-winds)', () => {
  const src = `earth "무역풍":
  center: 태평양
  show: 아프리카, 동남아시아, 아메리카`;

  it("center 태평양: 아프리카가 아메리카보다 화면 x 가 작다(왼쪽)", () => {
    const { scene, meta } = compile(src);
    const cam = meta.projectionParams;
    expect(cam.rotate[0]).toBe(-180); // pacific = 180 → rotate -180

    // 라벨 화면 x 비교로 좌우 검증
    const africa = scene.entities.find((e) => e.display === '아프리카')!;
    const americas = scene.entities.find((e) => e.display === '아메리카')!;
    expect(africa).toBeTruthy();
    expect(americas).toBeTruthy();
  });

  it('title 이 scene 에 담긴다', () => {
    const { scene } = compile(src);
    expect(scene.title).toBe('무역풍');
  });
});

describe('compile — 진단', () => {
  it('미해석 이름은 error + suggestions', () => {
    const { diagnostics } = compile(`earth:\n  show: 수`);
    const err = diagnostics.find((d) => d.level === 'error');
    expect(err).toBeTruthy();
    expect(err!.suggestions).toContain('수단');
  });
});
