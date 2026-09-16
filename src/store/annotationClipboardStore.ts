import { create } from 'zustand';
import type { TextHighlight } from '../objects/text/indentation/types';

/**
 * 요구사항(2026-09-15, 주석 하나만 복사/붙여넣기): 주석(Annotation)은 독립 CanvasObject가
 * 아니라 TextLine에 종속된 데이터라서(types/object.ts 참고), CanvasObject 전용인
 * store/clipboardStore.ts로는 다룰 수 없다 — 그래서 이 작은 별도 클립보드를 둔다.
 *
 * 담기는 건 주석의 "내용물"(텍스트/색/글꼴/크기/자기 자신의 형광펜)뿐이다 —
 * anchor(원본 objectId/lineId/start/end)는 원본 위치에만 의미 있는 값이라 절대 복사하지
 * 않는다. 붙여넣을 때마다 대상 위치(단어 클릭)에서 새로 정해진다
 * (canvas/interaction/useTextSelectionTools.ts의 'annotation' 도구 클릭 처리 참고).
 *
 * 객체 클립보드(clipboardStore)와 같은 이유로, 붙여넣은 뒤에도 내용을 지우지 않는다 —
 * 새로 Ctrl+C/X 하기 전까지 같은 내용을 여러 단어에 반복해서 붙여넣을 수 있다.
 */
export interface CopiedAnnotationPayload {
  text: string;
  color?: string;
  fontFamily?: string;
  fontSize?: number;
  highlights?: TextHighlight[];
}

interface AnnotationClipboardState {
  payload: CopiedAnnotationPayload | null;
  copy: (payload: CopiedAnnotationPayload) => void;
}

export const useAnnotationClipboardStore = create<AnnotationClipboardState>((set) => ({
  payload: null,
  copy: (payload) => set({ payload }),
}));
