import { useMarqueeStore } from '../store/marqueeStore';
import { useViewportStore } from '../store/viewportStore';
import { normalizeRect } from './selection';

/**
 * Phase 7: useMarqueeSelect.ts가 드래그 중 갱신하는 marqueeStore를 구독해서
 * 현재 영역 선택 사각형을 그린다. DrawPreview.tsx와 같은 원리로 canvas-world 안에
 * 렌더링되어 pan/zoom transform을 그대로 상속받는다(world 좌표를 그대로 CSS
 * left/top/width/height로 써도 되는 이유).
 */
export function MarqueeOverlay() {
  const draft = useMarqueeStore((s) => s.draft);
  const zoom = useViewportStore((s) => s.zoom);

  if (!draft) return null;

  const rect = normalizeRect(draft.start, draft.current);
  const borderWidth = 1 / zoom;

  return (
    <div
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        border: `${borderWidth}px solid #4f8cff`,
        background: 'rgba(79, 140, 255, 0.12)',
        pointerEvents: 'none',
        zIndex: 9998, // SelectionOverlay(9999) 바로 아래.
      }}
    />
  );
}
