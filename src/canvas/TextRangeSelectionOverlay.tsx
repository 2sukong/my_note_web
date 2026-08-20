import { useLayoutEffect, useState } from 'react';
import { useTextRangeStore } from '../store/textRangeStore';
import { useViewportStore } from '../store/viewportStore';
import { mergeClientRectsByLine, rangeForOffsets } from '../objects/text/domCaret';
import { clientToWorld } from '../utils/coords';

interface CommittedRect {
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** HighlightDragPreview.tsx의 findLineEl과 동일한 이유(StrictMode 안전한 data-* 조회)로
 * 이 파일에도 똑같이 둔다 — 두 컴포넌트는 각자 독립적으로 마운트/언마운트되므로 굳이
 * 공유 모듈로 뺄 필요가 없다. */
function findLineEl(objectId: string, lineId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-object-id="${objectId}"][data-line-id="${lineId}"]`);
}

/**
 * 요구사항(Ctrl+드래그로 비연속 다중 구간 선택): Ctrl을 누른 채 텍스트 편집 중 여러
 * 구간을 드래그해서 커밋하면(useTextRangeSelection.ts), 그 구간들은 더 이상 브라우저
 * 네이티브 선택(Chrome은 한 번에 range 하나만 지원)으로 표시되지 않는다 — 그래서
 * 직접 하이라이트를 그려서 "이 구간들도 함께 선택돼 있다"는 걸 시각적으로 보여준다.
 *
 * HighlightDragPreview.tsx와 완전히 같은 기법(rangeForOffsets + getClientRects, world
 * 좌표로 변환해 canvas-world의 형제로 렌더링)을 그대로 재사용한다 — 다만 대상은
 * textRangeStore.committedSegments이고 색은 하이라이트가 아니라 선택을 뜻하는 파란색이다.
 * 지금 드래그 중인(아직 커밋되지 않은) 구간은 브라우저 자체의 네이티브 파란 선택
 * 음영이 이미 보여주므로 여기서는 committedSegments만 그린다.
 */
export function TextRangeSelectionOverlay() {
  const committedSegments = useTextRangeStore((s) => s.committedSegments);
  const zoom = useViewportStore((s) => s.zoom);
  const panX = useViewportStore((s) => s.panX);
  const panY = useViewportStore((s) => s.panY);
  const [rects, setRects] = useState<CommittedRect[]>([]);

  useLayoutEffect(() => {
    if (committedSegments.length === 0) {
      setRects((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const viewport = { zoom, panX, panY };
    const next: CommittedRect[] = [];
    for (const seg of committedSegments) {
      const lineEl = findLineEl(seg.objectId, seg.lineId);
      if (!lineEl) continue;
      const textLen = lineEl.textContent?.length ?? 0;
      const start = Math.max(0, Math.min(seg.start, textLen));
      const end = Math.max(0, Math.min(seg.end, textLen));
      if (end <= start) continue;
      const range = rangeForOffsets(lineEl, start, end);
      if (!range) continue;
      const clientRects = mergeClientRectsByLine(range.getClientRects());
      for (let i = 0; i < clientRects.length; i++) {
        const r = clientRects[i];
        if (r.width <= 0 || r.height <= 0) continue;
        const topLeft = clientToWorld({ x: r.left, y: r.top }, viewport);
        next.push({
          key: `${seg.objectId}-${seg.lineId}-${start}-${end}-${i}`,
          left: topLeft.x,
          top: topLeft.y,
          width: r.width / zoom,
          height: r.height / zoom,
        });
      }
    }
    setRects(next);
  }, [committedSegments, zoom, panX, panY]);

  if (rects.length === 0) return null;

  return (
    <>
      {rects.map((r) => (
        <div
          key={r.key}
          style={{
            position: 'absolute',
            left: r.left,
            top: r.top,
            width: r.width,
            height: r.height,
            // 브라우저 네이티브 선택 음영과 비슷한 톤(#4f8cff — 이 앱의 선택 강조색)으로
            // 맞춰서, 지금 드래그 중인(네이티브) 구간과 이미 커밋된 구간이 시각적으로
            // 같은 "선택됨" 의미로 읽히게 한다.
            background: 'rgba(79, 140, 255, 0.35)',
            pointerEvents: 'none',
            zIndex: 9997, // HighlightDragPreview.tsx와 같은 층 — 동시에 보일 일이 없어 충돌하지 않는다.
          }}
        />
      ))}
    </>
  );
}
