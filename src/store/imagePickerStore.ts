import { create } from 'zustand';

interface PendingImagePlacement {
  x: number;
  y: number;
  frameId: string | null;
}

interface ImagePickerState {
  requestId: number;
  pending: PendingImagePlacement | null;
  requestPicker: (x: number, y: number, frameId?: string | null) => void;
  clearPending: () => void;
}

/**
 * Phase 5: '이미지' 도구로 캔버스/Frame을 클릭한 시점의 world 좌표(+frameId)를
 * 잠깐 들고 있다가, 파일 선택 대화상자(input[type=file], Canvas.tsx가 소유)가
 * 끝난 뒤 spawnImageAt에 그대로 넘겨준다. 파일 선택은 브라우저 네이티브 비동기
 * UI라서 "클릭한 위치"와 "파일이 실제로 선택되는 시점" 사이에 시간차가 있고,
 * Canvas 배경 클릭이냐 Frame 내부 클릭이냐에 따라 frameId도 달라져야 하므로
 * text/frame 도구처럼 즉시 spawn하지 못하고 별도 store로 분리했다.
 * requestId는 값이 같은 위치를 두 번 연속 클릭해도(pending 객체가 얕은 비교로
 * "안 바뀐 것"처럼 보이는 경우) Canvas.tsx의 useEffect가 매번 파일 선택 창을
 * 새로 열도록 하는 트리거 용도다.
 */
export const useImagePickerStore = create<ImagePickerState>((set) => ({
  requestId: 0,
  pending: null,
  requestPicker: (x, y, frameId = null) =>
    set((s) => ({ pending: { x, y, frameId }, requestId: s.requestId + 1 })),
  clearPending: () => set({ pending: null }),
}));
