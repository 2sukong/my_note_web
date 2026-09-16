import { useEffect } from 'react';
import type { RefObject } from 'react';
import { usePdfViewerStore } from '../../store/pdfViewerStore';

const ZOOM_SENSITIVITY = 0.0015; // canvas/viewport/useWheelZoom.ts와 같은 민감도(같은 손맛 유지).

/**
 * 요구사항(2026-09, "마우스를 PDF 위에 올린 채 Ctrl+스크롤 시 PDF 화면이 확대"):
 * useWheelZoom.ts(메인 캔버스 줌)와 완전히 같은 지수 감쇠 계산을 쓰되, 대상은
 * viewportStore.zoom이 아니라 pdfViewerStore.pageZoom이다.
 *
 * 요구사항 변경(2026-09-16, "PDF 이동을 SPACE+드래그로"): 예전엔 Ctrl 없는 일반 휠을
 * 여기서 그냥 흘려보내 `.pdf-viewer-stage`의 네이티브 스크롤(overflow:auto)이 패닝을
 * 대신했는데, 그 방식엔 "오른쪽으로만 이동되고 왼쪽으로는 안 되는" 방향성 버그가 있었다
 * (canvas/pdf/usePdfViewerPan.ts 상단 주석 참고 — transform:scale된 flex-중앙정렬
 * 요소의 스크롤 오버플로가 좌우 비대칭으로 계산되는 크로스 브라우저 공통 결함). 이제
 * `.pdf-viewer-stage`는 overflow:hidden으로 바뀌었고(PdfViewerPanel.css) 이동은 전부
 * pdfViewerStore.panBy(usePdfViewerPan.ts의 Space+드래그와 동일한 액션)로 처리한다 —
 * useWheelZoom.ts(메인 캔버스)가 Ctrl 없는 휠을 panBy로 처리하는 것과 완전히 같은 관례.
 *
 * containerRef는 `.pdf-viewer-stage`(페이지를 감싸는 영역) — 페이지 이미지 자체
 * (pageRef)가 아니라 이 스테이지에 붙여야, 페이지 주변 여백 위에서 휠을 굴려도 반응한다.
 */
export function usePdfViewerZoom(containerRef: RefObject<HTMLDivElement | null>, pageWidth: number) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      const { pageZoom, setPageZoom, panBy } = usePdfViewerStore.getState();

      if (!e.ctrlKey) {
        panBy(-e.deltaX, -e.deltaY);
        return;
      }

      const nextZoom = pageZoom * Math.exp(-e.deltaY * ZOOM_SENSITIVITY);
      setPageZoom(nextZoom);
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
    // 버그 수정(2026-09, Ctrl+스크롤이 아무 반응 없던 문제): PdfViewerPanel.tsx는
    // `if (!mounted || !displayRecordRef.current) return null;`로 hooks 호출부보다
    // *뒤에서* 조건부로 null을 반환한다 — 즉 이 컴포넌트의 첫 마운트(PDF를 아직 하나도
    // 안 열었을 때, mounted===false)에도 이 훅은 정상적으로 호출되지만, 그 시점엔 아직
    // `.pdf-viewer-stage`(containerRef가 가리키는 실제 DOM)가 렌더링되지 않아
    // containerRef.current가 null이라 위 effect가 아무 것도 못 붙이고 조기 종료된다.
    // deps가 containerRef(useRef 객체 자신, 항상 같은 참조)뿐이면 React는 "다시 실행할
    // 필요 없음"으로 보고, 나중에 PDF를 열어 실제로 스테이지 DOM이 생겨도 이 effect가
    // 다시 실행되지 않아 리스너가 영원히 안 붙는다. 다른 PDF 오버레이 훅들
    // (useOverlayHighlightTool.ts 등)이 전부 pageWidth/pageHeight를 매개변수로 받아
    // deps에 넣는 것과 같은 이유로, pageWidth를 deps에 추가해 "0(닫힘) → 실제 값(페이지
    // 로드됨)"으로 바뀔 때 effect가 다시 실행되며 그때는 containerRef.current가 이미
    // 채워져 있어 정상적으로 리스너가 붙는다.
  }, [containerRef, pageWidth]);
}
