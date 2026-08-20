import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { ImageObject } from '../../types/object';
import { useViewportStore } from '../../store/viewportStore';
import { useObjectsStore } from '../../store/objectsStore';
import { useInteractionStore } from '../../store/interactionStore';
import { useHistoryStore } from '../../store/historyStore';
import { computeCroppedState } from './cropMath';
import type { CropState } from './cropMath';
import type { ResizeHandle } from './resizeMath';

interface CropRefState {
  pointerId: number;
  startScreen: { x: number; y: number };
  startState: CropState;
}

/**
 * 요구사항(이미지 자르기): useObjectResize.ts와 같은 구조의 8방향 핸들 드래그이지만,
 * 박스를 통째로 늘리는 대신 computeCroppedState(cropMath.ts)로 "보이는 영역(box)"과
 * "원본 이미지 중 보여줄 자연 픽셀 영역(crop)"을 함께 갱신한다. 리사이즈와 달리
 * 종횡비 고정/정렬 가이드 스냅은 적용하지 않는다 — 자르기는 애초에 비율을 자유롭게
 * 바꾸는 것이 목적이라 스냅 대상이 될 이유가 없다.
 */
export function useImageCrop(object: ImageObject, handle: ResizeHandle) {
  const cropRef = useRef<CropRefState | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    useInteractionStore.getState().setMode('resize');
    useHistoryStore.getState().beginTransaction('crop');
    cropRef.current = {
      pointerId: e.pointerId,
      startScreen: { x: e.clientX, y: e.clientY },
      startState: {
        box: { x: object.x, y: object.y, width: object.width, height: object.height },
        crop: {
          cropX: object.cropX ?? 0,
          cropY: object.cropY ?? 0,
          cropWidth: object.cropWidth ?? object.naturalWidth,
          cropHeight: object.cropHeight ?? object.naturalHeight,
        },
        naturalWidth: object.naturalWidth,
        naturalHeight: object.naturalHeight,
      },
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const state = cropRef.current;
    if (!state || state.pointerId !== e.pointerId) return;

    if (e.buttons === 0) {
      useInteractionStore.getState().setMode('select');
      useHistoryStore.getState().endTransaction();
      cropRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      return;
    }

    const { zoom } = useViewportStore.getState();
    const dx = (e.clientX - state.startScreen.x) / zoom;
    const dy = (e.clientY - state.startScreen.y) / zoom;

    const next = computeCroppedState(state.startState, handle, dx, dy);
    useObjectsStore.getState().cropObjectTo(object.id, next.box, next.crop);
  };

  const endCrop = (e: ReactPointerEvent<HTMLDivElement>) => {
    const state = cropRef.current;
    if (!state || state.pointerId !== e.pointerId) return;

    cropRef.current = null;
    useInteractionStore.getState().setMode('select');
    useHistoryStore.getState().endTransaction();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: endCrop,
    onPointerCancel: endCrop,
  };
}
