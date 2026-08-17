import { create } from 'zustand';
import type { AnnotationSelectionSegment, SelectionSegment } from '../objects/text/selectionCapture';

interface HighlightDragState {
  /** 형광펜 도구로 드래그하는 동안 실시간으로 갱신되는 "아직 확정되지 않은" 선택
   * 구간. 드래그 중이 아니면 빈 배열. objectsStore에는 손을 뗄 때만(기존 로직 그대로)
   * 반영되고, 그 전까지는 이 store만 갱신되어 HighlightDragPreview.tsx가 실시간으로
   * 그린다. */
  segments: SelectionSegment[];
  /** 요구사항(주석 자기 자신의 텍스트도 본문과 동일하게 실시간 미리보기): 드래그가
   * "본문 줄"이 아니라 Annotation 자기 자신의 텍스트 위에서 일어나고 있을 때 채워진다
   * (본문 segments와 동시에 값이 있을 수 없다 — 한 드래그는 둘 중 하나만 대상으로
   * 삼는다). null이면 대상이 없거나 드래그 중이 아님. */
  annotationSegment: AnnotationSelectionSegment | null;
  setSegments: (segments: SelectionSegment[]) => void;
  setAnnotationSegment: (segment: AnnotationSelectionSegment | null) => void;
  clear: () => void;
}

/**
 * 요구사항(형광펜 실시간 드래그): canvas/interaction/useTextSelectionTools.ts가
 * 드래그 중(selectionchange 이벤트마다) 이 store를 갱신하고,
 * canvas/HighlightDragPreview.tsx가 구독해서 실제 색을 실시간으로 칠한다 —
 * drawDraftStore.ts(도형)/textDrawDraftStore.ts(텍스트 상자)와 같은 원리로,
 * "드래그 중인 미확정 상태"를 별도 store로 분리해 objectsStore(단일 진실 원천)를
 * 매 마우스 이동마다 건드리지 않는다.
 */
export const useHighlightDragStore = create<HighlightDragState>((set) => ({
  segments: [],
  annotationSegment: null,
  setSegments: (segments) => set({ segments, annotationSegment: null }),
  setAnnotationSegment: (segment) => set({ annotationSegment: segment, segments: [] }),
  clear: () => set({ segments: [], annotationSegment: null }),
}));
