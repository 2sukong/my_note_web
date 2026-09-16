import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { ArrowObject, ShapeObject } from '../../types/object';
import { MIN_VISUAL, ShapeSvgContent } from '../../objects/shapes/ShapeSvgContent';
import { useToolStore } from '../../store/toolStore';
import { usePdfViewerStore } from '../../store/pdfViewerStore';
import { usePdfOverlayStore } from '../../store/pdfOverlayStore';
import { usePdfOverlaySelectionStore } from '../../store/pdfOverlaySelectionStore';
import { PdfOverlayResizeHandles } from './PdfOverlayResizeHandles';
import { PDF_OVERLAY_ABSOLUTE_SIZE_CALIBRATION } from '../../objects/pdf/pdfRaster';

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
    // 버그 수정(2026-09-16, PDF Viewer Space+드래그 이동 도입): Space를 누른 채 페이지를
    // 옮기려는 제스처가 이 객체 위에서 시작됐다고 해서 그 객체가 선택/이동돼서는 안
    // 된다(usePdfViewerStore.isSpacePressed 참고 — 메인 캔버스 objects/ObjectView.tsx의
    // isSpacePressed 가드와 같은 목적).
    if (usePdfViewerStore.getState().isSpacePressed) return;
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

  // 버그 수정(2026-09-15): 화살표를 정확히 수평(height===0)/수직(width===0)으로
  // 그리면 wrapper div의 width/height %가 0이 되거나(부모가 0폭/높이), 그보다 먼저
  // <svg>의 viewBox 자체가 "0 0 W 0" 같은 값이 되어 SVG 스펙상 렌더링이 완전히
  // 꺼진다(viewBox의 폭/높이 성분이 0이면 그 <svg>는 아무것도 그리지 않음 —
  // ShapeSvgContent.tsx의 MIN_VISUAL 설명 참고). object.width/height 자체(저장된
  // 값)는 그대로 두고, 여기 렌더링에서만 최소값을 보정한다.
  const boxWidth = Math.max(object.width, MIN_VISUAL);
  const boxHeight = Math.max(object.height, MIN_VISUAL);

  return (
    <div
      className={'pdf-overlay-shape' + (isSelected ? ' is-selected' : '')}
      style={{
        position: 'absolute',
        left: `${(object.x / pageWidth) * 100}%`,
        top: `${(object.y / pageHeight) * 100}%`,
        width: `${(boxWidth / pageWidth) * 100}%`,
        height: `${(boxHeight / pageHeight) * 100}%`,
        zIndex: object.zIndex,
        pointerEvents: 'auto',
        cursor: activeTool === 'select' ? 'move' : 'default',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <svg width="100%" height="100%" viewBox={`0 0 ${boxWidth} ${boxHeight}`} style={{ overflow: 'visible', display: 'block' }}>
        <ShapeSvgContent
          type={object.type}
          width={object.width}
          height={object.height}
          strokeColor={object.strokeColor}
          // 요구사항(굵기 페이지-PDF 동등화, 2026-09-01): 이 <svg>는
          // viewBox="0 0 object.width object.height"(참조 px)를 실제 화면 표시
          // 크기(displayScale배)로 자동 스케일하므로, strokeWidth 같은 속성값도
          // 그 스케일을 그대로 따라간다 — 메인 캔버스(viewBox 없음, 1:1)와 같은
          // "굵기" 숫자를 넣어도 여기선 displayScale(기본 ~0.33)배만큼 얇게
          // 보였다. PdfOverlayTextView.tsx의 글자크기 보정과 동일한 계수를 곱해
          // 상쇄한다(브라우저가 다시 displayScale을 곱해 최종 픽셀 굵기가
          // strokeWidth * CALIBRATION이 되게 하는 것 — CALIBRATION만 곱하고
          // displayScale로 나누지 않는 이유: viewBox 자동 스케일이 이미 그 나눗셈
          // 역할을 대신 해준다).
          strokeWidth={object.strokeWidth * PDF_OVERLAY_ABSOLUTE_SIZE_CALIBRATION}
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
