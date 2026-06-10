/**
 * 바닐라 DOM 마운트 — core 의 정적 SVG 를 컨테이너에 박고 줌/팬으로 하이드레이트.
 * editable 이면 지도 직접 조작(국가/대륙 추가·제거) 편집 오버레이를 얹는다.
 *
 * 프레임워크 비종속. 호스트 어댑터(host-tiptap)가 이 mount 를 NodeView 안에서 호출.
 */

import {
  adm1CountriesFor,
  cameraFromMeta,
  compile,
  createDefaultDataSource,
  createLocator,
  createResolver,
  type CompileResult,
  type DataSource,
  type GeoFeature,
  type InternalOptions,
  type Locator,
  type Resolver,
} from '@geoinsight/core';
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
  /**
   * ADM1 지연 로더 — show/showOnly 에 등장한 국가(ccn3)의 주/도 지오메트리를 비동기로
   * 가져온다. 제공되면 compile 전에 필요한 국가를 fetch·주입하고 렌더. 미제공 시 ADM1 미지원.
   */
  loadAdm1?: (ccn3: string) => Promise<GeoFeature[] | null>;
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

  // 영속 DataSource/resolver — 렌더 간 ADM1 로드 상태를 유지해야 한다(매번 새로 만들면 소실).
  const dataSource: DataSource = opts.dataSource ?? createDefaultDataSource();
  const resolver: Resolver = opts.resolver ?? createResolver({ dataSource });
  const compileOpts: MountOptions = { ...opts, dataSource, resolver };
  const adm1InFlight = new Set<string>();

  const teardown = (): void => {
    editing?.destroy();
    editing = null;
    controller?.destroy();
    controller = null;
  };

  /** 필요한 ADM1 국가를 먼저 비동기 로드한 뒤 render. 로더 없으면 즉시 동기 렌더. */
  const ensureAndRender = async (input: string | CompileResult): Promise<void> => {
    if (typeof input === 'string' && opts.loadAdm1) {
      const need = adm1CountriesFor(input, resolver).filter(
        (c) => dataSource.adm1(c).length === 0 && !adm1InFlight.has(c),
      );
      if (need.length > 0) {
        need.forEach((c) => adm1InFlight.add(c));
        const loaded = await Promise.all(
          need.map((c) =>
            opts
              .loadAdm1!(c)
              .then((fs) => [c, fs] as const)
              .catch(() => [c, null] as const),
          ),
        );
        for (const [c, fs] of loaded) {
          adm1InFlight.delete(c);
          if (fs && fs.length > 0) dataSource.loadAdm1(c, fs);
        }
        if (destroyed) return;
      }
    }
    render(input);
  };

  const render = (input: string | CompileResult): void => {
    if (destroyed) return;
    result = typeof input === 'string' ? compile(input, compileOpts) : input;
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
    // 줌아웃 한계를 전세계 투영 범위로 — 선택 국가에 타이트하게 fit 돼도 지구 수준까지 탐색 가능.
    const outer = worldBounds(result) ?? vb;
    controller = attachZoomPan(svg, vb, { interactive: opts.interactive ?? true, outerBounds: outer });

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
          void ensureAndRender(next);
          opts.onChange?.(next);
        },
      });
    }
  };

  void ensureAndRender(src);

  return {
    update(next) {
      if (typeof next === 'string') currentSource = next;
      void ensureAndRender(next);
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

/** 전세계 sphere 의 화면 좌표 bbox → ViewBox. 비유한이면 null(폴백은 호출부). */
function worldBounds(result: CompileResult): ViewBox | null {
  const b = cameraFromMeta(result.meta).bounds({ type: 'Sphere' });
  if (!b) return null;
  return [b[0][0], b[0][1], b[1][0] - b[0][0], b[1][1] - b[0][1]];
}

/** CSS.escape 폴백 (속성 셀렉터용). */
function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
  return s.replace(/["\\\]]/g, '\\$&');
}
