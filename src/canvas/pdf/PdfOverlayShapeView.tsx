import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { ArrowObject, ShapeObject } from '../../types/object';
import { ShapeSvgContent } from '../../objects/shapes/ShapeSvgContent';
import { useToolStore } from '../../store/toolStore';
import { usePdfOverlayStore } from '../../store/pdfOverlayStore';
import { usePdfOverlaySelectionStore } from '../../store/pdfOverlaySelectionStore';
import { PdfOverlayResizeHandles } from './PdfOverlayResizeHandles';

/**
 * PDF 페이지 오버레이 위 화살표/사각형 하나(Phase 6, 2026-08). objects/shapes/
 * ShapeView.tsx와 마찬가지로 ShapeSvgContent를 그대로 재사용해서 "그리는 중
 * 미리보기"(PdfOverlayShapeDraftLayer.tsx)와 확정된 모양이 항상 같게 한다 —
 * 순수 렌더링 함수라 world 좌표든 페이지 로컬 좌표든 상관없이 그대로 쓸 수 있다.
 *
 * 리사이즈(추가 Phase, 2026-09): 메인 캔버스의 SelectionOverlay.tsx와 동일한 8방향
 * 핸들을 선택 시 보여준다(PdfOverlayResizeHandles.tsx). 사용자 확정(2026-08-31)으로
 * 정렬 가이드/스냅은 이번 범위에서 제외했다 — usePdfOverlayObjectResize.ts 참고.
 *
 * v1 범위로 여전히 의도적으로 줄여둔 것(PdfOverlayTextView.tsx와 같은 기준): 화살표
 * 중간을 드래그해 곡선으로 만드는 기능 없음(항상 직선, 사용자 확정 2026-08-31).
 * 선택/삭제(Delete)/드래그 이동은 PdfOverlayTextView.tsx와 동일하게 지원한다.
 *
 * ShapeView.tsx와 같은 트레이드오프: 클릭/드래그 히트 영역이 실제 선(stroke)이
 * 아니라 bounding box 전체다.
 */
export function PdfOverlayShapeView({
  object,
  pageWidth,
  pageHeight,
  displayScale,
}: {
  object: ArrowObject | ShapeObject;
  pageWidth: number;
  pageHeight: number;
  displayScale: number;
}) {
  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  const selectedId = usePdfOverlaySelectionStore((s) => s.selectedId);
  const isSelected = selectedId === object.id;
  const activeTool = useToolStore((s) => s.activeTool);

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (activeTool !== 'select') return;
    usePdfOverlaySelectionStore.getState().select(object.id);
    dragRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: object.x,
      startY: object.y,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (e.buttons === 0) {
      dragRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      return;
    }
    const dxClient = e.clientX - drag.startClientX;
    const dyClient = e.clientY - drag.startClientY;
    if (!drag.moved && Math.hypot(dxClient, dyClient) < 2) return; // 지터 방지(실수로 살짝 움직인 클릭)
    drag.moved = true;
    usePdfOverlayStore
      .getState()
      .updateObject(
        object.id,
        { x: drag.startX + dxClient / displayScale, y: drag.startY + dyClient / displayScale },
        `move:${object.id}`,
      );
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div
      className={'pdf-overlay-shape' + (isSelected ? ' is-selected' : '')}
      style={{
        position: 'absolute',
        left: `${(object.x / pageWidth) * 100}%`,
        top: `${(object.y / pageHeight) * 100}%`,
        width: `${(object.width / pageWidth) * 100}%`,
        height: `${(object.height / pageHeight) * 100}%`,
        zIndex: object.zIndex,
        pointerEvents: 'auto',
        cursor: activeTool === 'select' ? 'move' : 'default',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <svg width="100%" height="100%" viewBox={`0 0 ${object.width} ${object.height}`} style={{ overflow: 'visible', display: 'block' }}>
        <ShapeSvgContent
          type={object.type}
          width={object.width}
          height={object.height}
          strokeColor={object.strokeColor}
          strokeWidth={object.strokeWidth}
          fill={object.type === 'rectangle' && object.fillEnabled ? object.strokeColor : 'none'}
          fillOpacity={object.type === 'rectangle' ? object.fillOpacity : undefined}
          rounded={object.type === 'rectangle' ? object.rounded : undefined}
          flipY={object.type === 'arrow' ? object.flipY : undefined}
          reverseArrow={object.type === 'arrow' ? object.reverseArrow : undefined}
          arrowHead={object.type === 'arrow' ? object.arrowHead : undefined}
          lineStyle={object.lineStyle}
        />
      </svg>
      {isSelected && activeTool === 'select' && (
        <PdfOverlayResizeHandles
          objectId={object.id}
          box={{ x: object.x, y: object.y, width: object.width, height: object.height }}
          displayScale={displayScale}
        />
      )}
    </div>
  );
}
