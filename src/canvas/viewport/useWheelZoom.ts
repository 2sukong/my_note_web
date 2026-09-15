import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useViewportStore } from '../../store/viewportStore';

const ZOOM_SENSITIVITY = 0.0015;

/**
 * 마우스 휠로 캔버스를 조작한다.
 *
 * 요구사항(2026-09-15): 예전엔 Ctrl 여부와 무관하게 모든 휠 입력을 확대/축소로
 * 처리했다(트랙패드 핀치 제스처가 브라우저에서 ctrlKey+wheel로 오는 것도 그중
 * 하나로 자연스럽게 포함됐을 뿐). 이제는 PDF Reference Viewer(usePdfViewerZoom.ts)와
 * 같은 관례로 통일한다 — **Ctrl+휠일 때만** 커서 위치를 중심으로 확대/축소하고,
 * Ctrl 없는 일반 휠(트랙패드 두 손가락 스크롤 포함)은 화면에 보이는 페이지 위치를
 * 위/아래(그리고 좌/우)로 이동시킨다. panBy는 usePan.ts(Space+드래그)가 쓰는 것과
 * 같은 "화면 px만큼 그대로 이동" 함수라 새 유틸이 필요 없다. 부호는 일반적인 문서
 * 스크롤 관례를 따른다 — 아래로 스크롤(deltaY>0)하면 더 아래쪽 내용이 보여야
 * 하므로, 그만큼 콘텐츠 자체는 위로 밀려야 한다(panY 감소) → panBy(-deltaX, -deltaY).
 */
export function useWheelZoom(containerRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      // 버그 수정: Toolbar/PropertiesPanel(색상 피커 팝오버 포함)은 canvas-root의
      // DOM 자식이라 그 위에서 휠을 굴려도 이 native 리스너까지 이벤트가 올라온다.
      // 예전엔 무조건 preventDefault + zoom을 했기 때문에, 스타일 패널 안의 폰트
      // 크기 select나 색상 피커의 hue/opacity 슬라이더, 패널 자체의 overflow-y
      // 스크롤이 전부 "캔버스 확대/축소"로 가로채져서 전혀 스크롤되지 않는 버그가
      // 있었다. UI chrome(툴바/HUD/속성 패널) 위에서는 캔버스 줌에 전혀 관여하지
      // 않고 그대로 흘려보내 브라우저 기본 스크롤/드래그가 정상 동작하게 한다.
      //
      // 추가(2026-09): 같은 이유로 `.pdf-viewer-panel`(PDF Reference Viewer 전체 —
      // 필름스트립/스테이지 포함)도 제외했다. 원래 이 패널도 canvas-root의 DOM
      // 자식이라 이 리스너가 그대로 가로챘는데, 그러면 필름스트립을 마우스 휠로
      // 스크롤하려 해도 캔버스가 확대/축소돼버렸다(별개로 존재하던 버그). PDF 페이지
      // 자체의 Ctrl+휠 확대/일반 휠 이동은 usePdfViewerZoom.ts가 `.pdf-viewer-stage`에서
      // 전담한다(요구사항상 PDF 쪽 동작은 이번 변경과 무관하게 그대로 유지) — 여기서
      // 빠지지 않으면 두 로직이 동시에 반응해 서로 간섭한다.
      const target = e.target as HTMLElement | null;
      if (target?.closest('.canvas-toolbar, .canvas-hud, .properties-panel, .pdf-viewer-panel')) return;

      e.preventDefault();

      if (!e.ctrlKey) {
        useViewportStore.getState().panBy(-e.deltaX, -e.deltaY);
        return;
      }

      const { zoom, zoomAt } = useViewportStore.getState();
      const rect = el.getBoundingClientRect();
      const screenPoint = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };

      const nextZoom = zoom * Math.exp(-e.deltaY * ZOOM_SENSITIVITY);
      zoomAt(screenPoint, nextZoom);
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [containerRef]);
}
