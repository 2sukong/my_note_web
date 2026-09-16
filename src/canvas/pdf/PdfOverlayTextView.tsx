import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  CompositionEvent as ReactCompositionEvent,
  FocusEvent as ReactFocusEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import type { TextObject } from '../../types/object';
import type { TextLine } from '../../objects/text/indentation/types';
import { ROOT_ANCHOR, createLineId, lineText } from '../../objects/text/indentation/types';
import {
  mergeHighlightsForLineJoin,
  remapHighlightsForEdit,
  splitHighlightsAtOffset,
} from '../../objects/text/highlightModel';
import { focusLineAt, getCaretOffset, mergeClientRectsByLine, rangeForOffsets } from '../../objects/text/domCaret';
import { highlightBackgroundFor } from '../../objects/text/highlightColors';
import { useToolStore } from '../../store/toolStore';
import { usePdfViewerStore } from '../../store/pdfViewerStore';
import { usePdfOverlayStore } from '../../store/pdfOverlayStore';
import { usePdfOverlaySelectionStore } from '../../store/pdfOverlaySelectionStore';
import { PdfOverlayResizeHandles } from './PdfOverlayResizeHandles';
import { PDF_OVERLAY_ABSOLUTE_SIZE_CALIBRATION } from '../../objects/pdf/pdfRaster';

// objects/text/TextObjectView.tsx의 같은 이름 상수와 같은 값(32) — 리사이즈 핸들로
// 세로를 아무리 줄여도 이 아래로는 못 내려간다.
const MIN_TEXT_HEIGHT = 32;

