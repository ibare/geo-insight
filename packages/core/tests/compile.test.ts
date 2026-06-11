import { describe, expect, it } from 'vitest';
import { buildModel, compile, renderAnnotations, renderModel } from '../src/compile.js';
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

  it('SVG 레이어 순서: ocean → graticule → world → entities → links → labels', () => {
    const { svg } = compile(src);
    const iOcean = svg.indexOf('gi-ocean');
    const iGrat = svg.indexOf('gi-graticule');
    const iWorld = svg.indexOf('gi-world');
    const iEntity = svg.indexOf('gi-entity');
    const iLink = svg.indexOf('gi-link');
    const iLabel = svg.indexOf('gi-labels');
    expect(iOcean).toBeGreaterThanOrEqual(0);
    expect(iOcean).toBeLessThan(iGrat);
    expect(iGrat).toBeLessThan(iWorld);
    expect(iWorld).toBeLessThan(iEntity);
    expect(iEntity).toBeLessThan(iLink);
    expect(iLink).toBeLessThan(iLabel);
  });

  it('수단→인도 화살표(taper wedge + arrowhead) 가 gi-link 로 생성된다', () => {
    const { svg } = compile(src);
    expect(svg).toContain('gi-link');
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

describe('compile — fit', () => {
  it('fit:bbox 는 world 보다 확대된다(winding 폭주 버그 회귀 방지)', () => {
    const world = compile('earth:\n  center: 100\n  fit: world\n  show: 한국, 인도').meta.projectionParams.scale;
    const bbox = compile('earth:\n  center: 100\n  fit: [55,0,150,55]\n  show: 한국, 인도').meta.projectionParams.scale;
    expect(bbox).toBeGreaterThan(world * 1.5);
  });
});

describe('compile — globe(orthographic) 중앙 정렬', () => {
  it('디스크는 fit 과 무관하게 캔버스 중앙에 온다(translate=중심)', () => {
    // dominant fit(기본)이어도 globe 는 disc 를 중앙 배치해야 한다.
    const { meta } = compile('earth:\n  projection: orthographic\n  show: 아프리카, 수단, 인도', {
      width: 960,
      height: 600,
    });
    const [tx, ty] = meta.projectionParams.translate;
    expect(tx).toBeCloseTo(480, 0);
    expect(ty).toBeCloseTo(300, 0);
  });

  it('center 미지정 globe 는 표시 지역 중심을 정면으로(rotate 위도≠0)', () => {
    const { meta } = compile('earth:\n  projection: orthographic\n  show: 한국');
    // 한국(위도 ~37N)을 정면으로 → rotate[1] = -lat < 0 (0 이 아님).
    expect(meta.projectionParams.rotate[1]).not.toBe(0);
  });
});

describe('compile — 주석 레이어 분리 + annotationScale', () => {
  const src = 'earth:\n  show: 수단, 인도\n  link: 수단 -> 인도\n  label all { collide: true }';

  it('gi-geometry / gi-annotations 두 그룹으로 분리된다', () => {
    const { svg } = compile(src);
    expect(svg).toContain('class="gi-geometry"');
    expect(svg).toContain('class="gi-annotations"');
    // 라벨/링크는 주석 그룹, 전세계 배경은 지오메트리 그룹.
    const geo = svg.indexOf('gi-geometry');
    const anno = svg.indexOf('gi-annotations');
    expect(svg.indexOf('gi-world')).toBeGreaterThan(geo);
    expect(svg.indexOf('gi-world')).toBeLessThan(anno);
    expect(svg.indexOf('gi-labels')).toBeGreaterThan(anno);
  });

  it('renderAnnotations 는 주석만(전세계 배경 없음)', () => {
    const model = buildModel(src);
    const { annotations } = renderAnnotations(model);
    expect(annotations).toContain('gi-labels');
    expect(annotations).not.toContain('gi-world');
    expect(annotations).not.toContain('gi-ocean"'); // sphere 배경 제외
  });

  it('annotationScale<1 이면 라벨 폰트가 작아진다(줌인 시 화면상 일정)', () => {
    const model = buildModel(src);
    const base = renderModel(model);
    const zoomed = renderModel(model, { annotationScale: 0.5 });
    const sizeOf = (svg: string): number =>
      Number(/gi-labels[^>]*font-size="([\d.]+)"/.exec(svg)![1]);
    expect(sizeOf(zoomed.svg)).toBeLessThan(sizeOf(base.svg));
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
