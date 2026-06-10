/**
 * 호스트(Tiptap 등) DOM 노드에 GeoInsight 인터랙티브 맵을 마운트하는 어댑터.
 *
 * @geoinsight/runtime 의 vanilla mount 를 감싸 height/editable/테마 힌트를 다룬다.
 * editable 이면 지도 클릭으로 국가/대륙을 추가·제거하고, 변경된 DSL 을 onChange 로
 * 호스트에 흘려보낸다(NodeView 가 ProseMirror textContent 로 write-back).
 * React 비종속 — 호스트 React 인스턴스를 끌어들이지 않는다(FACET 패턴).
 */

import { mount as runtimeMount, type GeoInstance } from '@geoinsight/runtime';
import '@geoinsight/runtime/styles.css';
import type { CompileOptions, Diagnostic, Theme } from '@geoinsight/core';

export interface GeoMountOptions {
  /** 최초 마운트 시점의 DSL 소스 (Tiptap 노드의 textContent). */
  initialSource: string;
  /** 최초 캔버스 높이(px). 미지정 시 어댑터가 기본값 사용. */
  initialHeight?: number;
  /** 호스트 로케일 (패스스루). */
  locale?: string;
  /** 호스트 테마 힌트. light 면 밝은 오션으로 오버라이드. */
  theme?: 'light' | 'dark';
  /** 편집 가능 여부 — true 면 지도 클릭으로 국가/대륙 추가·제거. */
  editable?: boolean;
  /** 편집으로 DSL 이 바뀔 때 새 소스 통지 — NodeView 가 textContent 로 write-back. */
  onChange?: (source: string) => void;
  /** 컴파일 진단 콜백. */
  onDiagnostics?: (d: Diagnostic[]) => void;
}

export interface GeoMountHandle {
  /** DSL 소스 갱신 (외부 편집 반영). */
  setSource(source: string): void;
  /** 캔버스 높이 갱신. */
  setHeight(height: number | undefined): void;
  /** editable 토글 — 편집 오버레이를 켜고 끈다(재마운트). */
  setEditable(editable: boolean): void;
  /** 엔티티 key 로 카메라 이동. */
  zoomTo(entityKey: string): void;
  reset(): void;
  destroy(): void;
}

const DEFAULT_HEIGHT = 420;

const LIGHT_OVERRIDE: Partial<Theme> = {
  ocean: '#dfe7ef',
  worldFaint: '#c6d2df',
  worldStroke: '#aab8c8',
  graticule: '#cdd8e4',
  label: { fill: '#1b2430', halo: '#ffffff', font: 'system-ui, sans-serif', size: 13 },
};

export function mountGeoInsight(el: HTMLElement, opts: GeoMountOptions): GeoMountHandle {
  el.setAttribute('data-geoinsight-root', 'true');
  applyHeight(el, opts.initialHeight ?? DEFAULT_HEIGHT);

  let currentSource = opts.initialSource;
  let editable = opts.editable ?? false;
  let instance: GeoInstance;

  const build = (): void => {
    const compileOpts: CompileOptions = {};
    if (opts.theme === 'light') compileOpts.theme = LIGHT_OVERRIDE;
    instance = runtimeMount(el, currentSource, {
      ...compileOpts,
      interactive: true,
      editable,
      // 편집으로 바뀐 소스를 기억하고 호스트로 통지. currentSource 를 먼저 갱신해
      // 직후 들어오는 setSource(PM round-trip)가 no-op 이 되게 한다.
      onChange: (next) => {
        currentSource = next;
        opts.onChange?.(next);
      },
      ...(opts.onDiagnostics ? { onDiagnostics: opts.onDiagnostics } : {}),
    });
  };

  build();

  return {
    setSource(source) {
      if (source === currentSource) return;
      currentSource = source;
      instance.update(source);
    },
    setHeight(height) {
      applyHeight(el, height ?? DEFAULT_HEIGHT);
    },
    setEditable(next) {
      if (next === editable) return;
      editable = next;
      instance.destroy();
      build();
    },
    zoomTo(entityKey) {
      instance.zoomTo(entityKey);
    },
    reset() {
      instance.reset();
    },
    destroy() {
      instance.destroy();
    },
  };
}

function applyHeight(el: HTMLElement, height: number): void {
  el.style.height = `${height}px`;
}
