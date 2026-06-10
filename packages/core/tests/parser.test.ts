import { describe, expect, it } from 'vitest';
import { parse } from '../src/parser.js';
import type { EntityStmt, LinkStmt, ScenePropStmt } from '../src/ast.js';

describe('parser — 최소형', () => {
  const src = `earth:
  show: 아프리카, 수단, 인도
  link: 수단 -> 인도`;

  it('show 리스트와 link 관계를 분해한다', () => {
    const { ast, diagnostics } = parse(src);
    expect(diagnostics.filter((d) => d.level === 'error')).toHaveLength(0);
    expect(ast.statements).toHaveLength(2);

    const show = ast.statements[0] as ScenePropStmt;
    expect(show.kind).toBe('prop');
    expect(show.key).toBe('show');
    expect(show.list).toEqual(['아프리카', '수단', '인도']);

    const link = ast.statements[1] as ScenePropStmt;
    expect(link.key).toBe('link');
    expect(link.relation).toEqual({ from: '수단', to: '인도' });
  });
});

describe('parser — 명시형', () => {
  const src = `earth "무역풍":
  center: 태평양
  fit: dominant
  projection: naturalEarth1

  group 아프리카  { fill: amber, borders: keep }
  focus 수단      { fill: coral }
  focus 인도      { fill: coral }

  link 수단 -> 인도 {
    arrow: taper
    curve: 0.25
    color: teal
    anchor: border
    geodesic: true
  }

  label all { place: centroid, collide: true }`;

  it('title 을 읽는다', () => {
    const { ast } = parse(src);
    expect(ast.title).toBe('무역풍');
  });

  it('scene props/entities/link/label 을 모두 파싱한다', () => {
    const { ast, diagnostics } = parse(src);
    expect(diagnostics.filter((d) => d.level === 'error')).toHaveLength(0);

    const entities = ast.statements.filter((s): s is EntityStmt => s.kind === 'entity');
    expect(entities).toHaveLength(3);
    expect(entities[0]).toMatchObject({ role: 'group', name: '아프리카' });
    expect(entities[0]!.props).toEqual({ fill: 'amber', borders: 'keep' });
    expect(entities[1]).toMatchObject({ role: 'focus', name: '수단' });

    const link = ast.statements.find((s): s is LinkStmt => s.kind === 'link')!;
    expect(link.from).toBe('수단');
    expect(link.to).toBe('인도');
    expect(link.props).toEqual({
      arrow: 'taper',
      curve: 0.25,
      color: 'teal',
      anchor: 'border',
      geodesic: true,
    });

    const label = ast.statements.find((s) => s.kind === 'label');
    expect(label).toMatchObject({ kind: 'label', target: 'all' });
  });
});

describe('parser — 링크 인라인 라벨', () => {
  it('link: A -> B "라벨" 의 트레일링 문자열을 label 로 분리', () => {
    const { ast } = parse(`earth:\n  link: 수단 -> 인도 "무역 항로"`);
    const p = ast.statements[0] as ScenePropStmt;
    expect(p.relation).toEqual({ from: '수단', to: '인도' });
    expect(p.label).toBe('무역 항로');
  });
  it('라벨 없으면 to 가 온전하다', () => {
    const { ast } = parse(`earth:\n  wind: 태평양 -> 인도양`);
    const p = ast.statements[0] as ScenePropStmt;
    expect(p.key).toBe('wind');
    expect(p.relation).toEqual({ from: '태평양', to: '인도양' });
    expect(p.label).toBeUndefined();
  });
});

describe('parser — center 음수/프리셋, fit bbox', () => {
  it('center 음수 경도', () => {
    const { ast } = parse(`earth:\n  center: -120`);
    const p = ast.statements[0] as ScenePropStmt;
    expect(p.key).toBe('center');
    expect(p.raw).toBe('-120');
  });

  it('fit bbox 배열', () => {
    const { ast } = parse(`earth:\n  fit: [-20, -35, 55, 38]`);
    const p = ast.statements[0] as ScenePropStmt;
    expect(p.raw).toContain('-20');
    expect(p.raw).toContain('38');
  });

  it('주석은 무시된다', () => {
    const { ast, diagnostics } = parse(`earth:\n  # 주석\n  show: 인도`);
    expect(diagnostics.filter((d) => d.level === 'error')).toHaveLength(0);
    expect(ast.statements).toHaveLength(1);
  });
});
