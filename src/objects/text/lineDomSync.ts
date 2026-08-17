import type { TextRun } from './indentation/types';

/** color/fontSize/fontFamily/bold 중 아무것도 설정되지 않은 run — 부모(줄 컨테이너)의
 * 기본 스타일을 그대로 상속하는 "평범한" run이다. */
function isPlainRun(run: TextRun): boolean {
  return !run.color && !run.fontSize && !run.fontFamily && !run.bold;
}

/** 줄 전체가 "스타일 없는 run 하나(또는 0개)"뿐이라 <span>으로 감쌀 필요가 없는지.
 * 절대다수의 평범한 줄이 여기 해당한다 — 이 경우 브라우저가 직접 관리하는 raw
 * 텍스트 노드를 그대로 둬서, 매 키 입력마다 <span>으로 다시 감싸느라 캐럿을
 * 흔드는 일을 막는다(핵심 최적화, 기존 Phase 3 단일 텍스트 노드 동작과 동일). */
function isPlainWhole(runs: TextRun[]): boolean {
  return runs.length === 0 || (runs.length === 1 && isPlainRun(runs[0]));
}

/** 스타일 필드만으로 만든 지문 — DOM에 이미 반영된 span과 store의 run이 같은지
 * 비교하는 데 쓴다(텍스트/구조가 같아도 스타일이 바뀌었으면 다시 그려야 하므로). */
function runSignature(run: TextRun): string {
  return `${run.color ?? ''}|${run.fontSize ?? ''}|${run.fontFamily ?? ''}|${run.bold ? 1 : 0}`;
}

/**
 * 문단(TextLine) 중간의 자동 줄바꿈된 행 위에 주석 여백을 확보하기 위해 끼워 넣는
 * 투명 spacer 하나의 명세. offset은 이 줄의 runs를 이어붙인 flat 문자열 기준
 * 삽입 지점(반드시 0보다 커야 한다 — 0이면 문단 맨 앞이라 기존 padding-top으로
 * 처리되므로 여기 올 일이 없다: TextObjectView.tsx의 annotationSpacerSpecs 참고).
 * heightPx는 "이 행의 자연스러운 높이 + 주석이 필요로 하는 추가 여백"을 합친 총
 * 높이다(자연스러운 행 높이보다 작으면 line-box가 커지지 않아 여백이 전혀 안
 * 생기므로 반드시 합산된 값이어야 한다).
 */
export interface AnnotationSpacerSpec {
  offset: number;
  heightPx: number;
  annotationId: string;
}

type LineSegment =
  | { kind: 'text'; runIndex: number; text: string; sig: string }
  | { kind: 'spacer'; annotationId: string; heightPx: number };

/**
 * runs + spacer 명세로부터 "최종적으로 DOM에 그려야 할 조각들"의 순서 있는 목록을
 * 만든다. spacer가 run 텍스트 중간에 걸리면 그 run을 두 조각으로 쪼개고(둘 다 같은
 * runIndex를 공유), 사이에 spacer 조각을 끼운다. lineDomMatchesRuns/renderRunsIntoDom이
 * 이 함수 하나를 공유해서, "무엇을 그려야 하는가"의 판단이 한 곳에만 있다 — DOM을
 * 다시 읽어서 오프셋을 추정하는 로직은 어디에도 없다(오프셋 드리프트의 근본 원인이었음).
 */
