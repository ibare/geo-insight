/**
 * 편집 오버레이 — 지도 직접 조작으로 국가/대륙 추가·제거.
 *
 * 클릭 위치를 cameraFromMeta 의 unproject 로 위경도로 바꾸고, locate(geoContains)로
 * 어느 국가인지 알아낸다. hover 시 그 국가를 하이라이트 + 툴팁, 클릭 시 DSL 의 show
 * 리스트를 토글한다. 대륙/권역은 클릭으로 식별되지 않으므로 코너 퀵칩으로 보완.
 *
 * 줌/팬과 공존: 짧은 클릭만 토글로 처리(이동거리 임계값), 드래그는 zoom-pan 이 팬.
 */

import {
  addShowName,
  cameraFromMeta,
  createLocator,
  GROUP_DEFS,
  hasShowName,
  removeShowName,
  type CompileResult,
  type LocatedCountry,
  type Locator,
  type MetaCamera,
} from '@geoinsight/core';
import type { ViewBox } from './zoom-pan.js';

export interface EditingParams {
  svg: SVGSVGElement;
  host: HTMLElement;
  getView: () => ViewBox;
  result: CompileResult;
  /** 편집 적용 — 새 DSL 소스로 재렌더 + onChange 통지(호출자 책임). */
  applyEdit: (nextSource: string) => void;
  /** 현재 DSL 소스 getter. */
  getSource: () => string;
  /** 공유 locator(없으면 생성). */
  locator?: Locator;
}

export interface EditingController {
  destroy(): void;
}

/** 퀵칩으로 노출할 주요 대륙/권역 key. */
const CHIP_KEYS = [
  'group:asia',
  'group:europe',
  'group:africa',
  'group:north-america',
  'group:south-america',
  'group:oceania',
];

const SVG_NS = 'http://www.w3.org/2000/svg';
const CLICK_MOVE_THRESHOLD = 5; // px

export function attachEditing(params: EditingParams): EditingController {
  const { svg, host, getView, result, applyEdit, getSource } = params;
  const cam: MetaCamera = cameraFromMeta(result.meta);
  const locator = params.locator ?? createLocator();
  const scene = result.scene;

  // ── 하이라이트 path (지도 좌표계 = viewBox 좌표, 줌/팬에 따라 자동 정렬) ──
  const highlight = document.createElementNS(SVG_NS, 'path');
  highlight.setAttribute('class', 'gi-edit-highlight');
  highlight.setAttribute('fill', 'rgba(255,255,255,0.18)');
  highlight.setAttribute('stroke', '#ffffff');
  highlight.setAttribute('stroke-width', '1');
  highlight.style.pointerEvents = 'none';
  highlight.style.display = 'none';
  svg.appendChild(highlight);

  // ── 툴팁 ──
  const tooltip = document.createElement('div');
  tooltip.className = 'gi-edit-tooltip';
  tooltip.style.display = 'none';
  host.appendChild(tooltip);

  // ── 대륙 퀵칩 툴바 ──
  const toolbar = document.createElement('div');
  toolbar.className = 'gi-edit-chips';
  const chipEls: Array<{ el: HTMLButtonElement; name: string }> = [];
  for (const key of CHIP_KEYS) {
    const def = GROUP_DEFS.find((g) => g.key === key);
    if (!def) continue;
    const chip = document.createElement('button');
    chip.className = 'gi-edit-chip';
    chip.textContent = def.display;
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleName(def.display);
    });
    toolbar.appendChild(chip);
    chipEls.push({ el: chip, name: def.display });
  }
  host.appendChild(toolbar);

  const refreshChips = (): void => {
    const src = getSource();
    for (const { el, name } of chipEls) {
      el.classList.toggle('active', hasShowName(src, name));
    }
  };
  refreshChips();

  // ── 좌표 변환 (preserveAspectRatio=xMidYMid meet 보정) ──
  const clientToBase = (clientX: number, clientY: number): [number, number] | null => {
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const view = getView();
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
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    return [view[0] + (px - offX) / scale, view[1] + (py - offY) / scale];
  };

  // ── hover ──
  let hovered: LocatedCountry | null = null;
  let rafId = 0;
  let pending: { x: number; y: number } | null = null;

  const processHover = (): void => {
    rafId = 0;
    if (!pending) return;
    const base = clientToBase(pending.x, pending.y);
    const ll = base ? cam.unproject(base) : null;
    const hit = ll ? locator.locate(ll) : null;

    if (hit?.key !== hovered?.key) {
      hovered = hit;
      if (hit) {
        highlight.setAttribute('d', cam.path(hit.feature));
        highlight.style.display = '';
      } else {
        highlight.style.display = 'none';
      }
    }
    if (hit) {
      const present = isIndividuallyShown(hit.key);
      tooltip.textContent = `${hit.display}  ${present ? '− 제거' : '+ 추가'}`;
      tooltip.style.display = '';
      const rect = host.getBoundingClientRect();
      tooltip.style.left = `${pending.x - rect.left + 12}px`;
      tooltip.style.top = `${pending.y - rect.top + 12}px`;
    } else {
      tooltip.style.display = 'none';
    }
    pending = null;
  };

  const onMove = (e: PointerEvent): void => {
    pending = { x: e.clientX, y: e.clientY };
    if (!rafId) rafId = requestAnimationFrame(processHover);
  };
  const onLeave = (): void => {
    hovered = null;
    highlight.style.display = 'none';
    tooltip.style.display = 'none';
  };

  // ── 클릭(드래그 아님) 토글 ──
  let downX = 0;
  let downY = 0;
  let downActive = false;
  const onDown = (e: PointerEvent): void => {
    downActive = true;
    downX = e.clientX;
    downY = e.clientY;
  };
  const onUp = (e: PointerEvent): void => {
    if (!downActive) return;
    downActive = false;
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
    if (moved > CLICK_MOVE_THRESHOLD) return; // 팬으로 간주
    const base = clientToBase(e.clientX, e.clientY);
    const ll = base ? cam.unproject(base) : null;
    const hit = ll ? locator.locate(ll) : null;
    if (!hit) return;
    toggleCountry(hit);
  };

  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerleave', onLeave);
  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointerup', onUp);

  function isIndividuallyShown(key: string): boolean {
    return scene.entities.some((entity) => entity.key === key);
  }

  function toggleCountry(hit: LocatedCountry): void {
    const src = getSource();
    const existing = scene.entities.find((e) => e.key === hit.key);
    const next = existing ? removeShowName(src, existing.display) : addShowName(src, hit.display);
    if (next !== src) applyEdit(next);
  }

  function toggleName(name: string): void {
    const src = getSource();
    const next = hasShowName(src, name) ? removeShowName(src, name) : addShowName(src, name);
    if (next !== src) applyEdit(next);
  }

  return {
    destroy() {
      if (rafId) cancelAnimationFrame(rafId);
      svg.removeEventListener('pointermove', onMove);
      svg.removeEventListener('pointerleave', onLeave);
      svg.removeEventListener('pointerdown', onDown);
      svg.removeEventListener('pointerup', onUp);
      highlight.remove();
      tooltip.remove();
      toolbar.remove();
    },
  };
}
