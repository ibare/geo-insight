/**
 * Emit 패스 — 결정적 SVG 문자열.
 *
 * 콘텐츠는 두 그룹으로 나뉜다:
 *   - gi-geometry: sphere → graticule → faint world → subdivisions → entity fills.
 *     무겁고(전세계 path) 줌에는 안 변하므로 팬(회전)에만 재투영한다.
 *   - gi-annotations: 5대양 라벨 → links → labels. 가볍고 화면상 일정 크기여야 하므로
 *     팬·줌 모두 재렌더하며 annotationScale 로 크기를 보정한다(줌 배율 상쇄).
 * 좌표는 이미 precision 으로 반올림됨. 속성/순서가 안정적이라 스냅샷·diff 가능.
 */

import type { DataSource } from '@geo-insight/data';
import { cardinalSpline, type FlowPt } from '../flow.js';
import { DEFAULT_FLOW_WIDTH_PARAMS, resolveFlowWidth, type FlowWidthParams } from '../flow-width.js';
import { graticule } from '../geometry.js';
import type { Entity, Scene, Theme } from '../types.js';
import type { Camera } from './camera.js';
import type { PlacedLabel } from './labels.js';
import type { RoutedLink } from './links.js';
import type { PlacedOcean } from './oceans.js';

export interface EmitInput {
  scene: Scene;
  camera: Camera;
  entities: Entity[];
  links: RoutedLink[];
  labels: PlacedLabel[];
  oceans: PlacedOcean[];
  theme: Theme;
  dataSource: DataSource;
  /** 드래그 재투영 중이면 faint world 배경을 거친(110m) 지오메트리로 — 값싼 재렌더. */
  coarseWorld?: boolean;
  /**
   * 주석(라벨/링크) 크기 배율 — 줌 배율(현재 viewBox 폭/기본 폭)을 그대로 넣는다.
   * 폰트·헤일로·링크 stroke 를 이 값으로 곱하면 줌과 무관하게 화면상 크기가 일정해진다.
   * 기본 1. 링크 path 의 두께/wedge 는 routeLinks 에서 이미 같은 배율로 적용됨.
   */
  annotationScale?: number;
  /**
   * 흐름(해류) 두께·가시성 계산용 — 현재 줌의 화면 픽셀/km. 미지정 시 정적 fit 해상도
   * (projection scale / 지구반경)로 폴백한다(비대화형 compile()). 대화형 런타임은 줌을
   * 반영한 값을 매 줌 전달해, 폭이 좁은 해류는 줌아웃 시 1px 미만이 되어 사라진다.
   */
  pxPerKm?: number;
  /** 흐름 두께 모델 파라미터(라이브 튜닝). 미지정 시 DEFAULT_FLOW_WIDTH_PARAMS. */
  flowWidthParams?: FlowWidthParams;
}

/** 지구 반경(km) — 1 라디안 호 길이. projection scale(px/rad) → px/km 환산에 쓴다. */
const EARTH_RADIUS_KM = 6371;

/** width(km) 미지정 흐름의 kind 별 기본 폭(km). */
function defaultWidthKm(kind: string): number {
  return isCurrentKind(kind) ? 80 : 30;
}

export function emit(input: EmitInput): string {
  const [vx, vy, vw, vh] = input.camera.meta.viewBox;
  // gi-content > (gi-geometry, gi-annotations). 런타임은 팬 때 gi-content 전체를,
  // 줌 때 gi-annotations 만 교체해 지오메트리 재투영을 피하면서 주석 크기를 보정한다.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" ` +
    `width="${vw}" height="${vh}" class="geoinsight" role="img">\n` +
    `<g class="gi-content">\n${emitContent(input)}\n</g>\n</svg>`
  );
}

