/**
 * Label layout 패스.
 *
 * centroid 를 투영해 화면 좌표로 배치한 뒤 간단한 displacement 로 충돌 회피
 * (겹치면 수직으로 밀어내고 프레임 안쪽으로 클램프). focus 라벨이 group 라벨보다
 * 우선순위가 높다 — 먼저 배치되어 자리를 지킨다.
 */

import type { Entity, Theme } from '../types.js';
import { round } from '../projection.js';
import type { Camera } from './camera.js';
import type { LabelSpec } from './build-scene.js';

export interface PlacedLabel {
  text: string;
  x: number;
  y: number;
  entityKey: string;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rolePriority(role: Entity['role']): number {
  // 낮을수록 먼저 배치(자리 우선). focus > plain > group.
  return role === 'focus' ? 0 : role === 'plain' ? 1 : 2;
}

function overlaps(a: Box, b: Box): boolean {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;
}

export function layoutLabels(
  camera: Camera,
  labels: LabelSpec[],
  entities: Map<string, Entity>,
  theme: Theme,
): PlacedLabel[] {
  const size = theme.label.size;
  const placed: PlacedLabel[] = [];
  const boxes: Box[] = [];
  const pad = 4;

  // 우선순위 정렬 (focus 먼저). 동순위는 입력 순서 유지(결정적).
  const ordered = labels
    .map((l, i) => ({ l, i, prio: rolePriority(entities.get(l.entityKey)?.role ?? 'plain') }))
    .sort((a, b) => a.prio - b.prio || a.i - b.i);

  for (const { l } of ordered) {
    const p = camera.project(l.at);
    if (!p) continue;
    const w = Math.max(8, l.text.length * size * 0.62);
    const h = size * 1.25;

    let x = clamp(p[0], pad + w / 2, camera.width - pad - w / 2);
    let y = clamp(p[1], pad + h / 2, camera.height - pad - h / 2);

    if (l.collide) {
      // 수직으로 한 칸씩 번갈아 밀며 최대 8회 시도.
      let attempt = 0;
      const step = h + 2;
      while (attempt < 8 && boxes.some((b) => overlaps(b, { x, y, w, h }))) {
        attempt++;
        const dir = attempt % 2 === 1 ? 1 : -1;
        const mag = Math.ceil(attempt / 2) * step;
        y = clamp(p[1] + dir * mag, pad + h / 2, camera.height - pad - h / 2);
      }
    }

    boxes.push({ x, y, w, h });
    placed.push({ text: l.text, x: round(x, 2), y: round(y, 2), entityKey: l.entityKey });
  }
  return placed;
}

function clamp(v: number, lo: number, hi: number): number {
  if (lo > hi) return (lo + hi) / 2;
  return Math.max(lo, Math.min(hi, v));
}
