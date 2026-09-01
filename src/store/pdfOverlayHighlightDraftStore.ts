import { create } from 'zustand';

/** store/imageHighlightDraftStore.ts와 완전히 같은 구조 — PDF 페이지 오버레이는
 * 한 번에 한 페이지만 열려 있으므로(Viewer가 하나) objectId 같은 대상 식별자가
 * 필요 없다는 점만 다르다. */
export interface PdfOverlayHighlightDraft {
  /** PDF 페이지 로컬 px(PDF_PAGE_REFERENCE_SCALE 기준) — 화면 표시 배율과 무관. */
  start: { x: number; y: number };
  current: { x: number; y: number };
}

interface PdfOverlayHighlightDraftState {
  draft: PdfOverlayHighlightDraft | null;
  setDraft: (draft: PdfOverlayHighlightDraft) => void;
  updateCurrent: (current: { x: number; y: number }) => void;
  clearDraft: () => void;
}

export const usePdfOverlayHighlightDraftStore = create<PdfOverlayHighlightDraftState>((set) => ({
  draft: null,
  setDraft: (draft) => set({ draft }),
  updateCurrent: (current) => set((s) => (s.draft ? { draft: { ...s.draft, current } } : s)),
  clearDraft: () => set({ draft: null }),
}));
