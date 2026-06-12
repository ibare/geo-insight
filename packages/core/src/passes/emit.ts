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

import type { DataSource } from '@geoinsight/data';
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

/** gi-content 내부 — gi-geometry + gi-annotations 두 그룹. */
export function emitContent(input: EmitInput): string {
  return (
    `<g class="gi-geometry">\n${emitGeometry(input)}\n</g>\n` +
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

    // 3.5 큐레이션 레이어(해류 등) — 바다/세계 위, 행정구역·엔티티 아래.
    //     난류/한류로 색을 가르고, 흐름선마다 개별 path. 격리 모드(바다 생략)는 제외.
    for (const name of scene.layers ?? []) {
      for (const f of dataSource.layer(name)) {
        const d = camera.path(f);
        if (!d) continue;
        const warm = f.properties.kind === 'warm';
        out.push(
          path(d, {
            class: `gi-layer gi-layer-${warm ? 'warm' : 'cold'}`,
            'data-layer': name,
            'data-id': f.id,
            fill: 'none',
            stroke: warm ? theme.layers.warm : theme.layers.cold,
            'stroke-width': '1.6',
            'stroke-linecap': 'round',
            'vector-effect': 'non-scaling-stroke',
          }),
        );
      }
    }
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

  // 레이어 라벨(해류 이름) — 흐름선 중간점, 화면 일정 크기. 격리 모드 제외, globe 뒷면 컬링.
  if (!isolated && (scene.layers?.length ?? 0) > 0) {
    const halo = n2(2.5 * s);
    const items: string[] = [];
    for (const name of scene.layers!) {
      for (const f of dataSource.layer(name)) {
        if (f.geometry.type !== 'LineString') continue;
        const coords = f.geometry.coordinates;
        if (coords.length === 0) continue;
        const mid = coords[Math.floor(coords.length / 2)]!;
        if (!camera.visible(mid)) continue;
        const p = camera.project(mid);
        if (!p) continue;
        const color = f.properties.kind === 'warm' ? theme.layers.warm : theme.layers.cold;
        const common = `x="${n2(p[0])}" y="${n2(p[1])}"`;
        items.push(
          `<text ${common} class="gi-layer-label-halo" fill="none" stroke="${theme.label.halo}" stroke-width="${halo}" stroke-linejoin="round">${escapeText(f.properties.kor)}</text>`,
        );
        items.push(`<text ${common} class="gi-layer-label" fill="${color}">${escapeText(f.properties.kor)}</text>`);
      }
    }
    if (items.length > 0) {
      out.push(
        `<g class="gi-layer-labels" font-family="${escapeAttr(theme.label.font)}" font-size="${n2(theme.label.size * 0.85 * s)}" ` +
          `font-style="italic" text-anchor="middle">`,
      );
      out.push(...items);
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