/** gi-content 내부 — gi-geometry + gi-flows + gi-annotations 세 그룹. */
export function emitContent(input: EmitInput): string {
  return (
    `<g class="gi-geometry">\n${emitGeometry(input)}\n</g>\n` +
    `<g class="gi-flows">\n${emitFlows(input)}\n</g>\n` +
    `<g class="gi-annotations">\n${emitAnnotations(input)}\n</g>`
  );
}

/** 지오메트리 레이어(무거움, 줌 불변) — sphere/graticule/world/subdivisions/entities. */
export function emitGeometry(input: EmitInput): string {
  const { scene, camera, entities, theme, dataSource } = input;
  const out: string[] = [];
  const isolated = scene.showOnly != null;

  if (!isolated) {
    // 1. sphere (ocean)
    const sphere = camera.path({ type: 'Sphere' });
    if (sphere) out.push(path(sphere, { class: 'gi-ocean', fill: theme.ocean, stroke: 'none' }));

    // 2. graticule
    const grat = camera.path(graticule());
    if (grat)
      out.push(
        path(grat, {
          class: 'gi-graticule',
          fill: 'none',
          stroke: theme.graticule,
          'stroke-width': '0.5',
          'vector-effect': 'non-scaling-stroke',
        }),
      );

    // 3. faint world (비선택 국가 배경) — 드래그 중엔 거친 110m 으로 값싸게.
    const worldFeatures =
      input.coarseWorld && dataSource.coarseCountries
        ? dataSource.coarseCountries()
        : dataSource.allCountries();
    const world = camera.path({ type: 'FeatureCollection', features: worldFeatures });
    if (world)
      out.push(
        path(world, {
          class: 'gi-world',
          fill: theme.worldFaint,
          stroke: theme.worldStroke,
          'stroke-width': '0.4',
          'vector-effect': 'non-scaling-stroke',
        }),
      );

    // 3.5 큐레이션 레이어 면(Polygon) — 바다/세계 위, 행정구역·엔티티 아래.
    //     선(흐름)은 gi-flows(emitFlows, 줌 종속 두께), 점은 gi-annotations 에서 그린다.
    const layerPaths: string[] = [];
    for (const name of scene.layers ?? []) {
      for (const f of dataSource.layer(name)) {
        const geomType = f.geometry.type;
        if (geomType !== 'Polygon' && geomType !== 'MultiPolygon') continue;
        const d = camera.path(f);
        if (!d) continue;
        const kind = f.properties.kind ?? 'warm';
        const color = layerColor(theme, kind);
        layerPaths.push(
          path(d, {
            class: `gi-layer gi-layer-area gi-layer-${kind}`,
            'data-layer': name,
            'data-id': f.id,
            fill: color,
            'fill-opacity': '0.18',
            stroke: color,
            'stroke-opacity': '0.6',
            'stroke-width': '1',
            'vector-effect': 'non-scaling-stroke',
          }),
        );
      }
    }
    out.push(...layerPaths);
  }

  // 3.6 행정구역 맥락 — ADM1 이 표시된 국가의 전체 주/도 경계를 옅게 깔아
  //      "어느 국가의 어느 주" 인지 읽히게 한다(엔티티 fill 아래).
  const admCountries = new Set<string>();
  for (const ent of entities) {
    if (!isolated && ent.level > 0 && ent.adm0) admCountries.add(ent.adm0);
  }
  for (const ccn3 of admCountries) {
    const subs = dataSource.adm1(ccn3);
    if (subs.length === 0) continue;
    const d = camera.path({ type: 'FeatureCollection', features: subs });
    if (d)
      out.push(
        path(d, {
          class: 'gi-subdivisions',
          'data-adm0': ccn3,
          fill: 'none',
          stroke: theme.subdivision.contextStroke,
          'stroke-width': '0.4',
          'vector-effect': 'non-scaling-stroke',
        }),
      );
  }

  // 4. 엔티티 (z 순서 — 이미 정렬됨)
  for (const ent of entities) {
    const d = camera.path({ type: 'FeatureCollection', features: ent.features });
    if (!d) continue;
    out.push(
      path(d, {
        class: `gi-entity gi-${ent.role}`,
        'data-key': ent.key,
        fill: ent.style.fill,
        'fill-opacity': String(ent.style.opacity),
        stroke: ent.style.borders ? ent.style.stroke : 'none',
        'stroke-width': ent.style.borders ? '0.5' : '0',
        'vector-effect': 'non-scaling-stroke',
      }),
    );
  }

  return out.join('\n');
}