/**
 * PDF 페이지 오버레이 위 Text 객체 하나(Phase 6, 2026-08). objects/text/TextObjectView.tsx
 * (1554줄, 메인 world-좌표/zoom 캔버스 전용, 여러 서식 span·콜론 들여쓰기·Frame 테마 등
 * 폭넓게 다룸)를 그대로 옮기지 않고, v3 §2-7 B안이 권한 대로 "필요한 로직만 새로
 * 구현"했다 — 다만 저장 데이터 형태(TextObject/TextLine/TextAnnotation)와 그 순수
 * 헬퍼(highlightModel.ts/domCaret.ts/indentation/types.ts)는 전부 그대로 재사용해서
 * objectsStore.ts와 100% 같은 데이터 계약을 지킨다.
 *
 * 버그 수정(2026-08, 한글 등 IME 조합 중 텍스트가 사라지는/엉뚱한 곳에 하이라이트가
 * 그어지는 문제): 처음 버전은 "한 줄 = 단일 run"이라 TextObjectView.tsx의 조합(IME)
 * 방어 로직(1116~1345줄 부근: isComposingRef + onCompositionStart/End +
 * "조합 중인 줄은 DOM↔store 동기화 effect가 절대 건드리지 않는다")을 생략했었다.
 * 그 결과: 조합 중에 이 컴포넌트가 어떤 이유로든 리렌더되면(예: 다른 줄 편집, 하이라이트
 * 추가 등으로 object.lines 참조가 바뀌면) DOM 동기화 effect가 "아직 조합 중이라 store에
 * 반영되지 않은" 줄의 textContent를 store의 (구버전) 값으로 강제로 덮어써서 방금 입력
 * 중이던 글자가 통째로 지워졌다 — Enter를 누르면 "줄이 나뉘는" 대신 텍스트 자체가
 * 사라진 것처럼 보이거나, 형광펜이 실제 글자가 아닌 위치를 잘못 잡는 증상으로 나타났다.
 * TextObjectView.tsx와 같은 방식(composingLineIdRef로 지금 조합 중인 줄 id를 추적해서
 * 동기화 effect가 그 줄만 건너뛰고, onCompositionStart/End로 조합 시작/끝을 명시적으로
 * 추적)으로 고쳤다. Enter/Backspace의 분할·병합 지점도 이제 store(lineText(line), 리렌더
 * 전이라 한 박자 늦을 수 있음)가 아니라 항상 살아있는 DOM(e.currentTarget.textContent)을
 * 기준으로 계산한다 — TextObjectView.tsx의 handleEnter 호출부(1177줄 부근, `fullText =
 * lineEl.textContent`)와 동일한 이유다.
 *
 * v1 범위로 의도적으로 줄인 것(추후 필요하면 확장 가능, 데이터는 이미 호환됨):
 * - 한 줄 = 단일 TextRun(굵기/색/폰트를 글자 단위로 다르게 줄 수 없음). 부분 서식
 *   툴바(useTextRangeSelection 연동)는 만들지 않았다.
 * - 콜론/글머리 자동 들여쓰기(anchorEngine의 root 외 트리거) 없음 — 모든 새 줄은
 *   ROOT_ANCHOR.
 * - 줄 사이 위/아래 화살표 이동, 여러 줄 걸친 선택 삭제/붙여쓰기 없음(각 줄이 독립된
 *   contentEditable이라 브라우저 기본 동작에 맡긴다).
 * - 주석(annotation) 기능 삭제(2026-09-16, "PDF에서 주석 사용 기능 삭제" 요구사항):
 *   한때 이 컴포넌트가 line.annotations를 PdfOverlayAnnotationNote로 렌더링했었지만
 *   (그 방식·이유는 이제 이 코드베이스에 없다), 버그가 많다는 피드백으로 렌더링과
 *   생성 진입점(canvas/pdf/useOverlayTextSelectionTools.ts)을 모두 없앴다. 데이터
 *   필드(line.annotations) 자체는 지우지 않아, 이전에 저장된 PDF의 주석은 화면에만
 *   안 보일 뿐 조용히 남아있다.
 *
 * 리사이즈(추가 Phase, 2026-09): 폭/높이 모두 8방향 핸들로 직접 조절할 수 있다
 * (PdfOverlayResizeHandles.tsx) — objects/text/TextObjectView.tsx의 자동 높이 로직
 * (manualHeight + "커지는 방향으로만" grow-only 규칙, 674줄 부근 상세 주석 참고)을
 * displayScale/pageHeight 기준으로 그대로 옮겨왔다(아래 자동 높이 effect). 다만 커스텀
 * 폰트 로딩 대기(hasPendingCustomFont) 가드는 뺐다 — 이 컴포넌트는 애초에
 * useFontStore를 구독하지 않고, document.fonts(전역 FontFace 레지스트리, fontStore.ts
 * 참고)에 폰트가 등록되기만 하면 커스텀 폰트라도 화면엔 정상 렌더링된다. 아직 로드되기
 * 전 아주 짧은 순간에 폴백 폰트 기준으로 한 번 측정될 수는 있지만, grow-only 규칙이
 * 뒤이은 재측정에서 알아서 보정하므로 실사용에 문제가 없다고 판단해 생략했다.
 *
 * 좌표계: 페이지 로컬 px(x/y/width/height, PDF_PAGE_REFERENCE_SCALE 기준)를 pageWidth/
 * pageHeight 대비 백분율로 변환해서 배치한다 — PdfOverlayHighlightLayer.tsx의 SVG
 * viewBox와 같은 목적을 CSS 퍼센트로 달성하는 것이라, 패널 리사이즈/창 크기 변화에
 * 자바스크립트 재계산 없이 저절로 따라간다. 다만 글자 크기(baseFontSize)는 퍼센트로
 * 표현할 수 없으므로 displayScale(부모 PdfOverlayObjectsLayer가 실측해서 내려주는,
 * "지금 화면에 실제로 그려지는 px 대 페이지 기준 px" 비율)을 곱해 실제 CSS px로 바꾼다.
 추가로
 * PDF_OVERLAY_ABSOLUTE_SIZE_CALIBRATION(pdfRaster.ts)을 한 번 더 곱한다 — 그 상수
 * 자체 주석 참고, 기본 Viewer 폭에서 메인 캔버스와 비슷한 글자 크기로 보이게 하는
 * 보정(2026-09).
 */
