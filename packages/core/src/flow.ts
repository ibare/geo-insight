/**
 * 흐름 프리미티브 중심선 보간 — 편집기와 methii 렌더(emit)가 공유한다.
 * 같은 제어점이 항상 같은 곡선이 되어 "스타일 강제" + 편집기=렌더 일치를 보장한다.
 */

export type FlowPt = [number, number];

/**
 * 카디널(Catmull-Rom, uniform) 스플라인 — 제어점들을 지나는 매끄러운 곡선으로 리샘플.
 * 좌표계 무관(위경도/화면 공통). 흐름선은 위경도 제어점을 보간한 뒤 투영하면
 * 지도 곡률까지 자연스럽게 반영된다. 제어점 < 3 이면 보간 없이 원본(직선) 반환.
 *
 * @param pts 제어점(흐름 오브젝트의 geometry.coordinates)
 * @param samplesPerSeg 제어점 구간당 분할 수(곡선 부드러움). non-scaling-stroke 라 화면 px 무관.
 */
export function cardinalSpline(pts: FlowPt[], samplesPerSeg = 16): FlowPt[] {
  const n = pts.length;
  if (n < 3 || samplesPerSeg < 2) return pts;
  const out: FlowPt[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2 >= n ? n - 1 : i + 2]!;
    for (let s = 0; s < samplesPerSeg; s++) {
      out.push(catmull(p0, p1, p2, p3, s / samplesPerSeg));
    }
  }
  out.push(pts[n - 1]!);
  return out;
}

function catmull(p0: FlowPt, p1: FlowPt, p2: FlowPt, p3: FlowPt, t: number): FlowPt {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number): number =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])];
}
