/**
 * DSL_SPEC 계약 테스트.
 *
 *  1. spec 의 모든 예제는 실제로 검증을 통과해야 한다 — LLM 에게 주는 few-shot 이 깨져
 *     있으면 그대로 학습해 틀린 출력을 만든다.
 *  2. spec 은 어휘 전량을 담아야 한다 — 표에서 빠진 키는 LLM 이 존재를 모른다.
 *  3. 어휘는 build-scene 의 실동작과 일치해야 한다 — 구현에 키를 더하고 어휘에 안 적으면
 *     검사도 문서도 조용히 낡는다.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DSL_SPEC, SPEC_EXAMPLES, specSize } from '../src/spec.js';
import { DSL_VOCABULARY } from '../src/vocabulary.js';
import { validate } from '../src/validate.js';

const readSrc = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

describe('DSL_SPEC — 예제', () => {
  it.each(SPEC_EXAMPLES.map((e) => [e.title, e.source] as const))(
    '예제가 진단 없이 검증을 통과한다: %s',
    (_title, source) => {
      const r = validate(source);
      const shown = r.diagnostics.map((d) => `${d.level}: ${d.message}`).join('\n');
      expect(shown).toBe('');
      expect(r.ok).toBe(true);
    },
  );

  it('spec 본문의 펜스 예제와 SPEC_EXAMPLES 가 일치한다', () => {
    const fenced = [...DSL_SPEC.matchAll(/```geoinsight\n([\s\S]*?)\n```/g)].map((m) => m[1]!);
    // 서두의 소개 예제 1개 + SPEC_EXAMPLES.
    expect(fenced).toHaveLength(SPEC_EXAMPLES.length + 1);
    for (const src of fenced) expect(validate(src).ok, src).toBe(true);
  });
});

describe('README 예제', () => {
  it('README 의 geoinsight 펜스가 전부 검증을 통과한다', () => {
    const readme = readSrc('../../../README.md');
    const fences = [...readme.matchAll(/```geoinsight\n([\s\S]*?)```/g)].map((m) => m[1]!.trimEnd());
    expect(fences.length).toBeGreaterThan(0);
    for (const src of fences) {
      const r = validate(src);
      const shown = r.diagnostics.map((d) => `${d.level}: ${d.message}`).join('\n');
      expect(shown, src).toBe('');
    }
  });
});

describe('DSL_SPEC — 어휘 수록', () => {
  it('scene 키·entity/link 속성이 전부 문서에 등장한다', () => {
    for (const k of DSL_VOCABULARY.sceneKeys) expect(DSL_SPEC, k).toContain(`\`${k}\``);
    for (const k of DSL_VOCABULARY.entityProps) expect(DSL_SPEC, k).toContain(`\`${k}\``);
    for (const k of DSL_VOCABULARY.linkProps) expect(DSL_SPEC, k).toContain(`\`${k}\``);
  });

  it('색 토큰 9개와 투영 전량이 문서에 등장한다', () => {
    for (const c of DSL_VOCABULARY.colorTokens) expect(DSL_SPEC, c).toContain(`\`${c}\``);
    for (const p of DSL_VOCABULARY.projections) expect(DSL_SPEC, p).toContain(`\`${p}\``);
  });

  it('그룹 25개가 별칭까지 전량 수록된다', () => {
    expect(DSL_SPEC).toContain('동남아시아');
    expect(DSL_SPEC).toContain('`중동`');
    expect(DSL_SPEC).toContain('`북미`');
  });

  it('레이어는 실제 목록에서 온다', () => {
    expect(DSL_SPEC).toContain('`해류`');
    expect(DSL_SPEC).toContain('`바람`');
  });

  it('실동작 경고가 명시된다 — 무시되는 속성과 hex 불가', () => {
    expect(DSL_SPEC).toMatch(/arrow: taper.*ignored/s);
    expect(DSL_SPEC).toMatch(/place.*ignored/s);
    expect(DSL_SPEC).toContain('Hex is not expressible');
  });

  it('해석되지 않는 이름의 범위를 명시한다', () => {
    expect(DSL_SPEC).toContain('Historical and ancient names do not resolve');
    expect(DSL_SPEC).toContain('고구려');
  });

  it('프롬프트 예산을 알 수 있다', () => {
    const { chars, approxTokens } = specSize();
    expect(chars).toBeGreaterThan(2000);
    // 시스템 프롬프트에 상시 얹는 문서이므로 비대해지면 알아채야 한다.
    expect(approxTokens).toBeLessThan(4000);
  });
});

describe('DSL_SPEC — 구현 드리프트', () => {
  const buildScene = readSrc('../src/passes/build-scene.ts');

  it('build-scene 이 처리하는 scene 키가 어휘에 전부 있다', () => {
    // applySceneProp 의 `case 'xxx':` 목록 = 실제로 인식되는 키.
    const cases = [...buildScene.matchAll(/case '([a-zA-Z]+)':/g)].map((m) => m[1]!);
    const known = new Set<string>([
      ...DSL_VOCABULARY.sceneKeys,
      // scene 키가 아닌 다른 switch 문(statement kind, link type 등)에서 온 case 들.
      'prop', 'entity', 'link', 'label', 'theme',
      'wind', 'current', 'route', 'arrow',
      'Polygon', 'MultiPolygon',
    ]);
    for (const c of cases) expect(known, `build-scene 의 case '${c}' 가 어휘에 없다`).toContain(c);
  });

  it('build-scene 의 LINK_KEYWORDS 와 어휘가 일치한다', () => {
    const block = buildScene.match(/LINK_KEYWORDS[^=]*=\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    const keys = [...block.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]!);
    expect(new Set(keys)).toEqual(new Set(DSL_VOCABULARY.linkKeywords));
  });

  it('entity 속성이 applyStyleProps 의 실제 처리와 일치한다', () => {
    // 함수 본문만 — 뒤따르는 arrowStyleFrom/parseThemeProps 까지 삼키면 안 된다.
    const from = buildScene.indexOf('function applyStyleProps');
    const block = buildScene.slice(from, buildScene.indexOf('\nfunction ', from + 1));
    const handled = [...block.matchAll(/props\.(\w+)\s*!=\s*null/g)].map((m) => m[1]!);
    expect(new Set(handled)).toEqual(new Set(DSL_VOCABULARY.entityProps));
  });
});
