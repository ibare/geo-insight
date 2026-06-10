/**
 * GeoInsight 펜스 규격.
 *
 * 호스트 마크다운 변환기(예: 메티의 buildFenceNode)에 추가할 분기에서 쓰는
 * 상수·유틸. fence lang `geoinsight` 안에 DSL 소스 그대로.
 *
 * 임베드 메타(높이 등)는 fence info-string 에 Pandoc 스타일로:
 *
 * ```geoinsight {height=500}
 * earth:
 *   show: 아프리카, 수단, 인도
 * ```
 *
 * DSL 본문은 메타에 의존하지 않으며, 호스트가 메타 없이 사용해도 동작한다.
 */

export const GEOINSIGHT_FENCE_LANG = 'geoinsight';

/** 마크다운 본문에서 첫 번째 ```geoinsight 펜스를 찾는 정규식. */
export const GEOINSIGHT_FENCE_RE = /```geoinsight([^\n]*)\n([\s\S]*?)\n```/m;

/** 펜스 메타 옵션 — 호스트 표현 결정. DSL 본문에는 영향 없음. */
export interface GeoInsightFenceMeta {
  /** 캔버스 높이(px). */
  height?: number;
}

/** fence info-string 의 메타 영역을 Pandoc 스타일로 직렬화. */
export function renderGeoInsightFenceMeta(meta?: GeoInsightFenceMeta): string {
  if (!meta || meta.height == null) return '';
  return ` {height=${meta.height}}`;
}

/** fence info-string 의 메타 영역(`{height=500}`) 파싱. 알 수 없는 키는 무시. */
export function parseGeoInsightFenceMeta(info: string): GeoInsightFenceMeta {
  if (!info) return {};
  const braced = /\{([^}]*)\}/.exec(info);
  const body = braced ? braced[1]! : info;
  const out: GeoInsightFenceMeta = {};
  for (const part of body.split(/[\s,]+/)) {
    if (!part) continue;
    const m = /^([a-zA-Z_-][a-zA-Z0-9_-]*)\s*=\s*(.+)$/.exec(part);
    if (!m) continue;
    const [, key, rawValue] = m;
    const value = rawValue!.replace(/^["']|["']$/g, '');
    if (key === 'height') {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) out.height = n;
    }
  }
  return out;
}

/**
 * 펜스 안의 DSL 텍스트로 GeoInsight 노드의 HTML 표현을 만든다 — parseHTML 이
 * 다시 받아갈 모양. `<pre data-geoinsight="true" data-height="500"><code>DSL</code></pre>`.
 */
export function renderGeoInsightFenceHTML(source: string, meta?: GeoInsightFenceMeta): string {
  const escaped = source
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const heightAttr =
    meta && typeof meta.height === 'number' ? ` data-height="${meta.height}"` : '';
  return `<pre data-geoinsight="true"${heightAttr}><code>${escaped}</code></pre>`;
}

/**
 * Tiptap geoinsightBlock 노드의 textContent(=DSL)를 마크다운 fence 문자열로.
 * 호스트가 이미 노드의 textContent 로 DSL 을 들고 있다면 이걸로 fence 만 씌우면
 * round-trip 안전. meta 가 있으면 info-string 에 Pandoc 메타 동봉.
 */
export function geoInsightNodeToMarkdown(source: string, meta?: GeoInsightFenceMeta): string {
  return '```' + GEOINSIGHT_FENCE_LANG + renderGeoInsightFenceMeta(meta) + '\n' + source + '\n```\n';
}
