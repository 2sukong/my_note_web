/**
 * Viewport: 화면(screen)과 월드(world) 좌표계를 잇는 변환 파라미터.
 * zoom/pan이 바뀌어도 객체의 world 좌표(x, y, width, height)는 절대 변경되지 않는다.
 */
export interface Viewport {
  zoom: number; // 1.0 = 100%
  panX: number; // world origin(0,0)이 화면의 어느 지점에 위치하는지 (px)
  panY: number;
}

export interface Point {
  x: number;
  y: number;
}

export const DEFAULT_VIEWPORT: Viewport = {
  zoom: 1,
  panX: 0,
  panY: 0,
};

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
