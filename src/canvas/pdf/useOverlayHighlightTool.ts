import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useToolStore } from '../../store/toolStore';
import { usePdfOverlayStore } from '../../store/pdfOverlayStore';
import { usePdfOverlayHighlightDraftStore } from '../../store/pdfOverlayHighlightDraftStore';
import {
  resolveHighlightStrokeWidth,
  segmentDistance,
  snapNearHorizontal,
  thicknessRatioFor,
} from '../../objects/image/imageHighlightGeometry';

const MIN_DRAG_PX = 3; // 페이지 로컬 px 기준. 이보다 짧으면 실수로 찍은 클릭으로 보고 무시한다.

/**
 * PDF 페이지 배경 위의 "형광펜"(v3 §2-4) — canvas/interaction/useImageHighlightTool.ts와
 * 완전히 같은 뼈대(containerRef에 native pointer 리스너, draft store로 실시간 미리보기,
 * pointerup에 한 번만 커밋)를 따르되 두 가지만 다르다: (1) 대상을 [data-object-id]로
 * 찾을 필요가 없다 — Viewer는 항상 지금 열려 있는 페이지 하나뿐이므로 컨테이너에
 * pointerdown이 오면 곧 그 페이지 위다. (2) 좌표계가 world가 아니라 "PDF 페이지 로컬
 * px"다 — containerRef(래스터 이미지를 감싸는, aspect-ratio로 크기가 정해지는 div)의
 * 실제 화면 표시 크기 대비 pageWidth/pageHeight(항상 PDF_PAGE_REFERENCE_SCALE 기준) 비로
 * 환산한다(clientToWorld의 PDF 버전인 셈).
 */
export function useOverlayHighlightTool(
  containerRef: RefObject<HTMLDivElement | null>,
  pageWidth: number,
  pageHeight: number,
) {
  const activeRef = useRef<{ pointerId: number } | null>(null);

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
      if (useToolStore.getState().activeTool !== 'highlight') return;
      // 버그 수정(2026-08): 텍스트 오버레이 객체(.pdf-overlay-text, Phase 6 텍스트/주석)
      // 위에서 드래그를 시작했으면 이 훅은 완전히 손을 뗀다 — canvas/interaction/
      // useImageHighlightTool.ts가 findImageObjectId로 "이미지 객체 위인지" 가려서
      // 텍스트 객체는 건드리지 않는 것과 똑같은 이유다. 이 가드가 없으면 페이지
      // 배경용 직선 형광펜이 텍스트 위에서도 무조건 먼저 반응해서(pointerdown 시점에
      // pointer capture까지 잡아버려서) 브라우저 네이티브 텍스트 선택이 시작될 기회
      // 자체가 없었다 — 그래서 내가 쓴 텍스트를 드래그해도 글자 폭에 맞는 알약 모양이
      // 아니라 마치 PDF 이미지 위인 것처럼 직선 형광펜이 그어졌다. 텍스트 위의 형광펜은
      // useOverlayTextSelectionTools.ts(네이티브 선택 기반)가 전담한다.
      const target = e.target as HTMLElement;
      if (target.closest('.pdf-overlay-text')) return;
      const local = toLocal(e);
      activeRef.current = { pointerId: e.pointerId };
      usePdfOverlayHighlightDraftStore.getState().setDraft({ start: local, current: local });
      el.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: PointerEvent) => {
      const active = activeRef.current;
      if (!active || active.pointerId !== e.pointerId) return;
      // 버그 방지: 다른 인터랙션 훅들과 동일한 이유(놓친 pointerup 때문에 capture가
      // 남아있는 상태를 e.buttons===0으로 감지)로 정리한다.
      if (e.buttons === 0) {
        activeRef.current = null;
        usePdfOverlayHighlightDraftStore.getState().clearDraft();
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
        return;
      }
      const draft = usePdfOverlayHighlightDraftStore.getState().draft;
      if (!draft) return;
      const raw = toLocal(e);
      usePdfOverlayHighlightDraftStore.getState().updateCurrent(snapNearHorizontal(draft.start, raw));
    };

    const finishDraw = (e: PointerEvent) => {
      const active = activeRef.current;
      if (!active || active.pointerId !== e.pointerId) return;
      activeRef.current = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);

      const draft = usePdfOverlayHighlightDraftStore.getState().draft;
      usePdfOverlayHighlightDraftStore.getState().clearDraft();
      if (!draft) return;

      const length = Math.hypot(draft.current.x - draft.start.x, draft.current.y - draft.start.y);
      if (length < MIN_DRAG_PX) return;

      const { highlightEraserActive, highlightColor, highlightThickness } = useToolStore.getState();

      if (highlightEraserActive) {
        const toRemove = usePdfOverlayStore
          .getState()
          .pageHighlights.filter(
            (h) =>
              segmentDistance(
                draft.start,
                draft.current,
                { x: h.x1 * pageWidth, y: h.y1 * pageHeight },
                { x: h.x2 * pageWidth, y: h.y2 * pageHeight },
              ) <= resolveHighlightStrokeWidth(h.thicknessRatio, pageWidth, pageHeight),
          )
          .map((h) => h.id);
        if (toRemove.length > 0) usePdfOverlayStore.getState().removePageHighlights(toRemove);
        return;
      }

      usePdfOverlayStore
        .getState()
        .addPageHighlight(
          draft.start.x / pageWidth,
          draft.start.y / pageHeight,
          draft.current.x / pageWidth,
          draft.current.y / pageHeight,
          highlightColor,
          thicknessRatioFor(highlightThickness, pageWidth, pageHeight),
        );
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
