import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { createPlainLine } from '../../objects/text/indentation/types';
import type { TextObject } from '../../types/object';
import { useToolStore } from '../../store/toolStore';
import { usePdfViewerStore } from '../../store/pdfViewerStore';
import { usePdfOverlayStore } from '../../store/pdfOverlayStore';
import { usePdfOverlaySelectionStore } from '../../store/pdfOverlaySelectionStore';
import { usePdfOverlayTextDrawDraftStore } from '../../store/pdfOverlayTextDrawDraftStore';
import { computeDiagonal } from '../../objects/shapes/shapeGeometry';

const MIN_TEXT_WIDTH = 60; // 페이지 로컬 px. canvas/actions.ts의 같은 이름 상수와 같은 값 —
const MIN_TEXT_HEIGHT = 32; // 너무 작게 드래그해도 최소한 타이핑 가능한 크기는 보장한다.
const MIN_DRAW_DISTANCE = 4; // 페이지 로컬 px. 이보다 짧은 드래그는 사실상 클릭으로 보고 무시한다.

/**
 * PDF 오버레이의 '텍스트' 도구.
 *
 * 업데이트(2026-09, 요구사항: 텍스트 상자 생성 시 드래그로 크기 조절 가능하게): 메인
 * 캔버스(canvas/interaction/useDrawTextTool.ts + canvas/actions.ts spawnTextFromDraft)와
 * 완전히 같은 방식으로 바꿨다 — 화살표/사각형처럼 드래그해서 시작점→끝점을 잇는 사각형
 * 크기로 텍스트 상자가 생긴다. 예전(v1 스코프 축소, 아래 원래 주석 참고)엔 "클릭 한 번 =
 * 고정 크기 즉시 생성"만 지원했는데, 그 축소 이유였던 "드래그 미리보기 인프라를 새로
 * 만드는 비용"은 이후 useDrawOverlayShapeTool.ts + PdfOverlayShapeDraftLayer.tsx로 다른
 * 도구용으로 이미 만들어져 있어서, 같은 구조(draft store만 텍스트 전용
 * pdfOverlayTextDrawDraftStore로 새로 분리 — 화살표/사각형 코드는 건드리지 않음)를
 * 텍스트에도 그대로 적용했다. 메인 캔버스와 동일하게, 드래그 거리가 MIN_DRAW_DISTANCE
 * 보다 짧으면(사실상 클릭) 아무것도 만들지 않는다 — 클릭만으로는 더 이상 텍스트 상자가
 * 생기지 않는다(메인 캔버스가 이미 그렇게 바뀐 것과 동일한 관례).
 *
 * (v1 스코프 축소 시절 주석, 참고용으로 남김) 원래는 "실시간 브라우저 테스트가 불가능한
 * 환경에서 드래그 미리보기 인프라를 새로 만드는 비용 대비 가치가 낮다"고 판단해 클릭
 * 한 번으로만 만들었다 — 위 이유로 이제는 그 인프라가 이미 있으므로 이 판단이 더 이상
 * 유효하지 않다.
 *
 * useOverlayHighlightTool.ts와 같은 좌표 환산(containerRef의 실제 화면 표시 크기 대비
 * pageWidth/pageHeight 비로 클라이언트 px → 페이지 로컬 px)을 쓴다. 빈 배경(컨테이너
 * 자신, `.pdf-viewer-page` div)에서 시작한 드래그만 반응한다 — 이미 있는 텍스트 상자나
 * 주석 위에서 시작한 드래그는 그 자식 엘리먼트가 target이 되므로 여기서 무시되고, 대신
 * PdfOverlayTextView.tsx 자신의 pointerdown/더블클릭 핸들러가 처리한다.
 */
export function useDrawOverlayTextTool(
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

    // 버그 수정(2026-09, 사각형/화살표를 그린 직후 바로 선택 해제되던 문제 — 자세한 경위는
    // usePdfOverlayShapeDraftStore 도입 당시 커밋 메모 참고)와 같은 이유로, "빈 배경
    // 클릭으로 선택 해제" 판정을 pointerdown 시점에 한다(click이 아니라).
    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      // 버그 수정(2026-09-16, PDF Viewer Space+드래그 이동 도입): useOverlayHighlightTool.ts와
      // 같은 이유 — usePdfViewerStore.isSpacePressed 참고.
      if (usePdfViewerStore.getState().isSpacePressed) return;
      if (e.target !== el) return;

      if (useToolStore.getState().activeTool === 'select') {
        usePdfOverlaySelectionStore.getState().select(null);
        return;
      }
      if (useToolStore.getState().activeTool !== 'text') return;

      const local = toLocal(e);
      activeRef.current = { pointerId: e.pointerId };
      usePdfOverlayTextDrawDraftStore.getState().setDraft({ start: local, current: local });
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
      const draft = usePdfOverlayTextDrawDraftStore.getState().draft;
      if (!draft) return;
      usePdfOverlayTextDrawDraftStore.getState().updateCurrent(toLocal(e));
    };

    const finishDraw = (e: PointerEvent) => {
      const active = activeRef.current;
      if (!active || active.pointerId !== e.pointerId) return;
      activeRef.current = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);

      const draft = usePdfOverlayTextDrawDraftStore.getState().draft;
      usePdfOverlayTextDrawDraftStore.getState().clearDraft();
      if (!draft) return;

      const distance = Math.hypot(draft.current.x - draft.start.x, draft.current.y - draft.start.y);
      if (distance < MIN_DRAW_DISTANCE) return;

      const { box } = computeDiagonal(draft.start, draft.current);
      const width = Math.max(MIN_TEXT_WIDTH, box.width);
      const height = Math.max(MIN_TEXT_HEIGHT, box.height);

      const { textColor, textFontFamily, textFontSize, textBold, textBorderEnabled, textLineHeight } =
        useToolStore.getState();
      const t = Date.now();
      const id = crypto.randomUUID();
      const obj: TextObject = {
        id,
        type: 'text',
        x: box.x,
        y: box.y,
        width,
        height,
        rotation: 0,
        zIndex: usePdfOverlayStore.getState().nextZIndex(),
        createdAt: t,
        updatedAt: t,
        lines: [createPlainLine('')],
        baseFontSize: textFontSize,
        color: textColor,
        fontFamily: textFontFamily,
        bold: textBold,
        borderEnabled: textBorderEnabled,
        lineHeight: textLineHeight,
        frameId: null,
        // 요구사항(2026-09, "드래그 생성 시 한 줄로 줄어들지 않고 드래그한 크기 유지"):
        // canvas/actions.ts의 spawnTextFromDraft와 같은 이유로 true를 세운다 — 이 도구는
        // 이제 항상 드래그로만 생성되므로(위 파일 설명 참고) 매번 true. PdfOverlayTextView.tsx의
        // 자동 높이 effect(TextObjectView.tsx와 동일한 isGenuinelyFreshObject 규칙)가 이
        // 값을 보고, 방금 드래그한 빈 상자를 첫 렌더에 한 줄 높이로 줄이지 않는다(넘치면
        // 자동으로 커지는 grow-only 규칙은 그대로 유지).
        manualHeight: true,
      };
      usePdfOverlayStore.getState().addObject(obj);
      usePdfOverlaySelectionStore.getState().startEditing(id);
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
