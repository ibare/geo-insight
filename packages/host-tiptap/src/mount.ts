/**
 * 호스트(Tiptap 등) DOM 노드에 GeoInsight 인터랙티브 맵을 마운트하는 어댑터.
 *
 * @geoinsight/runtime 의 vanilla mount 를 감싸 height/editable/테마 힌트를 다룬다.
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
  /** 편집 가능 여부 — 현재는 상호작용(줌/팬)에 영향 없음(탐색은 항상 허용). */
  editable?: boolean;
  /** 컴파일 진단 콜백. */
  onDiagnostics?: (d: Diagnostic[]) => void;
}

export interface GeoMountHandle {
  /** DSL 소스 갱신 (외부 편집 반영). */
  setSource(source: string): void;
  /** 캔버스 높이 갱신. */
  setHeight(height: number | undefined): void;
  /** editable 토글 (현재 패스스루). */
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

  const compileOpts: CompileOptions = {};
  if (opts.theme === 'light') compileOpts.theme = LIGHT_OVERRIDE;

  const instance: GeoInstance = runtimeMount(el, opts.initialSource, {
    ...compileOpts,
    interactive: true,
    ...(opts.onDiagnostics ? { onDiagnostics: opts.onDiagnostics } : {}),
  });

  let currentSource = opts.initialSource;

  return {
    setSource(source) {
      if (source === currentSource) return;
      currentSource = source;
      // runtime mount 는 최초 컴파일 옵션(테마 등)을 클로저로 보존하므로 소스만 넘기면 된다.
      instance.update(source);
    },
    setHeight(height) {
      applyHeight(el, height ?? DEFAULT_HEIGHT);
    },
    setEditable() {
      // 줌/팬 탐색은 편집 모드와 무관하게 항상 허용 — no-op (확장 여지).
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
