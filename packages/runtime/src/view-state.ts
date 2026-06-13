/**
 * 투영 독립 뷰 상태 — flat/globe 전환·리사이즈·편집에서 "보고 있는 곳"을 보존한다.
 *
 * 절대 픽셀 카메라(scale/translate/rotate)는 특정 투영·viewBox 좌표계에만 유효해,
 * 투영이 바뀌거나 viewBox 종횡비가 달라지면 무효가 된다(비틀린 지도·화면 밖 구체).
 * 대신 화면이 "어디를(중심 경위도) 얼마나 넓게(세로 가시 위도 범위)" 보는지를 투영과
 * 무관한 의미 단위로 저장하고, 렌더 시 현재 투영·viewBox 에 맞춰 카메라로 환산한다.
 *
 * 핵심 매핑: globe 의 위도 회전은 flat 의 "위도 회전(rotate[1])"이 아니라 flat 의
 * "세로 위치(중심 위도)"에 대응한다 — 이 차이를 무시한 게 비틀림의 원인이었다.
 */

import { cameraFromMeta, renderModel, type CompileResult, type SceneMeta, type SceneModel } from '@geoinsight/core';
import type { ViewBox } from './zoom-pan.js';

export interface ViewState {
  /** 화면 중심의 경도(°). */
  centerLon: number;
  /** 화면 중심의 위도(°). */
  centerLat: number;
  /** 화면 세로에 담기는 위도 범위(°) — 작을수록 확대. 투영 독립 줌 단위. */
  zoom: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 현재 렌더 결과 + viewBox → ViewState. viewBox 중앙·상단·하단을 역투영해 중심
 * 경위도와 세로 가시 위도 범위를 구한다. 중앙이 투영 밖이면 null(보존 불가 → 새 fit).
 */
export function captureViewState(meta: SceneMeta, view: ViewBox): ViewState | null {
  const cam = cameraFromMeta(meta);
  const cx = view[0] + view[2] / 2;
  const cy = view[1] + view[3] / 2;
  const center = cam.unproject([cx, cy]);
  if (!center) return null;

  const top = cam.unproject([cx, view[1]]);
  const bot = cam.unproject([cx, view[1] + view[3]]);
  // 세로 가시 위도 범위. 상/하단이 투영 밖(globe 가장자리 너머)이면 전체 viewBox 의
  // 위도 폭을 못 재므로, 중앙↔하단 절반을 두 배로 근사.
  let zoom: number;
  if (top && bot) {
    zoom = Math.abs(top[1] - bot[1]);
  } else if (bot) {
    zoom = Math.abs(center[1] - bot[1]) * 2;
  } else if (top) {
    zoom = Math.abs(top[1] - center[1]) * 2;
  } else {
    zoom = 140; // 양끝 모두 투영 밖 — 거의 전구. 합리적 기본.
  }
  if (!(zoom > 0)) zoom = 1e-3;
  return { centerLon: center[0], centerLat: center[1], zoom: Math.min(zoom, 180) };
}

/**
 * ViewState → 현재 모델의 렌더 결과 + 초기 viewBox. 투영에 맞춰 환산한다:
 *   - 경도: 두 투영 모두 rotate[0] = -centerLon
 *   - 위도: globe 는 rotate[1] = -centerLat(구체 회전), flat 은 viewBox 세로 위치
 *   - 줌:   세로 위도 범위를 viewBox 높이로 환산(project 로 픽셀 측정)
 * scale/translate 는 fit 결과를 재사용하고, 중심/줌은 rotate + viewBox 로만 표현한다.
 */
export function applyViewState(model: SceneModel, vs: ViewState): { result: CompileResult; view: ViewBox } {
  const W = model.width;
  const H = model.height;
  const isGlobe = model.built.config.projectionType === 'orthographic';

  // 1) 기본 fit — scale/translate(프레이밍 기준값)를 얻는다.
  const base = renderModel(model);
  const bp = base.meta.projectionParams;

  // 2) 중심 경위도를 카메라에 반영해 재투영.
  //    globe: 경도+위도 모두 회전. flat: 경도만 회전(위도는 아래 viewBox 로).
  const rotate: [number, number] = isGlobe
    ? [-vs.centerLon, -clamp(vs.centerLat, -90, 90)]
    : [-vs.centerLon, 0];
  const result = renderModel(model, {
    fixed: { rotate, scale: bp.scale, translate: [bp.translate[0], bp.translate[1]] },
  });

  // 3) 줌(세로 위도 범위)·중심을 viewBox 로 환산 — project 로 픽셀을 직접 측정.
  const cam = cameraFromMeta(result.meta);
  const pc = cam.project([vs.centerLon, vs.centerLat]);
  const half = vs.zoom / 2;
  const pTop = cam.project([vs.centerLon, clamp(vs.centerLat + half, -89.9, 89.9)]);
  const pBot = cam.project([vs.centerLon, clamp(vs.centerLat - half, -89.9, 89.9)]);

  let viewH = pTop && pBot ? Math.abs(pBot[1] - pTop[1]) : H;
  if (!(viewH > 0)) viewH = H;
  const viewW = viewH * (W / H);
  const cxp = pc ? pc[0] : W / 2;
  const cyp = pc ? pc[1] : H / 2;
  const view: ViewBox = [cxp - viewW / 2, cyp - viewH / 2, viewW, viewH];

  return { result, view };
}
