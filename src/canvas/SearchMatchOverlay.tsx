import { useLayoutEffect, useState } from 'react';
import { useCanvasSearchStore } from '../store/canvasSearchStore';
import { useObjectsStore } from '../store/objectsStore';
import { useViewportStore } from '../store/viewportStore';
import { mergeClientRectsByLine, rangeForOffsets } from '../objects/text/domCaret';
import { clientToWorld } from '../utils/coords';
import { lineText } from '../objects/text/indentation/types';

interface MatchRect {
  key: string;
  left: number;
  top: number;
  width: number;
}

/** TextRangeSelectionOverlay.tsx의 findLineEl과 동일한 이유(StrictMode 안전한 data-*
 * 조회)로 이 파일에도 똑같이 둔다 — 세 컴포넌트는 각자 독립적으로 마운트/언마운트되므로
 * 굳이 공유 모듈로 뺄 필요가 없다. */
function findLineEl(objectId: string, lineId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-object-id="${objectId}"][data-line-id="${lineId}"]`);
}

/** text 안에서 query(대소문자 무시)와 일치하는 모든 [start, end) 구간을 찾는다.
 * 겹치지 않게 순서대로 스캔한다(예: "aa"를 "aaaa"에서 찾으면 [0,2],[2,4] — 일반적인
 * "모두 찾기" 동작과 동일). */
function findMatchRanges(text: string, query: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const lowerQuery = query.toLowerCase();
  if (!lowerQuery) return ranges;
  const lowerText = text.toLowerCase();
  let from = 0;
  for (;;) {
    const idx = lowerText.indexOf(lowerQuery, from);
    if (idx === -1) break;
    ranges.push([idx, idx + lowerQuery.length]);
    from = idx + lowerQuery.length;
  }
  return ranges;
}

/**
 * 요구사항(찾기 결과 강조, 2026-09-08): CanvasSearch.tsx에서 검색어를 입력하면 그
 * 검색어와 일치하는 부분을 캔버스 위 실제 텍스트에도 밑줄로 표시한다 — 하나의 텍스트
 * 상자 안에 검색어가 여러 번 나오면 전부(findMatchRanges가 줄 하나 안의 모든 occurrence를
 * 반환).
 *
 * TextRangeSelectionOverlay.tsx와 완전히 같은 기법(rangeForOffsets + getClientRects,
 * world 좌표로 변환해 canvas-world의 형제로 렌더링)을 재사용하되, 대상 range가 텍스트
 * 선택이 아니라 검색어 매치 위치라는 점만 다르다 — 매치는 이 컴포넌트 자체가
 * useObjectsStore.objects를 순회해서 찾아내므로(검색 결과 목록과 달리 이 컴포넌트는
 * CanvasSearch.tsx의 buildResults를 공유하지 않는다), Frame이 아니라 Text 객체만 대상.
 *
 * query는 CanvasSearch.tsx의 close()가 항상 query를 함께 비우므로(store 참고),
 * "검색창이 닫히면 밑줄도 사라진다"가 별도 처리 없이 자연스럽게 보장된다.
 */
export function SearchMatchOverlay() {
  const query = useCanvasSearchStore((s) => s.query);
  const objects = useObjectsStore((s) => s.objects);
  const zoom = useViewportStore((s) => s.zoom);
  const panX = useViewportStore((s) => s.panX);
  const panY = useViewportStore((s) => s.panY);
  const [rects, setRects] = useState<MatchRect[]>([]);

  useLayoutEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setRects((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const viewport = { zoom, panX, panY };
    const next: MatchRect[] = [];
    for (const object of Object.values(objects)) {
      if (object.type !== 'text') continue;
      for (const line of object.lines) {
        const matches = findMatchRanges(lineText(line), trimmed);
        if (matches.length === 0) continue;
        const lineEl = findLineEl(object.id, line.id);
        if (!lineEl) continue;
        const textLen = lineEl.textContent?.length ?? 0;
        for (const [start, end] of matches) {
          const s = Math.max(0, Math.min(start, textLen));
          const e = Math.max(0, Math.min(end, textLen));
          if (e <= s) continue;
          const range = rangeForOffsets(lineEl, s, e);
          if (!range) continue;
          const clientRects = mergeClientRectsByLine(range.getClientRects());
          for (let i = 0; i < clientRects.length; i++) {
            const r = clientRects[i];
            if (r.width <= 0 || r.height <= 0) continue;
            // 밑줄은 이 글자 rect의 "바로 아래"(바닥 모서리)에 그린다 — clientToWorld는
            // 선형 변환(translate+scale)이라 바닥 모서리 좌표도 top-left와 같은
            // 방식으로 구할 수 있다(top-left world 좌표 + 글자 높이/zoom).
            const topLeft = clientToWorld({ x: r.left, y: r.top }, viewport);
            next.push({
              key: `${object.id}-${line.id}-${s}-${e}-${i}`,
              left: topLeft.x,
              top: topLeft.y + r.height / zoom,
              width: r.width / zoom,
            });
          }
        }
      }
    }
    setRects(next);
  }, [query, objects, zoom, panX, panY]);

  if (rects.length === 0) return null;

  return (
    <>
      {rects.map((r) => (
        <div
          key={r.key}
          style={{
            position: 'absolute',
            left: r.left,
            // 2px(화면 기준, zoom으로 나눠 world 단위로 환산) 두께의 밑줄이 글자
            // 바로 아래에 오도록 top을 살짝 위로 당긴다.
            top: r.top - 1.5 / zoom,
            width: r.width,
            height: 3 / zoom,
            background: '#ff8f00',
            borderRadius: 999,
            pointerEvents: 'none',
            zIndex: 9997, // TextRangeSelectionOverlay.tsx와 같은 층 — 검색 중엔 텍스트 구간 선택과
            // 동시에 보일 일이 없어 충돌하지 않는다.
          }}
        />
      ))}
    </>
  );
}
