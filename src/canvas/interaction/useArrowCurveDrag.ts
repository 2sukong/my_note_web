import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useViewportStore } from '../../store/viewportStore';
import { useObjectsStore } from '../../store/objectsStore';
import { useInteractionStore } from '../../store/interactionStore';
import { useHistoryStore } from '../../store/historyStore';
import { clientToWorld } from '../../utils/coords';
import { curveOffsetForMidpoint } from '../../objects/shapes/shapeGeometry';
import type { Point } from '../../objects/shapes/shapeGeometry';

interface CurveDragState {
  pointerId: number;
}

/**
 * 화살표 중간 곡률(curveOffset) 조절 핸들의 인터랙션. useObjectResize와 달리
 * "시작점 대비 delta"를 누적하지 않는다 — 매 pointermove의 커서 world 좌표를 그대로
 * 목표 곡선 중점으로 삼아 curveOffset을 다시 계산한다(shapeGeometry의
 * curveOffsetForMidpoint). 그래야 곡선이 커서를 정확히 따라와서 "선을 손으로 잡아
 * 당기는" 느낌이 나고, 드래그를 시작한 지점과 핸들의 정확한 픽셀이 어긋나 있어도
 * 다음 프레임부터 바로 커서 위치로 스냅되어 자연스럽다.
 *
 * p1/p2는 로컬(박스 기준) 좌표라서, 커서의 world 좌표에서 box.x/box.y를 빼 같은
 * 좌표계로 맞춘 뒤 넘긴다.
 */
export function useArrowCurveDrag(
  objectId: string,
  box: { x: number; y: number },
  p1: Point,
  p2: Point,
) {
  const dragState = useRef<CurveDragState | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    useInteractionStore.getState().setMode('resize');
    useHistoryStore.getState().beginTransaction('arrow-curve');
    dragState.current = { pointerId: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragState.current;
    if (!state || state.pointerId !== e.pointerId) return;

    // 버그 수정: useObjectDrag.ts와 동일한 이유로, 놓친 pointerup 때문에 이 핸들이
    // pointer capture를 계속 들고 있는 상태를 e.buttons===0으로 감지해 정리한다.
    if (e.buttons === 0) {
      dragState.current = null;
      useInteractionStore.getState().setMode('select');
      useHistoryStore.getState().endTransaction();
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      return;
    }

    const viewport = useViewportStore.getState();
    const world = clientToWorld({ x: e.clientX, y: e.clientY }, viewport);
    const local: Point = { x: world.x - box.x, y: world.y - box.y };
    const nextOffset = curveOffsetForMidpoint(p1, p2, local);
    useObjectsStore.getState().updateObject(objectId, { curveOffset: nextOffset }, `curve:${objectId}`);
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragState.current;
    if (!state || state.pointerId !== e.pointerId) return;

    dragState.current = null;
    useInteractionStore.getState().setMode('select');
    useHistoryStore.getState().endTransaction();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  };
}
