export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 두 점(시작점, 끝점, world 좌표)으로부터 저장용 bounding box(x,y,width,height,
 * 항상 canonical: x<=x+width, y<=y+height)와 대각선 방향 플래그를 계산하는 순수 함수.
 *
 * ArrowObject/ShapeObject도 다른 모든 객체와 동일하게 canonical box를 쓰기 때문에
 * (types/object.ts의 ArrowObject 주석 참고 — useObjectDrag/useObjectResize/
 * SelectionOverlay를 그대로 재사용하기 위함), box 자체에는 "어느 쪽이 시작점이고
 * 어느 쪽이 끝점인지"가 남지 않는다. 그 정보만 이 두 boolean에 담는다:
 *  - flipY: 대각선이 NW-SE(false)인지 NE-SW(true)인지.
 *  - reverseDirection: 꼬리(시작점)/머리(끝점)의 순서가 "박스 좌상단 계열 -> 우하단
 *    계열"과 반대인지. Arrow의 화살촉 위치 계산에만 쓰이고 Line에는 영향 없다.
 */
export function computeDiagonal(
  start: Point,
  end: Point,
): { box: Box; flipY: boolean; reverseDirection: boolean } {
  const box: Box = {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };

  const dxNeg = end.x < start.x;
  const dyNeg = end.y < start.y;
  const flipY = dxNeg !== dyNeg;
  const reverseDirection = flipY ? !dxNeg : dxNeg;

  return { box, flipY, reverseDirection };
}

/**
 * computeDiagonal의 역연산. 저장된 box의 width/height와 flipY/reverseDirection으로부터
 * 렌더링에 쓸 두 점(p1=꼬리, p2=머리/화살촉)을 box 로컬 좌표(0..width, 0..height)로
 * 되돌린다. ShapeView.tsx가 <line>/화살촉 <polygon>을 그릴 때 이 함수만 사용한다 —
 * world 좌표로의 변환은 필요 없다(SVG가 이미 object 자신의 로컬 박스 안에서 그려지므로).
 */
export function localEndpoints(
  width: number,
  height: number,
  flipY: boolean,
  reverseDirection: boolean,
): { p1: Point; p2: Point } {
  const a: Point = flipY ? { x: width, y: 0 } : { x: 0, y: 0 };
  const b: Point = flipY ? { x: 0, y: height } : { x: width, y: height };
  return reverseDirection ? { p1: b, p2: a } : { p1: a, p2: b };
}

/**
 * 화살표 곡선용 2차 베지어 제어점. p1/p2(끝점)는 그대로 두고, curveOffset(p1->p2
 * 길이 대비 수직 방향 비율)만큼 중점에서 수직으로 밀어낸 점을 돌려준다.
 * curveOffset이 0이면 제어점이 중점과 같아서 결과적으로 직선(p1-p2)과 동일하다 —
 * 그래서 ShapeSvgContent가 curveOffset이 falsy일 때 기존 <line> 렌더링을 그대로
 * 유지해도(별도 분기) 시각적으로 차이가 없다.
 */
export function quadraticControlPoint(p1: Point, p2: Point, curveOffset: number): Point {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  return { x: mx + nx * curveOffset * len, y: my + ny * curveOffset * len };
}

/**
 * quadraticControlPoint로 만든 베지어 곡선이 실제로 지나가는 t=0.5 지점(=곡선이
 * 가장 많이 휘어 보이는, 사용자가 손으로 잡아 끄는 지점). 2차 베지어
 * B(0.5) = 0.25*p1 + 0.5*C + 0.25*p2 = 0.5*중점 + 0.5*C 이므로 제어점 자체가 아니라
 * 이 지점을 드래그 핸들 위치로 써야 "핸들이 곡선 위에 정확히 얹혀 있다"가 성립한다.
 */
export function curveMidpoint(p1: Point, p2: Point, curveOffset: number): Point {
  const c = quadraticControlPoint(p1, p2, curveOffset);
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  return { x: (mx + c.x) / 2, y: (my + c.y) / 2 };
}

/**
 * curveMidpoint의 역연산: "곡선이 이 점을 지나가게 하려면 curveOffset이 얼마여야
 * 하는가"를 구한다. 드래그 인터랙션(useArrowCurveDrag)이 매 pointermove마다 현재
 * 커서의 world 좌표(로컬로 변환된)를 이 함수에 넘겨서, 곡선이 커서를 그대로 따라
 * 오도록 한다. p1->p2 방향 성분은 버리고 수직 성분만 반영한다(끝점 고정 + 순수하게
 * 수직으로만 휘는 형태를 유지하기 위함 — 평행 성분까지 반영하면 끝점 근처가 아닌데도
 * 곡선이 옆으로 삐뚤어져 보일 수 있다).
 */
export function curveOffsetForMidpoint(p1: Point, p2: Point, dragPoint: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  const proj = (dragPoint.x - mx) * nx + (dragPoint.y - my) * ny;
  return (2 * proj) / len;
}
