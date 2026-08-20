import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useViewportStore } from '../../store/viewportStore';
import { useObjectsStore } from '../../store/objectsStore';
import { useInteractionStore } from '../../store/interactionStore';
import { useHistoryStore } from '../../store/historyStore';
import { computeResizedBox, MIN_SIZE } from './resizeMath';
import type { Box, ResizeHandle } from './resizeMath';

interface GroupResizeRefState {
  pointerId: number;
  startScreen: { x: number; y: number };
  startGroupBox: Box;
  startBoxes: Record<string, Box>;
}

/**
 * 다중 선택(2개 이상) 전체를 하나의 union bounding box로 묶어 리사이즈하는 handle의
 * 인터랙션. useObjectResize.ts(단일 객체)와 같은 구조이지만, 새 group box를
 * computeResizedBox로 구한 뒤 그 스케일 비율(scaleX/scaleY)을 각 객체의 시작
 * 위치/크기에 그대로 곱해 적용한다 — 각 객체는 group box 안에서의 상대 위치/크기
 * 비율을 유지한 채 함께 커지거나 작아진다.
 *
 * 요구사항(다중 선택 리사이즈)에 맞춰 새로 추가됐다. 단일 리사이즈(useObjectResize)와
 * 달리 정렬 가이드 스냅이나 개별 종횡비 고정은 적용하지 않는다 — 여러 객체가 동시에
 * 서로 다른 비율로 반응하면 스냅/종횡비 기준을 정하기 애매해지므로 범위 밖으로 뒀다.
 */
export function useGroupResize(objectIds: string[], groupBox: Box, handle: ResizeHandle) {
  const resizeRef = useRef<GroupResizeRefState | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    const objects = useObjectsStore.getState().objects;
    const startBoxes: Record<string, Box> = {};
    for (const id of objectIds) {
      const o = objects[id];
      if (o) startBoxes[id] = { x: o.x, y: o.y, width: o.width, height: o.height };
    }

    useInteractionStore.getState().setMode('resize');
    useHistoryStore.getState().beginTransaction('resize');
    resizeRef.current = {
      pointerId: e.pointerId,
      startScreen: { x: e.clientX, y: e.clientY },
      startGroupBox: groupBox,
      startBoxes,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const state = resizeRef.current;
    if (!state || state.pointerId !== e.pointerId) return;

    // useObjectResize.ts와 동일한 이유(놓친 pointerup으로 인한 capture 잔류 방지).
    if (e.buttons === 0) {
      useInteractionStore.getState().setMode('select');
      useHistoryStore.getState().endTransaction();
      resizeRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      return;
    }

    const { zoom } = useViewportStore.getState();
    const dx = (e.clientX - state.startScreen.x) / zoom;
    const dy = (e.clientY - state.startScreen.y) / zoom;

    const nextGroupBox = computeResizedBox(state.startGroupBox, handle, dx, dy);
    const scaleX = state.startGroupBox.width > 0 ? nextGroupBox.width / state.startGroupBox.width : 1;
    const scaleY = state.startGroupBox.height > 0 ? nextGroupBox.height / state.startGroupBox.height : 1;

    for (const [id, startBox] of Object.entries(state.startBoxes)) {
      const nextBox: Box = {
        x: nextGroupBox.x + (startBox.x - state.startGroupBox.x) * scaleX,
        y: nextGroupBox.y + (startBox.y - state.startGroupBox.y) * scaleY,
        width: Math.max(MIN_SIZE, startBox.width * scaleX),
        height: Math.max(MIN_SIZE, startBox.height * scaleY),
      };
      useObjectsStore.getState().resizeObjectTo(id, nextBox);
    }
  };

  const endResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    const state = resizeRef.current;
    if (!state || state.pointerId !== e.pointerId) return;

    resizeRef.current = null;
    useInteractionStore.getState().setMode('select');
    useHistoryStore.getState().endTransaction();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: endResize,
    onPointerCancel: endResize,
  };
}
