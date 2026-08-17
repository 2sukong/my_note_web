import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useViewportStore } from '../../store/viewportStore';
import { useObjectsStore } from '../../store/objectsStore';
import { useInteractionStore } from '../../store/interactionStore';
import { useHistoryStore } from '../../store/historyStore';
import { useAlignmentGuideStore } from '../../store/alignmentGuideStore';
import { computeResizedBox, MIN_SIZE } from './resizeMath';
import type { Box, ResizeHandle } from './resizeMath';
import { computeResizeSnap } from '../../objects/align/smartGuides';
import type { GuideTarget } from '../../objects/align/smartGuides';
import { alignmentScopeOf, objectsInAlignmentScope } from '../../objects/align/frameScope';

const SNAP_THRESHOLD_PX = 6; // screen px 기준. 정렬 가이드(smartGuides.ts)가 반응하는 민감도.

interface ResizeRefState {
  pointerId: number;
  startScreen: { x: number; y: number };
  startBox: Box;
}

/**
 * 하나의 resize handle의 인터랙션. world 이동량을 resizeMath로 넘겨 새 박스를 계산한다.
 *
 * Phase 5: aspectRatio(width/height)를 넘기면 기본적으로 그 비율을 고정한 채 리사이즈된다
 * (이미지가 종횡비를 유지하는 게 자연스럽다는 요구사항). Shift를 누르고 있는 동안만
 * 잠깐 자유 리사이즈로 전환한다 — 매 pointermove의 실제 이벤트(e.shiftKey)로 판단하므로
 * 드래그 도중 Shift를 누르거나 떼면 즉시 반영된다.
 */
export function useObjectResize(objectId: string, box: Box, handle: ResizeHandle, aspectRatio?: number) {
  const resizeRef = useRef<ResizeRefState | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    useInteractionStore.getState().setMode('resize');
    useHistoryStore.getState().beginTransaction('resize');
    resizeRef.current = {
      pointerId: e.pointerId,
      startScreen: { x: e.clientX, y: e.clientY },
      startBox: box,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const state = resizeRef.current;
    if (!state || state.pointerId !== e.pointerId) return;

    // 버그 수정: useObjectDrag.ts와 동일한 이유(브라우저 밖 마우스업 등으로
    // pointerup을 놓치면 pointer capture가 이 핸들에 계속 남아, 이후 클릭이 전부
    // 여기로만 전달돼 "해제가 안 되는" 것처럼 보임) — e.buttons===0이면 버튼이
    // 이미 떼어진 것이므로 즉시 정리한다.
    if (e.buttons === 0) {
      useInteractionStore.getState().setMode('select');
      useHistoryStore.getState().endTransaction();
      useAlignmentGuideStore.getState().clear();
      resizeRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      return;
    }

    const { zoom } = useViewportStore.getState();
    const dx = (e.clientX - state.startScreen.x) / zoom;
    const dy = (e.clientY - state.startScreen.y) / zoom;

    const lockedAspectRatio = aspectRatio !== undefined && !e.shiftKey ? aspectRatio : undefined;
    let nextBox = computeResizedBox(state.startBox, handle, dx, dy, lockedAspectRatio);

    // 요구사항(정렬 가이드): 종횡비가 잠긴 상태(예: 이미지)에서는 한 변만 스냅해버리면
    // 다른 변과의 비율이 깨지므로, 자유 리사이즈(종횡비 고정 없음, 또는 Shift로 잠깐
    // 해제한 상태)일 때만 스냅을 적용한다.
    if (lockedAspectRatio === undefined) {
      const objects = useObjectsStore.getState().objects;
      const target = objects[objectId];
      // 요구사항(정사각형 가이드): 사각형/텍스트에서만 "가로=세로" 스냅을 시도한다 —
      // 화살표/이미지/프레임에는 정사각형이라는 개념이 딱히 의미가 없어서 범위 밖으로 뒀다.
      const matchSquare = target?.type === 'rectangle' || target?.type === 'text';
      // 요구사항(정렬 가이드는 같은 프레임 안에서만): 리사이즈 대상 자신의 프레임
      // 소속을 기준으로 비교 범위를 정한다.
      const scope = target ? alignmentScopeOf(target) : null;
      const candidates = objectsInAlignmentScope(
        Object.values(objects).filter((o) => o.id !== objectId),
        scope,
      );
      const others: GuideTarget[] = candidates.map((o) => ({ id: o.id, x: o.x, y: o.y, width: o.width, height: o.height }));
      const threshold = SNAP_THRESHOLD_PX / zoom;
      const snap = computeResizeSnap(
        nextBox,
        { east: handle.includes('e'), west: handle.includes('w'), north: handle.includes('n'), south: handle.includes('s') },
        others,
        threshold,
        MIN_SIZE,
        matchSquare,
      );
      nextBox = snap.box;
      useAlignmentGuideStore.getState().setLines(snap.lines);
    } else {
      useAlignmentGuideStore.getState().clear();
    }

    useObjectsStore.getState().resizeObjectTo(objectId, nextBox);
  };

  const endResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    const state = resizeRef.current;
    if (!state || state.pointerId !== e.pointerId) return;

    resizeRef.current = null;
    useInteractionStore.getState().setMode('select');
    useHistoryStore.getState().endTransaction();
    useAlignmentGuideStore.getState().clear();
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
