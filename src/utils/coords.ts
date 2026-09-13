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

/**
 * 요구사항(내부 하이퍼링크, Phase 9): worldPoint 하나가 canvas-root 정중앙에 오도록
 * panX/panY를 계산한 새 viewport를 반환한다(zoom은 인자로 받은 값을 그대로 쓴다 —
 * 링크로 이동할 때는 확대/축소하지 않고 "지금 보던 배율 그대로 그 위치를 보여준다"는
 * 게 자연스럽다고 판단했다. store/linkNavigationStore.ts의 navigateTo가 쓴다).
 * registerCanvasContainer로 등록된 컨테이너가 아직 없으면(레이아웃 계산 전 등) 화면
 * 크기를 모르니 0,0을 중심으로 취급해 폴백한다 — 완전히 틀린 위치는 아니고, 다음
 * 렌더에서 사용자가 눈으로 보고 조정하면 되는 정도라 별도 재시도 로직을 두지 않았다.
 */
export function centerViewportOn(worldPoint: Point, zoom: number): Viewport {
  const rect = canvasContainerEl?.getBoundingClientRect();
  const centerX = rect ? rect.width / 2 : 0;
  const centerY = rect ? rect.height / 2 : 0;
  return {
    zoom,
    panX: centerX - worldPoint.x * zoom,
    panY: centerY - worldPoint.y * zoom,
  };
}

/**
 * 요구사항(2026-09-13, "뒤로 버튼 제거 + 이동 후 커서가 도착 아이콘 위에 있도록"):
 * worldPoint가 clientPoint(브라우저 창 기준 — 보통 방금 링크를 클릭한 순간의 마우스
 * 포인터 위치)가 가리키는 화면 자리에 오도록 panX/panY를 계산한다. centerViewportOn과
 * 원리는 완전히 같고("이 world 지점이 화면의 이 자리에 오게") 그 "화면의 이 자리"만
 * canvas-root 정중앙 대신 임의의 지점으로 일반화했다.
 *
 * 웹에서는 OS 마우스 커서 자체를 코드로 옮길 방법이 없다 — 그래서 반대로 "월드를
 * 커서 밑으로 가져오는" 방식으로 같은 결과(이동한 뒤에도 마우스가 방금 도착한 링크
 * 아이콘 바로 위에 남아있다)를 낸다. 도착 지점에도 같은 링크의 반대쪽 anchor가 마커로
 * 떠 있으므로(canvas/LinkMarkersLayer.tsx — 한 링크는 항상 양쪽 다 마커가 보인다),
 * 커서를 옮기지 않고도 곧바로 다시 클릭하면 원래 있던 곳으로 돌아간다 — 별도의
 * "뒤로가기" 버튼 없이도 같은 UX를 낸다.
 */
export function viewportShowingPointAtClient(worldPoint: Point, zoom: number, clientPoint: Point): Viewport {
  const rect = canvasContainerEl?.getBoundingClientRect();
  const localX = rect ? clientPoint.x - rect.left : clientPoint.x;
  const localY = rect ? clientPoint.y - rect.top : clientPoint.y;
  return {
    zoom,
    panX: localX - worldPoint.x * zoom,
    panY: localY - worldPoint.y * zoom,
  };
}
