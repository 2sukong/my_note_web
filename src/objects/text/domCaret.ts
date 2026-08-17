/**
 * contentEditable 줄 하나 안에서 커서/측정과 관련된 DOM 조작을 모아둔 헬퍼.
 * TextObjectView에서만 사용한다.
 *
 * Phase 8(부분 서식) 이전에는 "한 줄 = 단일 텍스트 노드"로 단순화돼 있었지만,
 * 드래그한 구간만 다른 스타일을 가질 수 있게 되면서 한 줄이 여러 개의 <span>(run)으로
 * 나뉘어 렌더링될 수 있다(TextObjectView.tsx의 DOM 동기화 로직 참고). 그래서 이
 * 파일의 모든 함수는 "줄 안의 여러 텍스트 노드를 순서대로 이어붙인 하나의 flat
 * 문자열"이라는 관점으로 오프셋을 다룬다 — span이 몇 개든 항상 같은 방식으로 동작한다.
 */

/**
 * lineEl 시작부터 (container, containerOffset) 지점까지의 flat 문자 오프셋을 구한다.
 * Range.setEnd는 텍스트 노드/엘리먼트 컨테이너를 모두 받아들이고, Range.toString()이
 * 그 사이의 모든 텍스트 노드를 문서 순서대로 이어붙여 주므로, span이 몇 개로 쪼개져
 * 있든 신경 쓸 필요가 없다 — 수동으로 DOM을 순회하는 것보다 훨씬 견고하다.
 */
function flatOffsetOf(lineEl: HTMLElement, container: Node, containerOffset: number): number {
  const range = document.createRange();
  range.selectNodeContents(lineEl);
  range.setEnd(container, containerOffset);
  return range.toString().length;
}

/** 현재 선택 영역이 lineEl 안에 있다면 그 flat 문자 오프셋을, 아니라면 줄 끝 오프셋을 반환한다. */
export function getCaretOffset(lineEl: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return lineEl.textContent?.length ?? 0;
  }
  const range = selection.getRangeAt(0);
  if (!lineEl.contains(range.startContainer)) {
    return lineEl.textContent?.length ?? 0;
  }
  return flatOffsetOf(lineEl, range.startContainer, range.startOffset);
}

/**
 * Phase 4(2차): 마우스 클릭 좌표(clientX/clientY) 아래에 있는 flat 문자 오프셋을 구한다.
 * "이 줄의 어떤 글자를 클릭했는가"를 알아야 그 글자가 하이라이트 안인지 판단할 수 있다
 * (하이라이트 rect 자체는 텍스트보다 아래에 그려져서 직접 pointer 이벤트를 받을 수
 * 없으므로, line div의 클릭 좌표에서 역으로 오프셋을 구하는 방식을 쓴다).
 * 브라우저마다 API 이름이 달라(Chromium 계열 vs Firefox) 둘 다 시도한다.
 */
export function caretOffsetFromPoint(lineEl: HTMLElement, clientX: number, clientY: number): number | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };

  if (typeof document.caretRangeFromPoint === 'function') {
    const range = document.caretRangeFromPoint(clientX, clientY);
    if (!range || !lineEl.contains(range.startContainer)) return null;
    return flatOffsetOf(lineEl, range.startContainer, range.startOffset);
  }
  if (typeof doc.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(clientX, clientY);
    if (!pos || !lineEl.contains(pos.offsetNode)) return null;
    return flatOffsetOf(lineEl, pos.offsetNode, pos.offset);
  }
  return null;
}

/**
 * lineEl 안의 모든 텍스트 노드를 문서 순서대로 이어붙였을 때 flatOffset번째 문자
 * 위치에 해당하는 실제 (텍스트 노드, 그 안에서의 로컬 offset)을 찾는다. run이 몇 개의
 * span으로 나뉘어 있든 이 함수 하나로 일관되게 처리한다 — focusLineAt/measureCharOffsetPx/
 * measureCharPointPx가 공유한다.
 */
function resolveTextPosition(root: HTMLElement, flatOffset: number): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  let remaining = flatOffset;
  let last: Text | null = null;
  while (node) {
    const len = node.textContent?.length ?? 0;
    if (remaining <= len) return { node, offset: Math.max(0, remaining) };
    remaining -= len;
    last = node;
    node = walker.nextNode() as Text | null;
  }
  if (last) return { node: last, offset: last.textContent?.length ?? 0 };
  return null;
}

