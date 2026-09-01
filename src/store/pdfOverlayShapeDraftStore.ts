import { create } from 'zustand';
import type { ShapeToolId } from '../canvas/actions';

/** store/drawDraftStore.ts(메인 캔버스)와 완전히 같은 구조 —
 * store/pdfOverlayHighlightDraftStore.ts와 마찬가지로 objectId 같은 대상 식별자가
 * 필요 없다(Viewer는 한 번에 한 페이지만 열려 있음). 좌표는 항상 PDF 페이지 로컬
 * px(PDF_PAGE_REFERENCE_SCALE 기준) — 화면 표시 배율과 무관하다.
 */
export interface PdfOverlayShapeDraft {
  tool: ShapeToolId;
  start: { x: number; y: number };
  current: { x: number; y: number };
}

interface PdfOverlayShapeDraftState {
  draft: PdfOverlayShapeDraft | null;
  setDraft: (draft: PdfOverlayShapeDraft) => void;
  updateCurrent: (current: { x: number; y: number }) => void;
  clearDraft: () => void;
}

export const usePdfOverlayShapeDraftStore = create<PdfOverlayShapeDraftState>((set) => ({
  draft: null,
  setDraft: (draft) => set({ draft }),
  updateCurrent: (current) => set((s) => (s.draft ? { draft: { ...s.draft, current } } : s)),
  clearDraft: () => set({ draft: null }),
}));
