import { create } from 'zustand';

/**
 * 요구사항(2026-09-15, PDF 라이브러리 항목 드래그 순서 변경): PdfLibraryRail
 * 플라이아웃의 PDF 목록에도 File/Page 트리(canvas/sidebar/fileTreeDragStore.ts)와
 * 똑같은 "자리를 비켜주는" 드래그 정렬 모션(DropGapLine이 실제 레이아웃 공간을
 * 차지해 다른 항목이 진짜로 밀려나는 방식)을 쓴다. 다만 여기는 같은 Page에 속한
 * PDF들의 평평한 목록 하나뿐이라(폴더 중첩·다른 목록으로의 재배치 같은 개념이
 * 없음) fileTreeDragStore의 kind 분기(file-order/into-file 등)가 전혀 필요 없어
 * 훨씬 단순한 전용 store로 따로 둔다.
 */
interface PdfLibraryDragState {
  draggingId: string | null;
  /** 지금 이대로 놓으면 어디로 가는지 — 특정 id면 "그 항목 바로 앞", null이면
   * "목록의 맨 끝". 드래그 시작 직후 아직 dragover가 한 번도 안 일어난 상태와
   * 구분하기 위해 undefined를 별도로 둔다(그 상태에선 어떤 DropGapLine도 그리지
   * 않는다). */
  dropBeforeId: string | null | undefined;
  startDrag: (id: string) => void;
  setDropTarget: (beforeId: string | null) => void;
  endDrag: () => void;
}

export const usePdfLibraryDragStore = create<PdfLibraryDragState>((set) => ({
  draggingId: null,
  dropBeforeId: undefined,
  startDrag: (id) => set({ draggingId: id, dropBeforeId: undefined }),
  setDropTarget: (beforeId) => set({ dropBeforeId: beforeId }),
  endDrag: () => set({ draggingId: null, dropBeforeId: undefined }),
}));
