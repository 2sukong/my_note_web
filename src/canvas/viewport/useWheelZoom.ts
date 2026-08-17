import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useViewportStore } from '../../store/viewportStore';

const ZOOM_SENSITIVITY = 0.0015;

/**
 * 마우스 휠로 확대/축소한다. 항상 커서 위치를 중심으로 확대/축소되도록
 * viewportStore.zoomAt에 현재 화면(screen) 좌표를 그대로 넘긴다.
 *
 * ctrlKey(트랙패드 핀치 제스처는 브라우저가 ctrlKey+wheel로 보낸다)와
 * 일반 마우스 휠을 모두 zoom으로 처리한다.
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
      const target = e.target as HTMLElement | null;
      if (target?.closest('.canvas-toolbar, .canvas-hud, .properties-panel')) return;

      e.preventDefault();

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
