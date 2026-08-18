import { create } from 'zustand';

/**
 * 요구사항(찾기): 캔버스 위쪽의 "이 페이지 안에서 찾기" 패널 — Frame 이름과 Text
 * 내용을 지금 열려 있는 Page 안에서만 검색한다(다른 Page/File 이름은
 * canvas/sidebar/fileTreeUiStore.ts의 searchQuery가 별도로 담당). Page를 전환하면
 * 검색 결과가 그 Page와 무관해지므로 자동으로 닫는다(canvas/Canvas.tsx 참고).
 */
interface CanvasSearchState {
  isOpen: boolean;
  query: string;
  open: () => void;
  close: () => void;
  toggle: () => void;
  setQuery: (query: string) => void;
}

export const useCanvasSearchStore = create<CanvasSearchState>((set, get) => ({
  isOpen: false,
  query: '',
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false, query: '' }),
  toggle: () => (get().isOpen ? set({ isOpen: false, query: '' }) : set({ isOpen: true })),
  setQuery: (query) => set({ query }),
}));
