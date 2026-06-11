/**
 * 5대양 라벨 패스 — 항상(가능한 한) 표시.
 *
 * 태평양/대서양/인도양/북극해/남극해를 대표 좌표에 고정하고 카메라로 투영한다.
 * 대표점이 프레임을 살짝 벗어났지만 그 대양이 화면에 걸쳐 있는 경우(EXPAND 이내)
 * 라벨을 프레임 안쪽으로 끌어오되, 끌어온 지점이 실제 바다일 때만 그린다(육지 오배치
 * 방지). orthographic 처럼 구를 클립하는 투영에서는 뒷면(중심 90° 밖)도 제외한다.
 * 좌표는 고정·반올림되므로 출력은 재현 가능하다.
 */

import { geoDistance } from 'd3-geo';
import { round } from '../projection.js';
import type { ProjectionType } from '../types.js';

export interface PlacedOcean {
  text: string;
  x: number;
  y: number;
}

/** 프레임 밖으로 이 비율(가로/세로) 이내면 대양이 화면에 걸친 것으로 보고 끌어온다. */
const EXPAND = 0.15;
/** 프레임 가장자리 여백(px) — 글자 높이를 감안해 잘림 방지. */
const INSET = 24;

/** 각 대양의 대표 좌표 [lon, lat] — 육지를 피한 열린 바다 지점. */
const OCEANS: Array<{ text: string; at: [number, number] }> = [
  { text: '북극해', at: [0, 78] },
  { text: '태평양', at: [-150, 5] },
  { text: '대서양', at: [-28, 5] },
  { text: '인도양', at: [78, -22] },
  { text: '남극해', at: [120, -66] },
];

export interface OceanContext {
  project(lonlat: [number, number]): [number, number] | null;
  unproject(xy: [number, number]): [number, number] | null;
  width: number;
  height: number;
  projType: ProjectionType;
  /** rotate 로부터 역산한 지리적 중심 경도. */
  centerLon: number;
  /** rotate 로부터 역산한 지리적 중심 위도(globe 틸트). 기본 0. */
  centerLat?: number;
  /** 해당 좌표가 바다인지(어느 국가에도 속하지 않음). */
  isWater(lonlat: [number, number]): boolean;
}

export function layoutOceans(ctx: OceanContext): PlacedOcean[] {
  const { project, unproject, width, height, projType, centerLon, isWater } = ctx;
  const centerLat = ctx.centerLat ?? 0;
  const out: PlacedOcean[] = [];
  const ex = width * EXPAND;
  const ey = height * EXPAND;

  for (const o of OCEANS) {
    if (projType === 'orthographic' && geoDistance(o.at, [centerLon, centerLat]) > Math.PI / 2 - 0.03) {
      continue;
    }
    const p = project(o.at);
    if (!p) continue;
    if (p[0] < -ex || p[0] > width + ex || p[1] < -ey || p[1] > height + ey) continue;

    const x = clamp(p[0], INSET, width - INSET);
    const y = clamp(p[1], INSET, height - INSET);
    const moved = x !== p[0] || y !== p[1];
    if (moved) {
      const ll = unproject([x, y]);
      if (!ll || !isWater(ll)) continue;
    }
    out.push({ text: o.text, x: round(x, 2), y: round(y, 2) });
  }
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
