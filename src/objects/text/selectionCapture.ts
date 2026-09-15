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

/**
 * 요구사항(주석 생성 UX 변경, 2026-09-15): 기존엔 텍스트를 드래그해서 만든 selection
 * (captureSelectionSegments)이 있어야만 주석을 만들 수 있었는데, "텍스트를 클릭하면
 * 그 위에 주석이 생성"되도록 바뀐다 — 드래그 없이 클릭 한 번(=collapsed selection)만
 * 있어도, 그 클릭 좌표 "아래에 있는 단어" 하나를 찾아 앵커로 쓸 수 있어야 한다.
 * 브라우저 selection API에는 "이 좌표가 속한 단어"를 바로 구하는 기능이 없어서:
 * 1) caretRangeFromPoint/caretPositionFromPoint로 그 좌표의 caret 위치(어떤 DOM
 *    노드의 몇 번째 글자인지)를 얻고,
 * 2) offsetWithin으로 그 caret을 줄(div) 기준 flat 오프셋으로 바꾼 뒤,
 * 3) wordBoundsAt으로 그 오프셋을 감싸는 단어의 [start,end) 경계를 계산한다.
 * 드래그 기반 captureSelectionSegments와 결과 타입(SelectionSegment)이 같으므로
 * 호출부(useTextSelectionTools.ts)에서 "드래그 선택이 있으면 그걸, 없으면 이 함수의
 * 결과를" 그대로 anchor로 바꿔 끼울 수 있다.
 */
export function captureWordAtPoint(clientX: number, clientY: number): SelectionSegment | null {
  const caret = caretPositionAt(clientX, clientY);
  if (!caret) return null;

  const lineDivs = Array.from(document.querySelectorAll<HTMLElement>('[data-line-id]'));
  const div = lineDivs.find((d) => d.contains(caret.node));
  if (!div) return null;

  const objectId = div.dataset.objectId;
  const lineId = div.dataset.lineId;
  if (!objectId || !lineId) return null;

  const text = div.textContent ?? '';
  if (text.length === 0) return null;

  const flatOffset = Math.min(offsetWithin(div, caret.node, caret.offset), text.length);
  const { start, end } = wordBoundsAt(text, flatOffset);
  if (end <= start) return null;

  return { objectId, lineId, start, end };
}

/** caretRangeFromPoint(Chrome/Safari/Edge)와 caretPositionFromPoint(Firefox 표준
 * 초안) 두 이름으로 갈라져 있어서 둘 다 시도한다. 어느 쪽도 없는 아주 오래된
 * 환경이면 null(클릭 위치를 알 수 없음 → 주석 생성 안 함)을 준다. */
function caretPositionAt(clientX: number, clientY: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(clientX, clientY);
    if (!range) return null;
    return { node: range.startContainer, offset: range.startOffset };
  }
  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(clientX, clientY);
    if (!pos) return null;
    return { node: pos.offsetNode, offset: pos.offset };
  }
  return null;
}

type WordSegment = { segment: string; index: number; isWordLike?: boolean };

/** flatOffset을 감싸는 "단어" 하나의 [start, end) 범위를 찾는다. Intl.Segmenter
 * (word 단위, 대부분의 최신 브라우저가 지원)를 쓸 수 있으면 한글/영문 모두 정확한
 * 단어 경계를 얻고, 클릭 지점이 공백/구두점 위라면 바로 오른쪽(없으면 왼쪽)의 실제
 * 단어로 넘어간다. Intl.Segmenter가 없는 환경에서는 공백 기준 폴백을 쓴다. */
function wordBoundsAt(text: string, flatOffset: number): { start: number; end: number } {
  const SegmenterCtor = (
    Intl as typeof Intl & {
      Segmenter?: new (locale?: string, opts?: { granularity: string }) => { segment: (s: string) => Iterable<WordSegment> };
    }
  ).Segmenter;

  if (SegmenterCtor) {
    const segments = Array.from(new SegmenterCtor(undefined, { granularity: 'word' }).segment(text));
    let hit = segments.find((s) => flatOffset >= s.index && flatOffset < s.index + s.segment.length);
    if (hit && !hit.isWordLike) {
      const hitIdx = segments.indexOf(hit);
      hit = segments.slice(hitIdx + 1).find((s) => s.isWordLike) ?? [...segments.slice(0, hitIdx)].reverse().find((s) => s.isWordLike);
    }
    if (!hit) return { start: 0, end: 0 };
    return { start: hit.index, end: hit.index + hit.segment.length };
  }

  const isSpace = (ch: string) => /\s/.test(ch);
  let i = flatOffset;
  if (i >= text.length || isSpace(text[i] ?? ' ')) {
    i -= 1;
    while (i >= 0 && isSpace(text[i])) i--;
    if (i < 0) return { start: 0, end: 0 };
  }
  let start = i;
  while (start > 0 && !isSpace(text[start - 1])) start--;
  let end = i + 1;
  while (end < text.length && !isSpace(text[end])) end++;
  return { start, end };
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