function buildSegments(runs: TextRun[], spacers: AnnotationSpacerSpec[]): LineSegment[] {
  if (spacers.length === 0) {
    return runs.map((run, runIndex) => ({ kind: 'text', runIndex, text: run.text, sig: runSignature(run) }));
  }
  const sorted = [...spacers].sort((a, b) => a.offset - b.offset);
  const segments: LineSegment[] = [];
  let cursor = 0;
  let spacerIdx = 0;
  for (let runIndex = 0; runIndex < runs.length; runIndex++) {
    const run = runs[runIndex];
    const sig = runSignature(run);
    let textStart = 0;
    while (spacerIdx < sorted.length && sorted[spacerIdx].offset > cursor && sorted[spacerIdx].offset <= cursor + run.text.length) {
      const localOffset = sorted[spacerIdx].offset - cursor;
      const before = run.text.slice(textStart, localOffset);
      if (before) segments.push({ kind: 'text', runIndex, text: before, sig });
      segments.push({ kind: 'spacer', annotationId: sorted[spacerIdx].annotationId, heightPx: sorted[spacerIdx].heightPx });
      textStart = localOffset;
      spacerIdx++;
    }
    const rest = run.text.slice(textStart);
    if (rest.length > 0 || textStart === 0) segments.push({ kind: 'text', runIndex, text: rest, sig });
    cursor += run.text.length;
  }
  // 줄 맨 끝(offset === 전체 길이)에 걸리는 드문 경우 — 남은 spacer를 뒤에 붙인다.
  while (spacerIdx < sorted.length) {
    segments.push({ kind: 'spacer', annotationId: sorted[spacerIdx].annotationId, heightPx: sorted[spacerIdx].heightPx });
    spacerIdx++;
  }
  return segments;
}

/**
 * el(줄 div)의 현재 DOM 자식이 runs+spacers와 구조적으로 완전히 같은지 검사한다.
 * true면 DOM을 전혀 건드리지 않아도 된다는 뜻 — 캐럿 위치/IME 조합 상태가 보존된다.
 * TextObjectView.tsx의 layout effect가 매 렌더마다 이 함수로 먼저 확인한 뒤,
 * 다를 때만 renderRunsIntoDom을 호출한다.
 */
export function lineDomMatchesRuns(el: HTMLElement, runs: TextRun[], spacers: AnnotationSpacerSpec[] = []): boolean {
  if (spacers.length === 0 && isPlainWhole(runs)) {
    const flat = runs.length === 0 ? '' : runs[0].text;
    return el.children.length === 0 && el.textContent === flat;
  }
  const segments = buildSegments(runs, spacers);
  const children = el.children;
  if (children.length !== segments.length) return false;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const child = children[i] as HTMLElement;
    if (child.tagName !== 'SPAN') return false;
    if (seg.kind === 'spacer') {
      if (child.dataset.annotationSpacer !== '1') return false;
      if (child.dataset.spacerFor !== seg.annotationId) return false;
      const h = parseFloat(child.dataset.spacerHeight ?? '');
      if (!Number.isFinite(h) || Math.abs(h - seg.heightPx) > 0.5) return false;
    } else {
      if (child.dataset.annotationSpacer) return false;
      if (child.textContent !== seg.text) return false;
      if (child.dataset.runSig !== seg.sig) return false;
      if (child.dataset.runIndex !== String(seg.runIndex)) return false;
    }
  }
  return true;
}

/**
 * runs+spacers 그대로 el의 자식을 다시 그린다 — lineDomMatchesRuns가 false일 때만
 * 호출해야 한다(구조/스타일/spacer가 실제로 바뀐 경우에만; 캐럿을 흔들 수 있으므로
 * 불필요한 호출은 피해야 한다). spacer는 폭 0, 텍스트 없음, contentEditable=false인
 * <span>으로 렌더링되고 vertical-align:bottom + height로 그 줄의 line-box를
 * 위로 부풀린다 — 텍스트 노드가 아니므로 getCaretOffset/rangeForOffsets 등 기존의
 * "flat 문자 오프셋" 계산에 전혀 개입하지 않는다(항상 빈 문자열 취급).
 */