/**
 * flat [start, end) 구간에 해당하는 Range를 만든다. TextObjectView.tsx의 하이라이트/
 * 주석 anchor 위치 측정이 이 Range의 getClientRects()/getBoundingClientRect()를
 * 그대로 쓴다 — run이 몇 개의 span으로 나뉘어 있든(부분 서식) 항상 정확하다. 두 끝이
 * 서로 다른 텍스트 노드(= 다른 span)에 있어도 Range는 문제없이 그 사이를 표현한다.
 */
export function rangeForOffsets(lineEl: HTMLElement, start: number, end: number): Range | null {
  const startPos = resolveTextPosition(lineEl, start);
  const endPos = resolveTextPosition(lineEl, end);
  if (!startPos || !endPos) return null;
  const range = document.createRange();
  range.setStart(startPos.node, startPos.offset);
  range.setEnd(endPos.node, endPos.offset);
  return range;
}

/** lineEl에 포커스를 주고 커서를 flat offset 위치로 이동시킨다. */
export function focusLineAt(lineEl: HTMLElement, offset: number): void {
  lineEl.focus();
  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  const pos = resolveTextPosition(lineEl, offset);
  if (pos) {
    range.setStart(pos.node, pos.offset);
  } else {
    range.setStart(lineEl, 0);
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * lineEl의 flat charIndex번째 문자가 시작하는 지점의 실제 화면 픽셀 위치를 측정해,
 * containerEl(텍스트 객체 wrapper) 좌상단 기준 상대 오프셋으로 변환하고 zoom으로 나눠
 * zoom=1 기준 절대 픽셀 값으로 정규화한다. IndentAnchor.offsetPx의 단위와 일치시키기 위함.
 */
export function measureCharOffsetPx(
  lineEl: HTMLElement,
  charIndex: number,
  containerEl: HTMLElement,
  zoom: number,
): number {
  const pos = resolveTextPosition(lineEl, charIndex);
  if (!pos) return 0;

  const range = document.createRange();
  range.setStart(pos.node, pos.offset);
  range.setEnd(pos.node, pos.offset);

  const rect = range.getBoundingClientRect();
  const containerRect = containerEl.getBoundingClientRect();
  // containerRect는 containerEl의 테두리 바깥 기준이라, 실제 줄(line div)들의 콘텐츠가
  // 시작되는 지점은 거기서 border-left-width + padding-left만큼 더 안쪽이다. 이 값을
  // 반환하는 offsetPx는 그 콘텐츠 시작점을 기준으로 한 "그 지점 대비 추가 들여쓰기"여야
  // 한다(anchor.offsetPx가 새 줄의 paddingLeft로 그대로 쓰이고, 그 줄 역시 이 컨테이너의
  // border/padding을 이미 한 번 적용받은 채로 렌더링되기 때문). 여기서 미리 빼주지
  // 않으면 컨테이너의 border/padding이 두 번(컨테이너 자체 한 번 + 새 줄의 paddingLeft
  // 한 번) 겹쳐 들어가서, 콜론 정렬로 만들어진 줄이 윗줄의 실제 글자 위치보다 오른쪽으로
  // 밀려 보이는 오차가 생긴다.
  const containerStyle = getComputedStyle(containerEl);
  const insetLeft = parseFloat(containerStyle.borderLeftWidth || '0') + parseFloat(containerStyle.paddingLeft || '0');
  return (rect.left - containerRect.left) / zoom - insetLeft;
}

/**
 * measureCharOffsetPx와 같은 원리로 x, y를 모두 측정한다.
 * Phase 4의 Annotation anchor 지점(화살표가 가리킬 지점) 계산에 사용한다.
 * containerEl 좌상단 기준 상대 좌표를 zoom으로 나눠 정규화해서 반환하므로,
 * 여기에 텍스트 객체의 world x/y를 더하면 그대로 world 좌표가 된다.
 */
export function measureCharPointPx(
  lineEl: HTMLElement,
  charIndex: number,
  containerEl: HTMLElement,
  zoom: number,
): { x: number; y: number } {
  const pos = resolveTextPosition(lineEl, charIndex);
  if (!pos) {
    const lineRect = lineEl.getBoundingClientRect();
    const containerRect = containerEl.getBoundingClientRect();
    return {
      x: (lineRect.left - containerRect.left) / zoom,
      y: (lineRect.top - containerRect.top) / zoom,
    };
  }

  const range = document.createRange();
  range.setStart(pos.node, pos.offset);
  range.setEnd(pos.node, pos.offset);

  const rect = range.getBoundingClientRect();
  const containerRect = containerEl.getBoundingClientRect();
  return {
    x: (rect.left - containerRect.left) / zoom,
    y: (rect.top - containerRect.top) / zoom,
  };
}
