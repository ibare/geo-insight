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
  hasLayer,
  hasShowName,
  removeLink,
  removeShowName,
  removeShowOnly,
  setLinkLabel,
  setLinkType,
  setProjection,
  setShowOnly,
  toggleLayer,
  type CompileResult,
  type Entity,
  type Link,
  type LinkType,
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
  /**
   * 편집 적용 — 새 DSL 소스로 재렌더 + onChange 통지(호출자 책임).
   * reframe=true 면 현재 뷰포트를 보존하지 않고 새로 fit(showOnly 진입/나가기처럼
   * 프레임이 바뀌어야 하는 전환). 기본은 보존(클릭 선택 시 화면 고정).
   */
  applyEdit: (nextSource: string, opts?: { reframe?: boolean }) => void;
  /** 현재 DSL 소스 getter. */
  getSource: () => string;
  /** 공유 locator(없으면 생성). */
  locator?: Locator;
}

export interface EditingController {
  /** 회전 재투영 후 카메라(meta)·장면 참조를 최신 result 로 갱신(재마운트 없이). */
  refresh(result: CompileResult): void;
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

/** 토글 가능한 큐레이션 레이어(환경). 향후 dataSource 의 index 에서 동적 생성. */
const LAYER_KEYS = ['해류', '바람'];

const SVG_NS = 'http://www.w3.org/2000/svg';
const CLICK_MOVE_THRESHOLD = 5; // px

export function attachEditing(params: EditingParams): EditingController {
  const { svg, host, getView, result, applyEdit, getSource } = params;
  let cam: MetaCamera = cameraFromMeta(result.meta);
  const locator = params.locator ?? createLocator();
  let scene = result.scene;

  // ── 하이라이트 path (지도 좌표계 = viewBox, 줌/팬에 자동 정렬) ──
  // 색은 테마 슬롯(theme.hover)에서 — 라이트/다크 테마에 맞춰 조정 가능.
  const hoverStyle = scene.theme.hover;
  const highlight = document.createElementNS(SVG_NS, 'path');
  highlight.setAttribute('class', 'gi-edit-highlight');
  highlight.setAttribute('fill', hoverStyle.fill);
  highlight.setAttribute('stroke', hoverStyle.stroke);
  highlight.setAttribute('stroke-width', String(hoverStyle.width));
  highlight.setAttribute('vector-effect', 'non-scaling-stroke'); // 줌 무관 일정 두께
  highlight.style.pointerEvents = 'none';
  highlight.style.display = 'none';
  svg.appendChild(highlight);

  // ── 툴팁 ──
  const tooltip = document.createElement('div');
  tooltip.className = 'gi-edit-tooltip';
  tooltip.style.display = 'none';
  host.appendChild(tooltip);

  // ── 대륙 퀵칩 (기본 접힘: ⋯ 칩, 클릭 시 펼침, 선택 시 재렌더되며 다시 접힘) ──
  const toolbar = document.createElement('div');
  toolbar.className = 'gi-edit-chips';

  // 펼침 상태 + 바깥 클릭 시 접기(메뉴와 동일 패턴, 단 비차단).
  let outsideChipsHandler: ((e: PointerEvent) => void) | null = null;
  const setChipsExpanded = (expanded: boolean): void => {
    toolbar.classList.toggle('expanded', expanded);
    if (expanded && !outsideChipsHandler) {
      outsideChipsHandler = (e: PointerEvent) => {
        if (!toolbar.contains(e.target as Node)) setChipsExpanded(false);
      };
      window.addEventListener('pointerdown', outsideChipsHandler);
    } else if (!expanded && outsideChipsHandler) {
      window.removeEventListener('pointerdown', outsideChipsHandler);
      outsideChipsHandler = null;
    }
  };

  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.className = 'gi-edit-chip gi-chip-more';
  moreBtn.textContent = '⋯';
  moreBtn.setAttribute('aria-label', '대륙 추가');
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setChipsExpanded(true);
  });
  toolbar.appendChild(moreBtn);

  const chipList = document.createElement('div');
  chipList.className = 'gi-chip-list';
  const chipEls: Array<{ el: HTMLButtonElement; name: string }> = [];
  for (const key of CHIP_KEYS) {
    const def = GROUP_DEFS.find((g) => g.key === key);
    if (!def) continue;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'gi-edit-chip';
    chip.textContent = def.display;
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleName(def.display); // 재렌더 → 새 toolbar 는 접힌 상태로 시작
    });
    chipList.appendChild(chip);
    chipEls.push({ el: chip, name: def.display });
  }
  toolbar.appendChild(chipList);
  host.appendChild(toolbar);
  for (const { el, name } of chipEls) el.classList.toggle('active', hasShowName(getSource(), name));

  // ── 레이어(환경) 토글 패널 — 칩 줄 아래 카드. 켜진 레이어는 active. ──
  const layerPanel = document.createElement('div');
  layerPanel.className = 'gi-edit-layers';
  for (const key of LAYER_KEYS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gi-layer-toggle';
    btn.textContent = key;
    btn.classList.toggle('active', hasLayer(getSource(), key));
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const src = getSource();
      const next = toggleLayer(src, key);
      if (next !== src) applyEdit(next);
    });
    layerPanel.appendChild(btn);
  }
  // showOnly(격리) 에선 전세계 레이어가 무의미 → 숨김(칩/모드 토글과 동일).
  if (scene.showOnly) layerPanel.style.display = 'none';
  host.appendChild(layerPanel);

  // ── 모드 토글(flat ↔ globe) — 투영 전환 버튼 ──
  // 펼친 지도(equirectangular)와 지구본(orthographic)을 오간다. 회전/팬은 휘발
  // 상태라 DSL 에 남지 않고, 이 토글만 projection 라인으로 소스에 기록된다.
  const modeBtn = document.createElement('button');
  modeBtn.type = 'button';
  modeBtn.className = 'gi-edit-mode';
  const isGlobe = (): boolean => scene.projection.type === 'orthographic';
  modeBtn.textContent = isGlobe() ? '🗺' : '🌐';
  modeBtn.title = isGlobe() ? '펼친 지도로' : '지구본으로';
  modeBtn.setAttribute('aria-label', modeBtn.title);
  modeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const src = getSource();
    const next = setProjection(src, isGlobe() ? 'equirectangular' : 'orthographic');
    if (next !== src) applyEdit(next);
  });
  host.appendChild(modeBtn);

  // showOnly(격리) 에선 대륙 칩·모드 토글이 무의미 → 숨김(인라인 스타일이 :hover 규칙보다 우선).
  // 대신 '← 전체 지도' 나가기 버튼을 둔다.
  let exitBtn: HTMLButtonElement | null = null;
  if (scene.showOnly) {
    toolbar.style.display = 'none';
    modeBtn.style.display = 'none';
    exitBtn = document.createElement('button');
    exitBtn.type = 'button';
    exitBtn.className = 'gi-edit-exit';
    exitBtn.textContent = '← 전체 지도';
    exitBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const src = getSource();
      const next = removeShowOnly(src);
      if (next !== src) applyEdit(next, { reframe: true });
    });
    host.appendChild(exitBtn);
  }

  // ── 컨텍스트 메뉴 ──
  let menuEl: HTMLElement | null = null;
  let backdropEl: HTMLElement | null = null;

  const closeMenu = (): void => {
    menuEl?.remove();
    backdropEl?.remove();
    menuEl = null;
    backdropEl = null;
  };

  /** backdrop + 빈 메뉴 셸 생성 → build 로 내용 채우고 위치. */
  const openMenuShell = (clientX: number, clientY: number, build: (menu: HTMLElement) => void): void => {
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
    build(menu);
    host.appendChild(menu);
    menuEl = menu;

    const hostRect = host.getBoundingClientRect();
    const mw = menu.offsetWidth || 180;
    const mh = menu.offsetHeight || 160;
    const left = Math.min(clientX - hostRect.left, Math.max(0, hostRect.width - mw - 4));
    const top = Math.min(clientY - hostRect.top, Math.max(0, hostRect.height - mh - 4));
    menu.style.left = `${Math.max(4, left)}px`;
    menu.style.top = `${Math.max(4, top)}px`;
  };

  const addTitle = (menu: HTMLElement, text: string): void => {
    const t = document.createElement('div');
    t.className = 'gi-edit-menu-title';
    t.textContent = text;
    menu.appendChild(t);
  };
  const addSection = (menu: HTMLElement, text: string): void => {
    const s = document.createElement('div');
    s.className = 'gi-edit-menu-section';
    s.textContent = text;
    menu.appendChild(s);
  };
  const addSep = (menu: HTMLElement): void => {
    const s = document.createElement('div');
    s.className = 'gi-edit-menu-sep';
    menu.appendChild(s);
  };
  const addItem = (
    menu: HTMLElement,
    text: string,
    onClick: () => void,
    opts: { connected?: boolean; danger?: boolean } = {},
  ): void => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `gi-edit-menu-item${opts.connected ? ' connected' : ''}${opts.danger ? ' danger' : ''}`;
    item.textContent = `${opts.connected ? '✓ ' : ''}${text}`;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    menu.appendChild(item);
  };

  /** 편집 적용 헬퍼 — 바뀌면 applyEdit, 아니면 메뉴만 닫기. */
  const commit = (next: string, opts?: { reframe?: boolean }): void => {
    if (next !== getSource()) applyEdit(next, opts);
    else closeMenu();
  };

  const entityDisplay = (key: string): string =>
    scene.entities.find((e) => e.key === key)?.display ?? key;

  /** showOnly 에서 이 엔티티가 '선택된'(show 에 명시) ADM1 인지 — 자동 캔버스와 구분. */
  function isSelectedAdm1(e: Entity): boolean {
    return hasShowName(getSource(), e.display);
  }

  // ── 국가 메뉴 ──
  const openMenu = (entity: Entity, clientX: number, clientY: number): void => {
    // showOnly 에선 연결 후보를 '선택된' ADM1 로만 한정(전체 행정구역 캔버스 제외).
    const others = scene.entities.filter(
      (e) => e.key !== entity.key && (!scene.showOnly || isSelectedAdm1(e)),
    );
    openMenuShell(clientX, clientY, (menu) => {
      addTitle(menu, entity.display);
      if (others.length > 0) {
        addSection(menu, '연결 / 해제');
        for (const other of others) {
          const connected = isLinked(entity.key, other.key);
          addItem(menu, other.display, () => toggleLink(entity, other, connected), { connected });
        }
      } else {
        const hint = document.createElement('div');
        hint.className = 'gi-edit-menu-hint';
        hint.textContent = '연결할 다른 선택 항목이 없습니다';
        menu.appendChild(hint);
      }
      addSep(menu);
      // 일반 모드에서 국가(level 0) → 이 국가만 행정구역으로 보기(showOnly 진입).
      if (!scene.showOnly && entity.level === 0) {
        addItem(menu, '행정구역 보기', () => commit(setShowOnly(getSource(), entity.display), { reframe: true }));
      }
      addItem(menu, scene.showOnly ? '선택 해제' : '이 국가 제거', () => commit(removeShowName(getSource(), entity.display)), {
        danger: true,
      });
    });
  };

  // ── 링크 메뉴 (타입/라벨/제거) ──
  const LINK_TYPES: Array<{ type: LinkType; label: string }> = [
    { type: 'arrow', label: '화살표' },
    { type: 'wind', label: '바람' },
    { type: 'current', label: '해류' },
    { type: 'route', label: '경로' },
  ];

  const openLinkMenu = (link: Link, clientX: number, clientY: number): void => {
    const fromD = entityDisplay(link.from);
    const toD = entityDisplay(link.to);
    openMenuShell(clientX, clientY, (menu) => {
      addTitle(menu, `${fromD} → ${toD}`);
      addSection(menu, '타입');
      for (const { type, label } of LINK_TYPES) {
        addItem(menu, label, () => commit(setLinkType(getSource(), fromD, toD, type)), {
          connected: link.type === type,
        });
      }
      addSection(menu, '라벨');
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'gi-edit-menu-input';
      input.value = link.label ?? '';
      input.placeholder = '라벨 입력 후 Enter';
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit(setLinkLabel(getSource(), fromD, toD, input.value));
        } else if (e.key === 'Escape') {
          closeMenu();
        }
      });
      menu.appendChild(input);
      addSep(menu);
      addItem(menu, '링크 제거', () => commit(removeLink(getSource(), fromD, toD)), { danger: true });
    });
  };

  /**
   * 클릭/hover 지점의 ADM1 엔티티 식별 — showOnly 에선 모든 행정구역이 data-key 를
   * 가진 개별 path 라 elementFromPoint(capture 무관)로 바로 잡는다. 국가 locator 불필요.
   */
  const entityAt = (clientX: number, clientY: number): Entity | null => {
    const el = document.elementFromPoint(clientX, clientY);
    const key = el && el.getAttribute ? el.getAttribute('data-key') : null;
    if (!key) return null;
    return scene.entities.find((en) => en.key === key) ?? null;
  };

  /** 클릭 지점의 링크(data-link) 식별 — pointer capture 영향 없는 elementFromPoint 사용. */
  const linkAt = (clientX: number, clientY: number): Link | null => {
    const el = document.elementFromPoint(clientX, clientY);
    const dl = el && el.getAttribute ? el.getAttribute('data-link') : null;
    if (!dl) return null;
    const idx = dl.indexOf('>');
    if (idx < 0) return null;
    const f = dl.slice(0, idx);
    const t = dl.slice(idx + 1);
    return scene.links.find((l) => l.from === f && l.to === t) ?? null;
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
    commit(next);
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
  let hoveredKey: string | null = null; // showOnly ADM1 hover 추적
  let rafId = 0;
  let pending: { x: number; y: number } | null = null;

  const processHover = (): void => {
    rafId = 0;
    if (!pending || menuEl) return;
    // showOnly — ADM1 엔티티 hover 하이라이트 + 선택/해제 힌트.
    if (scene.showOnly) {
      const ent = entityAt(pending.x, pending.y);
      if ((ent?.key ?? null) !== hoveredKey) {
        hoveredKey = ent?.key ?? null;
        if (ent && ent.features[0]) {
          highlight.setAttribute('d', cam.path(ent.features[0]));
          highlight.style.display = '';
        } else {
          highlight.style.display = 'none';
        }
      }
      if (ent) {
        const shown = hasShowName(getSource(), ent.display);
        tooltip.textContent = `${ent.display}  ${shown ? '· 클릭: 연결/해제' : '+ 선택'}`;
        tooltip.style.display = '';
        const rect = host.getBoundingClientRect();
        tooltip.style.left = `${pending.x - rect.left + 12}px`;
        tooltip.style.top = `${pending.y - rect.top + 12}px`;
      } else {
        tooltip.style.display = 'none';
      }
      pending = null;
      return;
    }
    // 링크 위면 링크 편집 힌트.
    if (linkAt(pending.x, pending.y)) {
      hovered = null;
      highlight.style.display = 'none';
      tooltip.textContent = '✎ 링크 편집';
      tooltip.style.display = '';
      const rect = host.getBoundingClientRect();
      tooltip.style.left = `${pending.x - rect.left + 12}px`;
      tooltip.style.top = `${pending.y - rect.top + 12}px`;
      pending = null;
      return;
    }
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
    hoveredKey = null;
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
    // showOnly — 미선택 ADM1 클릭: 선택(추가). 선택된 ADM1 클릭: 메뉴(연결/해제·선택해제).
    if (scene.showOnly) {
      const ent = entityAt(e.clientX, e.clientY);
      if (!ent) return;
      onLeave();
      if (isSelectedAdm1(ent)) {
        openMenu(ent, e.clientX, e.clientY);
      } else {
        const src = getSource();
        const next = addShowName(src, ent.display);
        if (next !== src) applyEdit(next);
      }
      return;
    }
    // 링크(화살표/선) 클릭 → 링크 메뉴
    const link = linkAt(e.clientX, e.clientY);
    if (link) {
      onLeave();
      openLinkMenu(link, e.clientX, e.clientY);
      return;
    }
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
    refresh(next) {
      // 회전 재투영 — meta(투영 rotate)가 바뀌었으니 카메라 재구성. 엔티티/링크 등
      // 장면 데이터는 동일 모델이라 그대로지만 scene 객체는 새로 만들어졌으니 갱신.
      scene = next.scene;
      cam = cameraFromMeta(next.meta);
      // 진행 중인 hover 하이라이트는 좌표가 어긋났을 수 있으니 숨긴다(다음 hover 에 재계산).
      onLeave();
    },
    destroy() {
      if (rafId) cancelAnimationFrame(rafId);
      svg.removeEventListener('pointermove', onMove);
      svg.removeEventListener('pointerleave', onLeave);
      svg.removeEventListener('pointerdown', onDown);
      svg.removeEventListener('pointerup', onUp);
      closeMenu();
      if (outsideChipsHandler) window.removeEventListener('pointerdown', outsideChipsHandler);
      highlight.remove();
      tooltip.remove();
      toolbar.remove();
      layerPanel.remove();
      modeBtn.remove();
      exitBtn?.remove();
    },
  };
}

