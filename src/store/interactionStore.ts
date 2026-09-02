import { create } from 'zustand';
import { usePdfOverlaySelectionStore } from './pdfOverlaySelectionStore';

export type InteractionMode = 'idle' | 'select' | 'drag' | 'resize' | 'pan' | 'text-edit';

/**
 * Phase 4(2차): Highlight/Annotation은 더 이상 독립 CanvasObject가 아니라
 * TextLine에 종속된 데이터라서 objectsStore의 objects record에 id가 없다.
 * 그래도 "지금 이 하이라이트/주석 하나가 선택되어 있다"는 상태는 필요하다
 * (Backspace로 그것만 지우기, 시각적 표시 등) — 그래서 selectedIds(객체 선택)와는
 * 별개로 fineSelection이라는 필드를 둔다. 항상 둘 중 하나만 유효하다
 * (하나가 채워지면 다른 하나는 비운다).
 */
export type FineSelection =
  | { kind: 'highlight'; objectId: string; lineId: string; id: string }
  | { kind: 'annotation'; objectId: string; lineId: string; id: string };

interface InteractionState {
  mode: InteractionMode;
  /**
   * Phase 7: 단일 selectedId에서 배열로 확장했다. 순서는 "선택된 순서"이며 특별한
   * 의미를 갖는 곳은 없다(렌더링/삭제/복사 모두 순서 무관). 리사이즈 핸들과
   * 더블클릭 편집 진입처럼 "정확히 하나만 선택됐을 때"만 의미 있는 동작은
   * 호출부에서 selectedIds.length === 1로 직접 확인한다.
   */
  selectedIds: string[];
  fineSelection: FineSelection | null;

  setMode: (mode: InteractionMode) => void;
  /** 선택을 이 id 하나로 완전히 교체한다(id가 null이면 선택 해제). 기존 select(id) API 유지. */
  select: (id: string | null) => void;
  /** 선택을 이 배열로 완전히 교체한다(마퀴 드래그 종료, 붙여넣기 직후 등). */
  setSelection: (ids: string[]) => void;
  /** Shift+클릭: 이미 선택돼 있으면 선택에서 빼고, 아니면 선택에 더한다. */
  toggleSelect: (id: string) => void;
  deselect: () => void;
  selectFine: (selection: FineSelection) => void;
}

/**
 * 요구사항(2026-09, "PDF 객체가 선택된 상태에서 PDF 밖의 다른 객체를 클릭하면 PDF 쪽
 * 선택도 풀리게"): pdfOverlaySelectionStore(PDF 오버레이 텍스트/도형/이미지 선택)는
 * 원래 이 store와 완전히 분리된 병렬 구현이다(그 파일 설명 참고) — 그래서 메인 캔버스
 * 쪽 선택이 바뀌어도 스스로 알 방법이 없다. 방치하면 Canvas.tsx가
 * pdfOverlaySelectedId 유무만으로 속성 패널을 고르기 때문에(PdfOverlayPropertiesPanel
 * vs PropertiesPanel), 메인 캔버스에서 새로 객체를 선택하거나 빈 배경을 클릭해도
 * 여전히 PDF 쪽 속성 패널이 남아있는 버그가 생긴다. 아래 5개 mutator(메인 캔버스의
 * 선택 상태를 바꾸는 진입점 전부 — select/setSelection/toggleSelect/deselect/
 * selectFine, useMarqueeSelect.ts/objects/text/TextObjectView.tsx/canvas/actions.ts가
 * 전부 이 store를 통해서만 선택을 바꾼다)가 실제로 호출될 때마다 PDF 쪽 선택이 남아
 * 있으면 함께 지운다. PDF 오버레이 자신의 클릭 핸들러들은 이 store를 전혀 건드리지
 * 않으므로(usePdfOverlaySelectionStore만 직접 쓴다), PDF 안에서의 선택/편집 중에는
 * 이 정리가 절대 끼어들지 않는다.
 */
function clearPdfOverlaySelectionIfAny() {
  const pdfSelection = usePdfOverlaySelectionStore.getState();
  if (pdfSelection.selectedId !== null) pdfSelection.clear();
}

export const useInteractionStore = create<InteractionState>((set, get) => ({
  mode: 'idle',
  selectedIds: [],
  fineSelection: null,

  setMode: (mode) => set({ mode }),

  select: (id) => {
    clearPdfOverlaySelectionIfAny();
    set({ selectedIds: id ? [id] : [], fineSelection: null, mode: id ? 'select' : 'idle' });
  },

  setSelection: (ids) => {
    clearPdfOverlaySelectionIfAny();
    set({ selectedIds: ids, fineSelection: null, mode: ids.length > 0 ? 'select' : 'idle' });
  },

  toggleSelect: (id) => {
    clearPdfOverlaySelectionIfAny();
    const current = get().selectedIds;
    const next = current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id];
    set({ selectedIds: next, fineSelection: null, mode: next.length > 0 ? 'select' : 'idle' });
  },

  deselect: () => {
    clearPdfOverlaySelectionIfAny();
    set({ selectedIds: [], fineSelection: null, mode: 'idle' });
  },

  selectFine: (selection) => {
    clearPdfOverlaySelectionIfAny();
    set({ selectedIds: [], fineSelection: selection, mode: 'select' });
  },
}));
