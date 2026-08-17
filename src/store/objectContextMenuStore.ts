import { create } from 'zustand';

/**
 * 요구사항(우클릭 쌓임 순서 메뉴): 캔버스 객체를 우클릭하면 뜨는 작은 메뉴의 위치/대상.
 * storage/sidebar/fileTreeUiStore.ts의 contextMenu와 같은 원리(단일 메뉴, 열림/닫힘) —
 * 객체는 한 번에 하나만 우클릭할 수 있으므로 배열이 아니라 단일 값이다.
 */
interface ObjectContextMenuState {
  menu: { objectId: string; x: number; y: number } | null;
  open: (objectId: string, x: number, y: number) => void;
  close: () => void;
}

export const useObjectContextMenuStore = create<ObjectContextMenuState>((set) => ({
  menu: null,
  open: (objectId, x, y) => set({ menu: { objectId, x, y } }),
  close: () => set({ menu: null }),
}));
