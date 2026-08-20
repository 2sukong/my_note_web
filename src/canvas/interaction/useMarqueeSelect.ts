import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useViewportStore } from '../../store/viewportStore';
import { useInteractionStore } from '../../store/interactionStore';
import { useObjectsStore } from '../../store/objectsStore';
import { useToolStore } from '../../store/toolStore';
import { useMarqueeStore } from '../../store/marqueeStore';
import { clientToWorld } from '../../utils/coords';
import { normalizeRect, objectsFullyInsideRect, textObjectsIntersectingRect } from '../selection';

const DRAG_THRESHOLD_PX = 4; // screen px 기준. useObjectDrag/useDrawShapeTool과 동일한 관례.

/**
 * Phase 7: activeTool==='select'일 때 빈 캔버스(또는 Frame의 빈 표면)를 드래그하면
 * 사각형 영역 안에 "완전히 포함된" 객체를 전부 선택한다(canvas/selection.ts 참고).
 * usePan.ts/useDrawShapeTool.ts와 같은 방식(containerRef에 native pointer 리스너를
 * 직접 붙임)으로 구현했다.
 *
 * - Shift를 누른 채 드래그하면 기존 선택에 더한다(합집합). 아니면 완전히 교체한다.
 * - Ctrl(또는 Cmd)을 누른 채 드래그하면 "완전 포함 + 전체 타입" 대신 "교차 + Text만"
 *   기준으로 바뀐다(textObjectsIntersectingRect) — 서로 떨어진(비연속적인) Text
 *   객체들도 드래그 사각형에 살짝만 걸치면 함께 선택된다. Shift와 함께 누르면 이
 *   Text 교차 선택 결과를 기존 선택에 합친다.
 * - 실제로 드래그하지 않고 그냥 클릭만 했다면(임계값 미만) 기존 동작 그대로 선택을
 *   해제한다 — 예전에 Canvas.tsx의 handleBackgroundPointerDown이 pointerdown 즉시
 *   하던 일을, 이제는 이 훅이 pointerup 시점에(드래그였는지 판별한 뒤) 대신한다.
 *
 * isSpacePressed는 usePan.ts가 들고 있는 로컬 state라 Canvas.tsx가 훅 호출 순서를
 * usePan → useMarqueeSelect로 두고 그 값을 그대로 넘겨준다 — 스페이스+드래그(pan)와
 * 마퀴 선택이 동시에 시작되는 걸 막기 위한, useDrawShapeTool에는 없던 명시적 처리다
 * (마퀴는 기본 'select' 도구에서 항상 활성화돼 있어서 pan과 충돌할 확률이 도형 그리기
 * 도구보다 훨씬 높기 때문에 여기서는 제대로 막아야 한다).
 */
