import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { usePdfViewerStore } from '../../store/pdfViewerStore';

/**
 * PDF Viewer 페이지 pan(이동) 인터랙션 — canvas/viewport/usePan.ts(메인 캔버스)와
 * 완전히 같은 트리거(스페이스+드래그 / 마우스 중간 버튼 드래그)를 pdfViewerStore의
 * panX/panY에 적용한다.
 *
 * 요구사항(2026-09-16, "PDF 이동도 기존 페이지와 마찬가지로 SPACE+드래그로"): 기존엔
 * `.pdf-viewer-stage`가 overflow:auto인 네이티브 스크롤 영역이라 하단/우측 스크롤바를
 * 직접 끌어야만 확대된 페이지를 이동할 수 있었다 — 그리고 그 방식엔 "오른쪽으로는
 * 이동되는데 왼쪽으로는 안 되는" 별개의 버그가 있었다: `.pdf-viewer-page`는
 * transform:scale()로 시각적으로만 확대되고(레이아웃 박스 크기 자체는 그대로) 그
 * 부모 `.pdf-viewer-stage`는 flex(align-items/justify-content:center)로 그 박스를
 * 중앙 정렬한다 — 이 조합에서 브라우저는 scrollWidth/Height를 계산할 때 transform이
 * 만든 오버플로를 "중앙 기준 오른쪽/아래" 방향으로만 스크롤 가능 영역에 포함시키고
 * "왼쪽/위" 방향 오버플로는 포함하지 못하는 크로스 브라우저 공통 결함이 있다(레이아웃
 * 박스 자체는 그대로인 채 시각적으로만 좌우로 똑같이 튀어나오는데, 스크롤 앵커는
 * 레이아웃 박스의 원래 좌상단 기준이라 오른쪽으로 튀어나온 절반만 "새로 생긴 콘텐츠"로
 * 인식되는 셈).
 *
 * 이 훅은 그 스크롤 메커니즘 자체를 걷어내고(PdfViewerPanel.css의 .pdf-viewer-stage를
 * overflow:hidden으로 되돌림) 메인 캔버스와 동일하게 직접 transform:translate로
 * 옮긴다 — 화면 px 델타를 그대로 더하므로(스케일과 무관하게 1:1) 좌우 어느 방향으로든
 * 대칭적으로 움직이고, 방향성 버그 자체가 근본적으로 생기지 않는다.
 * `.pdf-viewer-page`의 transform은 `translate(panX, panY) scale(pageZoom)` 순서로
 * 적용된다(PdfViewerPanel.tsx) — translate가 scale "다음"에 온 값을 감싸므로(즉
 * translate가 바깥쪽) 화면 px 델타가 pageZoom과 무관하게 그대로 panX/panY에 반영된다.
 *
 * isSpacePressed는 pdfViewerStore에도 반영해둔다 — PDF 오버레이의 다른 포인터 기반
 * 도구들(형광펜/텍스트/도형/이미지 드래그 생성, 기존 객체 이동, 링크 마커 드래그)이
 * 이 값을 getState()로 확인해서, 스페이스를 누른 채 페이지를 옮기려는 제스처가 그
 * 위에 있는 객체를 실수로 선택/이동/그리기로 오인하지 않게 한다(메인 캔버스
 * objects/ObjectView.tsx가 Canvas.tsx로부터 usePan()의 isSpacePressed를 prop으로
 * 내려받아 skipDrag에 반영하는 것과 같은 목적을, 여러 파일에 흩어진 PDF 쪽 훅들에는
 * prop 전달 대신 store 하나로 대신한다).
 */
export function usePdfViewerPan(containerRef: RefObject<HTMLDivElement | null>) {
  const [isSpacePressed, setSpacePressed] = useState(false);
  const [isPanning, setPanning] = useState(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  // 스페이스바 상태 추적 — usePan.ts와 완전히 같은 로직(그 파일의 동일한 주석 참고).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        if (document.activeElement instanceof HTMLButtonElement) {
          e.preventDefault();
          document.activeElement.blur();
        }
        setSpacePressed(true);
        usePdfViewerStore.getState().setSpacePressed(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false);
        usePdfViewerStore.getState().setSpacePressed(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      usePdfViewerStore.getState().setSpacePressed(false);
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const shouldStartPan = (e: PointerEvent) => e.button === 1 || (e.button === 0 && isSpacePressed);

    const handlePointerDown = (e: PointerEvent) => {
      if (!shouldStartPan(e)) return;
      e.preventDefault();
      // 버그 수정: 이 이벤트가 계속 버블링해서 canvas/viewport/usePan.ts(메인 캔버스,
      // PdfViewerPanel이 canvas-root의 자식이라 이 pointerdown도 결국 거기까지
      // 올라간다)에도 닿으면, 거기서도 shouldStartPan이 똑같이 참이라 판단해 메인
      // 캔버스까지 같이 pan을 시작해버린다 — 두 pan이 동시에 setPointerCapture를
      // 다투면서 나중 것(canvas-root)이 이겨 이 PDF pan이 중간에 뺏기는 문제가 생긴다.
      // stopPropagation으로 여기서 완전히 끊는다(usePan.ts 쪽에도 방어적으로
      // `.pdf-viewer-panel` 제외 처리를 추가해뒀다 — 이 stopPropagation 하나에만
      // 기대지 않는다).
      e.stopPropagation();
      // 지금 편집 중인 오버레이 텍스트가 있으면 caret을 먼저 꺼서, 이후 스페이스바
      // auto-repeat이 그 텍스트에 문자로 입력되지 않게 한다(usePan.ts와 같은 이유).
      if (document.activeElement instanceof HTMLElement && document.activeElement.isContentEditable) {
        document.activeElement.blur();
      }
      setPanning(true);
      lastPoint.current = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!lastPoint.current) return;
      // 버그 방지: 다른 인터랙션 훅들과 동일한 이유(놓친 pointerup 때문에 capture가
      // 남아있는 상태를 e.buttons===0으로 감지)로 정리한다.
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
      usePdfViewerStore.getState().panBy(dx, dy);
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

  const cursor = isPanning ? 'grabbing' : isSpacePressed ? 'grab' : undefined;

  return { cursor, isPanning, isSpacePressed };
}
