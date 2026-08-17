import { create } from 'zustand';

export interface TextDrawDraft {
  start: { x: number; y: number }; // world 좌표, 고정됨(pointerdown 시점)
  current: { x: number; y: number }; // world 좌표, pointermove마다 갱신
}

interface TextDrawDraftState {
  draft: TextDrawDraft | null;
  setDraft: (draft: TextDrawDraft) => void;
  updateCurrent: (current: { x: number; y: number }) => void;
  clearDraft: () => void;
}

/**
 * 요구사항(텍스트 상자 생성 경로 통합, 2차): '텍스트' 도구가 화살표/사각형과 동일하게
 * 드래그로 상자를 만들게 되면서, drawDraftStore.ts(ShapeToolId 전용)와 완전히 같은
 * 원리의 스토어가 텍스트에도 필요해졌다. ShapeObject/ArrowObject는 strokeColor 등
 * 도형 전용 필드를 갖고 있어 기존 스토어를 그대로 확장하는 대신, 화살표/사각형 쪽의
 * 검증된 동작을 전혀 건드리지 않도록 별도로 분리했다(useDrawTextTool.ts가 사용).
 */
export const useTextDrawDraftStore = create<TextDrawDraftState>((set) => ({
  draft: null,
  setDraft: (draft) => set({ draft }),
  updateCurrent: (current) =>
    set((s) => (s.draft ? { draft: { ...s.draft, current } } : s)),
  clearDraft: () => set({ draft: null }),
}));
