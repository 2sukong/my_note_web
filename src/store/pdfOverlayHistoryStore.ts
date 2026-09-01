import { create } from 'zustand';
import type { Patch } from 'immer';
import { usePdfOverlayStore } from './pdfOverlayStore';

// enablePatches()는 store/historyStore.ts가 앱 전체에서 한 번만 호출해두면 충분하다
// (immer 전역 설정이라 여러 번 호출해도 안전하지만, 굳이 여기서 다시 부를 필요는 없다).

/**
 * PDF 페이지 오버레이 전용 독립 undo/redo 스택(v3 §2-7, 사용자가 "PDF 페이지별 독립된
 * 작은 undo 스택"으로 확정). store/historyStore.ts와 거의 동일한 구조를 그대로
 * 복제했다 — 코드 중복은 있지만, 메인 Canvas의 historyStore(및 그걸 구독하는
 * fileTreeStore의 autosave-on-transaction-end 로직 등)를 전혀 건드리지 않아서 회귀
 * 위험이 없다는 게 이 방식(병렬 구현, B안)을 고른 이유였다.
 *
 * 메인 historyStore와 다른 점은 딱 하나: undo/redo가 적용하는 대상이
 * useObjectsStore가 아니라 usePdfOverlayStore(objects+pageHighlights 묶음)라는 것뿐이다.
 */
const COALESCE_WINDOW_MS = 800;

function flattenInverseBatches(batches: Patch[][]): Patch[] {
  const result: Patch[] = [];
  for (let i = batches.length - 1; i >= 0; i--) {
    result.push(...batches[i]);
  }
  return result;
}

interface HistoryEntry {
  patches: Patch[];
  inverseBatches: Patch[][];
  coalesceKey?: string;
  timestamp: number;
}

interface ActiveTransaction {
  key: string;
  patches: Patch[];
  inverseBatches: Patch[][];
}

interface PdfOverlayHistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
  activeTransaction: ActiveTransaction | null;

  record: (patches: Patch[], inversePatches: Patch[], coalesceKey?: string) => void;
  beginTransaction: (key: string) => void;
  endTransaction: () => void;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  /** PDF를 닫거나 다른 페이지/다른 PDF로 넘어갈 때 usePdfOverlayStore가 호출한다 —
   * 다른 페이지의 patches를 지금 페이지의 objects에 applyPatches하면 안 되므로,
   * historyStore.ts의 Page 전환 시 reset()과 같은 이유로 스택을 통째로 비운다. */
  reset: () => void;
}

export const usePdfOverlayHistoryStore = create<PdfOverlayHistoryState>((set, get) => ({
  past: [],
  future: [],
  activeTransaction: null,

  record: (patches, inversePatches, coalesceKey) => {
    if (patches.length === 0) return;
    const state = get();

    if (state.activeTransaction) {
      state.activeTransaction.patches.push(...patches);
      state.activeTransaction.inverseBatches.push(inversePatches);
      set({ activeTransaction: { ...state.activeTransaction } });
      return;
    }

    const now = Date.now();
    const last = state.past[state.past.length - 1];
    if (coalesceKey && last?.coalesceKey === coalesceKey && now - last.timestamp < COALESCE_WINDOW_MS) {
      last.patches.push(...patches);
      last.inverseBatches.push(inversePatches);
      last.timestamp = now;
      set({ past: [...state.past.slice(0, -1), last] });
      return;
    }

    set({
      past: [...state.past, { patches, inverseBatches: [inversePatches], coalesceKey, timestamp: now }],
      future: [],
    });
  },

  beginTransaction: (key) => {
    if (get().activeTransaction) return;
    set({ activeTransaction: { key, patches: [], inverseBatches: [] } });
  },

  endTransaction: () => {
    const active = get().activeTransaction;
    if (!active) return;
    set({ activeTransaction: null });
    if (active.patches.length === 0) return;
    set((state) => ({
      past: [
        ...state.past,
        { patches: active.patches, inverseBatches: active.inverseBatches, timestamp: Date.now() },
      ],
      future: [],
    }));
  },

  undo: () => {
    const state = get();
    if (state.past.length === 0) return;
    const entry = state.past[state.past.length - 1];
    usePdfOverlayStore.getState().applyHistoryPatches(flattenInverseBatches(entry.inverseBatches));
    set({ past: state.past.slice(0, -1), future: [...state.future, entry] });
  },

  redo: () => {
    const state = get();
    if (state.future.length === 0) return;
    const entry = state.future[state.future.length - 1];
    usePdfOverlayStore.getState().applyHistoryPatches(entry.patches);
    set({ future: state.future.slice(0, -1), past: [...state.past, entry] });
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  reset: () => set({ past: [], future: [], activeTransaction: null }),
}));
