export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const RESIZE_HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export const MIN_SIZE = 20; // world 단위

/** 화면 기준 px, zoom과 무관하게 항상 이 크기로 보인다. SelectionOverlay.tsx의 일반
 * 리사이즈 핸들과 요구사항(이미지 자르기)의 크롭 핸들이 똑같은 크기/톤을 공유한다. */
export const HANDLE_SCREEN_SIZE = 8;

/** 핸들 하나의 부모 박스(width/height) 기준 상대 위치(left/top)와 커서 모양.
 * SelectionOverlay.tsx(일반 리사이즈)와 ImageObjectView.tsx(자르기)가 공유한다. */
export function handlePosition(
  handle: ResizeHandle,
  width: number,
  height: number,
  size: number,
): { left: number; top: number; cursor: string } {
  const half = size / 2;
  const table: Record<ResizeHandle, { left: number; top: number; cursor: string }> = {
    nw: { left: -half, top: -half, cursor: 'nwse-resize' },
    n: { left: width / 2 - half, top: -half, cursor: 'ns-resize' },
    ne: { left: width - half, top: -half, cursor: 'nesw-resize' },
    e: { left: width - half, top: height / 2 - half, cursor: 'ew-resize' },
    se: { left: width - half, top: height - half, cursor: 'nwse-resize' },
    s: { left: width / 2 - half, top: height - half, cursor: 'ns-resize' },
    sw: { left: -half, top: height - half, cursor: 'nesw-resize' },
    w: { left: -half, top: height / 2 - half, cursor: 'ew-resize' },
  };
  return table[handle];
}

/**
 * handle 방향과 world 단위 드래그 이동량(dx, dy)으로부터 새 바운딩 박스를 계산하는 순수 함수.
 * DOM에 의존하지 않으므로 단위 테스트가 가능하다.
 *
 * - east(e)를 포함하면 오른쪽으로 늘어나며 width만 변한다.
 * - west(w)를 포함하면 왼쪽 경계가 움직이므로 x와 width가 함께 변한다.
 * - north/south도 동일한 원리로 y/height에 적용된다.
 * - MIN_SIZE보다 작아지지 않도록 clamp한다.
 *
 * Phase 5: aspectRatio(width/height)를 넘기면 그 비율을 유지하도록 width/height를
 * 보정한 뒤, 그 보정된 크기로 x/y(고정된 반대쪽 모서리/변)를 다시 계산한다.
 * 변(edge) handle(n/s/e/w)은 그 변 자체가 유일하게 변하는 축이므로 그 값을 그대로 주축으로 쓴다.
 *
 * 버그 수정(이미지 확대/축소가 드래그 속도보다 빨라지는 문제): 모서리 handle(nw/ne/se/sw)은
 * 예전엔 dx/dy 중 절대값이 더 큰 쪽 축의 "원본 픽셀 변화량"을 그대로 두 축 모두에 적용했다
 * (예: 정사각형을 dx=100, dy=10으로 대각선 드래그하면 width/height가 둘 다 100만큼 커져서,
 * 실제로 10px밖에 움직이지 않은 세로축이 마우스보다 훨씬 빠르게 커지는 것처럼 보였다).
 * 지금은 대각선(anchor→반대쪽 모서리) 방향으로의 투영 거리만큼만 그 대각선 길이를 늘리고,
 * width/height를 같은 비율로 스케일한다 — 대각선 방향으로 정확히 드래그하면 1:1로 따라가고,
 * 축 하나로 치우쳐 드래그해도 그만큼만(코사인 성분만큼만) 커져서 손 속도를 넘어서지 않는다.
 */
export function computeResizedBox(
  start: Box,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  aspectRatio?: number,
): Box {
  const hasWest = handle.includes('w');
  const hasEast = handle.includes('e');
  const hasNorth = handle.includes('n');
  const hasSouth = handle.includes('s');

  let width = start.width;
  let height = start.height;

  if (hasEast) width = Math.max(MIN_SIZE, start.width + dx);
  if (hasWest) width = Math.max(MIN_SIZE, start.width - dx);
  if (hasSouth) height = Math.max(MIN_SIZE, start.height + dy);
  if (hasNorth) height = Math.max(MIN_SIZE, start.height - dy);

  if (aspectRatio && aspectRatio > 0) {
    const changesWidth = hasEast || hasWest;
    const changesHeight = hasNorth || hasSouth;

    if (changesWidth && changesHeight) {
      // 모서리 handle: dx/dy를 "이 handle이 실제로 늘어나는 방향" 부호로 정규화한 뒤
      // (start.width, start.height) 대각선 벡터에 투영해서, 그 대각선이 실제로 얼마나
      // 늘거나 줄었는지를 하나의 스칼라로 구한다.
      const signX = hasEast ? 1 : -1;
      const signY = hasSouth ? 1 : -1;
      const diagLength = Math.sqrt(start.width * start.width + start.height * start.height);
      const projected = (dx * signX * start.width + dy * signY * start.height) / diagLength;
      const scaleFloor = Math.max(MIN_SIZE / start.width, MIN_SIZE / start.height);
      const scale = Math.max(scaleFloor, (diagLength + projected) / diagLength);
      width = Math.max(MIN_SIZE, start.width * scale);
      height = Math.max(MIN_SIZE, start.height * scale);
    } else if (changesWidth) {
      height = Math.max(MIN_SIZE, width / aspectRatio);
    } else if (changesHeight) {
      width = Math.max(MIN_SIZE, height * aspectRatio);
    }
  }

  let x = start.x;
  let y = start.y;
  if (hasWest) x = start.x + (start.width - width);
  if (hasNorth) y = start.y + (start.height - height);

  return { x, y, width, height };
}
