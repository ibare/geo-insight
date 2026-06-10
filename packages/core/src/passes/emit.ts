/**
 * Emit 패스 — 결정적 SVG 문자열.
 *
 * 레이어 순서 고정(구현지침 §9):
 *   sphere(ocean) → graticule → faint world → group/plain/focus fills(z 순서)
 *   → links → arrowheads → labels.
 * 좌표는 이미 precision 으로 반올림됨. 속성 순서·id 순서가 안정적이라 스냅샷·diff 가능.
 */

import type { DataSource } from '@geoinsight/data';
import { graticule } from '../geometry.js';
import type { Entity, Scene, Theme } from '../types.js';
import type { Camera } from './camera.js';
import type { PlacedLabel } from './labels.js';
import type { RoutedLink } from './links.js';

export interface EmitInput {
  scene: Scene;
  camera: Camera;
  entities: Entity[];
  links: RoutedLink[];
  labels: PlacedLabel[];
  theme: Theme;
  dataSource: DataSource;
}

export function emit(input: EmitInput): string {
  const { camera, entities, links, labels, theme, dataSource } = input;
  const [vx, vy, vw, vh] = camera.meta.viewBox;
  const out: string[] = [];

  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" ` +
      `width="${vw}" height="${vh}" class="geoinsight" role="img">`,
  );

  // 1. sphere (ocean)
  const sphere = camera.path({ type: 'Sphere' });
  if (sphere) out.push(path(sphere, { class: 'gi-ocean', fill: theme.ocean, stroke: 'none' }));

  // 2. graticule
  const grat = camera.path(graticule());
  if (grat)
    out.push(
      path(grat, { class: 'gi-graticule', fill: 'none', stroke: theme.graticule, 'stroke-width': '0.5' }),
    );

  // 3. faint world (비선택 국가 배경)
  const world = camera.path({ type: 'FeatureCollection', features: dataSource.allCountries() });
  if (world)
    out.push(
      path(world, {
        class: 'gi-world',
        fill: theme.worldFaint,
        stroke: theme.worldStroke,
        'stroke-width': '0.4',
      }),
    );

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
      }),
    );
  }

  // 5. links (wedge)
  for (const l of links) {
    if (l.wedge) out.push(path(l.wedge, { class: 'gi-link', fill: l.color, stroke: 'none' }));
  }
  // 6. arrowheads
  for (const l of links) {
    if (l.arrowhead) out.push(path(l.arrowhead, { class: 'gi-arrow', fill: l.color, stroke: 'none' }));
  }

  // 7. labels (halo + fill)
  if (labels.length > 0) {
    out.push(`<g class="gi-labels" font-family="${escapeAttr(theme.label.font)}" font-size="${theme.label.size}" text-anchor="middle">`);
    for (const lab of labels) {
      const common = `x="${lab.x}" y="${lab.y}" data-key="${escapeAttr(lab.entityKey)}"`;
      out.push(
        `<text ${common} class="gi-label-halo" fill="none" stroke="${theme.label.halo}" stroke-width="3" stroke-linejoin="round">${escapeText(lab.text)}</text>`,
      );
      out.push(`<text ${common} class="gi-label" fill="${theme.label.fill}">${escapeText(lab.text)}</text>`);
    }
    out.push('</g>');
  }

  out.push('</svg>');
  return out.join('\n');
}

function path(d: string, attrs: Record<string, string>): string {
  const a = Object.entries(attrs)
    .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
    .join(' ');
  return `<path ${a} d="${d}"/>`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
