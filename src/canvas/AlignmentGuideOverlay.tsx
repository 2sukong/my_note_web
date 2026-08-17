import { useAlignmentGuideStore } from '../store/alignmentGuideStore';
import { useViewportStore } from '../store/viewportStore';

const GUIDE_COLOR = '#f5c518'; // 노란색(요구사항 명시).

/**
 * 요구사항(정렬 가이드): alignmentGuideStore에 쌓인 가이드선(objects/align/
 * smartGuides.ts의 GuideLine — 세로/가로선뿐 아니라 정사각형 표시용 대각선도 있다)을
 * 그린다. DrawPreview.tsx/MarqueeOverlay.tsx와 같은 위치(canvas-world 안)에
 * 렌더링되어 pan/zoom transform을 그대로 상속받으므로 world 좌표를 그대로 SVG
 * 좌표로 쓴다. 세로/가로/대각선을 굳이 div(border)와 svg로 나누지 않고 <line> 하나로
 * 통일했다 — 대각선은 CSS border만으로 표현하기 까다롭기 때문. 두께만 화면 기준 1px로
 * 항상 일정하게 보이도록 1/zoom을 곱한다(MarqueeOverlay의 borderWidth와 동일한 관례).
 */
export function AlignmentGuideOverlay() {
  const lines = useAlignmentGuideStore((s) => s.lines);
  const zoom = useViewportStore((s) => s.zoom);

  if (lines.length === 0) return null;

  const thickness = 1 / zoom;
  const dash = `${3 / zoom} ${3 / zoom}`;

  return (
    <svg
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        overflow: 'visible',
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    >
      {lines.map((line) => (
        <line
          key={line.id}
          x1={line.x1}
          y1={line.y1}
          x2={line.x2}
          y2={line.y2}
          stroke={GUIDE_COLOR}
          strokeWidth={thickness}
          strokeDasharray={dash}
        />
      ))}
    </svg>
  );
}
