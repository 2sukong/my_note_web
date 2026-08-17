import { create } from 'zustand';

/**
 * Phase 8: 자동저장 상태를 화면 한 구석에 최소한으로 보여주기 위한 스토어
 * (canvas/SaveStatusIndicator.tsx). fileTreeStore.ts가 자동저장을 스케줄/실행할 때마다
 * 갱신한다.
 */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface SaveStatusState {
  status: SaveStatus;
  setStatus: (status: SaveStatus) => void;
}

export const useSaveStatusStore = create<SaveStatusState>((set) => ({
  status: 'idle',
  setStatus: (status) => set({ status }),
}));
