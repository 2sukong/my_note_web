import type { ImageObject } from '../../types/object';
import { registerImageBlob } from '../../objects/image/imageStore';
import { usePdfOverlayStore } from '../../store/pdfOverlayStore';
import { usePdfOverlaySelectionStore } from '../../store/pdfOverlaySelectionStore';

// 페이지 로컬 px(PDF_PAGE_REFERENCE_SCALE 기준) 기준. canvas/actions.ts의 같은 이름
// 상수와 같은 값 — useDrawOverlayTextTool.ts의 DEFAULT_TEXT_WIDTH/HEIGHT와 같은 이유로,
// 페이지 로컬 px 스케일이 대략 메인 캔버스의 zoom=1과 비슷해서 그대로 재사용해도
// 자연스러운 초기 크기가 나온다.
const MAX_IMAGE_DIM = 320;

/**
 * PDF 오버레이의 이미지 삽입 진입점(Phase 6, 2026-08). canvas/actions.ts의
 * spawnImageAt과 완전히 같은 원리 — imageStore.registerImageBlob(이미지 Blob을
 * IndexedDB에 저장하고 실제 픽셀 크기를 측정)이 끝날 때까지 기다려야 하므로
 * 비동기다. naturalWidth/Height는 원본 그대로 보존하고, 화면에 놓이는 초기
 * width/height만 MAX_IMAGE_DIM 기준으로 축소한다(종횡비는 항상 유지).
 *
 * imageStore.ts 자체는 imageId(전역 UUID) ↔ Blob 매핑만 다루는, 어느 store에도
 * 속하지 않는 순수 모듈이라 메인 캔버스와 완전히 동일하게 재사용할 수 있다 — 새로
 * 포크할 필요가 없었다(v3 §2-7 "병렬 구현"은 objectsStore/historyStore에만 해당,
 * imageStore 같은 좌표계-무관 유틸리티는 그대로 공유).
 *
 * v1 스코프 축소(다른 오버레이 쓰기 도구들과 같은 기준): 자르기(crop) 기능 없음,
 * 이미지 전용 직선 형광펜(ImageObject.highlights) 없음 — 리사이즈 핸들도 없음
 * (화살표/사각형과 같은 판단: 크기를 바꾸려면 지우고 다시 넣어야 한다).
 */
export async function spawnOverlayImageAt(pageLocalX: number, pageLocalY: number, blob: Blob): Promise<string> {
  const { imageId, naturalWidth, naturalHeight } = await registerImageBlob(blob);
  const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(20, Math.round(naturalWidth * scale));
  const height = Math.max(20, Math.round(naturalHeight * scale));

  const t = Date.now();
  const id = crypto.randomUUID();
  const obj: ImageObject = {
    id,
    type: 'image',
    x: pageLocalX,
    y: pageLocalY,
    width,
    height,
    rotation: 0,
    zIndex: usePdfOverlayStore.getState().nextZIndex(),
    createdAt: t,
    updatedAt: t,
    imageId,
    naturalWidth,
    naturalHeight,
    aspectRatioLocked: true,
    frameId: null,
  };
  usePdfOverlayStore.getState().addObject(obj);
  usePdfOverlaySelectionStore.getState().select(id);
  return id;
}
