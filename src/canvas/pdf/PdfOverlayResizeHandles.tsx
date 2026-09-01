import { HANDLE_SCREEN_SIZE, RESIZE_HANDLES, handlePosition } from '../interaction/resizeMath';
import type { Box, ResizeHandle } from '../interaction/resizeMath';
import { usePdfOverlayObjectResize } from './usePdfOverlayObjectResize';

/**
 * canvas/SelectionOverlay.tsx의 ResizeHandleDot 8개를 PDF 오버레이용으로 옮긴 것 —
 * 다만 메인 캔버스처럼 별도의 전역 오버레이 컴포넌트로 두지 않고, 선택된 객체 자신의
 * wrapper(PdfOverlayTextView/ShapeView/ImageView, 전부 이미 position:absolute라
 * 자식의 위치 기준점이 된다) 안에 직접 끼워 넣는다 — v3 §2-7 B안의 "필요한 만큼만
 * 병렬 구현, 메인 쪽 SelectionOverlay 자체는 건드리지 않는다"는 방향과 같다.
 *
 * 메인 캔버스는 .canvas-world가 CSS transform: scale(zoom)이라 핸들 크기를 1/zoom으로
 * 나눠서 화면상 고정 크기를 유지해야 하지만, PDF Viewer는 그런 transform이 없고
 * 부모가 실제 CSS px 크기로 렌더링되므로(displayScale은 그저 좌표 환산 비율일 뿐)
 * 핸들을 HANDLE_SCREEN_SIZE 그대로(고정 8px) 그리면 이미 화면 기준 고정 크기다 —
 * 그만큼 이 컴포넌트가 메인 쪽보다 단순하다.
 */
export function PdfOverlayResizeHandles({
  objectId,
  box,
  displayScale,
  aspectRatio,
  isText,
}: {
  objectId: string;
  /** 페이지 로컬 px 기준(usePdfOverlayObjectResize에 그대로 전달돼 다음 드래그의 시작
   * 박스로 쓰인다). */
  box: Box;
  displayScale: number;
  aspectRatio?: number;
  isText?: boolean;
}) {
  // 핸들을 그릴 위치만 화면 px(box * displayScale)로 환산한다 — 드래그 계산 자체는
  // usePdfOverlayObjectResize 내부에서 페이지 로컬 px 기준으로 이뤄진다.
  const screenWidth = box.width * displayScale;
  const screenHeight = box.height * displayScale;

  return (
    <>
      {RESIZE_HANDLES.map((handle) => (
        <PdfOverlayResizeHandleDot
          key={handle}
          objectId={objectId}
          box={box}
          handle={handle}
          screenWidth={screenWidth}
          screenHeight={screenHeight}
          displayScale={displayScale}
          aspectRatio={aspectRatio}
          isText={isText}
        />
      ))}
    </>
  );
}

function PdfOverlayResizeHandleDot({
  objectId,
  box,
  handle,
  screenWidth,
  screenHeight,
  displayScale,
  aspectRatio,
  isText,
}: {
  objectId: string;
  box: Box;
  handle: ResizeHandle;
  screenWidth: number;
  screenHeight: number;
  displayScale: number;
  aspectRatio?: number;
  isText?: boolean;
}) {
  const drag = usePdfOverlayObjectResize(objectId, box, handle, displayScale, aspectRatio, isText);
  const pos = handlePosition(handle, screenWidth, screenHeight, HANDLE_SCREEN_SIZE);

  return (
    <div
      {...drag}
      className="pdf-overlay-resize-handle"
      data-handle={handle}
      // 부모(Text/Shape/Image의 wrapper)의 이동 드래그(onPointerDown 등)로 이벤트가
      // 새지 않도록 usePdfOverlayObjectResize의 onPointerDown이 이미 stopPropagation
      // 한다 — 다만 부모가 리스닝하는 onDoubleClick(텍스트 편집 진입) 등은 이 핸들이
      // 덮고 있는 한 애초에 부모까지 도달하지 않는다(핸들이 위에 그려지므로).
      style={{
        position: 'absolute',
        left: pos.left,
        top: pos.top,
        width: HANDLE_SCREEN_SIZE,
        height: HANDLE_SCREEN_SIZE,
        background: '#ffffff',
        border: '1.5px solid var(--color-accent)',
        borderRadius: 2,
        cursor: pos.cursor,
        pointerEvents: 'auto',
        touchAction: 'none',
        zIndex: 20, // 텍스트 줄/주석보다 항상 위에 그려져야 핸들을 잡을 수 있다.
      }}
    />
  );
}
