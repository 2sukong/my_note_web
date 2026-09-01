import { create } from 'zustand';

/**
 * PDF 오버레이 객체(텍스트 등)의 선택/편집 상태 — 순전히 화면 전용 UI 상태라 undo
 * 대상이 아니고(historyStore/pdfOverlayHistoryStore와 무관), 메인 앱의
 * interactionStore와도 완전히 분리된 별도 store다(v3 §2-7 B안과 같은 이유 — 병렬
 * 구현이라 메인 쪽 selectedIds/mode 상태 머신을 전혀 건드리지 않는다). PDF 오버레이는
 * "한 번에 한 페이지"만 보여주므로 다중 선택/그룹 같은 개념이 필요 없어 메인
 * interactionStore보다 훨씬 단순하다.
 *
 * PdfViewerPanel.tsx가 페이지를 넘기거나 Viewer를 닫을 때 clear()를 호출해 초기화한다
 * (usePdfOverlayStore.loadForPage/closeOverlay와 같은 타이밍).
 */
interface PdfOverlaySelectionState {
  /** 지금 선택된(테두리가 보이는) 오버레이 객체 id. */
  selectedId: string | null;
  /** 지금 실제로 타이핑 가능한(contentEditable) 상태인 TextObject id — selectedId의
   * 부분집합이다(편집 중이면 항상 선택된 상태이기도 하다). */
  editingId: string | null;
  /** 새로 만든 Annotation에 바로 포커스를 주기 위한 1회성 신호. PdfOverlayTextView가
   * 렌더링 후 이 값을 보고 해당 annotation의 입력창에 focus를 준 뒤 스스로 지운다
   * (한 번 소비되면 다시 안 쓰이는 "커맨드"에 가까운 필드). */
  focusAnnotationId: string | null;

  select: (id: string | null) => void;
  startEditing: (id: string) => void;
  stopEditing: () => void;
  requestAnnotationFocus: (annotationId: string) => void;
  clearAnnotationFocus: () => void;
  clear: () => void;
}

export const usePdfOverlaySelectionStore = create<PdfOverlaySelectionState>((set) => ({
  selectedId: null,
  editingId: null,
  focusAnnotationId: null,

  select: (id) => set({ selectedId: id, editingId: null }),
  startEditing: (id) => set({ selectedId: id, editingId: id }),
  stopEditing: () => set({ editingId: null }),
  requestAnnotationFocus: (annotationId) => set({ focusAnnotationId: annotationId }),
  clearAnnotationFocus: () => set({ focusAnnotationId: null }),
  clear: () => set({ selectedId: null, editingId: null, focusAnnotationId: null }),
}));
