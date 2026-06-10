import type { NodeViewRenderer, NodeViewRendererProps } from '@tiptap/core';
import type { GeoFeature } from '@geoinsight/core';
import { mountGeoInsight, type GeoMountHandle } from './mount.js';

/** data-height 미지정 시 NodeView 가 mount 에 넘기는 기본 높이(px). */
const DEFAULT_HEIGHT = 420;
const MIN_HEIGHT = 200;
const MAX_HEIGHT = 1200;

/**
 * Tiptap NodeView 생성기 — DOM 컨테이너 안에 GeoInsight 인터랙티브 맵을 마운트.
 *
 * 디자인 결정(trama/FACET 패턴 혼합):
 *   - DOM 기반 NodeView. ReactNodeViewRenderer 미사용 — runtime 이 vanilla 라
 *     React glue 가 필요 없고, 호스트 React 인스턴스를 끌어들이지 않는다.
 *   - DSL 소스는 node.textContent 로 보관. 외부에서 텍스트가 바뀌면 맵을 다시 컴파일.
 *   - height 는 attrs 로 보관 — 하단 핸들 드래그로 setNodeMarkup.
 *   - stopEvent 로 포인터/클릭 이벤트를 흡수해 PM 의 NodeView 재빌드(줌 상태 증발)를 막음.
 *   - ignoreMutation: true — 내부 SVG 변경(줌/팬)을 PM 입력으로 오해하지 않게.
 */
export function createGeoInsightNodeView(): NodeViewRenderer {
  return ({ node, editor, getPos, extension }: NodeViewRendererProps) => {
    const opts = (extension.options ?? {}) as {
      locale?: string;
      theme?: 'light' | 'dark';
      loadAdm1?: (ccn3: string) => Promise<GeoFeature[] | null>;
    };

    const dom = document.createElement('pre');
    dom.setAttribute('data-geoinsight', 'true');
    dom.className = 'geoinsight-tiptap-node';
    dom.setAttribute('contenteditable', 'false');

    const mount = document.createElement('div');
    mount.className = 'geoinsight-tiptap-mount';
    dom.appendChild(mount);

    const handleEl = document.createElement('div');
    handleEl.className = 'geoinsight-tiptap-resize';
    handleEl.setAttribute('aria-hidden', 'true');
    dom.appendChild(handleEl);

    const initialAttrHeight =
      typeof node.attrs.height === 'number' ? (node.attrs.height as number) : null;

    let currentSource = node.textContent || '';
    let currentHeight: number | null = initialAttrHeight;
    let destroyed = false;
    /** 자기 dispatch → update 루프 차단 플래그(trama writeBackJson 패턴). */
    let suppressNextUpdate = false;

    /** 편집(지도 클릭)으로 바뀐 DSL 을 노드 textContent 로 write-back. */
    const writeBackSource = (source: string): void => {
      if (destroyed) return;
      if (source === currentSource) return;
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (typeof pos !== 'number') return;
      const view = editor.view;
      const $node = view.state.doc.nodeAt(pos);
      if (!$node) return;
      currentSource = source;
      suppressNextUpdate = true;
      const from = pos + 1;
      const to = pos + 1 + $node.content.size;
      const tr = source
        ? view.state.tr.replaceWith(from, to, view.state.schema.text(source))
        : view.state.tr.delete(from, to);
      view.dispatch(tr);
    };

    const handle: GeoMountHandle = mountGeoInsight(mount, {
      initialSource: currentSource,
      initialHeight: initialAttrHeight ?? DEFAULT_HEIGHT,
      locale: opts.locale,
      theme: opts.theme,
      loadAdm1: opts.loadAdm1,
      editable: editor.options.editable,
      onChange: writeBackSource,
    });

    // ── 높이 리사이즈 핸들 ──
    let resizing = false;
    let startY = 0;
    let startH = 0;
    const onHandleDown = (e: PointerEvent) => {
      if (!editor.options.editable) return;
      resizing = true;
      startY = e.clientY;
      startH = currentHeight ?? DEFAULT_HEIGHT;
      handleEl.setPointerCapture?.(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    };
    const onHandleMove = (e: PointerEvent) => {
      if (!resizing) return;
      const h = clamp(startH + (e.clientY - startY), MIN_HEIGHT, MAX_HEIGHT);
      handle.setHeight(h);
    };
    const onHandleUp = (e: PointerEvent) => {
      if (!resizing) return;
      resizing = false;
      handleEl.releasePointerCapture?.(e.pointerId);
      const h = clamp(startH + (e.clientY - startY), MIN_HEIGHT, MAX_HEIGHT);
      writeBackHeight(h);
    };
    handleEl.addEventListener('pointerdown', onHandleDown);
    handleEl.addEventListener('pointermove', onHandleMove);
    handleEl.addEventListener('pointerup', onHandleUp);

    const writeBackHeight = (height: number): void => {
      if (destroyed) return;
      if (height === currentHeight) return;
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (typeof pos !== 'number') return;
      const view = editor.view;
      const $node = view.state.doc.nodeAt(pos);
      if (!$node) return;
      currentHeight = height;
      const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...$node.attrs, height });
      view.dispatch(tr);
    };

    return {
      dom,
      update(updatedNode) {
        if (updatedNode.type.name !== node.type.name) return false;
        const newSource = updatedNode.textContent || '';
        const rawHeight = updatedNode.attrs.height;
        const newHeight: number | null =
          typeof rawHeight === 'number' && Number.isFinite(rawHeight) && rawHeight > 0
            ? rawHeight
            : null;

        if (newHeight !== currentHeight) {
          currentHeight = newHeight;
          handle.setHeight(newHeight ?? DEFAULT_HEIGHT);
        }
        if (suppressNextUpdate) {
          // 자기 write-back 의 echo — 소스만 동기화하고 재렌더는 건너뛴다.
          suppressNextUpdate = false;
          currentSource = newSource;
        } else if (newSource !== currentSource) {
          currentSource = newSource;
          handle.setSource(newSource);
        }
        handle.setEditable(editor.options.editable);
        return true;
      },
      destroy() {
        destroyed = true;
        handleEl.removeEventListener('pointerdown', onHandleDown);
        handleEl.removeEventListener('pointermove', onHandleMove);
        handleEl.removeEventListener('pointerup', onHandleUp);
        handle.destroy();
      },
      ignoreMutation() {
        return true;
      },
      /**
       * 맵 영역의 포인터/클릭 이벤트는 줌/팬 핸들러가 흡수한다. PM 으로 넘기면
       * contenteditable=false 노드 위 dblclick/contextmenu 가 NodeSelection 으로
       * 처리되며 NodeView 재빌드가 일어나 줌 상태가 증발한다. 키보드/wheel 은
       * 통과(단축키·줌 휠은 runtime 이 자체 처리).
       */
      stopEvent(event) {
        const t = event.type;
        return (
          t === 'mousedown' ||
          t === 'mouseup' ||
          t === 'click' ||
          t === 'dblclick' ||
          t === 'contextmenu' ||
          t === 'pointerdown' ||
          t === 'pointerup' ||
          t === 'pointermove' ||
          t === 'pointercancel'
        );
      },
    };
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
