/**
 * GeoInsight 호스트 통합용 1회 셋업 훅.
 *
 * 현재는 no-op. 향후 커스텀 데이터 소스/리졸버/테마 프리셋 등 호스트 진입점에서
 * 정적 등록할 게 생기면 여기에 모은다. FACET·trama 의 bootstrapFacet/bootstrapTrama
 * 와 동일한 자리 — 호스트가 진입점에서 1회 호출하는 컨벤션을 위해 지금부터 export.
 */
let bootstrapped = false;

export function bootstrapGeoInsight(): void {
  if (bootstrapped) return;
  bootstrapped = true;
}
