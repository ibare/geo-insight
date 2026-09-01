/**
 * '@geo-insight/core/validate' 계약 테스트.
 *
 * 두 축을 지킨다:
 *  1. 검출력 — LLM 이 흔히 틀리는 형태를 실제로 잡는가. compile 이 침묵하던 것들 포함.
 *  2. 의존 그래프 — 지오메트리(world-atlas)와 JSON import 가 새지 않는가.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validate, DSL_VOCABULARY } from '../src/validate.js';

const findDiag = (src: string, needle: string) =>
  validate(src).diagnostics.find((d) => d.message.includes(needle));

describe('validate — 검출력', () => {
  it('정상 소스는 진단 0, ok', () => {
    const r = validate('earth:\n  show: 아프리카, 수단, 인도\n  link: 수단 -> 인도\n');
    expect(r.diagnostics).toHaveLength(0);
    expect(r.ok).toBe(true);
  });

  it('문법 오류를 잡는다(parse 진단 승계)', () => {
    const r = validate('earth:\n  show 한국\n');
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]!.message).toContain("':' 가 필요합니다");
  });

  it('미존재 지명을 잡는다 — parse 가 못 잡던 것', () => {
    for (const name of ['고구려', '페르시아', '아틀란티스']) {
      const r = validate(`earth:\n  show: ${name}\n`);
      expect(r.ok, `${name} 이 통과됐다`).toBe(false);
    }
  });

  it('부분 일치는 기존 resolver 와 동일하게 해석한다 — 검증이 렌더보다 엄격해지지 않도록', () => {
    // '대한미국' 은 '미국' 을 포함해 partial 로 해석된다. 관대함의 기준을 compile 과 맞춘다.
    const r = validate('earth:\n  show: 대한미국\n');
    expect(r.ok).toBe(true);
    expect(r.names[0]!.key).toBe('840');
  });

  it('모호한 이름에는 후보를 제안한다 (resolver 와 같은 판정)', () => {
    // '수' 는 수단·남수단 등 복수 후보 → 미해석 + 제안. resolver.test.ts 와 같은 기준.
    const d = findDiag('earth:\n  show: 수\n', '해석할 수 없습니다');
    expect(d).toBeDefined();
    expect(d!.suggestions).toContain('수단');
    expect(d!.suggestions).toContain('남수단');
  });

  it('링크 끝점의 미해석도 잡는다', () => {
    const r = validate('earth:\n  link: 한국 -> 아틀란티스\n');
    expect(r.ok).toBe(false);
  });

  it('미지 scene 키를 잡는다', () => {
    expect(findDiag('earth:\n  show: 한국\n  zoom: 3\n', "알 수 없는 scene 속성: 'zoom'")).toBeDefined();
  });

  it('잘못된 투영을 잡고 근접 후보를 제안한다', () => {
    const d = findDiag('earth:\n  projection: mercater\n  show: 한국\n', '알 수 없는 투영');
    expect(d!.suggestions).toContain('mercator');
  });

  // ── 여기부터는 compile 이 조용히 무시하던 것들 ────────────────────────────
  it('미지 entity 속성을 잡는다 (compile 은 침묵)', () => {
    const d = findDiag('earth:\n  show: 한국\n  focus 한국 { bogus: 1 }\n', "'bogus'");
    expect(d).toBeDefined();
    expect(d!.level).toBe('warning');
  });

  it('미지 link 속성을 잡는다 (compile 은 침묵)', () => {
    expect(findDiag('earth:\n  link 한국 -> 일본 { nonsense: 3 }\n', "'nonsense'")).toBeDefined();
  });

  it('잘못된 fit 값을 잡는다 (compile 은 dominant 로 조용히 폴백)', () => {
    const d = findDiag('earth:\n  fit: nonsense\n  show: 한국\n', 'fit 값이 올바르지 않습니다');
    expect(d!.level).toBe('error');
  });

  it('bbox 형식 fit 은 통과시킨다', () => {
    expect(validate('earth:\n  fit: [100, 20, 140, 50]\n  show: 한국\n').ok).toBe(true);
  });

  it('존재하지 않는 색 토큰을 잡는다 (compile 은 그대로 SVG 에 흘림)', () => {
    expect(findDiag('earth:\n  show: 한국\n  focus 한국 { fill: nosuchcolor }\n', '색 토큰도 CSS 색도')).toBeDefined();
  });

  it('색 토큰과 CSS 색 이름은 통과시킨다', () => {
    const r = validate('earth:\n  show: 한국\n  focus 한국 { fill: coral, stroke: steelblue }\n');
    expect(r.diagnostics).toHaveLength(0);
  });

  it('hex 표기는 렉서가 주석으로 읽어 깨진다 — 파싱 에러로 드러난다', () => {
    // DSL 의 '#' 은 주석. `fill: #ff8800` 은 값이 비고 '}' 가 사라진다.
    expect(validate('earth:\n  show: 한국\n  focus 한국 { fill: #ff8800 }\n').ok).toBe(false);
  });

  it("무시되는 'arrow' 값에 head 를 안내한다", () => {
    const d = findDiag('earth:\n  link 한국 -> 일본 { arrow: triangle }\n', '무시됩니다');
    expect(d!.suggestions).toContain('head');
  });

  it("'arrow: line' 은 하위호환이므로 경고하지 않는다", () => {
    expect(validate('earth:\n  link 한국 -> 일본 { arrow: line }\n').ok).toBe(true);
  });

  it("무시되는 label 'place' 를 알린다", () => {
    expect(findDiag('earth:\n  show: 한국\n  label all { place: centroid }\n', "'place' 는 현재 무시")).toBeDefined();
  });

  it('알 수 없는 레이어를 잡는다', () => {
    const d = findDiag('earth:\n  layers: 해수면\n  show: 아시아\n', '알 수 없는 레이어');
    expect(d!.level).toBe('error');
  });

  it('유효한 레이어는 통과시킨다', () => {
    expect(validate('earth:\n  layers: 해류, 바람\n  show: 아시아\n').ok).toBe(true);
  });

  it('showOnly 가 국가가 아니면 잡는다', () => {
    expect(findDiag('earth:\n  showOnly: 아시아\n', 'showOnly 는 단일 국가')).toBeDefined();
  });

  it('ADM1 은 지오메트리 로딩 없이도 해석된다', () => {
    const r = validate('earth:\n  showOnly: 미국\n  show: California, 텍사스\n');
    expect(r.ok).toBe(true);
    expect(r.names.filter((n) => n.kind === 'adm1')).toHaveLength(2);
  });

  it("'국가.지역' 스코프 표기를 해석한다", () => {
    const r = validate('earth:\n  show: 미국.캘리포니아\n');
    expect(r.ok).toBe(true);
    expect(r.names[0]!.kind).toBe('adm1');
    expect(r.names[0]!.adm0).toBe('840');
  });

  it('center 의 방위 키워드·경도·엔티티명을 모두 통과시킨다', () => {
    for (const c of ['태평양', '60', '-120.5', '한국']) {
      expect(validate(`earth:\n  center: ${c}\n  show: 한국\n`).ok, c).toBe(true);
    }
  });

  it('해석 결과를 names 로 돌려준다(파이프라인 후처리용)', () => {
    const r = validate('earth:\n  show: 아시아, 한국\n');
    expect(r.names.map((n) => n.kind)).toEqual(['group', 'country']);
    expect(r.names[1]!.key).toBe('410');
  });
});

describe('validate — 의존 그래프', () => {
  const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

  it('validate 그래프에 지오메트리 경로가 없다', () => {
    // 데이터 접근은 오직 '@geo-insight/data/names'(경량 색인) 로만. 주석이 아니라 import 문만 본다.
    const imports = [...read('../src/validate.ts').matchAll(/^\s*(?:import|export)[^\n]*from\s+['"]([^'"]+)['"]/gm)]
      .map((m) => m[1]!);
    expect(imports).not.toContain('@geo-insight/data');
    for (const i of imports) expect(i).not.toMatch(/world-atlas|topojson/);
  });

  it('names 경로에 JSON import 가 없다 — Node 의 import attribute 요구를 피한다', () => {
    for (const f of ['names.ts', 'groups.ts', 'name-types.ts']) {
      expect(read(`../../data/src/${f}`), f).not.toMatch(/^\s*import[^\n]*\.json['"]/m);
    }
  });

  it('어휘 표가 노출된다(spec 생성용)', () => {
    expect(DSL_VOCABULARY.colorTokens).toHaveLength(9);
    expect(DSL_VOCABULARY.sceneKeys).toContain('showOnly');
    expect(DSL_VOCABULARY.entityProps).toContain('stroke');
  });
});
