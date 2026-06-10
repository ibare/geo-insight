/**
 * 편집 오버레이 — 지도 직접 조작으로 국가/대륙/링크 추가·제거.
 *
 * 클릭 위치를 cameraFromMeta 의 unproject 로 위경도로 바꾸고, locate(geoContains)로
 * 어느 국가인지 알아낸다.
 *  - 미선택 국가 클릭 → show 에 추가.
 *  - 선택된 국가(엔티티) 클릭 → 컨텍스트 메뉴: 다른 선택 국가와 연결/해제, 또는 제거.
 *  - 대륙/권역은 코너 퀵칩으로 토글.
 * hover 시 커서 아래 국가를 하이라이트 + 툴팁. 줌/팬과 공존(짧은 클릭만 처리).
 */

import {
  addLink,
  addShowName,
  cameraFromMeta,
  createLocator,
  GROUP_DEFS,
  hasShowName,
  removeLink,
  removeShowName,
  type CompileResult,
  type Entity,
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

  // ── 하이라이트 path (지도 좌표계 = viewBox, 줌/팬에 자동 정렬) ──
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

  // ── 대륙 퀵칩 ──
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
  for (const { el, name } of chipEls) el.classList.toggle('active', hasShowName(getSource(), name));

  // ── 컨텍스트 메뉴 ──
  let menuEl: HTMLElement | null = null;
  let backdropEl: HTMLElement | null = null;

  const closeMenu = (): void => {
    menuEl?.remove();
    backdropEl?.remove();
    menuEl = null;
    backdropEl = null;
  };

  const openMenu = (entity: Entity, clientX: number, clientY: number): void => {
    closeMenu();
    const backdrop = document.createElement('div');
    backdrop.className = 'gi-edit-backdrop';
    backdrop.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      closeMenu();
    });
    host.appendChild(backdrop);
    backdropEl = backdrop;

    const menu = document.createElement('div');
    menu.className = 'gi-edit-menu';

    const title = document.createElement('div');
    title.className = 'gi-edit-menu-title';
    title.textContent = entity.display;
    menu.appendChild(title);

    const others = scene.entities.filter((e) => e.key !== entity.key);
    if (others.length > 0) {
      const section = document.createElement('div');
      section.className = 'gi-edit-menu-section';
      section.textContent = '연결 / 해제';
      menu.appendChild(section);
      for (const other of others) {
        const connected = isLinked(entity.key, other.key);
        const item = document.createElement('button');
        item.className = `gi-edit-menu-item${connected ? ' connected' : ''}`;
        item.textContent = `${connected ? '✓ ' : ''}${other.display}`;
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleLink(entity, other, connected);
        });
        menu.appendChild(item);
      }
    } else {
      const hint = document.createElement('div');
      hint.className = 'gi-edit-menu-hint';
      hint.textContent = '연결할 다른 선택 항목이 없습니다';
      menu.appendChild(hint);
    }

    const sep = document.createElement('div');
    sep.className = 'gi-edit-menu-sep';
    menu.appendChild(sep);

    const removeItem = document.createElement('button');
    removeItem.className = 'gi-edit-menu-item danger';
    removeItem.textContent = '이 국가 제거';
    removeItem.addEventListener('click', (e) => {
      e.stopPropagation();
      const next = removeShowName(getSource(), entity.display);
      if (next !== getSource()) applyEdit(next);
      else closeMenu();
    });
    menu.appendChild(removeItem);

    host.appendChild(menu);
    menuEl = menu;

    // 위치(호스트 내 클램프)
    const hostRect = host.getBoundingClientRect();
    const mw = menu.offsetWidth || 180;
    const mh = menu.offsetHeight || 160;
    const left = Math.min(clientX - hostRect.left, Math.max(0, hostRect.width - mw - 4));
    const top = Math.min(clientY - hostRect.top, Math.max(0, hostRect.height - mh - 4));
    menu.style.left = `${Math.max(4, left)}px`;
    menu.style.top = `${Math.max(4, top)}px`;
  };

  function isLinked(a: string, b: string): boolean {
    return scene.links.some(
      (l) => (l.from === a && l.to === b) || (l.from === b && l.to === a),
    );
  }

  function toggleLink(a: Entity, other: Entity, connected: boolean): void {
    const src = getSource();
    // 양방향 모두 시도(표기/방향 차이 흡수).
    const next = connected
      ? removeLink(removeLink(src, a.display, other.display), other.display, a.display)
      : addLink(src, a.display, other.display);
    if (next !== src) applyEdit(next);
    else closeMenu();
  }

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
    return [view[0] + (clientX - rect.left - offX) / scale, view[1] + (clientY - rect.top - offY) / scale];
  };

  const hitAt = (clientX: number, clientY: number): LocatedCountry | null => {
    const base = clientToBase(clientX, clientY);
    const ll = base ? cam.unproject(base) : null;
    return ll ? locator.locate(ll) : null;
  };

  // ── hover ──
  let hovered: LocatedCountry | null = null;
  let rafId = 0;
  let pending: { x: number; y: number } | null = null;

  const processHover = (): void => {
    rafId = 0;
    if (!pending || menuEl) return;
    const hit = hitAt(pending.x, pending.y);
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
      tooltip.textContent = `${hit.display}  ${present ? '· 클릭: 연결/제거' : '+ 추가'}`;
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

  // ── 클릭(드래그 아님) ──
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
    if (menuEl) return; // 메뉴 열림 중 — backdrop 가 처리
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > CLICK_MOVE_THRESHOLD) return; // 팬
    const hit = hitAt(e.clientX, e.clientY);
    if (!hit) return;
    const entity = scene.entities.find((en) => en.key === hit.key);
    if (entity) {
      onLeave();
      openMenu(entity, e.clientX, e.clientY);
    } else {
      const src = getSource();
      const next = addShowName(src, hit.display);
      if (next !== src) applyEdit(next);
    }
  };

  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerleave', onLeave);
  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointerup', onUp);

  function isIndividuallyShown(key: string): boolean {
    return scene.entities.some((entity) => entity.key === key);
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
      closeMenu();
      highlight.remove();
      tooltip.remove();
      toolbar.remove();
    },
  };
}