/** 주석 레이어(가벼움, 화면상 일정 크기) — 5대양 라벨/links/labels. */
export function emitAnnotations(input: EmitInput): string {
  const { scene, camera, links, labels, oceans, theme, dataSource } = input;
  const s = input.annotationScale && input.annotationScale > 0 ? input.annotationScale : 1;
  const isolated = scene.showOnly != null;
  const out: string[] = [];

  // 5대양 라벨 (격리 모드 제외)
  if (!isolated && oceans.length > 0) {
    out.push(
      `<g class="gi-oceans" font-family="${escapeAttr(theme.label.font)}" font-size="${n2(theme.oceanLabel.size * s)}" ` +
        `font-style="italic" text-anchor="middle" fill="${theme.oceanLabel.fill}" letter-spacing="${n2(theme.oceanLabel.spacing * s)}">`,
    );
    for (const o of oceans) {
      out.push(`<text x="${o.x}" y="${o.y}" class="gi-ocean-label">${escapeText(o.text)}</text>`);
    }
    out.push('</g>');
  }

  // 레이어 점 마커 + 라벨(흐름 선·화살촉·라벨은 gi-flows/emitFlows 로 이동).
  // 화면 일정 크기(annotationScale), 격리 모드 제외, globe 뒷면 컬링.
  if (!isolated && (scene.layers?.length ?? 0) > 0) {
    const halo = n2(2.5 * s);
    const markers: string[] = [];
    const labels: string[] = [];
    for (const name of scene.layers!) {
      for (const f of dataSource.layer(name)) {
        const gt = f.geometry.type;
        if (gt !== 'Point' && gt !== 'MultiPoint') continue;
        const kind = f.properties.kind ?? 'warm';
        const color = layerColor(theme, kind);
        // 점 마커 — 흰 테두리 원. 크기는 properties.size 에 비례. 라벨은 마커 아래.
        const pts = gt === 'Point' ? [f.geometry.coordinates] : f.geometry.coordinates;
        const r = n2((3.5 + (Number(f.properties.size) || 1) * 1.4) * s);
        for (const pt of pts) {
          if (!camera.visible(pt)) continue;
          const p = camera.project(pt);
          if (!p) continue;
          markers.push(
            `<circle class="gi-layer-marker gi-layer-${kind}" data-layer="${escapeAttr(name)}" cx="${n2(p[0])}" cy="${n2(p[1])}" r="${r}" fill="${color}" stroke="${theme.label.halo}" stroke-width="${n2(1.5 * s)}"/>`,
          );
          if (f.properties.kor) {
            labels.push(...layerLabel(p[0], p[1] + r + theme.label.size * 0.9 * s, f.properties.kor, color, theme.label.halo, halo));
          }
        }
      }
    }
    if (markers.length > 0) out.push(`<g class="gi-layer-markers">\n${markers.join('\n')}\n</g>`);
    if (labels.length > 0) {
      out.push(
        `<g class="gi-layer-labels" font-family="${escapeAttr(theme.label.font)}" font-size="${n2(theme.label.size * 0.85 * s)}" ` +
          `font-style="italic" text-anchor="middle">`,
      );
      out.push(...labels);
      out.push('</g>');
    }
  }

  // links (타입별 path — wedge/stroke/wavy/arrowhead 모두 paths 로) + 투명 히트 영역
  for (const l of links) {
    const dl = `${l.from}>${l.to}`;
    for (const p of l.paths) {
      if (p.d) out.push(linkPath(p, dl));
    }
    if (l.hit) {
      out.push(
        `<path class="gi-link-hit" data-link="${escapeAttr(dl)}" d="${l.hit}" fill="none" ` +
          `stroke="#000" stroke-opacity="0" stroke-width="${n2(14 * s)}" stroke-linecap="round" pointer-events="stroke"/>`,
      );
    }
  }

  // labels (엔티티 + 링크). halo + fill. 폰트·헤일로는 annotationScale 로 화면상 일정.
  const linkLabels = links.filter((l) => l.label);
  if (labels.length > 0 || linkLabels.length > 0) {
    const halo = n2(3 * s);
    out.push(
      `<g class="gi-labels" font-family="${escapeAttr(theme.label.font)}" font-size="${n2(theme.label.size * s)}" text-anchor="middle">`,
    );
    for (const lab of labels) {
      const common = `x="${lab.x}" y="${lab.y}" data-key="${escapeAttr(lab.entityKey)}"`;
      out.push(
        `<text ${common} class="gi-label-halo" fill="none" stroke="${theme.label.halo}" stroke-width="${halo}" stroke-linejoin="round">${escapeText(lab.text)}</text>`,
      );
      out.push(`<text ${common} class="gi-label" fill="${theme.label.fill}">${escapeText(lab.text)}</text>`);
    }
    for (const l of links) {
      if (!l.label) continue;
      const common = `x="${l.label.x}" y="${l.label.y}"`;
      out.push(
        `<text ${common} class="gi-link-label-halo" fill="none" stroke="${theme.label.halo}" stroke-width="${halo}" stroke-linejoin="round">${escapeText(l.label.text)}</text>`,
      );
      out.push(`<text ${common} class="gi-link-label" fill="${theme.label.fill}">${escapeText(l.label.text)}</text>`);
    }
    out.push('</g>');
  }

  return out.join('\n');
}

