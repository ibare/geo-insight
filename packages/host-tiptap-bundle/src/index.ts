/**
 * @geo-insight/tiptap — self-contained ESM 번들.
 *
 * 호스트 앱(예: 메티)이 단일 의존으로 GeoInsight 를 통합할 수 있도록
 * @geo-insight/host-tiptap + runtime + core + data 의존을 모두 Rollup 으로 인라인.
 * peer 는 @tiptap/core·@tiptap/pm 둘뿐 (runtime 이 vanilla DOM 이라 React 불요).
 *
 * 부수효과: bundle import 시점에 runtime/host-tiptap 의 styles.css 가 head 에 1회 주입.
 * geoinsight-* 셀렉터 prefix 로 호스트 전역 CSS 와 충돌 위험 낮음.
 *
 * 호스트 사용 흐름:
 *   import { GeoInsightExtension, bootstrapGeoInsight } from '@geo-insight/tiptap';
 *   bootstrapGeoInsight();                                       // 앱 부팅 1회
 *   new Editor({ extensions: [GeoInsightExtension, ...] });      // Tiptap 통합
 */

export {
  GeoInsightExtension,
  GEOINSIGHT_NODE_NAME,
  createGeoInsightNodeView,
  mountGeoInsight,
  bootstrapGeoInsight,
  GEOINSIGHT_FENCE_LANG,
  GEOINSIGHT_FENCE_RE,
  renderGeoInsightFenceHTML,
  renderGeoInsightFenceMeta,
  parseGeoInsightFenceMeta,
  geoInsightNodeToMarkdown,
} from '@geo-insight/host-tiptap';

export type {
  GeoInsightExtensionOptions,
  GeoMountOptions,
  GeoMountHandle,
  GeoInsightFenceMeta,
} from '@geo-insight/host-tiptap';