export function renderRunsIntoDom(el: HTMLElement, runs: TextRun[], spacers: AnnotationSpacerSpec[] = []): void {
  if (spacers.length === 0 && isPlainWhole(runs)) {
    el.textContent = runs.length === 0 ? '' : runs[0].text;
    return;
  }
  const segments = buildSegments(runs, spacers);
  const nodes = segments.map((seg) => {
    const span = document.createElement('span');
    if (seg.kind === 'spacer') {
      span.dataset.annotationSpacer = '1';
      span.dataset.spacerFor = seg.annotationId;
      span.dataset.spacerHeight = String(seg.heightPx);
      span.contentEditable = 'false';
      span.setAttribute('aria-hidden', 'true');
      span.style.display = 'inline-block';
      span.style.width = '0';
      span.style.height = `${seg.heightPx}px`;
      span.style.verticalAlign = 'bottom';
      span.style.pointerEvents = 'none';
      return span;
    }
    const run = runs[seg.runIndex];
    span.textContent = seg.text;
    span.dataset.runIndex = String(seg.runIndex);
    span.dataset.runSig = seg.sig;
    if (run.color) span.style.color = run.color;
    if (run.fontSize) span.style.fontSize = `${run.fontSize}px`;
    if (run.fontFamily) span.style.fontFamily = run.fontFamily;
    if (run.bold) span.style.fontWeight = '700';
    return span;
  });
  el.replaceChildren(...nodes);
}

/**
 * el(줄 div)의 현재 span 구조를 읽어 store에 반영할 runs 배열로 되돌린다 — 타이핑처럼
 * "이미 정해진 run 안에서 글자만 늘거나 준" 경우, 각 span의 스타일은 그대로 두고
 * 텍스트만 그 span이 가진 실제 값으로 갱신한다(renderRunsIntoDom과 정확히 대칭).
 * spacer(data-annotation-spacer)는 항상 건너뛴다 — 텍스트가 없는 순수 레이아웃용
 * 요소라 store에 반영될 내용이 없다. 같은 run이 spacer 때문에 두 조각(span)으로
 * 나뉘어 있을 수 있으므로 data-run-index로 그룹핑해서 원래 run의 텍스트로 합친다.
 * 구조를 신뢰할 수 없는 드문 경우(브라우저가 자체적으로 DOM을 바꿔버림)엔 안전하게
 * 단일 plain run(또는 빈 줄)으로 접어서 반환한다 — 스타일 정보를 잃더라도 텍스트
 * 자체가 깨지는 것보다는 낫다.
 */
export function readRunsFromDom(el: HTMLElement, fallbackRuns: TextRun[]): TextRun[] {
  if (el.children.length === 0) {
    const flat = el.textContent ?? '';
    return flat ? [{ text: flat }] : [];
  }
  const children = Array.from(el.children) as HTMLElement[];
  const textChildren = children.filter((c) => c.dataset.annotationSpacer !== '1');

  if (!children.some((c) => c.dataset.annotationSpacer === '1')) {
    if (children.length !== fallbackRuns.length || children.some((c) => c.tagName !== 'SPAN')) {
      const flat = el.textContent ?? '';
      return flat ? [{ text: flat }] : [];
    }
    return fallbackRuns
      .map((run, i) => ({ ...run, text: children[i].textContent ?? '' }))
      .filter((r) => r.text.length > 0);
  }

  if (textChildren.some((c) => c.tagName !== 'SPAN' || c.dataset.runIndex === undefined)) {
    const flat = textChildren.map((c) => c.textContent ?? '').join('');
    return flat ? [{ text: flat }] : [];
  }
  const byIndex = new Map<number, string>();
  for (const c of textChildren) {
    const idx = Number(c.dataset.runIndex);
    byIndex.set(idx, (byIndex.get(idx) ?? '') + (c.textContent ?? ''));
  }
  const maxIndex = Math.max(-1, ...Array.from(byIndex.keys()));
  if (maxIndex + 1 !== fallbackRuns.length) {
    const flat = textChildren.map((c) => c.textContent ?? '').join('');
    return flat ? [{ text: flat }] : [];
  }
  return fallbackRuns
    .map((run, i) => ({ ...run, text: byIndex.get(i) ?? '' }))
    .filter((r) => r.text.length > 0);
}
