import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { SHAPE_TOOL_IDS, useToolStore } from '../../store/toolStore';
import type { ShapeToolId } from '../actions';
import { usePdfOverlayStore } from '../../store/pdfOverlayStore';
import { usePdfOverlaySelectionStore } from '../../store/pdfOverlaySelectionStore';
import { usePdfOverlayShapeDraftStore } from '../../store/pdfOverlayShapeDraftStore';
import { computeDiagonal } from '../../objects/shapes/shapeGeometry';
import { strokeColorValueFor } from '../../objects/shapes/strokeColors';
import type { ArrowObject, ShapeObject } from '../../types/object';

const MIN_DRAW_DISTANCE = 4; // 페이지 로컬 px 기준. 이보다 짧은 드래그는 사실상 클릭으로 보고 무시한다.

/**
 * PDF 오버레이의 화살표/사각형 도구(Phase 6, 2026-08). canvas/interaction/
 * useDrawShapeTool.ts와 같은 "드래그로 시작점→끝점을 잇는 도형을 그린다" 뼈대를
 * 따르되, v1 스코프 축소로 정렬 가이드(스냅)는 옮기지 않았다 — PDF 페이지는 한 번에
 * 한 페이지만 보이고 다른 비교 대상 객체가 몇 개 없어 스냅의 효용이 낮고, 그
 * 인프라(smartGuides.ts/alignmentGuideStore) 전체를 페이지-로컬 좌표계로 다시
 * 포크하는 비용이 크다고 판단했다(리사이즈 핸들을 v1에서 생략하기로 한 것과 같은
 * 판단 기준). 좌표 환산은 useOverlayHighlightTool.ts와 동일(컨테이너의 실제 화면
 * 표시 크기 대비 pageWidth/pageHeight 비).
 *
 * Frame이 없는 PDF 오버레이 특성상(types/pdf.ts의 OverlayObject 유니온에 FrameObject가
 * 아예 없음) findFrameAt 같은 소속 판정이 필요 없다 — frameId는 항상 null.
 *
 * 메인 캔버스의 useDrawShapeTool.ts는 Text 상자 위에서도 그릴 수 있게 허용하지만
 * (data-shape-drawable 검사), 여기는 그런 검사 자체가 없다 — 'select' 도구가 아닐 때는
 * PdfOverlayTextView.tsx/PdfOverlayShapeView.tsx 자신의 pointerdown 핸들러가 이미
 * 아무 것도 하지 않고 그대로 넘겨주므로(각 컴포넌트의 `activeTool !== 'select'`
 * 가드), 텍스트/다른 도형 위에서 시작한 드래그도 이 훅까지 그대로 버블링돼 자연스럽게
 * 같은 방식으로 동작한다.
 */
export function useDrawOverlayShapeTool(
  containerRef: RefObject<HTMLDivElement | null>,
  pageWidth: number,
  pageHeight: number,
) {
  const activeRef = useRef<{ pointerId: number; tool: ShapeToolId } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || pageWidth <= 0 || pageHeight <= 0) return;

    const toLocal = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * pageWidth,
        y: ((e.clientY - rect.top) / rect.height) * pageHeight,
      };
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const tool = useToolStore.getState().activeTool;
      if (!SHAPE_TOOL_IDS.includes(tool)) return;

      const local = toLocal(e);
      activeRef.current = { pointerId: e.pointerId, tool: tool as ShapeToolId };
      usePdfOverlayShapeDraftStore.getState().setDraft({ tool: tool as ShapeToolId, start: local, current: local });
      el.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: PointerEvent) => {
      const active = activeRef.current;
      if (!active || active.pointerId !== e.pointerId) return;
      // 버그 방지: 다른 PDF 오버레이 인터랙션 훅들과 동일한 이유(놓친 pointerup 때문에
      // capture가 남아있는 상태를 e.buttons===0으로 감지)로 정리한다.
      if (e.buttons === 0) {
        finishDraw(e);
        return;
      }
      const draft = usePdfOverlayShapeDraftStore.getState().draft;
      if (!draft) return;
      usePdfOverlayShapeDraftStore.getState().updateCurrent(toLocal(e));
    };

    const finishDraw = (e: PointerEvent) => {
      const active = activeRef.current;
      if (!active || active.pointerId !== e.pointerId) return;
      activeRef.current = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);

      const draft = usePdfOverlayShapeDraftStore.getState().draft;
      usePdfOverlayShapeDraftStore.getState().clearDraft();
      if (!draft) return;

      const distance = Math.hypot(draft.current.x - draft.start.x, draft.current.y - draft.start.y);
      if (distance < MIN_DRAW_DISTANCE) return;

      const { box, flipY, reverseDirection } = computeDiagonal(draft.start, draft.current);
      const t = Date.now();
      const id = crypto.randomUUID();
      const { shapeStrokeColor, shapeStrokeWidth, shapeArrowHead, shapeLineStyle, shapeRounded, shapeFillEnabled, shapeFillOpacity } =
        useToolStore.getState();
      const strokeColor = strokeColorValueFor(shapeStrokeColor);

      const obj: ArrowObject | ShapeObject =
        draft.tool === 'arrow'
          ? {
              id,
              type: 'arrow',
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
              rotation: 0,
              zIndex: usePdfOverlayStore.getState().nextZIndex(),
              createdAt: t,
              updatedAt: t,
              strokeColor,
              strokeWidth: shapeStrokeWidth,
              flipY,
              reverseArrow: reverseDirection,
              frameId: null,
              arrowHead: shapeArrowHead,
              lineStyle: shapeLineStyle,
            }
          : {
              id,
              type: 'rectangle',
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
              rotation: 0,
              zIndex: usePdfOverlayStore.getState().nextZIndex(),
              createdAt: t,
              updatedAt: t,
              strokeColor,
              strokeWidth: shapeStrokeWidth,
              frameId: null,
              rounded: shapeRounded,
              fillEnabled: shapeFillEnabled,
              fillOpacity: shapeFillOpacity,
              lineStyle: shapeLineStyle,
            };

      usePdfOverlayStore.getState().addObject(obj);
      usePdfOverlaySelectionStore.getState().select(id);
      useToolStore.getState().setTool('select');
    };

    el.addEventListener('pointerdown', handlePointerDown);
    el.addEventListener('pointermove', handlePointerMove);
    el.addEventListener('pointerup', finishDraw);
    el.addEventListener('pointercancel', finishDraw);

    return () => {
      el.removeEventListener('pointerdown', handlePointerDown);
      el.removeEventListener('pointermove', handlePointerMove);
      el.removeEventListener('pointerup', finishDraw);
      el.removeEventListener('pointercancel', finishDraw);
    };
  }, [containerRef, pageWidth, pageHeight]);
}
