/**
 * 바닐라 DOM 마운트 — core 모델을 컴파일해 컨테이너에 박고 줌/회전으로 하이드레이트.
 *
 * 두 모드(투영으로 결정):
 *   - flat(equirectangular 등): 드래그 = 좌우 무한 wrap(경도 회전), 상하 패닝 없음.
 *   - globe(orthographic):       드래그 = 구체 회전(경도+위도), 지구본을 돌리듯.
 *   - 줌(휠): 두 모드 공통, viewBox 스케일(커서 중심).
 *
 * 회전은 휘발 상태(DSL 불변) — 모델을 캐시해두고 renderContent 로 rotate 만 바꿔
 * gi-content 그룹 innerHTML 만 교체한다(parse/resolve/지오메트리 fetch 없음, svg
 * 리스너·편집 오버레이 보존). editable 이면 편집 오버레이를 얹는다.
 *
 * 프레임워크 비종속. 호스트 어댑터(host-tiptap)가 이 mount 를 NodeView 안에서 호출.
 */

import {
  adm1CountriesFor,
  buildModel,
  cameraFromMeta,
  createDefaultDataSource,
  createLocator,
  createResolver,
  renderAnnotations,
  renderContent,
  renderModel,
  type CompileResult,
  type DataSource,
  type GeoFeature,
  type LayerFeature,
  type InternalOptions,
  type Locator,
  type Resolver,
  type SceneModel,
} from '@geoinsight/core';
import { attachZoomPan, type ViewBox, type ZoomPanController } from './zoom-pan.js';
import { attachEditing, type EditingController } from './editing.js';

export interface MountOptions extends InternalOptions {
  /** 줌/회전 상호작용 활성화. 기본 true. */
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
  /**
   * 레이어 지연 로더 — layers 에 켜진 레이어명('해류')의 지오메트리를 비동기로 가져온다.
   * 제공되면 compile 전에 필요한 레이어를 fetch·주입하고 렌더. 미제공 시 레이어 미표시.
   */
  loadLayer?: (name: string) => Promise<LayerFeature[]>;
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
  /** 화면(client) 좌표 → 위경도 [lon, lat]. 현재 줌/팬/회전 반영. 편집기 좌표 찍기용. */
  unproject(clientX: number, clientY: number): [number, number] | null;
}

