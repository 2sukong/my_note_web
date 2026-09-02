import { create } from 'zustand';

/**
 * PDF 오버레이 '텍스트' 도구의 드래그 미리보기 상태(2026-09, 요구사항: 텍스트 상자도
 * 드래그로 크기를 정해서 생성). store/pdfOverlayShapeDraftStore.ts(화살표/사각형)와
 * 완전히 같은 구조 — objectId 같은 대상 식별자가 필요 없다(Viewer는 한 번에 한 페이지만
 * 열려 있음). 좌표는 항상 PDF 페이지 로컬 px(PDF_PAGE_REFERENCE_SCALE 기준) — 화면
 * 표시 배율과 무관하다. 메인 캔버스의 store/textDrawDraftStore.ts와 같은 목적을 PDF
 * 오버레이 좌표계로 옮긴 것.
 */
export interface PdfOverlayTextDrawDraft {
  start: { x: number; y: number };
  current: { x: number; y: number };
}

interface PdfOverlayTextDrawDraftState {
  draft: PdfOverlayTextDrawDraft | null;
  setDraft: (draft: PdfOverlayTextDrawDraft) => void;
  updateCurrent: (current: { x: number; y: number }) => void;
  clearDraft: () => void;
}

export const usePdfOverlayTextDrawDraftStore = create<PdfOverlayTextDrawDraftState>((set) => ({
  draft: null,
  setDraft: (draft) => set({ draft }),
  updateCurrent: (current) => set((s) => (s.draft ? { draft: { ...s.draft, current } } : s)),
  clearDraft: () => set({ draft: null }),
}));