function linkPath(p: { d: string; fill: string; stroke: string; width?: number; dash?: string }, dataLink: string): string {
  const attrs: Record<string, string> = { class: 'gi-link', 'data-link': dataLink, fill: p.fill, stroke: p.stroke };
  if (p.stroke !== 'none') {
    attrs['stroke-width'] = String(p.width ?? 2);
    attrs['stroke-linecap'] = 'round';
    attrs['stroke-linejoin'] = 'round';
    if (p.dash) attrs['stroke-dasharray'] = p.dash;
  }
  return path(p.d, attrs);
}

/** 레이어 흐름선 색 — feature.kind → theme.layers 색(미정의면 warm 폴백). */
/**
 * gi-flows 그룹 — 흐름(해류) 선. width(km)를 현재 줌의 화면 px/km(pxPerKm)로 환산해
 * 두께·가시성·페이드를 결정한다(flow-width). 본체·화살촉·라벨을 흐름별 opacity 그룹으로
 * 묶어 임계 근처 페이드가 함께 적용되게 한다. 점 마커는 emitAnnotations 가 담당.
 */
export function emitFlows(input: EmitInput): string {
  const { scene, camera, theme, dataSource } = input;
  if (scene.showOnly != null || (scene.layers?.length ?? 0) === 0) return '';
  const s = input.annotationScale && input.annotationScale > 0 ? input.annotationScale : 1;
  // pxPerKm: 대화형은 줌 반영값을 받고, 비대화형(정적 compile)은 fit 해상도로 폴백.
  // 가시성(줌아웃 시 사라짐)은 대화형에서만 — 정적은 줌 개념이 없어 모든 흐름을 그린다.
  const interactive = input.pxPerKm != null && input.pxPerKm > 0;
  const pxPerKm = interactive ? input.pxPerKm! : camera.meta.projectionParams.scale / EARTH_RADIUS_KM;
  const params = input.flowWidthParams ?? DEFAULT_FLOW_WIDTH_PARAMS;
  const halo = n2(2.5 * s);
  const labelFont =
    `font-family="${escapeAttr(theme.label.font)}" font-size="${n2(theme.label.size * 0.85 * s)}" ` +
    `font-style="italic" text-anchor="middle"`;

  const defs: string[] = [];
  const items: string[] = [];
  for (const name of scene.layers!) {
    for (const f of dataSource.layer(name)) {
      // 흐름은 prim:'flow' 인 LineString 만 — prim 없는 선(면 draft 등)은 흐름이 아니다.
      if (f.geometry.type !== 'LineString' || f.properties.prim !== 'flow') continue;
      const kind = f.properties.kind ?? 'warm';
      const widthKm = typeof f.properties.width === 'number' ? f.properties.width : defaultWidthKm(kind);
      const r = resolveFlowWidth(widthKm, pxPerKm, params);
      if (interactive && !r.visible) continue; // 폭이 좁아 현재 줌에서 1px 미만 → 사라짐
      const opacity = interactive ? r.opacity : 1;
      // 라벨은 도형보다 높은 임계 — 도형은 보여도 라벨은 먼저 사라진다(정적은 항상 표시).
      const labelVisible = !interactive || r.labelVisible;
      const labelOpacity = interactive ? r.labelOpacity : 1;

      const isFlow = f.properties.prim === 'flow';
      const coords = isFlow ? cardinalSpline(f.geometry.coordinates as FlowPt[]) : f.geometry.coordinates;
      if (coords.length < 2) continue;
      const d = camera.path({ ...f, geometry: { type: 'LineString', coordinates: coords } });
      if (!d) continue;

      const color = layerColor(theme, kind);
      const parts: string[] = [];

      // 방향 그라데이션(꼬리 투명 → 머리 진함). axis = 시작점→끝점 투영.
      let stroke = color;
      const p0 = camera.project(coords[0]!);
      const pN = camera.project(coords[coords.length - 1]!);
      if (p0 && pN) {
        const gid = `gilg-${f.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
        defs.push(
          `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${n2(p0[0])}" y1="${n2(p0[1])}" x2="${n2(pN[0])}" y2="${n2(pN[1])}">` +
            `<stop offset="0" stop-color="${color}" stop-opacity="0.04"/>` +
            `<stop offset="1" stop-color="${color}" stop-opacity="1"/></linearGradient>`,
        );
        stroke = `url(#${gid})`;
      }

      // 본체 — non-scaling-stroke 라 stroke-width 가 곧 화면 px(strokeWidthPx).
      const sw = n2(r.strokeWidthPx);
      const bodyAttrs: Record<string, string> = {
        class: `gi-layer gi-flow-line gi-layer-${kind}`,
        'data-layer': name,
        'data-id': f.id,
        fill: 'none',
        stroke,
        'stroke-width': String(sw),
        'stroke-linecap': 'butt',
        'stroke-linejoin': 'round',
        'vector-effect': 'non-scaling-stroke',
      };
      if (f.properties.dash) bodyAttrs['stroke-dasharray'] = `${n2(r.strokeWidthPx * 1.2)} ${sw}`;
      parts.push(path(d, bodyAttrs));

      // 화살촉 — 화면 px(strokeWidthPx) 기준. annotationScale(s) 로 viewBox 좌표 변환.
      const b = coords[coords.length - 1]!;
      const a = coords[coords.length - 2]!;
      if (f.properties.arrow !== false && camera.visible(b)) {
        const pb = camera.project(b);
        const pa = camera.project(a);
        if (pb && pa) {
          const w = r.strokeWidthPx * s;
          parts.push(arrowHead(pa, pb, w * 2.4, w * 1.35, w * 0.5, color));
        }
      }

      // 라벨 — 중간점. 도형보다 높은 임계로 먼저 사라진다(이중 가시성). 별도 opacity.
      let labelMarkup = '';
      if (labelVisible && f.properties.kor) {
        const mid = coords[Math.floor(coords.length / 2)]!;
        if (camera.visible(mid)) {
          const p = camera.project(mid);
          if (p) {
            const lo = labelOpacity < 1 ? ` opacity="${n2(labelOpacity)}"` : '';
            labelMarkup =
              `<g${lo} ${labelFont}>\n` +
              `${layerLabel(p[0], p[1], f.properties.kor, color, theme.label.halo, halo).join('\n')}\n</g>`;
          }
        }
      }

      // 도형(본체·화살촉)과 라벨을 각자 opacity 그룹으로 — 라벨이 먼저 페이드/소멸한다.
      const sop = opacity < 1 ? ` opacity="${n2(opacity)}"` : '';
      const shapeGroup = `<g${sop}>\n${parts.join('\n')}\n</g>`;
      items.push(
        `<g class="gi-flow" data-id="${escapeAttr(f.id)}">\n${shapeGroup}${labelMarkup ? `\n${labelMarkup}` : ''}\n</g>`,
      );
    }
  }
  if (items.length === 0) return '';
  const out: string[] = [];
  if (defs.length > 0) out.push(`<defs>\n${defs.join('\n')}\n</defs>`);
  out.push(...items);
  return out.join('\n');
}

