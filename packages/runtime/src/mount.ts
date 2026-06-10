/**
 * 바닐라 DOM 마운트 — core 의 정적 SVG 를 컨테이너에 박고 줌/팬으로 하이드레이트.
 *
 * 프레임워크 비종속. 호스트 어댑터(host-tiptap)가 이 mount 를 NodeView 안에서 호출.
 */

import { compile, type CompileResult, type InternalOptions } from '@geoinsight/core';
import { attachZoomPan, type ViewBox, type ZoomPanController } from './zoom-pan.js';

export interface MountOptions extends InternalOptions {
  /** 줌/팬 상호작용 활성화. 기본 true. */
  interactive?: boolean;
  /** 컴파일 진단 콜백. */
  onDiagnostics?: (d: CompileResult['diagnostics']) => void;
}

export interface GeoInstance {
  /** DSL 소스 또는 미리 컴파일된 결과로 갱신. */
  update(src: string | CompileResult): void;
  /** 엔티티(국가/그룹 key)로 카메라 이동 — 멀리 떨어진 조각 탐색. */
  zoomTo(entityKey: string): void;
  reset(): void;
  destroy(): void;
  /** 현재 컴파일 결과(검사용). */
  getResult(): CompileResult | null;
}

export function mount(
  el: HTMLElement,
  src: string | CompileResult,
  opts: MountOptions = {},
): GeoInstance {
  let controller: ZoomPanController | null = null;
  let svg: SVGSVGElement | null = null;
  let result: CompileResult | null = null;
  let destroyed = false;

  const render = (input: string | CompileResult): void => {
    if (destroyed) return;
    result = typeof input === 'string' ? compile(input, opts) : input;
    if (opts.onDiagnostics) opts.onDiagnostics(result.diagnostics);

    controller?.destroy();
    el.innerHTML = result.svg;
    svg = el.querySelector('svg');
    if (!svg) return;

    // 컨테이너에 꽉 차게 — 픽셀 width/height 대신 viewBox 보존.
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.display = 'block';

    const vb = result.meta.viewBox as ViewBox;
    controller = attachZoomPan(svg, vb, { interactive: opts.interactive ?? true });
  };

  render(src);

  return {
    update(next) {
      render(next);
    },
    zoomTo(entityKey) {
      if (!svg || !controller) return;
      const node = svg.querySelector(`[data-key="${cssEscape(entityKey)}"]`);
      if (!node || typeof (node as SVGGraphicsElement).getBBox !== 'function') return;
      const box = (node as SVGGraphicsElement).getBBox();
      if (box.width === 0 && box.height === 0) return;
      controller.zoomToBox(box);
    },
    reset() {
      controller?.reset();
    },
    destroy() {
      destroyed = true;
      controller?.destroy();
      controller = null;
      el.innerHTML = '';
      svg = null;
    },
    getResult: () => result,
  };
}

/** CSS.escape 폴백 (속성 셀렉터용). */
function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
  return s.replace(/["\\\]]/g, '\\$&');
}