type Rotate = [number, number];
interface FitBase {
  rotate: Rotate;
  scale: number;
  translate: [number, number];
}
/** DSL 의 `layers: A, B` 줄에서 켜진 레이어 이름들을 뽑는다(지연 로드 대상 판별용). */
function layersFor(src: string): string[] {
  const m = /^\s*layers\s*:\s*(.+)$/m.exec(src);
  if (!m) return [];
  return m[1]!
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 재렌더 시 현재 뷰포트(카메라 + 줌/팬)를 보존하기 위한 스냅샷.
 * 클릭 편집(show 추가/제거 등)에서 fitExtent 재프레이밍을 막아 화면이 점프하지 않게 한다.
 */
interface Preserve {
  view: ViewBox;
  rotate: Rotate;
  scale: number;
  translate: [number, number];
}

export function mount(
  el: HTMLElement,
  src: string | CompileResult,
  opts: MountOptions = {},
): GeoInstance {
  let controller: ZoomPanController | null = null;
  let editing: EditingController | null = null;
  let svg: SVGSVGElement | null = null;
  let contentGroup: SVGGElement | null = null;
  /** gi-annotations(라벨/링크/대양) 그룹 — 줌 시 이것만 재렌더해 화면상 크기 일정. */
  let annotationsGroup: SVGGElement | null = null;
  let result: CompileResult | null = null;
  let model: SceneModel | null = null;
  let base: FitBase | null = null;
  /** 렌더된 지도(전세계 sphere)의 viewBox 좌표 bbox — flat 수직 팬 클램프 기준. */
  let mapBounds: ViewBox | null = null;
  /** 휘발 회전 상태 [경도, 위도] — DSL 에 기록하지 않음. 전체 재렌더 시 base 로 리셋. */
  let rotate: Rotate = [0, 0];
  let currentSource: string | null = typeof src === 'string' ? src : null;
  let destroyed = false;
  let locator: Locator | null = null;

  // 영속 DataSource/resolver — 렌더 간 ADM1 로드 상태를 유지해야 한다(매번 새로 만들면 소실).
  const dataSource: DataSource = opts.dataSource ?? createDefaultDataSource();
  const resolver: Resolver = opts.resolver ?? createResolver({ dataSource });
  const compileOpts: MountOptions = { ...opts, dataSource, resolver };
  const adm1InFlight = new Set<string>();
  const layerInFlight = new Set<string>();

  const teardown = (): void => {
    if (rotateRaf) {
      cancelAnimationFrame(rotateRaf);
      rotateRaf = 0;
    }
    if (zoomRaf) {
      cancelAnimationFrame(zoomRaf);
      zoomRaf = 0;
    }
    editing?.destroy();
    editing = null;
    controller?.destroy();
    controller = null;
  };

  // ── 회전 재투영(팬) ──────────────────────────────────────────────────────────
  let rotateRaf = 0;
  let zoomRaf = 0;
  let pendingDx = 0;
  let pendingDy = 0;

  const isGlobe = (): boolean => result?.meta.projectionParams.type === 'orthographic';

  /** 주석 크기 배율 = 현재 viewBox 폭 / 기본 폭(줌 배율). 줌인=값<1 → 화면상 일정. */
  const annoScale = (): number => {
    if (!controller || !result) return 1;
    const baseW = result.meta.viewBox[2];
    return baseW > 0 ? controller.getView()[2] / baseW : 1;
  };

  /** 누적 드래그 델타(px)를 회전 상태에 반영. 화면 px → 경위도는 줌·투영 scale 보정. */
  const commitPending = (): void => {
    if ((pendingDx === 0 && pendingDy === 0) || !svg || !base) return;
    const rect = svg.getBoundingClientRect();
    const view = controller?.getView() ?? (result!.meta.viewBox as ViewBox);
    const pxPerUnit = rect.width > 0 ? rect.width / view[2] : 1;
    const pxPerRad = base.scale * pxPerUnit;
    const degPerPx = pxPerRad > 0 ? 180 / Math.PI / pxPerRad : 0.25;

    const lon = wrapLon(rotate[0] + pendingDx * degPerPx);
    // flat 은 좌우(경도)만 — 상하 패닝 없음. globe 만 위도 회전(±90 클램프, 뒤집힘 방지).
    const lat = isGlobe() ? clamp(rotate[1] - pendingDy * degPerPx, -90, 90) : rotate[1];
    pendingDx = 0;
    pendingDy = 0;
    rotate = [lon, lat];
  };

  /** 현재 회전 상태로 gi-content 만 재투영해 교체. coarse=true 면 거친 배경(드래그 중). */
  const renderAtRotate = (coarse: boolean): void => {
    if (destroyed || !model || !base || !contentGroup) return;
    const s = annoScale();
    const rendered = renderContent(model, {
      fixed: { rotate, scale: base.scale, translate: base.translate },
      ...(coarse ? { coarse: true } : {}),
      ...(s !== 1 ? { annotationScale: s } : {}),
    });
    contentGroup.innerHTML = rendered.content;
    annotationsGroup = contentGroup.querySelector('.gi-annotations');
    result!.scene = rendered.scene;
    result!.meta = rendered.meta;
    editing?.refresh(result!);
  };

  /** 줌 시 — 지오메트리는 viewBox 로 스케일되므로 그대로 두고 주석만 재렌더(크기 보정). */
  const applyZoom = (): void => {
    zoomRaf = 0;
    if (destroyed || !model || !base || !annotationsGroup) return;
    const rendered = renderAnnotations(model, {
      fixed: { rotate, scale: base.scale, translate: base.translate },
      annotationScale: annoScale(),
    });
    annotationsGroup.innerHTML = rendered.annotations;
  };
  const onZoom = (): void => {
    if (!zoomRaf) zoomRaf = requestAnimationFrame(applyZoom);
  };

  const applyRotate = (): void => {
    rotateRaf = 0;
    commitPending();
    renderAtRotate(true); // 드래그 중 — 거친 110m 배경으로 부드럽게.
  };

  /**
   * flat 수직 팬 — equirectangular 는 위도 wrap 이 없으므로 회전이 아니라 viewBox 를
   * 세로로 움직인다. 지도 세로가 뷰포트에 다 들어오면(최대 줌아웃) 고정(중앙), 줌인
   * 돼 안 보이는 영역이 생기면 그 범위 안에서만 패닝.
   */
  const panVertical = (dyPx: number): void => {
    if (!svg || !controller || !mapBounds) return;
    const rect = svg.getBoundingClientRect();
    if (rect.height === 0) return;
    const view = controller.getView();
    const scaleY = view[3] / rect.height;
    const mapTop = mapBounds[1];
    const mapH = mapBounds[3];
    const h = view[3];
    let y: number;
    if (h >= mapH) {
      y = mapTop - (h - mapH) / 2; // 다 보임 → 수직 고정(중앙)
    } else {
      y = clamp(view[1] - dyPx * scaleY, mapTop, mapTop + mapH - h); // 지도 범위 내
    }
    controller.setView([view[0], y, view[2], view[3]]);
  };

  const onRotate = (dx: number, dy: number): void => {
    // globe — 경도+위도 모두 구체 회전(재투영).
    if (isGlobe()) {
      pendingDx += dx;
      pendingDy += dy;
      if (!rotateRaf) rotateRaf = requestAnimationFrame(applyRotate);
      return;
    }
    // flat — 좌우=경도 회전(무한 wrap, 재투영), 상하=viewBox 수직 팬(줌인 시에만).
    if (dx !== 0) {
      pendingDx += dx;
      if (!rotateRaf) rotateRaf = requestAnimationFrame(applyRotate);
    }
    if (dy !== 0) panVertical(dy);
  };

  /** 드래그 종료 — 남은 델타 반영 후 고품질(50m)로 1회 스냅 재렌더. */
  const onRotateEnd = (): void => {
    if (rotateRaf) {
      cancelAnimationFrame(rotateRaf);
      rotateRaf = 0;
    }
    commitPending();
    renderAtRotate(false);
  };

  /** 필요한 ADM1 국가를 먼저 비동기 로드한 뒤 render. 로더 없으면 즉시 동기 렌더. */
  const ensureAndRender = async (input: string | CompileResult, preserve?: Preserve): Promise<void> => {
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
          else {
            // 조용한 폴백 방지 — ADM1 로더가 빈 결과를 주면(번들 lazy 청크 미서빙/경로
            // 오류 등) 50m 국가 외곽으로 폴백된다. 호스트(methii 등)가 원인 파악하도록 경고.
            console.warn(
              `[geoinsight] ADM1 로드 실패(ccn3=${c}) — 행정구역 대신 국가 외곽(50m)으로 폴백합니다. ` +
                `번들의 dist/chunks/ 가 서빙되는지(동적 import 경로) 확인하세요.`,
            );
          }
        }
        if (destroyed) return;
      }
    }
    // 레이어 지연 로드 — layers 에 켜진 이름의 지오메트리를 주입(ADM1 과 같은 2단계).
    if (typeof input === 'string' && opts.loadLayer) {
      const need = layersFor(input).filter(
        (n) => dataSource.layer(n).length === 0 && !layerInFlight.has(n),
      );
      if (need.length > 0) {
        need.forEach((n) => layerInFlight.add(n));
        const loaded = await Promise.all(
          need.map((n) =>
            opts
              .loadLayer!(n)
              .then((fs) => [n, fs] as const)
              .catch(() => [n, [] as LayerFeature[]] as const),
          ),
        );
        for (const [n, fs] of loaded) {
          layerInFlight.delete(n);
          if (fs.length > 0) dataSource.loadLayer(n, fs);
        }
        if (destroyed) return;
      }
    }
    render(input, preserve);
  };

  const render = (input: string | CompileResult, preserve?: Preserve): void => {
    if (destroyed) return;
    // 문자열이면 모델을 빌드해 캐시(회전 재투영용). 미리 컴파일된 결과는 정적 렌더.
    if (typeof input === 'string') {
      model = buildModel(input, compileOpts);
      // 뷰포트 보존(클릭 편집) — fixed 로 fitExtent 를 건너뛰어 카메라가 점프하지 않게 한다.
      result = preserve
        ? renderModel(model, {
            fixed: { rotate: preserve.rotate, scale: preserve.scale, translate: preserve.translate },
          })
        : renderModel(model);
    } else {
      model = null;
      result = input;
    }
    // 전체 재렌더 → 회전 휘발 상태를 fit 기준값으로 리셋.
    const pp = result.meta.projectionParams;
    base = { rotate: [pp.rotate[0], pp.rotate[1]], scale: pp.scale, translate: [pp.translate[0], pp.translate[1]] };
    rotate = [pp.rotate[0], pp.rotate[1]];

    if (opts.onDiagnostics) opts.onDiagnostics(result.diagnostics);

    teardown();
    el.innerHTML = '';
    el.insertAdjacentHTML('afterbegin', result.svg);
    svg = el.querySelector('svg');
    if (!svg) return;
    contentGroup = svg.querySelector('.gi-content');
    annotationsGroup = svg.querySelector('.gi-annotations');

    // 컨테이너에 꽉 차게 — 픽셀 width/height 대신 viewBox 보존.
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.display = 'block';

    const vb = result.meta.viewBox as ViewBox;
    const outer = worldBounds(result) ?? vb;
    mapBounds = outer;
    const interactive = opts.interactive ?? true;
    const flat = result.meta.projectionParams.type !== 'orthographic';
    // flat 은 줌아웃을 세로 cover 까지만 제한 + 레터박스를 바다색으로 채워 캔버스와
    // 분리돼 보이지 않게 한다. globe 는 다크 배경에 디스크가 떠야 하므로 배경 비움.
    svg.style.background = flat ? result.scene.theme.ocean : '';
    // 모델이 있을 때만 드래그=회전(재투영). 미리 컴파일된 정적 결과는 기존 viewBox 팬.
    controller = attachZoomPan(svg, vb, {
      interactive,
      outerBounds: outer,
      coverVertical: flat,
      ...(interactive && model ? { onRotate, onRotateEnd, onZoom } : {}),
    });
    // 클릭 편집이면 직전 줌/팬 상태를 그대로 복원(카메라는 fixed 로 이미 고정됨).
    if (preserve) controller.setView(preserve.view);

    if (opts.editable && currentSource != null) {
      if (!locator) locator = createLocator();
      editing = attachEditing({
        svg,
        host: el,
        getView: () => controller!.getView(),
        result,
        getSource: () => currentSource ?? '',
        locator,
        applyEdit: (next, editOpts) => {
          currentSource = next;
          // 클릭 편집은 현재 뷰포트(카메라+줌/팬)를 캡처해 보존 — 선택 시 화면이 점프하지 않게.
          // reframe(showOnly 진입/나가기)이면 보존을 건너뛰고 새 프레임에 fit 한다.
          const preserve: Preserve | undefined =
            !editOpts?.reframe && controller && base
              ? {
                  view: controller.getView(),
                  rotate: [rotate[0], rotate[1]],
                  scale: base.scale,
                  translate: [base.translate[0], base.translate[1]],
                }
              : undefined;
          void ensureAndRender(next, preserve);
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
    unproject(clientX, clientY) {
      if (!svg || !result || !controller) return null;
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      // client → 현재 viewBox 좌표(preserveAspectRatio=meet 레터박스 보정) → 위경도.
      const view = controller.getView();
      const vbAspect = view[2] / view[3];
      const elAspect = rect.width / rect.height;
      let scale: number;
      let offX: number;
      let offY: number;
      if (elAspect > vbAspect) {
        scale = rect.height / view[3];
        offX = (rect.width - view[2] * scale) / 2;
        offY = 0;
      } else {
        scale = rect.width / view[2];
        offX = 0;
        offY = (rect.height - view[3] * scale) / 2;
      }
      const sx = view[0] + (clientX - rect.left - offX) / scale;
      const sy = view[1] + (clientY - rect.top - offY) / scale;
      return cameraFromMeta(result.meta).unproject([sx, sy]);
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
      // 줌 + 회전 모두 fit 기준으로 복귀.
      controller?.reset();
      if (model && base && contentGroup) {
        rotate = [base.rotate[0], base.rotate[1]];
        const rendered = renderContent(model, {
          fixed: { rotate, scale: base.scale, translate: base.translate },
        });
        contentGroup.innerHTML = rendered.content;
        annotationsGroup = contentGroup.querySelector('.gi-annotations');
        if (result) {
          result.scene = rendered.scene;
          result.meta = rendered.meta;
        }
        if (result) editing?.refresh(result);
      }
    },
    destroy() {
      destroyed = true;
      teardown();
      el.innerHTML = '';
      svg = null;
      contentGroup = null;
      annotationsGroup = null;
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

function wrapLon(x: number): number {
  return ((((x + 180) % 360) + 360) % 360) - 180;
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** CSS.escape 폴백 (속성 셀렉터용). */
function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
  return s.replace(/["\\\]]/g, '\\$&');
}
