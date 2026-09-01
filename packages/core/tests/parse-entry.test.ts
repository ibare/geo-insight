/**
 * '@geo-insight/core/parse' 진입점 계약 테스트.
 *
 * 이 진입점의 존재 이유는 "데이터 레이어를 끌고 오지 않는 것" 하나다. 그래서 동작보다
 * **의존 그래프**를 지키는 것이 핵심이다 — parser 계열에 data 의존이나 JSON import 가
 * 하나라도 새면 호스트 번들이 다시 0.68MB 가 되고 Node 에서 죽는다.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hasError, parse } from '../src/parse.js';

/** 진입점의 도달 가능한 소스 전체(전이 폐포). 새 파일을 얹으면 여기에도 추가해야 한다. */
const GRAPH = ['parse.ts', 'parser.ts', 'lexer.ts', 'diagnostics.ts', 'ast.ts'];

function read(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/${name}`, import.meta.url)), 'utf8');
}

describe('core/parse 진입점', () => {
  it('문법 오류를 잡는다', () => {
    const { diagnostics } = parse('earth:\n  show 한국\n');
    expect(hasError(diagnostics)).toBe(true);
    expect(diagnostics[0]!.message).toContain("':' 가 필요합니다");
  });

  it('정상 소스는 진단 없이 AST 를 낸다', () => {
    const { ast, diagnostics } = parse('earth:\n  show: 한국, 일본\n  link: 한국 -> 일본\n');
    expect(diagnostics).toHaveLength(0);
    expect(ast.statements.length).toBeGreaterThan(0);
  });

  it('지명 해석은 하지 않는다 — 미존재 이름도 문법상 통과(검증은 validate 의 몫)', () => {
    const { diagnostics } = parse('earth:\n  show: 고구려\n');
    expect(diagnostics).toHaveLength(0);
  });

  it('그래프 어디에도 @geo-insight/data 의존이 없다', () => {
    for (const f of GRAPH) {
      expect(read(f), `${f} 가 데이터 패키지를 import 한다`).not.toMatch(
        /^\s*(import|export)[^\n]*from\s+['"]@geo-insight\/data/m,
      );
    }
  });

  it('그래프 어디에도 JSON import 가 없다 — Node 의 import attribute 요구를 피한다', () => {
    for (const f of GRAPH) {
      expect(read(f), `${f} 가 JSON 을 import 한다`).not.toMatch(
        /^\s*import[^\n]*from\s+['"][^'"]+\.json['"]/m,
      );
    }
  });

  it('그래프의 상대 import 는 전부 GRAPH 안에 있다(전이 폐포 유지)', () => {
    const allowed = new Set(GRAPH.map((f) => f.replace(/\.ts$/, '')));
    for (const f of GRAPH) {
      for (const m of read(f).matchAll(/from\s+['"]\.\/([^'"]+)\.js['"]/g)) {
        expect(allowed, `${f} → ./${m[1]} 가 GRAPH 에 없다`).toContain(m[1]!);
      }
    }
  });
});
