import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useViewportStore } from '../../store/viewportStore';
import { useInteractionStore } from '../../store/interactionStore';

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
        // 버그 수정(2026-09-15, "PDF가 열린 상태에서 Space+마우스 이동으로 화면을
        // 옮기면 PDF의 이전/다음 페이지 버튼이 같이 눌림"): 브라우저 기본 동작상
        // 포커스가 <button>에 남아있는 상태에서 Space를 누르면 그 버튼을 클릭한 것과
        // 동일하게 처리된다. PDF 뷰어의 이전/다음 페이지 화살표(다른 툴바 버튼도
        // 마찬가지)를 한 번 클릭하면 포커스가 그 버튼에 남는데, 그 직후 화면 이동을
        // 위해 Space를 누르면 이 기본 동작이 함께 발동해 의도치 않게 페이지가
        // 넘어갔다. 포커스가 버튼일 때만 Space의 기본 동작(클릭 트리거)을 막고
        // 포커스를 치운다 — 텍스트 편집 중(contentEditable)에는 활성 엘리먼트가
        // 버튼이 아니므로 이 분기에 걸리지 않아 스페이스 문자 입력에는 영향 없다.
        if (document.activeElement instanceof HTMLButtonElement) {
          e.preventDefault();
          document.activeElement.blur();
        }
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
      // 버그 수정(스페이스+드래그로 화면 이동 중 텍스트에 스페이스가 계속 입력됨):
      // 텍스트 편집 중(mode==='text-edit') 커서가 편집 중인 텍스트 위에 있을 때 스페이스를
      // 누르고 그대로 마우스를 움직이면, pointerdown이 텍스트의 contentEditable div
      // 위에서 일어나 이 pan 제스처가 시작되면서도 그 div는 계속 포커스를 들고 있었다 —
      // Canvas.tsx의 배경 클릭 처리는 e.target이 캔버스 루트 자신일 때만 동작해서 이
      // 경우엔 걸리지 않는다. 그 결과 포커스가 텍스트에 남은 채 스페이스바가
      // auto-repeat되면서 각 keydown이 그대로 텍스트에 스페이스 문자로 입력됐다.
      // Escape로 편집을 빠져나갈 때(TextObjectView.tsx의 setMode('select') + blur)와
      // 같은 방식으로, pan이 실제로 시작되는 순간 편집 중이면 즉시 캐럿을 꺼서 이후
      // 키 입력이 텍스트로 가지 않게 한다.
      if (useInteractionStore.getState().mode === 'text-edit') {
        useInteractionStore.getState().setMode('select');
        if (document.activeElement instanceof HTMLElement && document.activeElement.isContentEditable) {
          document.activeElement.blur();
        }
      }
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
