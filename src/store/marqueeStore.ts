import { create } from 'zustand';

export interface MarqueeDraft {
  start: { x: number; y: number }; // world 좌표, 고정됨(pointerdown 시점)
  current: { x: number; y: number }; // world 좌표, pointermove마다 갱신
}

interface MarqueeState {
  draft: MarqueeDraft | null;
  setDraft: (draft: MarqueeDraft) => void;
  updateCurrent: (current: { x: number; y: number }) => void;
  clearDraft: () => void;
}

/**
 * Phase 7: 드래그로 여러 객체를 선택하는 "마퀴(영역 선택)" 중인 사각형만 잠깐 들고 있는
 * store. drawDraftStore.ts(Phase 6 도형 그리기)와 완전히 같은 원리 — 실제 선택은
 * pointerup에서 한 번에 interactionStore.setSelection으로 확정되고, 그 전까지는
 * canvas/MarqueeOverlay.tsx가 이 draft를 구독해 사각형 미리보기만 그린다.
 */
export const useMarqueeStore = create<MarqueeState>((set) => ({
  draft: null,
  setDraft: (draft) => set({ draft }),
  updateCurrent: (current) => set((s) => (s.draft ? { draft: { ...s.draft, current } } : s)),
  clearDraft: () => set({ draft: null }),
}));
