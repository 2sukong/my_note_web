import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useViewportStore } from '../../store/viewportStore';
import { useObjectsStore } from '../../store/objectsStore';
import { useInteractionStore } from '../../store/interactionStore';
import { useHistoryStore } from '../../store/historyStore';
import { clientToWorld } from '../../utils/coords';
import { computeDiagonal, localEndpoints } from '../../objects/shapes/shapeGeometry';
import type { Point } from '../../objects/shapes/shapeGeometry';

interface EndpointDragState {
  pointerId: number;
  /** 드래그하지 않는 쪽 끝점의 world 좌표 — 이 점은 드래그 내내 고정된다. */
  fixedWorld: Point;
}

/**
 * PowerPoint 스타일 화살표 끝점 핸들의 인터랙션. useObjectResize(8방향 사각 리사이즈)와
 * 달리 "시작점 대비 delta"를 누적하지 않는다 — useArrowCurveDrag와 같은 방식으로,
 * 매 pointermove의 커서 world 좌표를 그대로 이번에 드래그 중인 끝점의 새 위치로 삼는다.
 * 반대쪽 끝점은 pointerdown 시점의 world 좌표에 고정해두고, 두 점으로
 * computeDiagonal을 다시 호출해 canonical box(x/y/width/height)와 flipY/reverseArrow를
 * 새로 계산한다 — 화살표를 처음 그릴 때(useDrawShapeTool.ts → spawnShapeFromDraft)와
 * 정확히 같은 변환이라, "시작점/끝점을 다시 잡아 그린다"는 결과와 동일하다.
 *
 * endpoint='p1'이면 꼬리(시작점)를, 'p2'면 머리(화살촉/끝점)를 커서에 맞춰 움직인다.
 * curveOffset(중간 곡률)은 이 훅이 건드리지 않는다 — resize와 동일하게 비율로
 * 저장되어 있어 끝점이 옮겨져도 자동으로 비례해 따라온다.
 */
export function useArrowEndpointDrag(
  objectId: string,
  box: { x: number; y: number; width: number; height: number },
  endpoint: 'p1' | 'p2',
  flipY: boolean,
  reverseArrow: boolean,
) {
  const dragState = useRef<EndpointDragState | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    const { p1, p2 } = localEndpoints(box.width, box.height, flipY, reverseArrow);
    const fixedLocal = endpoint === 'p1' ? p2 : p1;
    const fixedWorld: Point = { x: box.x + fixedLocal.x, y: box.y + fixedLocal.y };

    useInteractionStore.getState().setMode('resize');
    useHistoryStore.getState().beginTransaction('arrow-endpoint');
    dragState.current = { pointerId: e.pointerId, fixedWorld };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragState.current;
    if (!state || state.pointerId !== e.pointerId) return;

    // 버그 수정: useObjectResize/useArrowCurveDrag와 동일한 이유(놓친 pointerup으로
    // pointer capture가 계속 남는 것)로, e.buttons===0이면 즉시 정리한다.
    if (e.buttons === 0) {
      dragState.current = null;
      useInteractionStore.getState().setMode('select');
      useHistoryStore.getState().endTransaction();
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      return;
    }

    const world = clientToWorld({ x: e.clientX, y: e.clientY }, useViewportStore.getState());
    // endpoint='p1'을 옮기는 중이면 커서가 새 꼬리(start), 고정점이 머리(end) —
    // 반대도 마찬가지. computeDiagonal(start, end)의 인자 순서가 곧 꼬리/머리 순서다
    // (shapeGeometry.ts 주석 참고, spawnShapeFromDraft가 쓰는 것과 동일한 함수).
    const start = endpoint === 'p1' ? world : state.fixedWorld;
    const end = endpoint === 'p1' ? state.fixedWorld : world;
    const { box: nextBox, flipY: nextFlipY, reverseDirection } = computeDiagonal(start, end);

    useObjectsStore.getState().updateObject(objectId, {
      x: nextBox.x,
      y: nextBox.y,
      width: nextBox.width,
      height: nextBox.height,
      flipY: nextFlipY,
      reverseArrow: reverseDirection,
    });
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
