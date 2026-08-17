import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useViewportStore } from '../../store/viewportStore';

/**
 * 캔버스 pan(이동) 인터랙션.
 *
 * 트리거 조건 (요구사항 6번 Interaction 상태 중 'pan'):
 *  - 스페이스바를 누른 채로 드래그
 *  - 마우스 중간 버튼(휠 클릭) 드래그
 *
 * Phase 2에서 도입될 전역 interactionMode 상태 머신과는 별개로,
 * Phase 1에서는 pan 자체의 정상 동작을 먼저 검증하기 위해 로컬 상태로 구현한다.
 * 이후 Phase 2에서 select/drag/resize와 충돌하지 않도록 interactionStore에 편입한다.
 */
export function usePan(containerRef: RefObject<HTMLDivElement | null>) {
  const [isSpacePressed, setSpacePressed] = useState(false);
  const [isPanning, setPanning] = useState(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  // 스페이스바 상태 추적
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        setSpacePressed(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const shouldStartPan = (e: PointerEvent) => e.button === 1 || (e.button === 0 && isSpacePressed);

    const handlePointerDown = (e: PointerEvent) => {
      if (!shouldStartPan(e)) return;
      e.preventDefault();
      setPanning(true);
      lastPoint.current = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!lastPoint.current) return;
      // 버그 수정: useObjectDrag.ts와 동일한 이유로, 놓친 pointerup 때문에 캔버스가
      // pointer capture를 계속 들고 있는 상태를 e.buttons===0으로 감지해 정리한다.
      if (e.buttons === 0) {
        lastPoint.current = null;
        setPanning(false);
        if (el.hasPointerCapture(e.pointerId)) {
          el.releasePointerCapture(e.pointerId);
        }
        return;
      }
      const dx = e.clientX - lastPoint.current.x;
      const dy = e.clientY - lastPoint.current.y;
      lastPoint.current = { x: e.clientX, y: e.clientY };
      useViewportStore.getState().panBy(dx, dy);
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!lastPoint.current) return;
      lastPoint.current = null;
      setPanning(false);
      if (el.hasPointerCapture(e.pointerId)) {
        el.releasePointerCapture(e.pointerId);
      }
    };

    el.addEventListener('pointerdown', handlePointerDown);
    el.addEventListener('pointermove', handlePointerMove);
    el.addEventListener('pointerup', handlePointerUp);
    el.addEventListener('pointercancel', handlePointerUp);

    return () => {
      el.removeEventListener('pointerdown', handlePointerDown);
      el.removeEventListener('pointermove', handlePointerMove);
      el.removeEventListener('pointerup', handlePointerUp);
      el.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [containerRef, isSpacePressed]);

  const cursor = isPanning ? 'grabbing' : isSpacePressed ? 'grab' : 'default';

  return { cursor, isPanning, isSpacePressed };
}
