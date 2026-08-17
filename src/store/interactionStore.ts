import { create } from 'zustand';

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

export const useInteractionStore = create<InteractionState>((set, get) => ({
  mode: 'idle',
  selectedIds: [],
  fineSelection: null,

  setMode: (mode) => set({ mode }),

  select: (id) => set({ selectedIds: id ? [id] : [], fineSelection: null, mode: id ? 'select' : 'idle' }),

  setSelection: (ids) => set({ selectedIds: ids, fineSelection: null, mode: ids.length > 0 ? 'select' : 'idle' }),

  toggleSelect: (id) => {
    const current = get().selectedIds;
    const next = current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id];
    set({ selectedIds: next, fineSelection: null, mode: next.length > 0 ? 'select' : 'idle' });
  },

  deselect: () => set({ selectedIds: [], fineSelection: null, mode: 'idle' }),

  selectFine: (selection) => set({ selectedIds: [], fineSelection: selection, mode: 'select' }),
}));
