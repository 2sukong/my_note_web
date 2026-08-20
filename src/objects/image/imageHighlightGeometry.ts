interface Pt {
  x: number;
  y: number;
}

function distPointToSegment(p: Pt, a: Pt, b: Pt): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * abx;
  const projY = a.y + t * aby;
  return Math.hypot(p.x - projX, p.y - projY);
}

function ccw(a: Pt, b: Pt, c: Pt): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: Pt, b: Pt, c: Pt): boolean {
  return (
    Math.min(a.x, b.x) <= c.x &&
    c.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= c.y &&
    c.y <= Math.max(a.y, b.y)
  );
}

function segmentsIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d1 = ccw(p3, p4, p1);
  const d2 = ccw(p3, p4, p2);
  const d3 = ccw(p1, p2, p3);
  const d4 = ccw(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (d1 === 0 && onSegment(p3, p4, p1)) return true;
  if (d2 === 0 && onSegment(p3, p4, p2)) return true;
  if (d3 === 0 && onSegment(p1, p2, p3)) return true;
  if (d4 === 0 && onSegment(p1, p2, p4)) return true;
  return false;
}

/** ImageHighlight.thicknessRatio가 없는(이번 요구사항 이전에 만들어진) 구버전
 * 데이터를 위한 기본값 — 그 시절 굵기 자동 계산식(min(width,height)*0.035)과 같다. */
const DEFAULT_THICKNESS_RATIO = 0.035;

/**
 * 요구사항(형광펜 굵기 조절): 사용자가 사이드바에서 고른 굵기(px, 그 시점의 이미지
 * 기준)를 "이미지의 짧은 변 대비 비율"로 바꿔 ImageHighlight.thicknessRatio에 저장할
 * 값을 계산한다. 절대 px가 아니라 비율로 저장해야 나중에 이미지를 리사이즈해도
 * (resolveHighlightStrokeWidth가) 그 비율만큼 굵기를 함께 늘리고 줄일 수 있다.
 */
export function thicknessRatioFor(pickedPx: number, objWidth: number, objHeight: number): number {
  return pickedPx / Math.max(1, Math.min(objWidth, objHeight));
}

/**
 * 요구사항(이미지 리사이즈 시 형광펜 굵기 스케일링): 저장된 thicknessRatio에 현재
 * width/height를 곱해 "지금 이 순간" 그려야 할 실제 px 굵기를 구한다 — 이미지를
 * 확대/축소하면 min(width,height)이 그 비율만큼 변하므로, 굵기도 자동으로 같은
 * 비율만큼 늘고 줄어든다(끝점 좌표를 0~1 비율로 저장해 위치를 유지하는 것과 완전히
 * 같은 원리). thicknessRatio가 없으면(구버전 데이터) DEFAULT_THICKNESS_RATIO로 대체한다.
 */
export function resolveHighlightStrokeWidth(
  thicknessRatio: number | undefined,
  objWidth: number,
  objHeight: number,
): number {
  const ratio = thicknessRatio ?? DEFAULT_THICKNESS_RATIO;
  return Math.max(2, ratio * Math.min(objWidth, objHeight));
}

/**
 * 요구사항(이미지 형광펜 지우개): 두 선분(a1-a2, b1-b2) 사이의 최단 거리. 서로
 * 교차하면 0 — 두 선분이 서로 멀리 떨어진 채로 교차할 수 있어서(예: X자 모양) 네
 * 끝점의 점-선분 거리만으로는 이 경우를 못 잡는다. 단위는 호출부가 넘긴 좌표계를
 * 그대로 따른다(useImageHighlightTool.ts는 이미지 로컬 px로 호출).
 */
export function segmentDistance(a1: Pt, a2: Pt, b1: Pt, b2: Pt): number {
  if (segmentsIntersect(a1, a2, b1, b2)) return 0;
  return Math.min(
    distPointToSegment(a1, b1, b2),
    distPointToSegment(a2, b1, b2),
    distPointToSegment(b1, a1, a2),
    distPointToSegment(b2, a1, a2),
  );
}

const HORIZONTAL_SNAP_DEG = 5; // 이 각도 이내면 수평으로 스냅한다.
const HORIZONTAL_SNAP_MIN_LENGTH = 8; // 이미지 로컬 px. 이보다 짧은 드래그는 각도가 노이즈에
// 민감해서(예: 대각선 1px만 움직여도 45도) 스냅 판정을 건너뛴다.

/**
 * 요구사항(형광펜 가이드): start->point 선분이 수평에 가까우면(HORIZONTAL_SNAP_DEG
 * 이내) point.y를 start.y로 맞춰 완전한 수평선으로 스냅한다 — 그 각도를 벗어나면
 * point를 그대로 돌려줘서 임의의 각도로 자유롭게 그릴 수 있다(모든 선을 강제로
 * 수평으로 만들지 않는다는 요구사항). useImageHighlightTool.ts가 pointermove마다
 * 호출해서 draft.current를 이 결과로 갱신하므로, 커밋 시점엔 이미 스냅된 좌표가
 * 그대로 저장된다.
 */
export function snapNearHorizontal(start: Pt, point: Pt): Pt {
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  if (Math.hypot(dx, dy) < HORIZONTAL_SNAP_MIN_LENGTH) return point;
  const angleDeg = Math.atan2(Math.abs(dy), Math.abs(dx)) * (180 / Math.PI);
  if (angleDeg > HORIZONTAL_SNAP_DEG) return point;
  return { x: point.x, y: start.y };
}
