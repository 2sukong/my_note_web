import { create } from 'zustand';

export interface ImageHighlightDraft {
  objectId: string;
  /** 이미지 로컬 px 좌표(그 이미지 box의 좌상단 기준) — 손떨림을 그대로 따라가는
   * 게 아니라, useImageHighlightTool.ts가 pointerdown/pointermove마다 시작점은
   * 고정한 채 현재 점만 갱신한다. 렌더링(ImageObjectView.tsx)이 항상 start→current
   * 직선 하나만 그리므로, 드래그 경로가 아무리 구불거려도 미리보기는 처음부터
   * 끝까지 직선이다(요구사항: 손떨림/곡선 무시하고 강제 직선화).
   */
  start: { x: number; y: number };
  current: { x: number; y: number };
}

interface ImageHighlightDraftState {
  draft: ImageHighlightDraft | null;
  setDraft: (draft: ImageHighlightDraft) => void;
  updateCurrent: (current: { x: number; y: number }) => void;
  clearDraft: () => void;
}

/**
 * 요구사항(이미지 전용 직선 형광펜): drawDraftStore.ts(화살표/사각형)와 완전히 같은
 * 원리 — 드래그 중에는 objectsStore를 건드리지 않고 이 store만 갱신하고,
 * ImageObjectView.tsx가 자기 자신의 objectId와 일치하는 draft만 구독해서
 * 실시간으로 그린다. pointerup에서 objectsStore.addImageHighlight로 한 번에 커밋된다.
 */
export const useImageHighlightDraftStore = create<ImageHighlightDraftState>((set) => ({
  draft: null,
  setDraft: (draft) => set({ draft }),
  updateCurrent: (current) => set((s) => (s.draft ? { draft: { ...s.draft, current } } : s)),
  clearDraft: () => set({ draft: null }),
}));
