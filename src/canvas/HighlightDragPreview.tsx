import { useLayoutEffect, useState } from 'react';
import { useHighlightDragStore } from '../store/highlightDragStore';
import { useToolStore } from '../store/toolStore';
import { useViewportStore } from '../store/viewportStore';
import { mergeClientRectsByLine, rangeForOffsets } from '../objects/text/domCaret';
import { highlightBackgroundFor } from '../objects/text/highlightColors';
import { clientToWorld } from '../utils/coords';

interface PreviewRect {
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** data-object-id/data-line-id로 실제 줄 DOM을 직접 찾는다 — selectionCapture.ts의
 * captureSelectionSegments()가 쓰는 것과 정확히 같은 조회 방식이다(재사용).
 * 처음엔 objects/text/lineDomRegistry.ts의 ref 기반 조회를 썼는데, React
 * StrictMode(개발 모드)가 effect를 "사라짐→나타남"으로 시뮬레이션하는 동안 실제
 * DOM은 그대로인데도 그 레지스트리만 일시적으로 비어(unregister→register가 매우
 * 빠르게 반복) 드래그 중 하이라이트가 깜빡이며 안 보이는 문제가 있었다 —
 * data-* 속성 조회는 그 시뮬레이션과 무관하게 항상 실제 DOM 상태를 반영해서
 * 이 문제가 없다. */
function findLineEl(objectId: string, lineId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-object-id="${objectId}"][data-line-id="${lineId}"]`);
}

/** findLineEl과 같은 이유(StrictMode 안전한 data-* 조회)로, Annotation 자기 자신의
 * contentEditable div를 찾는다. annotationId는 crypto.randomUUID()라 이 속성 하나만
 * 으로 문서 전체에서 유일하게 찾긴다(objects/text/AnnotationBubble.tsx의 textElRef). */
function findAnnotationEl(annotationId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-annotation-id="${annotationId}"]`);
}

/**
 * 요구사항(형광펜 실시간 드래그): 형광펜 도구로 드래그하는 동안 손을 떼기 전에도
 * 실시간으로 색이 칠해지도록 한다. useTextSelectionTools.ts가 드래그 중
 * selectionchange마다 highlightDragStore에 현재 구간을 기록하면, 이 컴포넌트가
 * 그 구간을 실제 하이라이트와 똑같은 방식(rangeForOffsets + getClientRects,
 * TextObjectView.tsx의 committed highlight 렌더링과 동일한 기법)으로 그린다.
 *
 * TextObjectView 내부가 아니라 canvas-world의 형제 컴포넌트로 분리한 이유: 드래그
 * 구간이 여러 텍스트 객체/줄에 걸칠 수 있고(selectionCapture.ts 참고), 아직
 * objectsStore에 커밋되지 않은 상태라 특정 TextObjectView 하나의 렌더링에 묶을 수
 * 없기 때문이다. DrawPreview.tsx/MarqueeOverlay.tsx와 같은 위치(canvas-world 안)에
 * 렌더링된다.
 */
export function HighlightDragPreview() {
  const segments = useHighlightDragStore((s) => s.segments);
  const annotationSegment = useHighlightDragStore((s) => s.annotationSegment);
  const highlightColor = useToolStore((s) => s.highlightColor);
  const eraserActive = useToolStore((s) => s.highlightEraserActive);
  const zoom = useViewportStore((s) => s.zoom);
  const panX = useViewportStore((s) => s.panX);
  const panY = useViewportStore((s) => s.panY);
  const [rects, setRects] = useState<PreviewRect[]>([]);

  useLayoutEffect(() => {
    if (segments.length === 0 && !annotationSegment) {
      setRects((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const viewport = { zoom, panX, panY };
    const next: PreviewRect[] = [];
    for (const seg of segments) {
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
    // 요구사항(주석 자기 자신의 텍스트도 본문과 동일하게 실시간 미리보기): 위 본문
    // segments와 원리는 완전히 같고, 대상 DOM만 findAnnotationEl로 바뀐다.
    if (annotationSegment) {
      const el = findAnnotationEl(annotationSegment.annotationId);
      const textLen = el?.textContent?.length ?? 0;
      const start = Math.max(0, Math.min(annotationSegment.start, textLen));
      const end = Math.max(0, Math.min(annotationSegment.end, textLen));
      const range = el && end > start ? rangeForOffsets(el, start, end) : null;
      if (range) {
        const clientRects = mergeClientRectsByLine(range.getClientRects());
        for (let i = 0; i < clientRects.length; i++) {
          const r = clientRects[i];
          if (r.width <= 0 || r.height <= 0) continue;
          const topLeft = clientToWorld({ x: r.left, y: r.top }, viewport);
          next.push({
            key: `${annotationSegment.annotationId}-${start}-${end}-${i}`,
            left: topLeft.x,
            top: topLeft.y,
            width: r.width / zoom,
            height: r.height / zoom,
          });
        }
      }
    }
    setRects(next);
  }, [segments, annotationSegment, zoom, panX, panY]);

  if (rects.length === 0) return null;

  // 요구사항(형광펜 지우개): 지우개 모드로 드래그하는 동안은 "칠해질 색"이 아니라
  // "지워질 자리"라는 걸 구분할 수 있게, 형광펜 색 대신 옅은 회색 빗금(지움 표시)
  // + 점선 테두리로 그린다.
  const background = eraserActive ? 'rgba(120, 120, 120, 0.22)' : highlightBackgroundFor(highlightColor);
  const eraserPattern = eraserActive
    ? 'repeating-linear-gradient(135deg, rgba(90, 90, 90, 0.35) 0, rgba(90, 90, 90, 0.35) 1.5px, transparent 1.5px, transparent 6px)'
    : undefined;

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
            background: eraserPattern ? `${eraserPattern}, ${background}` : background,
            // TextObjectView.tsx의 커밋된 highlight와 동일한 알약 모양(borderRadius:
            // r.height/2) — 드래그 중과 손을 뗀 직후의 모양이 어긋나 보이지 않도록.
            borderRadius: r.height / 2,
            outline: eraserActive ? '1.5px dashed rgba(90, 90, 90, 0.7)' : 'none',
            outlineOffset: -1.5,
            pointerEvents: 'none',
            // 커밋된 highlight는 그 텍스트 객체 자신의 스택 컨텍스트 안에서 글자보다
            // "뒤"에 그려지지만(TextObjectView.tsx), 이 프리뷰는 모든 객체의 형제라서
            // 그 방식을 그대로 쓸 수 없다 — 대신 항상 최상단에 반투명으로 그린다.
            // 색 자체가 이미 옅은 alpha(0.3~0.45)라 글자 위에 겹쳐도 읽는 데 지장이
            // 없고, 손을 떼는 순간 실제 커밋된(글자 뒤에 그려지는) highlight로
            // 즉시 바뀌므로 그 짧은 드래그 동안만 보이는 차이다.
            zIndex: 9997, // MarqueeOverlay(9998)/SelectionOverlay(9999) 바로 아래.
          }}
        />
      ))}
    </>
  );
}
