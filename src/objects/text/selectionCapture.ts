/**
 * Phase 4: 사용자가 마우스로 텍스트를 드래그해 만든 브라우저 네이티브 selection을
 * "어떤 텍스트 객체의 어떤 줄에서, 몇 번째 글자부터 몇 번째 글자까지"로 분해한다.
 *
 * TextObjectView의 각 줄 div에는 data-object-id / data-line-id 속성이 붙어 있다.
 * Phase 8(부분 서식) 이전에는 한 줄 = 단일 텍스트 노드였지만, 지금은 여러 개의
 * <span>(run)으로 나뉘어 있을 수 있어서 Range 기반으로 오프셋을 계산한다(아래
 * offsetWithin 참고) — span 개수와 무관하게 항상 정확하다.
 */

export interface SelectionSegment {
  objectId: string;
  lineId: string;
  start: number;
  end: number;
}

/** div 시작부터 (container, containerOffset) 지점까지의 flat 문자 오프셋. domCaret.ts의
 * flatOffsetOf와 같은 기법 — Range.toString()이 그 사이 모든 텍스트 노드를 이어붙여
 * 주므로 컨테이너가 텍스트 노드든 엘리먼트든, span이 몇 개든 항상 정확하다. */
function offsetWithin(div: HTMLElement, container: Node, containerOffset: number): number {
  const range = document.createRange();
  range.selectNodeContents(div);
  range.setEnd(container, containerOffset);
  return range.toString().length;
}

/**
 * 현재 window.getSelection()을 줄 단위 세그먼트 배열로 변환한다.
 * 선택이 없거나(collapsed) 텍스트 줄 바깥이면 빈 배열을 반환한다.
 */
export function captureSelectionSegments(): SelectionSegment[] {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return [];

  const range = selection.getRangeAt(0);
  const lineDivs = Array.from(document.querySelectorAll<HTMLElement>('[data-line-id]'));
  if (lineDivs.length === 0) return [];

  const startDiv = lineDivs.find((d) => d.contains(range.startContainer));
  const endDiv = lineDivs.find((d) => d.contains(range.endContainer));
  if (!startDiv || !endDiv) return [];

  const startIdx = lineDivs.indexOf(startDiv);
  const endIdx = lineDivs.indexOf(endDiv);
  const loIdx = Math.min(startIdx, endIdx);
  const hiIdx = Math.max(startIdx, endIdx);

  const segments: SelectionSegment[] = [];
  for (let i = loIdx; i <= hiIdx; i++) {
    const div = lineDivs[i];
    const objectId = div.dataset.objectId;
    const lineId = div.dataset.lineId;
    if (!objectId || !lineId) continue;

    const text = div.textContent ?? '';
    let start = 0;
    let end = text.length;

    if (div === startDiv) {
      start = offsetWithin(div, range.startContainer, range.startOffset);
    }
    if (div === endDiv) {
      end = offsetWithin(div, range.endContainer, range.endOffset);
    }

    if (end > start) {
      segments.push({ objectId, lineId, start, end });
    }
  }
  return segments;
}

/** 하이라이트/주석을 만든 뒤 브라우저가 그려주는 파란 선택 음영을 지운다. */
export function clearNativeSelection(): void {
  const selection = window.getSelection();
  selection?.removeAllRanges();
}

export interface AnnotationSelectionSegment {
  objectId: string;
  lineId: string;
  annotationId: string;
  start: number;
  end: number;
}

/**
 * captureSelectionSegments()와 같은 목적이지만 대상이 "본문 줄(TextLine)"이 아니라
 * "Annotation 자기 자신의 텍스트"인 경우다. Annotation의 contentEditable div는
 * `data-line-id`가 아니라 `data-annotation-id`(+ data-object-id, data-owner-line-id)를
 * 들고 있어서 captureSelectionSegments의 `[data-line-id]` 질의와는 절대 겹치지 않는다
 * — 겹치면 본문 TextLine의 오프셋 체계로 잘못 해석돼 데이터가 깨진다.
 *
 * Annotation은 항상 "하나의 텍스트 노드"이므로(TextLine처럼 여러 줄에 걸친 세그먼트
 * 분해가 필요 없다) 결과도 항상 최대 1개(또는 없음)다.
 */
export function captureAnnotationSelection(): AnnotationSelectionSegment | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  const annotationDivs = Array.from(document.querySelectorAll<HTMLElement>('[data-annotation-id]'));
  const div = annotationDivs.find((d) => d.contains(range.startContainer) && d.contains(range.endContainer));
  if (!div) return null;

  const objectId = div.dataset.objectId;
  const lineId = div.dataset.ownerLineId;
  const annotationId = div.dataset.annotationId;
  if (!objectId || !lineId || !annotationId) return null;

  const text = div.textContent ?? '';
  const start = range.startContainer.nodeType === Node.TEXT_NODE ? range.startOffset : 0;
  const end = range.endContainer.nodeType === Node.TEXT_NODE ? range.endOffset : text.length;
  if (end <= start) return null;

  return { objectId, lineId, annotationId, start, end };
}
