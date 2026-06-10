import { describe, expect, it } from 'vitest';
import {
  GEOINSIGHT_FENCE_LANG,
  GEOINSIGHT_FENCE_RE,
  geoInsightNodeToMarkdown,
  parseGeoInsightFenceMeta,
  renderGeoInsightFenceHTML,
  renderGeoInsightFenceMeta,
} from '../src/markdown.js';
import { GEOINSIGHT_NODE_NAME, GeoInsightExtension } from '../src/node.js';

describe('markdown fence 유틸', () => {
  const dsl = `earth:\n  show: 아프리카, 수단, 인도\n  link: 수단 -> 인도`;

  it('fence lang/노드명 상수', () => {
    expect(GEOINSIGHT_FENCE_LANG).toBe('geoinsight');
    expect(GEOINSIGHT_NODE_NAME).toBe('geoinsightBlock');
  });

  it('펜스 정규식이 본문을 캡처한다', () => {
    const md = '문단\n\n```geoinsight\n' + dsl + '\n```\n다음';
    const m = GEOINSIGHT_FENCE_RE.exec(md);
    expect(m).toBeTruthy();
    expect(m![2]).toBe(dsl);
  });

  it('펜스 메타(height) round-trip', () => {
    expect(renderGeoInsightFenceMeta({ height: 500 })).toBe(' {height=500}');
    expect(renderGeoInsightFenceMeta()).toBe('');
    expect(parseGeoInsightFenceMeta(' {height=500}')).toEqual({ height: 500 });
    expect(parseGeoInsightFenceMeta('')).toEqual({});
    expect(parseGeoInsightFenceMeta(' {height=0}')).toEqual({}); // 양수만
  });

  it('nodeToMarkdown 이 fence 로 감싼다', () => {
    const md = geoInsightNodeToMarkdown(dsl, { height: 480 });
    expect(md.startsWith('```geoinsight {height=480}\n')).toBe(true);
    expect(md).toContain(dsl);
    expect(md.trimEnd().endsWith('```')).toBe(true);
  });

  it('renderFenceHTML 은 parseHTML 이 받을 pre[data-geoinsight] 를 만든다', () => {
    const html = renderGeoInsightFenceHTML(dsl, { height: 480 });
    expect(html).toContain('data-geoinsight="true"');
    expect(html).toContain('data-height="480"');
    expect(html).toContain('<code>');
  });
});

describe('GeoInsightExtension', () => {
  it('block 펜스 노드로 구성된다', () => {
    expect(GeoInsightExtension.name).toBe('geoinsightBlock');
    const config = GeoInsightExtension.config as Record<string, unknown>;
    expect(config.group).toBe('block');
    expect(config.content).toBe('text*');
    expect(config.code).toBe(true);
  });
});