export function useMarqueeSelect(containerRef: RefObject<HTMLDivElement | null>, isSpacePressed: boolean) {
  const activeRef = useRef<{
    pointerId: number;
    startScreen: { x: number; y: number };
    shiftKey: boolean;
    ctrlKey: boolean;
    dragging: boolean;
  } | null>(null);
  const isSpacePressedRef = useRef(isSpacePressed);
  isSpacePressedRef.current = isSpacePressed;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (isSpacePressedRef.current) return; // pan이 우선한다.
      if (useToolStore.getState().activeTool !== 'select') return;
      const target = e.target as HTMLElement;
      if (target !== el) {
        // 버그 수정(다중 선택 클릭이 곧바로 취소됨): data-shape-drawable은 원래
        // "화살표/사각형 도구가 Frame의 빈 표면 위에서도 그리기를 시작할 수 있다"는
        // 표식인데(FrameObjectView.tsx), TextObjectView.tsx도 같은 표식을 자기 내부
        // 콘텐츠 영역에 붙인다(같은 이유로 텍스트 상자 위에도 화살표/사각형을 그릴 수
        // 있게). 이 훅은 원래 "Frame의 빈 표면"만 마퀴/배경-클릭-해제 대상으로 삼을
        // 생각이었지만 검사가 속성값만 봐서 Text 내부 클릭도 통과시켜버렸다 — 그 결과
        // Text를 클릭(Ctrl+클릭 포함)해 useObjectDrag가 선택을 갱신해도, 같은 클릭을
        // 이 훅도 "빈 배경 클릭"으로 오인해 pointerup에서 deselect()를 호출해 방금 한
        // 선택을 곧바로 지워버렸다. 소유 객체가 실제로 Frame일 때만(개념상 "페이지
        // 배경"에 가까운 유일한 타입) 통과시킨다.
        if (target.dataset.shapeDrawable !== 'true') return;
        const ownerId = target.closest<HTMLElement>('[data-object-id]')?.dataset.objectId;
        const owner = ownerId ? useObjectsStore.getState().objects[ownerId] : undefined;
        if (owner?.type !== 'frame') return;
      }

      activeRef.current = {
        pointerId: e.pointerId,
        startScreen: { x: e.clientX, y: e.clientY },
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey || e.metaKey,
        dragging: false,
      };
      // 드래그 임계값을 넘기 전까지는 draft를 만들지 않는다 — 클릭만으로 끝나는
      // 대부분의 경우 MarqueeOverlay가 불필요하게 렌더링되지 않게 하기 위함.
    };

    const handlePointerMove = (e: PointerEvent) => {
      const active = activeRef.current;
      if (!active || active.pointerId !== e.pointerId) return;

      // 버그 수정: useObjectDrag.ts와 동일한 이유로, 놓친 pointerup 때문에 캔버스가
      // pointer capture를 계속 들고 있는 상태를 e.buttons===0으로 감지해 정리한다.
      if (e.buttons === 0) {
        activeRef.current = null;
        useMarqueeStore.getState().clearDraft();
        if (el.hasPointerCapture(e.pointerId)) {
          el.releasePointerCapture(e.pointerId);
        }
        return;
      }

      const world = clientToWorld({ x: e.clientX, y: e.clientY }, useViewportStore.getState());

      if (!active.dragging) {
        const dx = e.clientX - active.startScreen.x;
        const dy = e.clientY - active.startScreen.y;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        active.dragging = true;
        const startWorld = clientToWorld(active.startScreen, useViewportStore.getState());
        useMarqueeStore.getState().setDraft({ start: startWorld, current: world });
        el.setPointerCapture(e.pointerId);
        return;
      }

      useMarqueeStore.getState().updateCurrent(world);
    };

    const finish = (e: PointerEvent) => {
      const active = activeRef.current;
      if (!active || active.pointerId !== e.pointerId) return;
      activeRef.current = null;
      if (el.hasPointerCapture(e.pointerId)) {
        el.releasePointerCapture(e.pointerId);
      }

      const draft = useMarqueeStore.getState().draft;
      useMarqueeStore.getState().clearDraft();

      if (!active.dragging || !draft) {
        // 드래그 없이 그냥 클릭만 한 경우 — 기존 배경 클릭과 동일하게 선택 해제.
        useInteractionStore.getState().deselect();
        return;
      }

      const rect = normalizeRect(draft.start, draft.current);
      const matched = active.ctrlKey ? textObjectsIntersectingRect(rect) : objectsFullyInsideRect(rect);

      if (active.shiftKey) {
        const current = useInteractionStore.getState().selectedIds;
        const union = [...current, ...matched.filter((id) => !current.includes(id))];
        useInteractionStore.getState().setSelection(union);
      } else {
        useInteractionStore.getState().setSelection(matched);
      }
    };

    el.addEventListener('pointerdown', handlePointerDown);
    el.addEventListener('pointermove', handlePointerMove);
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);

    return () => {
      el.removeEventListener('pointerdown', handlePointerDown);
      el.removeEventListener('pointermove', handlePointerMove);
      el.removeEventListener('pointerup', finish);
      el.removeEventListener('pointercancel', finish);
    };
  }, [containerRef]);
}
