import { create } from 'zustand';

interface PendingImagePlacement {
  x: number;
  y: number;
}

interface PdfOverlayImagePickerState {
  requestId: number;
  pending: PendingImagePlacement | null;
  requestPicker: (x: number, y: number) => void;
  clearPending: () => void;
}

/**
 * PDF 오버레이의 '이미지' 도구(Phase 6, 2026-08) — store/imagePickerStore.ts(메인
 * 캔버스)와 완전히 같은 원리다: 파일 선택 대화상자(input[type=file], PdfViewerPanel.tsx가
 * 소유)는 브라우저 네이티브 비동기 UI라서 "클릭한 위치"와 "파일이 실제로 선택되는 시점"
 * 사이에 시간차가 있어, 클릭 시점의 좌표를 잠깐 들고 있다가 파일 선택이 끝난 뒤
 * spawnOverlayImageAt에 그대로 넘겨준다.
 *
 * frameId가 없다: PDF 오버레이에는 Frame이 아예 없다(types/pdf.ts의 OverlayObject 유니온
 * 참고, 사용자 확정 사항) — 좌표(x, y)만 페이지 로컬 px로 들고 있으면 된다.
 *
 * requestId는 같은 위치를 두 번 연속 클릭해도(pending 객체가 얕은 비교로 "안 바뀐 것"처럼
 * 보이는 경우) PdfViewerPanel.tsx의 useEffect가 매번 파일 선택 창을 새로 열도록 하는
 * 트리거 용도다(imagePickerStore.ts와 동일한 관례).
 */
export const usePdfOverlayImagePickerStore = create<PdfOverlayImagePickerState>((set) => ({
  requestId: 0,
  pending: null,
  requestPicker: (x, y) => set((s) => ({ pending: { x, y }, requestId: s.requestId + 1 })),
  clearPending: () => set({ pending: null }),
}));
