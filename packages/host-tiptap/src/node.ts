import { Node, mergeAttributes } from '@tiptap/core';
import type { GeoFeature, LayerFeature } from '@geoinsight/core';
import { loadAdm1Browser, loadLayerBrowser } from '@geoinsight/data/browser';
import { createGeoInsightNodeView } from './node-view.js';

export const GEOINSIGHT_NODE_NAME = 'geoinsightBlock';

export interface GeoInsightExtensionOptions {
  /** 호스트 로케일 (현재 패스스루). */
  locale?: string;
  /** 호스트 테마 힌트. */
  theme?: 'light' | 'dark';
  /**
   * ADM1(주/도) 지연 로더 — show/showOnly 의 국가(ccn3) 행정구역을 비동기로 가져온다.
   * 기본값은 loadAdm1Browser — 번들(@geoinsight/tiptap)에 lazy 청크로 포함된 국가별
   * ADM1 JSON 을 동적 import 한다. 즉 호스트(methii 등)는 별도 배선 없이 ADM1 동작.
   * 호스트가 자체 자산 서빙(fetch 등)을 쓰려면 직접 주입해 오버라이드.
   */
  loadAdm1?: (ccn3: string) => Promise<GeoFeature[] | null>;
  /**
   * 레이어 지연 로더 — 'layers: 해류' 등 켜진 레이어 지오메트리를 비동기로 가져온다.
   * 기본값은 loadLayerBrowser(번들 동봉 동적 import). 호스트가 자체 서빙 시 오버라이드.
   */
  loadLayer?: (name: string) => Promise<LayerFeature[]>;
}

/**
 * GeoInsight 펜스 Tiptap 확장.
 *
 * 마크다운 round-trip: ```geoinsight\n<DSL>\n``` ↔ `<pre data-geoinsight><code>DSL</code></pre>`.
 * 호스트의 마크다운 변환기가 fence lang `geoinsight` 를 감지해 노드로 변환하고,
 * 직렬화 때 같은 fence 로 되돌린다. DSL 본문은 attrs 가 아닌 textContent 로 보관 —
 * 멀티라인이 자연스럽고 HTML attribute 인코딩을 피한다(trama 패턴).
 *
 * 형질:
 *   - group block, content text*: DSL 텍스트를 노드 컨텐츠로 직접 보관
 *   - code: 코드블록 의미(마크다운 fence 와 짝)
 *   - defining + isolating: 분할/병합에서 텍스트가 섞이지 않음
 *   - marks '': 인라인 마크 적용 불가
 */
export const GeoInsightExtension = Node.create<GeoInsightExtensionOptions>({
  name: GEOINSIGHT_NODE_NAME,
  group: 'block',
  content: 'text*',
  code: true,
  defining: true,
  isolating: true,
  marks: '',
  selectable: true,
  draggable: false,

  addOptions() {
    return { locale: undefined, theme: undefined, loadAdm1: loadAdm1Browser, loadLayer: loadLayerBrowser };
  },

  /** 캔버스 높이(px) attr — 호스트 영속 표면. 미조절 fence 는 attr 없이 유지. */
  addAttributes() {
    return {
      height: {
        default: null as number | null,
        parseHTML: (el) => {
          const raw = (el as HTMLElement).getAttribute('data-height');
          if (raw == null) return null;
          const n = Number(raw);
          return Number.isFinite(n) && n > 0 ? n : null;
        },
        renderHTML: (attrs) => {
          const h = attrs.height;
          if (typeof h !== 'number' || !Number.isFinite(h) || h <= 0) return {};
          return { 'data-height': String(h) };
        },
      },
    };
  },

  parseHTML() {
    // priority 를 높여 StarterKit 의 codeBlock(generic `pre` 매칭)보다 먼저 잡히게 한다.
    // 이게 없으면 `<pre data-geoinsight>` 가 일반 코드블록으로 파싱된다.
    return [{ tag: 'pre[data-geoinsight]', preserveWhitespace: 'full', priority: 100 }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['pre', mergeAttributes({ 'data-geoinsight': 'true' }, HTMLAttributes), ['code', 0]];
  },

  addNodeView() {
    return createGeoInsightNodeView();
  },
});
