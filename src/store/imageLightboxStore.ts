import { create } from 'zustand';

/**
 * 요구사항(이미지 더블클릭 시 확대): 캔버스에 배치된 이미지를 더블클릭하면 화면
 * 전체를 덮는 오버레이로 원본 크기(에 가깝게, viewport에 맞춰 축소)를 보여준다.
 * canvas/ObjectContextMenu.tsx의 objectContextMenuStore와 같은 원리(단일 값,
 * 열림/닫힘) — 한 번에 하나의 이미지만 확대해서 볼 수 있으므로 배열이 아니다.
 * ImageObjectView.tsx가 이미 로드해둔 object URL을 그대로 넘겨받는다(imageId만
 * 저장하고 다시 로드하지 않는다 — 이미 화면에 떠 있던 이미지라 항상 로드가
 * 끝난 뒤에만 더블클릭할 수 있기 때문).
 */
interface ImageLightboxState {
  url: string | null;
  open: (url: string) => void;
  close: () => void;
}

export const useImageLightboxStore = create<ImageLightboxState>((set) => ({
  url: null,
  open: (url) => set({ url }),
  close: () => set({ url: null }),
}));
