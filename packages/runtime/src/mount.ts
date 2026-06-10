/**
 * 바닐라 DOM 마운트 — core 의 정적 SVG 를 컨테이너에 박고 줌/팬으로 하이드레이트.
 * editable 이면 지도 직접 조작(국가/대륙 추가·제거) 편집 오버레이를 얹는다.
 *
 * 프레임워크 비종속. 호스트 어댑터(host-tiptap)가 이 mount 를 NodeView 안에서 호출.
 */

import { compile, createLocator, type CompileResult, type InternalOptions, type Locator } from '@geoinsight/core';
import { attachZoomPan, type ViewBox, type ZoomPanController } from './zoom-pan.js';
import { attachEditing, type EditingController } from './editing.js';

export interface MountOptions extends InternalOptions {
  /** 줌/팬 상호작용 활성화. 기본 true. */
  interactive?: boolean;
  /** 편집(지도 클릭으로 국가/대륙 추가·제거) 활성화. 기본 false. */
  editable?: boolean;
  /** 편집으로 DSL 이 바뀔 때 새 소스 통지 — 호스트가 영속화. */
  onChange?: (source: string) => void;
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
  let editing: EditingController | null = null;
  let svg: SVGSVGElement | null = null;
  let result: CompileResult | null = null;
  let currentSource: string | null = typeof src === 'string' ? src : null;
  let destroyed = false;
  // locate 색인은 비싸지 않지만 편집 재렌더마다 재생성 않도록 공유.
  let locator: Locator | null = null;

  const teardown = (): void => {
    editing?.destroy();
    editing = null;
    controller?.destroy();
    controller = null;
  };

  const render = (input: string | CompileResult): void => {
    if (destroyed) return;
    result = typeof input === 'string' ? compile(input, opts) : input;
    if (opts.onDiagnostics) opts.onDiagnostics(result.diagnostics);

    teardown();
    el.innerHTML = '';
    el.insertAdjacentHTML('afterbegin', result.svg);
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

    if (opts.editable && currentSource != null) {
      if (!locator) locator = createLocator();
      editing = attachEditing({
        svg,
        host: el,
        getView: () => controller!.getView(),
        result,
        getSource: () => currentSource ?? '',
        locator,
        applyEdit: (next) => {
          currentSource = next;
          render(next);
          opts.onChange?.(next);
        },
      });
    }
  };

  render(src);

  return {
    update(next) {
      if (typeof next === 'string') currentSource = next;
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
      teardown();
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
