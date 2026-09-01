import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { usePdfOverlayStore } from '../../store/pdfOverlayStore';
import { usePdfOverlayHistoryStore } from '../../store/pdfOverlayHistoryStore';
import { computeResizedBox } from '../interaction/resizeMath';
import type { Box, ResizeHandle } from '../interaction/resizeMath';

interface ResizeRefState {
  pointerId: number;
  startScreen: { x: number; y: number };
  startBox: Box;
}

/**
 * canvas/interaction/useObjectResize.ts의 PDF 오버레이용 병렬 구현(v3 §2-7 B안과 같은
 * 이유 — objectsStore/historyStore/viewportStore 대신 usePdfOverlayStore/
 * usePdfOverlayHistoryStore를 쓴다는 점만 다르다). 두 가지는 의도적으로 뺐다:
 *
 * 1. 정렬 가이드(스마트 스냅): 메인 캔버스는 여러 world 객체가 뒤섞여 있어 정렬을
 *    맞추는 게 의미가 크지만, PDF 오버레이는 한 페이지 안의 소수 객체만 다루고
 *    "PDF 원본 레이아웃"이 이미 배경으로 깔려 있어 사용자가 정렬 기준을 스스로 보기
 *    쉽다 — 사용자 확정(2026-08-31)으로 이번 라운드는 스냅 없이 리사이즈 자체만 구현.
 * 2. useInteractionStore.setMode('resize') 상당의 모드 전환: 메인 캔버스는 이 모드로
 *    마퀴 선택/배경 클릭 등 다른 인터랙션을 억제하는데, PDF 오버레이 선택 상태
 *    (usePdfOverlaySelectionStore)는 애초에 마퀴/다중 선택 개념이 없는 훨씬 단순한
 *    상태 머신이라(그 store 상단 주석 참고) 별도 모드가 필요 없다.
 *
 * displayScale은 "화면에 실제로 그려지는 px 대 페이지 로컬 px" 비율
 * (PdfOverlayObjectsLayer.tsx가 계산)이다 — 메인 캔버스의 zoom과 정확히 같은 역할.
 */
export function usePdfOverlayObjectResize(
  objectId: string,
  box: Box,
  handle: ResizeHandle,
  displayScale: number,
  aspectRatio?: number,
  /** true면 이 리사이즈로 height가 실제로 바뀔 때 TextObject.manualHeight를 함께
   * true로 세팅한다(objectsStore.ts의 resizeObjectTo와 같은 규칙 — 자동 높이 조정
   * effect가 더 이상 이 상자를 건드리지 않게 하기 위함, PdfOverlayTextView.tsx 참고). */
  isText?: boolean,
) {
  const resizeRef = useRef<ResizeRefState | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    usePdfOverlayHistoryStore.getState().beginTransaction('resize');
    resizeRef.current = {
      pointerId: e.pointerId,
      startScreen: { x: e.clientX, y: e.clientY },
      startBox: box,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const state = resizeRef.current;
    if (!state || state.pointerId !== e.pointerId) return;

    // useObjectResize.ts와 같은 이유(pointerup을 놓쳐도 버튼이 이미 떼어졌으면 즉시 정리).
    if (e.buttons === 0) {
      usePdfOverlayHistoryStore.getState().endTransaction();
      resizeRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      return;
    }

    const dx = (e.clientX - state.startScreen.x) / displayScale;
    const dy = (e.clientY - state.startScreen.y) / displayScale;
    const nextBox = computeResizedBox(state.startBox, handle, dx, dy, aspectRatio);

    const patch: Record<string, unknown> = { x: nextBox.x, y: nextBox.y, width: nextBox.width, height: nextBox.height };
    if (isText && nextBox.height !== state.startBox.height) patch.manualHeight = true;
    usePdfOverlayStore.getState().updateObject(objectId, patch);
  };

  const endResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    const state = resizeRef.current;
    if (!state || state.pointerId !== e.pointerId) return;

    resizeRef.current = null;
    usePdfOverlayHistoryStore.getState().endTransaction();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: endResize,
    onPointerCancel: endResize,
  };
}