function layerColor(theme: Theme, kind: string): string {
  return theme.layers[kind] ?? theme.layers.warm ?? '#888888';
}

/** 해류 흐름선(warm/cold)인지 — 굵은 대양 흐름으로 그릴 대상(바람과 구분). */
function isCurrentKind(kind: string): boolean {
  return kind === 'warm' || kind === 'cold';
}

/** 레이어 라벨 — halo + fill 두 text. 화면 좌표(viewBox) 기준. */
function layerLabel(x: number, y: number, text: string, color: string, halo: string, haloW: number): string[] {
  const common = `x="${n2(x)}" y="${n2(y)}"`;
  return [
    `<text ${common} class="gi-layer-label-halo" fill="none" stroke="${halo}" stroke-width="${haloW}" stroke-linejoin="round">${escapeText(text)}</text>`,
    `<text ${common} class="gi-layer-label" fill="${color}">${escapeText(text)}</text>`,
  ];
}

/**
 * 흐름선 끝 갈매기형(barbed) 화살촉 — a→b 방향. 뒤가 오목해 날렵하다.
 * tip 을 끝점 b 보다 ext 만큼 앞으로 빼서 굵은 선의 끝 캡을 덮는다. 좌표는 화면(viewBox).
 */
function arrowHead(
  a: [number, number],
  b: [number, number],
  len: number,
  halfW: number,
  ext: number,
  color: string,
): string {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const m = Math.hypot(dx, dy) || 1;
  const ux = dx / m;
  const uy = dy / m;
  const px = -uy; // 진행 방향에 수직
  const py = ux;
  const tx = b[0] + ext * ux; // 꼭짓점(끝점보다 앞)
  const ty = b[1] + ext * uy;
  const cx = tx - len * ux; // 날개 base 중심
  const cy = ty - len * uy;
  const w1x = cx + halfW * px;
  const w1y = cy + halfW * py;
  const w2x = cx - halfW * px;
  const w2y = cy - halfW * py;
  const nx = cx + len * 0.34 * ux; // 뒤 노치(오목) — 갈매기 모양
  const ny = cy + len * 0.34 * uy;
  return (
    `<path class="gi-layer-arrow" fill="${color}" ` +
    `d="M${n2(tx)} ${n2(ty)} L${n2(w1x)} ${n2(w1y)} L${n2(nx)} ${n2(ny)} L${n2(w2x)} ${n2(w2y)}Z"/>`
  );
}

function path(d: string, attrs: Record<string, string>): string {
  const a = Object.entries(attrs)
    .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
    .join(' ');
  return `<path ${a} d="${d}"/>`;
}

/** 짧은 소수 반올림(주석 크기용). */
function n2(x: number): number {
  return Math.round(x * 100) / 100;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