export function PdfOverlayTextView({
  object,
  pageWidth,
  pageHeight,
  displayScale,
}: {
  object: TextObject;
  pageWidth: number;
  pageHeight: number;
  displayScale: number;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  // 자동 높이 측정 전용 ref — 아래 자동 높이 effect가 wrapperRef(핸들까지 포함하는
  // 바깥 박스) 대신 이 안쪽 div(순수 텍스트 줄들만 담음)의 scrollHeight를 잰다.
  // 버그 수정(2026-09, "Maximum update depth exceeded" 무한 루프): 처음엔 wrapperRef를
  // 직접 측정했는데, PdfOverlayResizeHandles가 이 wrapperRef "안"에 함께 렌더링되고
  // (아래 return문 참고) 각 핸들의 top/left가 object.height(=screenHeight)에서 계산되므로,
  // "핸들이 박스 아래쪽 가장자리에 위치 → overflow:visible인 위치 기준 조상(wrapperRef)의
  // scrollHeight에 핸들 자신의 높이만큼 얹힘 → 자동 높이 effect가 그 커진 scrollHeight를
  // 다시 object.height로 반영 → 핸들이 더 아래로 내려가 앉음 → scrollHeight가 또 커짐"이
  // 매 렌더마다 반복되는 직접적인 피드백 루프였다(디버그 로그로 매 렌더 scrollHeight가
  // 정확히 고정폭만큼 계속 커지는 것을 확인). 핸들을 측정 대상 밖(contentRef 바깥)에
  // 두는 것으로 이 순환 자체를 끊는다.
  const contentRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pendingFocusRef = useRef<{ lineId: string; offset: number } | null>(null);
  // 버그 수정(IME 조합 중 텍스트 유실): 지금 한글 등으로 조합 중인 줄의 id.
  // TextObjectView.tsx의 isComposingRef와 같은 목적 — 아래 DOM↔store 동기화 effect가
  // 이 줄만은 절대 건드리지 않도록 막는다(조합 버퍼는 store가 알지 못하는 "DOM에만
  // 있는" 상태라, effect가 store 값으로 덮어쓰면 그대로 사라진다).
  const composingLineIdRef = useRef<string | null>(null);
  // 자동 높이 effect 전용 — TextObjectView.tsx의 lastMeasuredContentHeightRef와 같은
  // 목적(아래 자동 높이 effect 주석, 그리고 objects/text/TextObjectView.tsx의 같은
  // 이름 ref 선언부 주석 참고 — "직전에 측정한 콘텐츠 자체의 필요 높이" 기준선이지
  // object.height 자체가 아니다).
  const lastMeasuredContentHeightRef = useRef<number | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  const selectedId = usePdfOverlaySelectionStore((s) => s.selectedId);
  const editingId = usePdfOverlaySelectionStore((s) => s.editingId);
  const isSelected = selectedId === object.id;
  const isEditing = editingId === object.id;

  // 버그 수정(2026-08, 형광펜 생성용 드래그 선택이 전혀 안 되던 문제): 이 패널
  // (.pdf-viewer-panel)이 Canvas.tsx에서 .canvas-root의 자식으로 렌더링되기 때문에
  // (canvas/Canvas.css의 `.canvas-root { user-select: none; }`), 아무 것도 하지
  // 않으면 이 줄 div도 그 user-select:none을 그대로 물려받는다 — 그러면 'highlight'
  // 도구로 이 텍스트 위를 드래그해도 브라우저 네이티브 선택 자체가 아예 생기지
  // 않아서(captureSelectionSegments가 항상 빈 배열을 줌), 형광펜을 만들 방법이
  // 없었다(그 대신 페이지 배경용 직선 형광펜 훅이 대신 반응해서 "PDF 위인 것처럼"
  // 그어진 것처럼 보였다). 메인 캔버스의 TextObjectView.tsx(1451줄 부근 주석 참고)가
  // 정확히 같은 이유로 activeTool에 따라 user-select를 켜고 끄길래 같은 패턴을 그대로
  // 옮겼다 — 편집 중이 아니고 형광펜 도구가 켜져 있을 때만 네이티브 텍스트 선택을
  // 허용한다(select 도구일 땐 계속 user-select:none을 유지해야 드래그가 "객체 이동"으로
  // 동작한다). 요구사항(2026-09-16, "PDF에서 주석 사용 기능 삭제"): 예전엔 'annotation'
  // 도구도 여기 포함됐었지만, 주석 생성 자체가 없어졌으므로 뺐다 — 이제 주석 도구가
  // 켜진 채로 PDF 텍스트를 드래그해도 아무 네이티브 선택이 뜨지 않는다(select/text
  // 도구와 동일하게 취급).
  const activeTool = useToolStore((s) => s.activeTool);
  const allowNativeTextSelect = !isEditing && activeTool === 'highlight';

  const [highlightRectsByLine, setHighlightRectsByLine] = useState<
    Map<string, { id: string; color: string; left: number; top: number; width: number; height: number }[]>
  >(new Map());

  // DOM↔store 텍스트 동기화: 현재 DOM 내용이 store와 이미 같으면 손대지 않는다(타이핑
  // 도중 커서 위치가 흐트러지지 않도록 — objects/text/lineDomSync.ts와 같은 원칙을
  // "한 줄 = 단일 run"이라는 단순화된 상황에 맞게 최소한으로 구현한 버전). 지금 IME로
  // 조합 중인 줄(composingLineIdRef)은 절대 건드리지 않는다 — TextObjectView.tsx의
  // 동일 effect(447줄 부근)와 같은 이유.
  useLayoutEffect(() => {
    for (const line of object.lines) {
      if (composingLineIdRef.current === line.id) continue;
      const el = lineRefs.current.get(line.id);
      if (!el) continue;
      const expected = lineText(line);
      if (el.textContent !== expected) el.textContent = expected;
    }
  }, [object.lines]);

  // 하이라이트 rect 측정: TextObjectView.tsx의 같은 원리(Range.getClientRects → 줄
  // 컨테이너 기준 상대 좌표로 정규화 → mergeClientRectsByLine로 음절 사이 끊김 방지).
  // zoom 나눗셈이 필요 없다 — 이 컴포넌트엔애초에 world 확대/축소 변환이 없으므로
  // getBoundingClientRect가 이미 "실제 화면 배율"을 반영한 값을 그대로 준다.
  useLayoutEffect(() => {
    const next = new Map<
      string,
      { id: string; color: string; left: number; top: number; width: number; height: number }[]
    >();
    for (const line of object.lines) {
      if (!line.highlights || line.highlights.length === 0) continue;
      const el = lineRefs.current.get(line.id);
      if (!el) continue;
      const containerRect = el.getBoundingClientRect();
      const entries: { id: string; color: string; left: number; top: number; width: number; height: number }[] = [];
      for (const h of line.highlights) {
        const range = rangeForOffsets(el, h.start, h.end);
        if (!range) continue;
        for (const r of mergeClientRectsByLine(range.getClientRects())) {
          entries.push({
            id: h.id,
            color: h.color,
            left: r.left - containerRect.left,
            top: r.top - containerRect.top,
            width: r.width,
            height: r.height,
          });
        }
      }
      if (entries.length > 0) next.set(line.id, entries);
    }
    setHighlightRectsByLine(next);
  }, [object.lines, displayScale]);

  // 자동 높이(objects/text/TextObjectView.tsx의 같은 이름 effect와 100% 같은 규칙 —
  // 그쪽의 상세 주석 참고, 커스텀 폰트 대기 가드만 뺐다): 콘텐츠 자체가 직전에
  // 측정했던 기준선(lastMeasuredContentHeightRef)보다 실제로 더 커졌을 때만 키우고,
  // "지금 저장된 height"와 직접 비교하지 않는다 — contentEl은 overflow:visible이라
  // scrollHeight가 상자에 설정된 높이와 무관하게 항상 콘텐츠 전체 필요 높이를
  // 반환하므로, height와 직접 비교하면 사용자가 내용보다 작게 리사이즈해둔 상자를
  // 매 렌더/새로고침마다 무조건 다시 키워버린다(TextObjectView.tsx가 실제로 겪은
  // 회귀, 2026-09 커밋 6901e73). object.manualHeight는 "생성된 뒤 한 번도 수정된
  // 적 없는" 진짜 새 객체의 첫 측정에 한해서만(즉 manualHeight가 아직 false일 때만)
  // 줄어드는 값도 허용해서 실제 폰트 기준 자연스러운 초기 높이로 맞추는 예외에서만
  // 쓰인다.
  useLayoutEffect(() => {
    const contentEl = contentRef.current;
    if (!contentEl) return;
    // displayScale은 페이지 로컬 px ↔ 실제 화면 px 환산 비율이다 — scrollHeight는
    // 화면 px이므로 저장 단위(페이지 로컬 px)로 되돌리려면 나눠야 한다. contentEl은
    // 텍스트 줄만 담고 리사이즈 핸들은 담지 않는다(위 contentRef 선언부 주석 참고) —
    // 핸들까지 포함해 재는 순간 핸들 위치가 다시 이 값에 의존하는 순환이 생긴다.
    const measuredHeight = contentEl.scrollHeight / displayScale;
    const nextHeight = Math.max(MIN_TEXT_HEIGHT, measuredHeight);
    const isGenuinelyFreshObject = !object.manualHeight && object.createdAt === object.updatedAt;
    const baseline = lastMeasuredContentHeightRef.current;
    if (baseline === null) {
      lastMeasuredContentHeightRef.current = nextHeight;
      if (isGenuinelyFreshObject && Math.abs(nextHeight - object.height) > 0.5) {
        usePdfOverlayStore.getState().updateObject(object.id, { height: nextHeight }, `text:${object.id}`);
      }
    } else if (nextHeight - baseline > 0.5) {
      lastMeasuredContentHeightRef.current = nextHeight;
      if (nextHeight - object.height > 0.5) {
        usePdfOverlayStore.getState().updateObject(object.id, { height: nextHeight }, `text:${object.id}`);
      }
    } else if (nextHeight < baseline - 0.5) {
      lastMeasuredContentHeightRef.current = nextHeight;
    }
  }, [
    object.id,
    object.lines,
    object.width,
    object.height,
    object.baseFontSize,
    object.fontFamily,
    object.lineHeight,
    object.manualHeight,
    displayScale,
    isEditing,
  ]);

  // Enter로 줄을 나눈/Backspace로 합친 직후 새 커서 위치로 포커스를 옮긴다 — 대상 줄의
  // DOM이 이 렌더 이후에야 생기므로 useLayoutEffect에서 처리한다.
  useLayoutEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    const el = lineRefs.current.get(pending.lineId);
    if (el) {
      focusLineAt(el, pending.offset);
      pendingFocusRef.current = null;
    }
  }, [object.lines]);

  // 편집 모드로 막 들어왔으면(더블클릭) 마지막 줄 끝에 커서를 둔다 — 더블클릭 지점을
  // 정확히 보존하는 것보다 훨씬 단순하고, 실사용에서 충분히 자연스럽다(v1 스코프 축소).
  useEffect(() => {
    if (!isEditing) return;
    const lastLine = object.lines[object.lines.length - 1];
    const el = lineRefs.current.get(lastLine.id);
    if (el) focusLineAt(el, lineText(lastLine).length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  /** handleLineInput/handleLineCompositionEnd가 공유하는 "지금 DOM 내용을 store에
   * 반영" 로직. 항상 살아있는 DOM 텍스트(el.textContent)를 기준으로 삼는다. */
  const syncLineFromDom = (line: TextLine, el: HTMLDivElement) => {
    const newText = el.textContent ?? '';
    const oldText = lineText(line);
    if (newText === oldText) return;
    const nextHighlights = remapHighlightsForEdit(line.highlights, oldText, newText);
    const nextAnnotations = remapHighlightsForEdit(line.annotations, oldText, newText);
    const nextLines = object.lines.map((l) =>
      l.id === line.id ? { ...l, runs: [{ text: newText }], highlights: nextHighlights, annotations: nextAnnotations } : l,
    );
    usePdfOverlayStore.getState().setTextLines(object.id, nextLines);
  };

  const handleLineInput = (line: TextLine, e: FormEvent<HTMLDivElement>) => {
    // 버그 수정: nativeEvent.isComposing만 보면 브라우저별 타이밍 차이로 조합이 이미
    // 끝났는데도 true로 남아있거나 반대인 경우가 있어(TextObjectView.tsx의 동일 주석
    // 참고), 우리가 onCompositionStart/End로 직접 추적하는 composingLineIdRef를
    // 우선으로 삼는다.
    const composing = composingLineIdRef.current === line.id || (e.nativeEvent instanceof InputEvent && e.nativeEvent.isComposing);
    if (composing) return;
    syncLineFromDom(line, e.currentTarget);
  };

  const handleLineCompositionStart = (line: TextLine) => {
    composingLineIdRef.current = line.id;
  };

  const handleLineCompositionEnd = (line: TextLine, e: ReactCompositionEvent<HTMLDivElement>) => {
    composingLineIdRef.current = null;
    // 조합이 막 끝난 시점의 DOM 내용을 바로 store에 반영한다 — 이 이벤트 직후에 오는
    // 마지막 input 이벤트의 isComposing이 브라우저에 따라 정확하지 않을 수 있어서,
    // onCompositionEnd 자체에서 한 번 더 확실하게 동기화한다(TextObjectView.tsx와 동일).
    syncLineFromDom(line, e.currentTarget);
  };

  const handleLineKeyDown = (line: TextLine, e: ReactKeyboardEvent<HTMLDivElement>) => {
    // 'Process'는 일부 Windows IME가 조합 중 keydown에 실어 보내는 key 값 —
    // nativeEvent.isComposing이 아직 안 켜진 타이밍에도 이걸로 조합 중임을 알 수 있다
    // (TextObjectView.tsx의 동일 판정 참고).
    if (e.nativeEvent.isComposing || composingLineIdRef.current === line.id || e.key === 'Process') return;

    if (e.key === 'Enter') {
      e.preventDefault();
      const el = e.currentTarget;
      const caret = getCaretOffset(el);
      // 버그 수정: store의 lineText(line)이 아니라 지금 화면에 실제로 있는 DOM 텍스트를
      // 기준으로 자른다 — line은 마지막 렌더 시점의 props라 아주 짧은 순간이라도 DOM과
      // 어긋나 있으면(예: 방금 조합이 끝난 직후) 엉뚱한 위치에서 잘리거나 텍스트가
      // 통째로 사라지는 것처럼 보였다. TextObjectView.tsx의 handleKeyDown(1177줄
      // 부근, `fullText = lineEl.textContent`)과 동일한 방어.
      const text = el.textContent ?? '';
      const before = text.slice(0, caret);
      const after = text.slice(caret);
      const splitH = splitHighlightsAtOffset(line.highlights, caret);
      const splitA = splitHighlightsAtOffset(line.annotations, caret);
      const newLineId = createLineId();
      const currentLine: TextLine = { ...line, runs: [{ text: before }], highlights: splitH.before, annotations: splitA.before };
      const newLine: TextLine = {
        id: newLineId,
        runs: [{ text: after }],
        anchor: ROOT_ANCHOR,
        highlights: splitH.after,
        annotations: splitA.after,
      };
      const idx = object.lines.findIndex((l) => l.id === line.id);
      const nextLines = [...object.lines];
      nextLines[idx] = currentLine;
      nextLines.splice(idx + 1, 0, newLine);
      pendingFocusRef.current = { lineId: newLineId, offset: 0 };
      usePdfOverlayStore.getState().setTextLines(object.id, nextLines);
      return;
    }

    if (e.key === 'Backspace') {
      const el = e.currentTarget;
      const caret = getCaretOffset(el);
      if (caret !== 0) return; // 줄 중간 삭제는 브라우저 기본 동작 + onInput에 맡긴다
      const idx = object.lines.findIndex((l) => l.id === line.id);
      if (idx > 0) {
        e.preventDefault();
        const prev = object.lines[idx - 1];
        const prevText = lineText(prev);
        // 버그 수정(Enter와 같은 이유): 현재 줄 쪽은 store가 아니라 살아있는 DOM
        // 텍스트를 쓴다 — prev(포커스가 없던 줄)는 이미 동기화돼 있다고 볼 수 있어
        // store 값을 그대로 쓴다.
        const currentText = el.textContent ?? '';
        const mergedText = prevText + currentText;
        const mergedHighlights = mergeHighlightsForLineJoin(prev.highlights, line.highlights, prevText.length);
        const mergedAnnotations = mergeHighlightsForLineJoin(prev.annotations, line.annotations, prevText.length);
        const mergedLine: TextLine = { ...prev, runs: [{ text: mergedText }], highlights: mergedHighlights, annotations: mergedAnnotations };
        const nextLines = object.lines.filter((l) => l.id !== line.id);
        const prevIdxInNext = nextLines.findIndex((l) => l.id === prev.id);
        nextLines[prevIdxInNext] = mergedLine;
        pendingFocusRef.current = { lineId: prev.id, offset: prevText.length };
        usePdfOverlayStore.getState().setTextLines(object.id, nextLines);
      } else if (object.lines.length === 1 && (el.textContent ?? '').length === 0) {
        // 요구사항(빈 텍스트 상자 정리): 유일한 줄이 비어있는 상태로 Backspace를 누르면
        // 상자 자체를 지운다 — 메인 앱 TextObjectView.tsx와 같은 관례.
        e.preventDefault();
        usePdfOverlayStore.getState().removeObject(object.id);
        usePdfOverlaySelectionStore.getState().select(null);
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      usePdfOverlaySelectionStore.getState().stopEditing();
      (e.currentTarget as HTMLElement).blur();
    }
  };

  const handleLineBlur = (e: ReactFocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    const wrapper = wrapperRef.current;
    // 같은 텍스트 상자 안의 다른 줄/주석으로 포커스가 옮겨간 거면 편집 상태를 유지한다.
    if (wrapper && next && wrapper.contains(next)) return;
    usePdfOverlaySelectionStore.getState().stopEditing();
  };

  const handleWrapperPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // 버그 수정(2026-09-16, PDF Viewer Space+드래그 이동 도입): PdfOverlayShapeView.tsx와
    // 같은 이유 — usePdfViewerStore.isSpacePressed 참고.
    if (usePdfViewerStore.getState().isSpacePressed) return;
    if (useToolStore.getState().activeTool !== 'select') return;
    if (isEditing) return; // 편집 중엔 텍스트 커서 조작이 드래그보다 우선
    usePdfOverlaySelectionStore.getState().select(object.id);
    dragRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: object.x,
      startY: object.y,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleWrapperPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (e.buttons === 0) {
      dragRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      return;
    }
    const dxClient = e.clientX - drag.startClientX;
    const dyClient = e.clientY - drag.startClientY;
    if (!drag.moved && Math.hypot(dxClient, dyClient) < 2) return; // 지터 방지(실수로 살짝 움직인 클릭)
    drag.moved = true;
    usePdfOverlayStore
      .getState()
      .updateObject(
        object.id,
        { x: drag.startX + dxClient / displayScale, y: drag.startY + dyClient / displayScale },
        `move:${object.id}`,
      );
  };

  const handleWrapperPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handleDoubleClick = () => {
    if (useToolStore.getState().activeTool !== 'select') return;
    usePdfOverlaySelectionStore.getState().startEditing(object.id);
  };

  return (
    <div
      ref={wrapperRef}
      className={
        'pdf-overlay-text' +
        (isSelected ? ' is-selected' : '') +
        (isEditing ? ' is-editing' : '') +
        (object.borderEnabled ? ' has-border' : '')
      }
      style={{
        position: 'absolute',
        left: `${(object.x / pageWidth) * 100}%`,
        top: `${(object.y / pageHeight) * 100}%`,
        width: `${(object.width / pageWidth) * 100}%`,
        // 요구사항(텍스트 상자 크기 조절): objects/text/TextObjectView.tsx와 동일하게
        // height는 항상 object.height를 반영하고(자동/수동 무관), overflow:visible로
        // 둔다 — 위 자동 높이 effect가 내용이 넘칠 때마다 "커지는 방향으로만"
        // object.height를 갱신해주므로, 실사용에서 실제로 잘리는 상태 자체가 생기지
        // 않는다(사용자가 리사이즈 핸들로 일부러 줄인 순간에는 짧게 넘쳐 보일 수 있고,
        // 그건 의도된 동작이다).
        height: `${(object.height / pageHeight) * 100}%`,
        overflow: 'visible',
        zIndex: object.zIndex,
        pointerEvents: 'auto',
        color: object.color,
        fontFamily: object.fontFamily,
        fontWeight: object.bold ? 700 : 400,
        lineHeight: object.lineHeight ?? 1.4,
        cursor: activeTool === 'select' && !isEditing ? 'move' : 'text',
      }}
      onPointerDown={handleWrapperPointerDown}
      onPointerMove={handleWrapperPointerMove}
      onPointerUp={handleWrapperPointerUp}
      onDoubleClick={handleDoubleClick}
    >
      <div ref={contentRef}>
        {object.lines.map((line) => {
          const rects = highlightRectsByLine.get(line.id) ?? [];
          return (
            <div key={line.id}>
              <div style={{ position: 'relative' }}>
                {rects.map((r, i) => (
                  <div
                    key={`${r.id}-${i}`}
                    style={{
                      position: 'absolute',
                      left: r.left,
                      top: r.top,
                      width: r.width,
                      height: r.height,
                      background: highlightBackgroundFor(r.color),
                      borderRadius: r.height / 2,
                      pointerEvents: 'none',
                    }}
                  />
                ))}
                <div
                  ref={(el) => {
                    if (el) lineRefs.current.set(line.id, el);
                    else lineRefs.current.delete(line.id);
                  }}
                  className="pdf-overlay-text-line"
                  data-object-id={object.id}
                  data-line-id={line.id}
                  contentEditable={isEditing}
                  suppressContentEditableWarning
                  spellCheck={false}
                  onInput={(e) => handleLineInput(line, e)}
                  onKeyDown={(e) => handleLineKeyDown(line, e)}
                  onCompositionStart={() => handleLineCompositionStart(line)}
                  onCompositionEnd={(e) => handleLineCompositionEnd(line, e)}
                  onBlur={handleLineBlur}
                  style={{
                    position: 'relative',
                    fontSize: object.baseFontSize * displayScale * PDF_OVERLAY_ABSOLUTE_SIZE_CALIBRATION,
                    outline: 'none',
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'break-word',
                    minHeight: '1em',
                    userSelect: allowNativeTextSelect ? 'text' : 'none',
                    WebkitUserSelect: allowNativeTextSelect ? 'text' : 'none',
                  }}
                />
              </div>
              {/* 요구사항(2026-09-16, "PDF에서 주석 사용 기능 삭제"): 버그가 많다는
                  피드백으로 line.annotations를 더 이상 렌더링하지 않는다 — 예전엔
                  여기서 각 annotation마다 PdfOverlayAnnotationNote를 그렸다. 데이터
                  자체(line.annotations)는 지우지 않았다(위 useOverlayTextSelectionTools.ts의
                  동일한 주석 참고 — 텍스트 편집 로직이 그 필드를 계속 다루고, 메인
                  캔버스와 타입을 공유하기 때문) — 그냥 화면에 그리지 않을 뿐이라, 혹시
                  이전에 저장된 PDF에 주석이 남아있어도 조용히 숨겨진다. */}
            </div>
          );
        })}
      </div>
      {isSelected && activeTool === 'select' && !isEditing && (
        <PdfOverlayResizeHandles
          objectId={object.id}
          box={{ x: object.x, y: object.y, width: object.width, height: object.height }}
          displayScale={displayScale}
          isText
        />
      )}
    </div>
  );
}
