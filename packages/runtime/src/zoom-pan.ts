/**
 * SVG viewBox 기반 줌/팬 컨트롤러 — 프레임워크 0, DOM 만.
 *
 * core 가 준 base viewBox 를 기준으로 휠 줌(커서 중심)·드래그 팬을 viewBox 속성
 * 조작으로 구현한다. 좌표는 core 의 결정적 출력을 그대로 쓰고, 변환만 런타임에서.
 */

export type ViewBox = [number, number, number, number];

export interface ZoomPanController {
  reset(): void;
  /** 화면(viewBox) 좌표 bbox 로 카메라 이동(패딩 포함). */
  zoomToBox(box: { x: number; y: number; width: number; height: number }, pad?: number): void;
  setView(view: ViewBox): void;
  getView(): ViewBox;
  destroy(): void;
}

export interface ZoomPanOptions {
  /** 최대 확대 배율(작은 viewBox). 기본 12. */
  maxZoom?: number;
  /** 상호작용 활성화. 기본 true. */
  interactive?: boolean;
  /**
   * 줌아웃 한계 + 팬 가능 영역(전세계 투영 범위). 기본은 base(=fit 프레임).
   *
   * fit:dominant 로 특정 국가에 타이트하게 프레이밍돼도, 렌더된 SVG 에는 전세계가
   * 그려져 있으므로 이 값을 전세계 sphere 범위로 주면 선택 상태와 무관하게 지구
   * 수준까지 줌아웃해 다른 지역을 탐색할 수 있다.
   */
  outerBounds?: ViewBox;
  /**
   * 제공되면 드래그를 viewBox 평행이동 대신 **회전**으로 처리한다(flat=좌우 wrap,
   * globe=구체 회전). 매 pointermove 마다 직전 대비 클라이언트 px 델타를 넘긴다.
   * 휠 줌은 그대로 viewBox 스케일로 동작. 콜백 쪽에서 px→경위도로 환산·재투영한다.
   */
  onRotate?: (dxPx: number, dyPx: number) => void;
  /** 회전 드래그가 끝났을 때(pointerup/cancel) 1회 호출 — 고품질 스냅 재렌더용. */
  onRotateEnd?: () => void;
}

export function attachZoomPan(
  svg: SVGSVGElement,
  base: ViewBox,
  opts: ZoomPanOptions = {},
): ZoomPanController {
  const maxZoom = opts.maxZoom ?? 12;
  const interactive = opts.interactive ?? true;
  const onRotate = opts.onRotate;
  const onRotateEnd = opts.onRotateEnd;
  let rotatedThisDrag = false;
  const aspect = base[3] / base[2];
  const outer = opts.outerBounds ?? base;
  const minW = base[2] / maxZoom;
  // 줌아웃 최대치: 전세계가 가로·세로 모두 들어오도록(종횡비 고정 보정).
  const maxW = Math.max(base[2], outer[2], outer[3] / aspect);

  let view: ViewBox = [...base] as ViewBox;

  const applyView = () => {
    svg.setAttribute('viewBox', `${round(view[0])} ${round(view[1])} ${round(view[2])} ${round(view[3])}`);
  };

  const setView = (v: ViewBox) => {
    // 너비 클램프 + 종횡비 고정(base 비율 유지)
    let w = clamp(v[2], minW, maxW);
    let h = w * aspect;
    // 팬 가능 영역: 전세계 범위 + 한 화면만큼의 여유.
    const x = clamp(v[0], outer[0] - w, outer[0] + outer[2]);
    const y = clamp(v[1], outer[1] - h, outer[1] + outer[3]);
    view = [x, y, w, h];
    applyView();
  };

  applyView();

  // ── 팬 ──
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const onPointerDown = (e: PointerEvent) => {
    if (!interactive) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    svg.setPointerCapture?.(e.pointerId);
    svg.style.cursor = 'grabbing';
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    // 회전 모드 — 드래그를 회전 콜백으로(viewBox 이동 안 함). 줌은 휠이 담당.
    if (onRotate) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (dx !== 0 || dy !== 0) {
        rotatedThisDrag = true;
        onRotate(dx, dy);
      }
      return;
    }
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const scaleX = view[2] / rect.width;
    const scaleY = view[3] / rect.height;
    const dx = (e.clientX - lastX) * scaleX;
    const dy = (e.clientY - lastY) * scaleY;
    lastX = e.clientX;
    lastY = e.clientY;
    setView([view[0] - dx, view[1] - dy, view[2], view[3]]);
  };
  const onPointerUp = (e: PointerEvent) => {
    dragging = false;
    svg.releasePointerCapture?.(e.pointerId);
    svg.style.cursor = interactive ? 'grab' : '';
    if (rotatedThisDrag) {
      rotatedThisDrag = false;
      onRotateEnd?.();
    }
  };

  // ── 줌 ──
  const onWheel = (e: WheelEvent) => {
    if (!interactive) return;
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    const pointX = view[0] + fx * view[2];
    const pointY = view[1] + fy * view[3];
    const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    const newW = clamp(view[2] * factor, minW, maxW);
    const aspect = base[3] / base[2];
    const newH = newW * aspect;
    setView([pointX - fx * newW, pointY - fy * newH, newW, newH]);
  };

  if (interactive) {
    svg.style.cursor = 'grab';
    svg.style.touchAction = 'none';
    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerup', onPointerUp);
    svg.addEventListener('pointercancel', onPointerUp);
    svg.addEventListener('wheel', onWheel, { passive: false });
  }

  return {
    reset() {
      view = [...base] as ViewBox;
      applyView();
    },
    zoomToBox(box, pad = 0.15) {
      const padX = box.width * pad;
      const padY = box.height * pad;
      setView([box.x - padX, box.y - padY, box.width + padX * 2, box.height + padY * 2]);
    },
    setView,
    getView: () => [...view] as ViewBox,
    destroy() {
      svg.removeEventListener('pointerdown', onPointerDown);
      svg.removeEventListener('pointermove', onPointerMove);
      svg.removeEventListener('pointerup', onPointerUp);
      svg.removeEventListener('pointercancel', onPointerUp);
      svg.removeEventListener('wheel', onWheel);
    },
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
