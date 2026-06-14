/**
 * 흐름(해류) 두께·가시성 모델 — width 를 "실제 폭(km)"으로 해석한다.
 *
 * 직관: 63빌딩이 고도 10km 에선 보이지만 100km 상공에선 안 보이듯, 폭이 좁은
 * 해류는 줌아웃하면 화면에서 1px 미만이 되어 사실상 사라진다. width(km) 하나로
 * "화면 두께"와 "표시 여부"가 동시에 파생된다 — 작성자는 줌별 규칙을 따로 관리할
 * 필요 없이 해류의 실제 폭만 적으면 된다.
 *
 * 줌인했을 때의 굵기 정책(실폭 비례 ↔ 화면 고정)은 정답이 없어 파라미터로 빼두고
 * 라이브로 튜닝한다. gamma 하나가 두 극단을 연속으로 잇는다:
 *   gamma=1 → 실폭 비례(줌인하면 실제 폭만큼 굵어짐)
 *   gamma=0 → 화면 고정(줌 무관 일정)
 *   gamma=0.5 → sqrt 댐핑(중간)
 * 가시성 판정은 항상 '실제 물리 두께'로 하므로, 굵기 정책을 어떻게 튜닝하든
 * "언제 사라지나"는 흔들리지 않는다.
 */

export interface FlowWidthParams {
  /** 이 화면 두께(px) 미만이면 도형 숨김 — 가시 임계(63빌딩 한계). */
  hideBelowPx: number;
  /** hideBelowPx~fadeToPx 구간을 도형 opacity 0→1 로 페이드(임계 근처 깜빡임 방지). */
  fadeToPx: number;
  /**
   * 라벨 숨김 임계(px) — 도형 화면 두께가 이 미만이면 라벨만 제거(도형은 남긴다).
   * 라벨은 도형보다 높은 임계를 둔다: 읽을 수 없는 크기의 이름표는 의미가 0이고,
   * 무명 도형은 "이게 뭐지? 확대해보자"는 탐색을 유발(detail-on-demand). hideBelowPx 보다 큼.
   */
  labelHidePx: number;
  /** labelHidePx~labelFadePx 구간을 라벨 opacity 0→1 로 페이드. */
  labelFadePx: number;
  /** 렌더 두께 하한(px). */
  minPx: number;
  /** 렌더 두께 상한(px) — 줌인 과굵기 방지. */
  maxPx: number;
  /** 줌 감도: 1=실폭 비례, 0.5=sqrt 댐핑, 0=화면 고정. */
  gamma: number;
  /** gamma 보간의 기준 해상도(px/km) — gamma<1 일 때 화면 고정 쪽 anchor. */
  refPxPerKm: number;
}

/** 튜닝 시작점 — 실폭 비례(gamma=1) + 1px 도형 임계 + 4px 라벨 임계 + 16px 상한. */
export const DEFAULT_FLOW_WIDTH_PARAMS: FlowWidthParams = {
  hideBelowPx: 1,
  fadeToPx: 2,
  labelHidePx: 4,
  labelFadePx: 7,
  minPx: 1,
  maxPx: 16,
  gamma: 1,
  refPxPerKm: 0.05,
};

export interface FlowWidthResult {
  /** 도형(본체·화살촉) 표시 여부 — 화면 두께가 hideBelowPx 이상. */
  visible: boolean;
  /** 렌더할 화면 두께(px) — 흐름 본체 stroke-width 와 화살촉 크기의 기준. */
  strokeWidthPx: number;
  /** 도형 페이드 opacity(0~1). */
  opacity: number;
  /** 라벨 표시 여부 — 화면 두께가 labelHidePx 이상(도형보다 높은 임계). */
  labelVisible: boolean;
  /** 라벨 페이드 opacity(0~1) — 도형과 독립. */
  labelOpacity: number;
}

/**
 * 실제 폭(km) + 현재 줌의 해상도(px/km) → 렌더 두께·가시성·opacity.
 * visible=false 여도 strokeWidthPx 는 항상 계산한다(가시성 적용 여부는 호출부가 결정 —
 * 정적 compile 은 줌 개념이 없어 가시성을 끄고 두께만 쓴다).
 *
 * @param widthKm   해류의 실제 폭(km)
 * @param pxPerKm   현재 줌에서 화면 1km 당 픽셀 수
 */
export function resolveFlowWidth(widthKm: number, pxPerKm: number, p: FlowWidthParams): FlowWidthResult {
  if (!(widthKm > 0) || !(pxPerKm > 0)) {
    return { visible: false, strokeWidthPx: p.minPx, opacity: 0, labelVisible: false, labelOpacity: 0 };
  }

  // 가시성은 '실제 물리 두께'로 — 정책(gamma/clamp) 튜닝과 무관하게 일관.
  const physicalPx = widthKm * pxPerKm;

  // 렌더 두께: gamma 로 실폭 비례 ↔ 화면 고정 사이 보간(지수 합 1 → 단위는 px).
  const ref = p.refPxPerKm > 0 ? p.refPxPerKm : 1;
  const raw = widthKm * Math.pow(ref, 1 - p.gamma) * Math.pow(pxPerKm, p.gamma);
  const strokeWidthPx = clamp(raw, p.minPx, p.maxPx);

  return {
    visible: physicalPx >= p.hideBelowPx,
    strokeWidthPx,
    opacity: smoothstep(p.hideBelowPx, p.fadeToPx, physicalPx),
    // 라벨은 더 높은 임계 — 도형은 보여도 라벨은 먼저 사라진다(이중 가시성).
    labelVisible: physicalPx >= p.labelHidePx,
    labelOpacity: smoothstep(p.labelHidePx, p.labelFadePx, physicalPx),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Hermite smoothstep — edge0 이하 0, edge1 이상 1, 사이 부드러운 S 곡선. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x >= edge1 ? 1 : 0;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
