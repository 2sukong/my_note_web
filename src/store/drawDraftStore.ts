import { create } from 'zustand';
import type { ShapeToolId } from '../canvas/actions';

export interface DrawDraft {
  tool: ShapeToolId;
  start: { x: number; y: number }; // world 좌표, 고정됨(pointerdown 시점)
  current: { x: number; y: number }; // world 좌표, pointermove마다 갱신
}

interface DrawDraftState {
  draft: DrawDraft | null;
  setDraft: (draft: DrawDraft) => void;
  updateCurrent: (current: { x: number; y: number }) => void;
  clearDraft: () => void;
}

/**
 * Phase 6: 화살표/사각형을 드래그로 "그리는 중"인 상태만 잠깐 들고 있는 store.
 * objectsStore에는 pointerup(드래그 확정) 시점에만 실제 객체가 추가된다 — 그 전까지는
 * 이 draft만 갱신되고, canvas/DrawPreview.tsx가 이 draft를 구독해서 미리보기를 그린다.
 * imagePickerStore와 같은 원리(수명이 짧은 인터랙션 상태를 별도 store로 분리)를 따른다.
 */
export const useDrawDraftStore = create<DrawDraftState>((set) => ({
  draft: null,
  setDraft: (draft) => set({ draft }),
  updateCurrent: (current) =>
    set((s) => (s.draft ? { draft: { ...s.draft, current } } : s)),
  clearDraft: () => set({ draft: null }),
}));
