import type { Point, Viewport } from '../types/viewport';
import { MAX_ZOOM, MIN_ZOOM } from '../types/viewport';

/**
 * screen(화면, clientX/clientY 기준) 좌표를 world 좌표로 변환한다.
 *
 * worldX = (screenX - panX) / zoom
 * worldY = (screenY - panY) / zoom
 */
export function screenToWorld(screenPoint: Point, viewport: Viewport): Point {
  return {
    x: (screenPoint.x - viewport.panX) / viewport.zoom,
    y: (screenPoint.y - viewport.panY) / viewport.zoom,
  };
}

/**
 * world 좌표를 screen 좌표로 변환한다.
 *
 * screenX = worldX * zoom + panX
 * screenY = worldY * zoom + panY
 *
 * 참고: 실제 렌더링은 CSS transform(translate + scale)이 브라우저에서 처리하므로
 * 이 함수는 주로 마우스 이벤트 좌표를 world로 되돌리거나, world 좌표를 화면 위
 * 오버레이(선택 박스 등)에 그릴 때 사용한다.
 */
export function worldToScreen(worldPoint: Point, viewport: Viewport): Point {
  return {
    x: worldPoint.x * viewport.zoom + viewport.panX,
    y: worldPoint.y * viewport.zoom + viewport.panY,
  };
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * screenPoint(보통 마우스/휠 위치) 아래의 world 좌표가 확대/축소 후에도
 * 같은 화면 위치에 남아있도록 panX/panY를 보정한 새 viewport를 반환한다.
 */
export function zoomAtPoint(
  viewport: Viewport,
  screenPoint: Point,
  nextZoom: number,
): Viewport {
  const clamped = clampZoom(nextZoom);
  const worldBefore = screenToWorld(screenPoint, viewport);

  return {
    zoom: clamped,
    panX: screenPoint.x - worldBefore.x * clamped,
    panY: screenPoint.y - worldBefore.y * clamped,
  };
}

/**
 * pan 이동량(deltaX/Y, screen px 단위)만큼 viewport를 이동한 새 viewport를 반환한다.
 */
export function panBy(viewport: Viewport, deltaX: number, deltaY: number): Viewport {
  return {
    ...viewport,
    panX: viewport.panX + deltaX,
    panY: viewport.panY + deltaY,
  };
}

let canvasContainerEl: HTMLElement | null = null;

/**
 * Canvas.tsx가 마운트 시 canvas-root 엘리먼트를 등록해둔다. screenToWorld가 쓰는
 * screen 좌표는 canvas-root 자신의 좌상단 기준인데, 포인터 이벤트의 clientX/clientY나
 * getClientRects()는 브라우저 창 전체 기준이다. canvas-root는 왼쪽에 파일트리
 * 사이드바(--file-tree-width)가 고정으로 붙어 화면 왼쪽 끝(x=0)에서 시작하지 않으므로,
 * 그 차이를 보정하지 않으면 새로 만든 객체나 마퀴 선택 영역이 항상 사이드바 폭만큼
 * 오른쪽으로 밀려서 생긴다(버그 리포트: "드래그한 곳이 아니라 더 오른쪽에 생성").
 */
export function registerCanvasContainer(el: HTMLElement | null): void {
  canvasContainerEl = el;
}

/**
 * clientX/clientY(브라우저 창 기준) 같은 "창 기준" 좌표를 world로 변환한다.
 * registerCanvasContainer로 등록된 canvas-root의 현재 위치를 빼서 컨테이너 기준
 * 좌표로 만든 뒤 screenToWorld에 넘긴다 — 포인터 이벤트를 다루는 곳에서는
 * screenToWorld를 직접 쓰지 말고 항상 이 함수를 써야 한다.
 */
export function clientToWorld(clientPoint: Point, viewport: Viewport): Point {
  const rect = canvasContainerEl?.getBoundingClientRect();
  const local = rect ? { x: clientPoint.x - rect.left, y: clientPoint.y - rect.top } : clientPoint;
  return screenToWorld(local, viewport);
}
