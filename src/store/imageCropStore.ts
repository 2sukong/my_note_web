import { create } from 'zustand';

/**
 * 요구사항(이미지 자르기): 지금 자르기 모드에 들어가 있는 Image 객체 하나(있다면)만
 * 기억한다 — 한 번에 하나의 이미지만 자를 수 있으므로 objectContextMenuStore/
 * imageLightboxStore(제거됨)와 같은 원리의 단일 값 store다. ImageObjectView.tsx가
 * 더블클릭으로 startCrop을 호출하고, 자기 자신의 id가 croppingObjectId와 같을 때만
 * 자르기 전용 렌더링(잘려나갈 부분 흐리게 표시 + 8방향 크롭 핸들)으로 전환한다.
 */
interface ImageCropState {
  croppingObjectId: string | null;
  startCrop: (objectId: string) => void;
  stopCrop: () => void;
}

export const useImageCropStore = create<ImageCropState>((set) => ({
  croppingObjectId: null,
  startCrop: (objectId) => set({ croppingObjectId: objectId }),
  stopCrop: () => set({ croppingObjectId: null }),
}));
