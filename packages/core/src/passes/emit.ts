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
}

export function emit(input: EmitInput): string {
  const { scene, camera, entities, links, labels, oceans, theme, dataSource } = input;
  const [vx, vy, vw, vh] = camera.meta.viewBox;
  const out: string[] = [];
  // showOnly(격리) — 바다/그래티큘/이웃국/대양라벨/인접구역 배경을 모두 생략하고
  // 대상 국가의 행정구역만 빈 배경에 띄운다.
  const isolated = scene.showOnly != null;

  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" ` +
      `width="${vw}" height="${vh}" class="geoinsight" role="img">`,
  );

  if (!isolated) {
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
  }

  // 3.5 5대양 라벨 (엔티티/링크 아래, 격리 모드 제외)
  if (!isolated && oceans.length > 0) {
    out.push(
      `<g class="gi-oceans" font-family="${escapeAttr(theme.label.font)}" font-size="${theme.oceanLabel.size}" ` +
        `font-style="italic" text-anchor="middle" fill="${theme.oceanLabel.fill}" letter-spacing="${theme.oceanLabel.spacing}">`,
    );
    for (const o of oceans) {
      out.push(`<text x="${o.x}" y="${o.y}" class="gi-ocean-label">${escapeText(o.text)}</text>`);
    }
    out.push('</g>');
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
      }),
    );
  }

  // 5. links (타입별 path — wedge/stroke/wavy/arrowhead 모두 paths 로) + 투명 히트 영역
  for (const l of links) {
    const dl = `${l.from}>${l.to}`;
    for (const p of l.paths) {
      if (p.d) out.push(linkPath(p, dl));
    }
    if (l.hit) {
      out.push(
        `<path class="gi-link-hit" data-link="${escapeAttr(dl)}" d="${l.hit}" fill="none" ` +
          `stroke="#000" stroke-opacity="0" stroke-width="14" stroke-linecap="round" pointer-events="stroke"/>`,
      );
    }
  }

  // 6. labels (엔티티 + 링크). halo + fill.
  const linkLabels = links.filter((l) => l.label);
  if (labels.length > 0 || linkLabels.length > 0) {
    out.push(`<g class="gi-labels" font-family="${escapeAttr(theme.label.font)}" font-size="${theme.label.size}" text-anchor="middle">`);
    for (const lab of labels) {
      const common = `x="${lab.x}" y="${lab.y}" data-key="${escapeAttr(lab.entityKey)}"`;
      out.push(
        `<text ${common} class="gi-label-halo" fill="none" stroke="${theme.label.halo}" stroke-width="3" stroke-linejoin="round">${escapeText(lab.text)}</text>`,
      );
      out.push(`<text ${common} class="gi-label" fill="${theme.label.fill}">${escapeText(lab.text)}</text>`);
    }
    for (const l of links) {
      if (!l.label) continue;
      const common = `x="${l.label.x}" y="${l.label.y}"`;
      out.push(
        `<text ${common} class="gi-link-label-halo" fill="none" stroke="${theme.label.halo}" stroke-width="3" stroke-linejoin="round">${escapeText(l.label.text)}</text>`,
      );
      out.push(`<text ${common} class="gi-link-label" fill="${theme.label.fill}">${escapeText(l.label.text)}</text>`);
    }
    out.push('</g>');
  }

  out.push('</svg>');
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

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
