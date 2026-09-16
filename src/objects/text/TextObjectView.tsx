import { useLayoutEffect, useRef, useState } from 'react';
import type { ClipboardEvent as ReactClipboardEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { TextObject } from '../../types/object';
import type { TextAnnotation, TextHighlight, TextLine, TextRun } from './indentation/types';
import { createLineId, lineText } from './indentation/types';
import {
  BULLET_INDENT_UNIT,
  computeAnchorForFirstLineBullet,
  computeAnchorForNewBullet,
  computeBackspaceAnchor,
  computeEnterAnchor,
  computeHangingMarkerPrefixLength,
  detectLeadingBullet,
  findColonAlignmentPoint,
} from './indentation/anchorEngine';
import { convertArrowTokenAtCursor } from './arrowConvert';
import { remapHighlightsForEdit, splitHighlightsAtOffset, mergeHighlightsForLineJoin } from './highlightModel';
import { splitRunsAtOffset, joinRuns } from './runStyle';
import { lineDomMatchesRuns, readRunsFromDom, renderRunsIntoDom } from './lineDomSync';
import type { AnnotationSpacerSpec } from './lineDomSync';
import { highlightBackgroundFor } from './highlightColors';
import { registerLineEl, unregisterLineEl } from './lineDomRegistry';
import { AnnotationBubble, DEFAULT_ANNOTATION_OFFSET_X_BASE } from './AnnotationBubble';
import { isAnnotationBelowAnchor } from './annotationLayout';
import { useObjectsStore } from '../../store/objectsStore';
import { resolveFrameTheme } from '../frame/frameStyles';
import { useInteractionStore } from '../../store/interactionStore';
import { useViewportStore } from '../../store/viewportStore';
import { useToolStore } from '../../store/toolStore';
import { useFontStore } from '../../store/fontStore';
import {
  caretOffsetFromPoint,
  caretPositionFromClientPoint,
  focusLineAt,
  getCaretOffset,
  getSelectionOffsetsWithinLine,
  measureCharOffsetPx,
  mergeClientRectsByLine,
  rangeForOffsets,
} from './domCaret';
import { captureSelectionSegments } from './selectionCapture';
import type { SelectionSegment } from './selectionCapture';
import { useTextRangeSelection } from './useTextRangeSelection';
import { DEFAULT_FONT_FAMILY } from './fontOptions';
import { fontHeightScaleFor } from './fontMetrics';
import { LINE_HEIGHT_DEFAULT, clampLineHeight } from './lineSpacing';

/** 하이라이트를 "드래그로 새로 만드는 것"이 아니라 "클릭해서 선택하는 것"으로 판정할 임계값(화면 px). */
const HIGHLIGHT_CLICK_THRESHOLD_PX = 4;
/** TextObjectView 컨테이너 자체의 CSS padding — Annotation 가로 범위 clamp 계산에 그대로 맞춰 써야 한다. */
const TEXT_PADDING = 6;
/** Annotation의 최소 폭(target Text 오른쪽 끝에 바짝 붙어도 이 밑으로는 줄어들지 않는다). */
const MIN_ANNOTATION_WIDTH = 60;
/**
 * AnnotationBubble.tsx의 ANNOTATION_TOTAL_GAP_BASE(tickRise + bubbleGap)와 반드시
 * 같은 값이어야 한다. 줄 위에 확보하는 여백을 계산할 때 "말풍선 자체 높이 + 이
 * 간격"으로 계산하기 위해 필요. 요구사항: 주석이 있는 줄과 앞뒤 줄 사이의 간격은
 * 주석 말풍선 자체의 실측 높이(불가피하게 필요한 부분)만 남기고 최대한 좁혀야
 * 한다 — 그래서 여기 더할 "안전 여백"은 화살표 꼬리/화살촉이 글자에 딱 붙어
 * 보이지 않을 최소한의 값(1px)만 둔다. 더 줄이면 bottomInset 실측이 아주 작은
 * 경우(예: 커스텀 폰트로 descender가 거의 없는 글꼴) bubbleGap의 하한(computeBubbleGap의
 * 0.5*scale)만으로 버텨야 해서 자칫 글자끼리 시각적으로 닿아 보일 수 있다.
 */
const ANNOTATION_GAP = 1;
/** 아직 실측 전(첫 렌더)이거나 빈 주석("메모" 플레이스홀더)일 때 쓰는 기본 높이 추정치(1줄 정도). */
const DEFAULT_ANNOTATION_HEIGHT = 16;
/** 요구사항 4번(텍스트 상자 자동 높이): 내용이 아예 없어도 최소한 이 높이는 유지한다
 * (빈 텍스트 상자가 한 줄보다도 작게 쪼그라들어 클릭하기 어려워지는 것을 방지). */
const MIN_TEXT_HEIGHT = 32;
/** 요구사항 5번(주석/밑줄 크기 비례): AnnotationBubble.tsx의 기존 고정 px 상수들
 * (밑줄 굵기/간격, 말풍선 글자 크기/여백 등)이 원래 어떤 텍스트 크기를 기준으로
 * 튜닝됐는지를 나타내는 기준값 — 새 TextObject의 기본 baseFontSize(16)와 같다.
 * anchor 위치의 실제 computed font-size를 이 값으로 나눈 배율(fontScale)을 그
 * 상수들에 곱해서, 텍스트가 커지거나 작아지면 주석/밑줄도 같은 비율로 커지거나
 * 작아지게 한다.
 *
 * 요구사항(폰트 목록 통합 — 실제 렌더링 크기 반영): 이 nominal 배율만으로는 부족하다
 * — 같은 16px이라도 폰트마다 실제 보이는 글자 높이가 다르기 때문이다. 그래서 아래
 * fontScale 계산은 이 nominal 배율에 fontMetrics.ts의 fontHeightScaleFor(해당 위치의
 * 실제 fontFamily로 측정한, 기준 폰트 대비 실측 높이 비율)를 추가로 곱한다. */
const REFERENCE_FONT_SIZE = 16;
/** 실측 높이 + 화살표 여백에 추가로 더하는 여유 공간(월드 px). 요구사항: 텍스트-주석-텍스트
 * 간격을 최대한 좁혀야 하므로 "약간 더"보다도 더 얇게, 반올림/서브픽셀 오차를 흡수할
 * 최소한(0.5px)만 남긴다. */
const ANNOTATION_SPACE_BUFFER = 0.5;
/**
 * 문단 중간(annotation.start > 0)에 달린 주석의 spacer 높이를 계산할 때 쓰는 "이 행의
 * 자연스러운 높이" 비율(fontSize 기준 em). object.lineHeight가 없으면(하위 호환) 줄 div에
 * CSS line-height를 명시하지 않고 브라우저 기본값에 맡기므로(그래야 폰트마다 제각각인
 * 기본 line-height를 그대로 존중함), spacer 높이를 "자연스러운 행 높이 + 추가 여백"으로
 * 정확히 맞추려면 이 자연스러운 행 높이를 우리가 직접 추정해야 한다. 이 줄 div들에
 * 이미 적용 중인 minHeight(아래 JSX)와 같은 값을 재사용해 일관성을 맞춘다 — spacer가
 * 이 값보다 작으면 line-box가 전혀 커지지 않아 여백이 생기지 않는다(요구사항: "spacer
 * 높이는 자연스러운 줄 높이보다 커야 실제로 화면에 여백이 반영된다").
 */
const NATURAL_LINE_HEIGHT_RATIO = LINE_HEIGHT_DEFAULT;

interface HighlightRect {
  key: string;
  highlightId: string;
  lineId: string;
  left: number;
  top: number;
  width: number;
  height: number;
  color: string;
}

function sameRects(a: HighlightRect[], b: HighlightRect[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.key !== y.key ||
      x.left !== y.left ||
      x.top !== y.top ||
      x.width !== y.width ||
      x.height !== y.height ||
      x.color !== y.color
    ) {
      return false;
    }
  }
  return true;
}

interface AnnotationAnchor {
  lineId: string;
  annotation: TextAnnotation;
  /** anchor(사용자가 처음 선택한) 텍스트 구간의 왼쪽 끝(컨테이너 기준, zoom 정규화).
   * Annotation을 드래그해도 이 값은 바뀌지 않는다 — 말풍선 자체의 왼쪽 정렬 기준점이자
   * 화살표가 가리키는 지점(첫 글자)의 x좌표. */
  anchorLeft: number;
  /** anchor 텍스트 구간의 맨 위(컨테이너 기준, zoom 정규화) — 화살표가 가리키는
   * 지점(첫 글자)의 y좌표. */
  top: number;
  /** 요구사항(2026-09-09 2차 수정 — 주석을 텍스트 아래로 옮겼을 때 anchor 자신의
   * 글자와 겹치는 버그): anchor 구간의 실제 렌더 높이(컨테이너 기준, zoom 정규화).
   * "위" 배치는 anchor.top에서 위로 띄우기만 하면 되므로 필요 없지만, "아래" 배치는
   * anchor.top이 아니라 anchor.top + height(=이 구간 글자의 실제 바닥)에서부터
   * 아래로 띄워야 anchor 자신의 글자를 덮지 않는다(AnnotationBubble.tsx 참고). */
  height: number;
  /** 실제로 말풍선이 그려질 왼쪽 위치 = anchorLeft + offsetX를 target Text 범위로 clamp한 값. */
  left: number;
  /** target Text의 남은 가로 공간 기준 최대 폭(px). */
  maxWidth: number;
  /**
   * 요구사항 5번: 주석/밑줄 크기는 고정 px가 아니라 실제 텍스트 크기에 비례해야
   * 한다. anchor 구간의 실제 DOM computed font-size(px)를 REFERENCE_FONT_SIZE(기존
   * 상수들을 튜닝할 때 기준으로 삼았던 기본 크기, 16px)로 나눈 배율이다 — object
   * 전체의 baseFontSize가 아니라 이 anchor 위치의 실제 computed 값을 쓰므로,
   * Phase 8(부분 서식)로 이 구간만 다른 fontSize/글꼴이 적용돼 있어도 정확하다.
   */
  fontScale: number;
  /** 위 fontScale을 만드는 데 쓰인, 이 anchor 위치의 실측 computed font-size(px, zoom과
   * 무관). annotationSpacerSpecs가 "이 행의 자연스러운 높이"를 계산할 때 재사용한다 —
   * fontScale에서 역산하면 fontHeightScaleFor(폰트별 실측 배율)까지 나눠야 해서 번거롭고
   * 오차가 생기기 쉬우므로, 원본 값을 그대로 들고 있는 편이 더 안전하다. */
  computedFontSizePx: number;
}

function sameAnchors(a: AnnotationAnchor[], b: AnnotationAnchor[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].annotation.id !== b[i].annotation.id ||
      a[i].annotation.text !== b[i].annotation.text ||
      a[i].annotation.highlights !== b[i].annotation.highlights ||
      // 버그 수정: fontFamily/color가 빠져 있었다 — 사이드바에서 이미 만들어진
      // 주석의 글꼴/색을 바꿔도 이 비교에 걸리지 않아 "같은 anchor"로 취급되면서
      // annotationAnchors state가 갱신되지 않았고, 그 결과 AnnotationBubble에
      // 새 fontFamily/color가 전달되지 않아 화면엔 반영이 안 되는 버그로 이어졌다
      // (텍스트를 추가로 고치는 등 다른 필드까지 함께 바뀌어야만 우연히 통과됐다).
      a[i].annotation.fontFamily !== b[i].annotation.fontFamily ||
      a[i].annotation.fontSize !== b[i].annotation.fontSize ||
      a[i].annotation.color !== b[i].annotation.color ||
      a[i].anchorLeft !== b[i].anchorLeft ||
      a[i].top !== b[i].top ||
      a[i].height !== b[i].height ||
      a[i].left !== b[i].left ||
      a[i].maxWidth !== b[i].maxWidth ||
      a[i].fontScale !== b[i].fontScale ||
      a[i].computedFontSizePx !== b[i].computedFontSizePx
    ) {
      return false;
    }
  }
  return true;
}

/** hangingIndents(Map<lineId, px>) 두 스냅샷이 실질적으로 같은지 비교한다 — 매 렌더마다
 * 새 Map을 만들어 setState하면 참조가 달라 불필요한 재렌더가 반복되므로, sameRects/
 * sameAnchors와 같은 이유로 값이 실제로 바뀌었을 때만 state를 갱신하기 위해 쓴다. */
function sameHangingIndents(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    if (b.get(key) !== value) return false;
  }
  return true;
}

/** annotationsOnFirstRow(Set<annotationId>) 두 스냅샷이 실질적으로 같은지 비교한다 —
 * sameHangingIndents와 같은 이유(불필요한 재렌더 방지). */
function sameIdSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

/** 요구사항 버그 수정(2026-09-09, 같은 줄에 주석 2개 이상일 때 기존 텍스트 간격이
 * 2배로 늘어남): 이 줄의 문단 시작(offset 0)부터 주어진 offset까지가 화면에서 실제로
 * 줄바꿈되는지(=시각적으로 2개 이상의 행에 걸치는지) 측정한다. true(=아직 첫 행 안)면
 * 이 offset에 달린 주석은 annotationSpaceMetrics(paddingTop)에 합류시켜야 하고,
 * annotationSpacerSpecs가 별도 spacer를 또 끼워 넣으면 안 된다 — 그렇게 하면 이미
 * paddingTop으로 확보한 여백 위에 spacer 높이가 같은 행 안에서 그대로 더해져(줄바꿈이
 * 실제로 일어나지 않으므로 새 행이 생기는 게 아니라 같은 행의 line-box만 커짐) 여백이
 * 정확히 2배로 보이는 게 이번에 고친 버그의 원인이었다.
 *
 * rangeForOffsets는 텍스트 노드만 순회해서 offset을 세므로(spacer <span>은 텍스트가
 * 없어 트리워커가 아예 건너뛴다), 이 측정은 그 offset에 달린 주석 자신의 spacer가
 * DOM에 있든 없든 항상 "spacer가 전혀 없었다면" 원래 텍스트가 실제로 몇 번째 행에
 * 있는지를 그대로 반영한다 — 그래서 이전 렌더에서 잘못 끼워진 spacer가 남아 있어도
 * 이 측정 자체는 오염되지 않는다. el에 아직 텍스트가 없는 첫 렌더(마운트 직후)처럼
 * 측정이 불가능하면, 여백을 불필요하게 만들지 않는 쪽(=첫 행으로 간주, spacer 없음)을
 * 기본값으로 삼는다 — 실제로 여러 행에 걸치는 경우였다면 이후 렌더(annotationHeights
 * 등 다른 측정이 이 effect를 다시 돌릴 때)에서 실제 텍스트를 보고 스스로 바로잡는다. */
function isOffsetWithinFirstVisualRow(el: HTMLElement, offset: number): boolean {
  if (offset <= 0) return true;
  const range = rangeForOffsets(el, 0, offset);
  if (!range) return true;
  return mergeClientRectsByLine(range.getClientRects()).length <= 1;
}

interface FocusRequest {
  lineId: string;
  offset: number;
}

/**
 * Phase 3: contentEditable 기반 줄 단위 텍스트 편집.
 *
 * 한 줄 = 하나의 contentEditable div. Phase 8(부분 서식) 이전에는 그 안이 항상 단일
 * 텍스트 노드였지만, 지금은 드래그한 구간만 다른 색/글꼴/크기/굵기를 가질 수 있어서
 * 줄 하나가 여러 개의 <span>(run)으로 나뉘어 렌더링될 수 있다. 다만 절대다수의
 * "스타일 없는 평범한 줄"은 여전히 예전처럼 단일 텍스트 노드 그대로 둔다(굳이
 * <span>으로 감싸지 않는다) — 실제 리치 스타일이 쓰인 줄에서만 <span> 구조로
 * 전환된다. 자세한 판단/변환 로직은 objects/text/lineDomSync.ts, 구간 분할/병합
 * 로직은 objects/text/runStyle.ts 참고. indentation은 각 줄의 anchor.offsetPx를
 * paddingLeft로 반영해 표현한다.
 *
 * [IME / 커서 안정화 재작업 노트]
 * 이 컴포넌트의 각 줄 div는 더 이상 JSX children으로 `{lineText(line)}`을 렌더링하지
 * 않는다("uncontrolled" contentEditable). React가 매 store 업데이트마다 text 자식을
 * diff해서 다시 써넣으면, 이미 브라우저가 올바르게 반영해 둔 DOM 텍스트 노드를 다시
 * 덮어쓰게 되고, 이 재작성이 캐럿(커서)/조합 중인 IME 버퍼를 깨뜨리는 원인이었다.
 * 대신 아래 useLayoutEffect 하나가 "store의 run 구조와 실제 DOM 구조(텍스트+스타일)가
 * 다를 때만" 그 줄을 다시 그리고(구조적 변경: Enter 분리/Backspace 병합/dedent/화살표
 * 토큰 변환/PropertiesPanel의 구간 서식 적용 등 "외부에서" 바뀐 경우), 이미 일치하는
 * 줄(=사용자가 방금 그 줄에 직접 타이핑해서 store를 그 값으로 동기화한 경우)은
 * 건드리지 않는다 — lineDomSync.ts의 lineDomMatchesRuns/renderRunsIntoDom이 이 비교/
 * 재작성을, readRunsFromDom이 타이핑 후 DOM→store 역방향 동기화를 담당한다.
 */
export function TextObjectView({ object }: { object: TextObject }) {
  // 사이드바 "줄 간격" 조절값. undefined면 기존 브라우저 기본값과 동일한 결과가 나오도록
  // NATURAL_LINE_HEIGHT_RATIO(1.4)를 그대로 쓴다 — 하위 호환(기존에 저장된 객체는 이
  // 필드가 없어도 렌더링이 달라지지 않는다).
  const lineHeightRatio = clampLineHeight(object.lineHeight ?? NATURAL_LINE_HEIGHT_RATIO);
  const containerRef = useRef<HTMLDivElement>(null);
  // 요구사항(자동 높이는 커지는 방향으로만): 내용이 줄어들었다고 상자를 계속
  // 줄이면(과거 동작) 편집 중 Backspace 몇 번에 상자가 계속 움찔거리며 작아지는
  // 게 어색하다는 피드백 — 그래서 "내용이 상자보다 커질 때만" 키우고, 짧아져도
  // 절대 줄이지 않는다. 다만 방금 생성된 상자의 아주 첫 측정만은 예외로 허용한다 —
  // 그래야 생성 시 임의로 잡아둔 기본 높이(actions.ts의 DEFAULT_TEXT_HEIGHT, 실제
  // 폰트 크기와 무관한 값)가 그 폰트의 실제 한 줄 높이로 정확히 맞춰진 뒤부터
  // "커지기만" 규칙이 적용된다.
  //
  // 버그 수정(2026-09, 두 번째 재발 — 아래 자동 높이 effect의 상세 주석 참고): 옛
  // 이름은 hasAutoFitHeightOnceRef였고 "첫 측정을 이미 했는지"만 기억하는 boolean
  // 하나였는데, 그것만으로는 "사용자가 리사이즈로 줄인 상자"와 "콘텐츠가 실제로
  // 늘어난 경우"를 구분할 수 없었다(리사이즈 이후에도 scrollHeight 자체는 항상 콘텐츠의
  // 전체 필요 높이를 그대로 반환하기 때문). 그래서 boolean 대신 "직전에 측정한
  // 콘텐츠 자체의 필요 높이" 값을 기억하는 기준선으로 바꿨다 — object.height(사용자가
  // 리사이즈로 정했을 수도 있는, 실제 저장되는 값)와는 별개의 값이다. null이면 "이
  // 컴포넌트 인스턴스에서 아직 한 번도 측정한 적 없음"(방금 마운트/새로고침 후
  // 재마운트) — 컴포넌트 인스턴스별로만 기억하므로 새로고침하면 항상 null로 다시
  // 시작하지만, 그 시점의 판단은 object.manualHeight(types/object.ts 주석 참고)와
  // object.createdAt===updatedAt으로 보강한다(아래 effect 참고).
  const lastMeasuredContentHeightRef = useRef<number | null>(null);
  // 요구사항(빈 텍스트 상자 자동 삭제): 이 상자에 실제 글자가 한 번이라도 있었는지
  // 기억한다. 마운트 시 이미 내용이 있으면(기존에 저장된 노트를 다시 연 경우) true로
  // 시작하고, 편집 중 한 글자라도 생기면 그 순간부터 true로 고정된다(이후 전부
  // 지워도 다시 false로 돌아가지 않음 — Annotation의 "seasoned" 개념과 동일한 원리,
  // AnnotationBubble.tsx의 annotationSeasonedRef 참고). 편집을 끝냈는데(isEditing이
  // true→false) 이 값이 여전히 false라면 "정말 아무 것도 입력한 적 없는" 빈 상자이므로
  // 자동으로 지운다.
  const hasEverHadContentRef = useRef(object.lines.some((line) => lineText(line) !== ''));
  const lineElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const focusRequestRef = useRef<FocusRequest | null>(null);
  // 한글 등 IME 조합 상태를 이벤트의 isComposing 플래그만으로 판단하지 않고
  // compositionstart/compositionend로 직접 추적한다. 브라우저별로 KeyboardEvent
  // .isComposing 타이밍이 미묘하게 다를 수 있어(특히 조합 경계 부근), 이 ref가
  // 더 신뢰할 수 있는 단일 진실 원천이다. keydown 판정에는 이 ref를 우선 사용하고
  // nativeEvent.isComposing / key === 'Process'는 보조 신호로만 곁들인다.
  const isComposingRef = useRef(false);
  // compositionend와 그 직후에 이어질 수 있는 input 이벤트가 "같은 최종 텍스트"를
  // 두 번 처리하지 않도록, 줄(id)별로 마지막으로 store에 반영한 DOM 텍스트를 기억해둔다.
  const lastProcessedTextRef = useRef<Map<string, string>>(new Map());
  // 줄마다 ref 콜백을 안정적인 함수 하나로 캐싱한다. 인라인 화살표 함수를 매 렌더마다
  // 새로 만들면 line.id가 그대로여도 React가 매번 detach(null)+attach를 호출해서
  // lineElsRef/lastProcessedTextRef 같은 부가 상태가 불필요하게 흔들릴 수 있다.
  // 실제 detach는 그 줄이 배열에서 완전히 사라졌을 때만 일어나게 만들어 ref가 stale해지지
  // 않도록 한다.
  const lineRefCallbacksRef = useRef<Map<string, (el: HTMLDivElement | null) => void>>(new Map());
  // Phase 4: 하이라이트 렌더링용 사각형(줄 텍스트 뒤에 그릴 위치/크기/색). DOM 측정
  // 결과이므로 useState로 들고 있다가 useLayoutEffect에서 다시 계산해 갱신한다.
  const [highlightRects, setHighlightRects] = useState<HighlightRect[]>([]);
  // Phase 4(2차): 주석 anchor 위치(화살표/말풍선을 그 자리 위에 그리기 위함). 원리는 위와 같다.
  const [annotationAnchors, setAnnotationAnchors] = useState<AnnotationAnchor[]>([]);
  // 요구사항(2026-09, 줄바꿈 매달린 들여쓰기): 줄 id -> 그 줄이 화면에서 접힐 때(soft-wrap)
  // 이어지는 줄이 추가로 걸려야 할 폭(px, world 단위). '-'/'·'/':' 로 시작하는 줄에서만
  // 채워지고, 그 외 줄은 이 Map에 아예 키가 없다(=기존과 동일하게 anchor.offsetPx 하나로만
  // 들여써짐). 하이라이트/주석 anchor와 마찬가지로 DOM 측정 결과라 useState + 아래
  // useLayoutEffect로 갱신한다.
  const [hangingIndents, setHangingIndents] = useState<Map<string, number>>(new Map());
  // 각 Annotation 말풍선이 실제로 렌더링된 높이(월드 px, AnnotationBubble이 자기 자신을
  // 측정해서 보고). 주석이 몇 줄이 되든(요구사항: 줄 수 제한 없이 자동으로 늘어남) 그
  // 줄 위에 미리 확보해 두는 여백(paddingTop)을 여기에 맞춰 동적으로 계산하기 위함이다.
  const [annotationHeights, setAnnotationHeights] = useState<Record<string, number>>({});
  // 버그 수정(2026-09-09, 같은 줄에 주석 2개 이상일 때 간격 2배): 문단 중간(start>0)에
  // 달린 주석 중 실제로는 아직 문단의 첫 행 안에 있는(=화면상 줄바꿈이 일어나기 전인)
  // 것들의 id 집합 — isOffsetWithinFirstVisualRow로 측정한다. 이 집합에 있는 주석은
  // annotationSpaceMetrics(paddingTop, 첫 행 여백)에 합류하고, annotationSpacerSpecs는
  // 이 집합에 있는 주석을 건너뛴다(중복 여백 방지). DOM 측정 결과라 다른 값들과 같은
  // 이유로 useState + 아래 useLayoutEffect로 갱신한다.
  const [annotationsOnFirstRow, setAnnotationsOnFirstRow] = useState<Set<string>>(new Set());
  // 줄을 "클릭"했는지 "드래그"했는지 구분하기 위한 시작 좌표 기록(줄 id별).
  // select 도구에서 하이라이트 위를 클릭하면 선택, 그 외에는 기존 객체 드래그로 흘려보낸다.
  const lineClickStartRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  // Phase 4(버그 수정): 방금 생성된 Text가 처음부터 편집 모드로 마운트되는 경우(더블클릭/
  // 텍스트 도구로 생성 직후)를 감지하기 위한 이전 isEditing 값. AnnotationBubble에 이미
  // 적용한 것과 같은 패턴이다.
  const wasEditingRef = useRef(false);
  // 주석이 "생성 직후 취소"가 아니라 최소 한 번은 내용이 있는 채로 편집을 완료한 적이
  // 있는지 기록한다(id 기준). 아직 여기 없는(=seasoned 아닌) 주석만 "빈 채로 편집을
  // 끝내면 생성 자체를 취소한 것으로 보고 자동 삭제"하는 대상이다 — 한 번이라도 내용을
  // 저장한 적이 있는 주석은 이후 다시 편집해서 비워도 절대 자동 삭제하지 않는다(줄만
  // 남기고 유지하며, 명시적으로 선택 후 Backspace를 눌러야만 지워진다).
  const annotationSeasonedRef = useRef<Set<string>>(new Set());

  const mode = useInteractionStore((s) => s.mode);
  const isSingleSelected = useInteractionStore(
    (s) => s.selectedIds.length === 1 && s.selectedIds[0] === object.id,
  );
  const fineSelection = useInteractionStore((s) => s.fineSelection);
  const isEditing = mode === 'text-edit' && isSingleSelected;
  // Phase 8(부분 서식): 편집 중 드래그로 만든 네이티브 선택 구간을 textRangeStore에
  // 반영한다 — PropertiesPanel이 이를 구독해서 "구간에만 스타일 적용" 모드로 전환한다.
  // onLinePointerDown은 요구사항(Ctrl+드래그로 비연속 다중 구간 선택)을 위해 아래
  // 줄 div의 onPointerDown(isEditing 분기)에서 직접 호출한다.
  const { onLinePointerDown } = useTextRangeSelection(object.id, isEditing);
  // Phase 4: 형광펜/주석 도구가 활성화된 동안엔 이 텍스트가 편집 중이 아니어도
  // 드래그로 선택할 수 있어야 한다(ObjectView가 이때 drag 핸들러를 떼어준다).
  // 이 컴포넌트에서는 그 선택이 실제로 동작하도록 각 줄에 user-select: text를
  // 켜주는 용도로만 activeTool을 읽는다 — 그 외 로직은 전혀 건드리지 않는다.
  const activeTool = useToolStore((s) => s.activeTool);
  // [수정] ObjectView.tsx의 isTextSelectMode와 동일한 이유로 'highlight'/'annotation'
  // 두 도구로만 좁힌다 — 'text' 도구가 활성화돼 있을 때(선택된 텍스트 객체 종류에
  // 맞춰 상단 메뉴가 자동 전환된 경우 포함) 줄 div에 user-select:text가 남아있으면
  // 객체를 드래그로 옮기는 제스처와 시각적으로 충돌(네이티브 텍스트 선택 하이라이트가
  // 동시에 그려짐)할 수 있다.
  const allowNativeTextSelect = !isEditing && (activeTool === 'highlight' || activeTool === 'annotation');

  // 버그 수정(새로고침 후 형광펜/주석 화살표가 다른 곳에 그려짐): 커스텀(업로드한)
  // 폰트는 앱이 뜬 뒤 IndexedDB에서 비동기로 다시 읽어 document.fonts에 등록된다
  // (store/fontStore.ts의 loadPersistedFonts, Canvas.tsx가 마운트 시 한 번 호출).
  // 이 컴포넌트의 아래 하이라이트/주석 anchor 측정 effect는 useLayoutEffect라 마운트
  // 직후 곧바로(=그 폰트가 아직 등록되기 전) 한 번 실행되므로, 이 텍스트 객체가 그
  // 폰트를 쓰고 있으면 그 순간엔 폴백 글꼴로 렌더링된 위치를 측정해버린다 — 폰트가
  // 나중에 실제로 등록돼 글자가 재배치돼도 이 effect는 그걸 알 방법이 없어 잘못된
  // 위치에 그대로 멈춰 있었다(다른 하이라이트를 새로 칠하는 것처럼 object.lines가
  // 바뀌는 무관한 동작이 이 effect를 다시 돌게 만들어야만 "우연히" 바로잡혔다).
  // 아래에서 이 값 자체를 읽어 쓰지는 않지만 measuring effect의 deps에 포함시켜서,
  // 폰트 로딩이 끝나 customFonts가 갱신될 때마다(이 시점엔 document.fonts.add로 이미
  // 등록되어 브라우저가 레이아웃을 다시 계산한 뒤이므로) 실제 글자 위치로 다시
  // 측정하게 한다.
  const customFonts = useFontStore((s) => s.customFonts);

  const setTextLines = useObjectsStore((s) => s.setTextLines);
  const updateAnnotationText = useObjectsStore((s) => s.updateAnnotationText);
  const updateAnnotationOffset = useObjectsStore((s) => s.updateAnnotationOffset);
  const removeAnnotation = useObjectsStore((s) => s.removeAnnotation);

  // 요구사항(어두운 프레임 위 텍스트 상자): 이 Text가 속한 Frame(frameId, 순수 논리적
  // 참조 — 원칙 3, 4 위 주석 참고)이 다크 테마면, 항상 반투명 흰 배경을 깔던 기존
  // 동작이 다크 배경 위에서 뿌연 회색 얼룩처럼 보인다. 그 경우에만 배경을 완전히
  // 투명하게 비운다 — 테두리(borderEnabled)는 이 판정과 무관하게 그대로 유지된다.
  const parentFrame = useObjectsStore((s) => (object.frameId ? s.objects[object.frameId] : undefined));
  const isOnDarkFrame = parentFrame?.type === 'frame' && resolveFrameTheme(parentFrame.style) === 'dark';

  // AnnotationBubble이 스스로 측정한 실제 렌더 높이를 보고받는다(줄 수가 늘어나면
  // 높이도 늘어남 — 요구사항: 텍스트 크기를 줄이지 않고 박스 높이로 대응). 값이
  // 실제로 바뀌었을 때만 setState해서 불필요한 재렌더를 막는다.
  const handleAnnotationHeightChange = (annotationId: string, height: number) => {
    setAnnotationHeights((prev) => {
      if (Math.abs((prev[annotationId] ?? 0) - height) < 0.5) return prev;
      return { ...prev, [annotationId]: height };
    });
  };

  /**
   * 버그 수정(커스텀 폰트를 쓰는 일부 텍스트 상자가 새로고침하면 세로 길이가
   * 크게(때로는 거의 2배) 늘어남): 업로드한 커스텀 폰트는 store/fontStore.ts의
   * familyNameFor가 만드는 고유 이름(`user-font-<id>`)만 저장되고, 별도 fallback
   * 글꼴 목록 없이 그대로 CSS font-family에 쓰인다. 새로고침 직후에는 이 폰트가
   * IndexedDB에서 비동기로 다시 로드되는 동안(store/fontStore.ts의 loadPersistedFonts)
   * 아직 document.fonts에 등록되지 않은 상태라, 브라우저가 그 이름을 못 찾고 브라우저
   * 기본 글꼴(대개 세리프)로 대신 그린다 — 이때 글자 너비가 실제 커스텀 폰트와
   * 크게 달라 줄바꿈 개수 자체가 달라질 수 있다. 바로 이 순간 아래 자동 높이 로직이
   * scrollHeight를 재서 store에 반영해버리면, 폰트가 실제로 로드된 뒤 다시 잰 값이
   * 더 작아도 "커지는 방향으로만" 규칙 때문에 절대 줄어들지 않아 잘못된 높이가
   * 영구히 남는다. 그래서 이 객체(또는 부분 서식/주석)가 참조하는 커스텀 폰트 중
   * 하나라도 아직 로드되지 않았으면, 그 폰트가 실제로 등록될 때까지(그러면 아래
   * customFonts deps로 effect가 다시 돈다) 높이 측정·반영 자체를 건너뛴다.
   */
  function isFontFamilyPending(family: string | undefined): boolean {
    return !!family && family.startsWith('user-font-') && !customFonts.some((f) => f.family === family);
  }
  function hasPendingCustomFont(): boolean {
    if (isFontFamilyPending(object.fontFamily)) return true;
    for (const line of object.lines) {
      for (const run of line.runs) {
        if (isFontFamilyPending(run.fontFamily)) return true;
      }
      for (const a of line.annotations ?? []) {
        if (isFontFamilyPending(a.fontFamily)) return true;
      }
    }
    return false;
  }

  /** 이 줄의 문단 맨 앞(annotation.start === 0)에 달린, 그리고 아직 "텍스트 위"에
   * 있는(isAnnotationBelowAnchor가 false인) 주석들 중 가장 큰 말풍선 실측 높이와,
   * 그 줄의 fontScale — paddingTop(reservedSpaceForLine) 계산에 쓰인다. start > 0
   * (문단 중간의 자동 줄바꿈된 행)인 주석은 여기서 제외한다 — padding-top은 문단
   * 전체의 첫 행에만 적용되는 CSS 특성상 그 행에만 유효하기 때문이다. 그런 주석들은
   * annotationSpacerSpecs가 별도로 처리한다. 요구사항(2026-09-09, 주석을 텍스트
   * 아래로도 이동 가능하게): "텍스트 아래"로 넘어간 주석은 annotationSpaceMetricsBelow
   * (아래)가 대신 담당하므로 이 Math.max 그룹에서 자동으로 빠진다 — 그래서 마지막
   * 남은 주석이 아래로 이동하면 이 함수가 자연히 null을 반환해 위쪽 여백이 다시
   * 사라진다(요구사항: "위쪽에 주석이 없다면 위쪽 여백은 다시 없애기"). */
  function annotationSpaceMetrics(line: TextLine): { maxBubbleHeight: number; lineFontScale: number } | null {
    // 버그 수정(2026-09-09): a.start === 0(문단 맨 앞)뿐 아니라, start > 0이라도
    // annotationsOnFirstRow에 있으면(=실제로는 아직 줄바꿈 전, 같은 첫 행) 여기 합류시켜
    // Math.max로 함께 묶는다 — annotationSpacerSpecs가 그 주석엔 별도 spacer를 만들지
    // 않으므로, 이렇게 합류시키지 않으면 그 주석의 말풍선 높이가 어디에도 반영되지 않는다.
    const list = (line.annotations ?? []).filter((a) => a.start === 0 || annotationsOnFirstRow.has(a.id));
    if (list.length === 0) return null;
    let maxBubbleHeight = 0;
    let lineFontScale = 1;
    let any = false;
    for (const a of list) {
      const anchor = annotationAnchors.find((anc) => anc.annotation.id === a.id);
      const scale = anchor?.fontScale ?? 1;
      if (isAnnotationBelowAnchor(a.offsetY ?? 0, scale)) continue;
      any = true;
      lineFontScale = Math.max(lineFontScale, scale);
      const height = annotationHeights[a.id] ?? DEFAULT_ANNOTATION_HEIGHT * scale;
      maxBubbleHeight = Math.max(maxBubbleHeight, height);
    }
    if (!any) return null;
    return { maxBubbleHeight, lineFontScale };
  }

  /** annotationSpaceMetrics의 "아래" 버전 — 같은 후보 목록(문단 맨 앞 또는
   * annotationsOnFirstRow) 중 isAnnotationBelowAnchor가 true인(=텍스트 아래로
   * 이동한) 주석들만 모아 paddingBottom(reservedSpaceBelowForLine) 계산에 쓴다.
   * 요구사항(2026-09-09, 다음 줄을 밀어내는 로직): 이 줄 자신의 paddingBottom을
   * 늘리면 CSS 문서 흐름상 자동으로 다음 줄(및 그 아래 모든 내용)이 그만큼 밀려
   * 내려가므로, 이웃 줄의 존재 여부나 위치를 이 함수가 알 필요가 전혀 없다. */
  function annotationSpaceMetricsBelow(line: TextLine): { maxBubbleHeight: number; lineFontScale: number } | null {
    const list = (line.annotations ?? []).filter((a) => a.start === 0 || annotationsOnFirstRow.has(a.id));
    if (list.length === 0) return null;
    let maxBubbleHeight = 0;
    let lineFontScale = 1;
    let any = false;
    for (const a of list) {
      const anchor = annotationAnchors.find((anc) => anc.annotation.id === a.id);
      const scale = anchor?.fontScale ?? 1;
      if (!isAnnotationBelowAnchor(a.offsetY ?? 0, scale)) continue;
      any = true;
      lineFontScale = Math.max(lineFontScale, scale);
      const height = annotationHeights[a.id] ?? DEFAULT_ANNOTATION_HEIGHT * scale;
      maxBubbleHeight = Math.max(maxBubbleHeight, height);
    }
    if (!any) return null;
    return { maxBubbleHeight, lineFontScale };
  }

  /** 이 줄의 문단 맨 앞 주석(있다면, "텍스트 위"인 것만) 이 말풍선+연결선을 그릴
   * 공간을 얼마나 확보해야 하는지(월드 px, paddingTop으로 쓰인다). 문단 중간 주석은
   * 포함하지 않는다(annotationSpacerSpecs가 담당). */
  function reservedSpaceForLine(line: TextLine): number {
    const metrics = annotationSpaceMetrics(line);
    if (!metrics) return 0;
    return ANNOTATION_GAP * metrics.lineFontScale + metrics.maxBubbleHeight + ANNOTATION_SPACE_BUFFER * metrics.lineFontScale;
  }

  /** reservedSpaceForLine의 "아래" 버전(paddingBottom으로 쓰인다) — 요구사항
   * (2026-09-09, 주석을 텍스트 아래로도 이동 가능하게): "텍스트 아래"로 이동한
   * 주석이 있으면 이 줄 자신의 아래쪽에 그만큼의 공간을 확보해서, 뒤이은 줄이
   * 자연스럽게 밀려 내려가게 한다. */
  function reservedSpaceBelowForLine(line: TextLine): number {
    const metrics = annotationSpaceMetricsBelow(line);
    if (!metrics) return 0;
    return ANNOTATION_GAP * metrics.lineFontScale + metrics.maxBubbleHeight + ANNOTATION_SPACE_BUFFER * metrics.lineFontScale;
  }

  /** 이 줄의 문단 중간(annotation.start > 0)에 달린 주석들 각각에 대해, 그 자동
   * 줄바꿈된 행 위에 끼워 넣을 spacer 명세를 계산한다. 실제로 store의 runs를 바꾸지
   * 않는 순수 함수다 — annotation.start/annotationAnchors/annotationHeights(모두 이미
   * 최신 상태)만으로 매 렌더 결정적으로 계산되므로, DOM을 읽어 오프셋을 추정하는
   * 단계가 아예 없다(오프셋 드리프트가 구조적으로 발생할 수 없는 이유). 요구사항
   * (2026-09-09, 주석을 텍스트 아래로도 이동 가능하게): "텍스트 아래"로 이동한
   * 주석이면 verticalAlign을 'top'으로 줘서(lineDomSync.ts 참고) 같은 spacer가 그
   * 행의 위가 아니라 아래에 여백을 만들게 한다 — spacer의 삽입 위치(offset) 자체는
   * 안 바뀐다. */
  function annotationSpacerSpecs(line: TextLine): AnnotationSpacerSpec[] {
    // 버그 수정(2026-09-09): start > 0이어도 annotationsOnFirstRow에 있으면(=실제로는
    // 아직 첫 행 안, 위 annotationSpaceMetrics가 이미 그 높이를 paddingTop에 반영함)
    // 여기서 또 spacer를 만들면 같은 여백이 한 행 안에서 중복으로 더해져 간격이 2배로
    // 보인다 — 그래서 그런 주석은 제외한다. 진짜로 뒤 행에 걸리는(줄바꿈 이후) 주석만
    // 남는다.
    const list = (line.annotations ?? []).filter((a) => a.start > 0 && !annotationsOnFirstRow.has(a.id));
    if (list.length === 0) return [];
    return list.map((a) => {
      const anchor = annotationAnchors.find((anc) => anc.annotation.id === a.id);
      const scale = anchor?.fontScale ?? 1;
      const computedFontSizePx = anchor?.computedFontSizePx ?? object.baseFontSize;
      const bubbleHeight = annotationHeights[a.id] ?? DEFAULT_ANNOTATION_HEIGHT * scale;
      const naturalRowHeight = computedFontSizePx * lineHeightRatio;
      const extra = ANNOTATION_GAP * scale + bubbleHeight + ANNOTATION_SPACE_BUFFER * scale;
      const isBelow = isAnnotationBelowAnchor(a.offsetY ?? 0, scale);
      return { offset: a.start, heightPx: naturalRowHeight + extra, annotationId: a.id, verticalAlign: isBelow ? 'top' : 'bottom' };
    });
  }

  function getLineRefCallback(lineId: string): (el: HTMLDivElement | null) => void {
    let cb = lineRefCallbacksRef.current.get(lineId);
    if (!cb) {
      cb = (el) => {
        if (el) {
          lineElsRef.current.set(lineId, el);
          // 참고: 여기서 바로 lineDomRegistry에 등록하지 않는다. React의 commit 순서상
          // 자식(line div) ref가 부모(containerRef) ref보다 먼저 붙을 수 있어서, 이
          // 시점엔 containerRef.current가 아직 null일 수 있다. 실제 등록은 모든 ref가
          // 붙은 뒤 실행이 보장되는 아래 useLayoutEffect에서 한다.
        } else {
          // 이 콜백이 null로 불렸다는 것은 해당 줄이 실제로 트리에서 제거됐다는 뜻
          // (id가 바뀌지 않는 한 렌더만으로는 호출되지 않는다) — 이때만 정리한다.
          lineElsRef.current.delete(lineId);
          lastProcessedTextRef.current.delete(lineId);
          lineRefCallbacksRef.current.delete(lineId);
          unregisterLineEl(object.id, lineId);
        }
      };
      lineRefCallbacksRef.current.set(lineId, cb);
    }
    return cb;
  }

  // 렌더 커밋 직후(페인트 전) 두 가지 일을 순서대로 한다:
  // 1) store 텍스트와 실제 DOM 텍스트가 다른 줄만 textContent를 맞춰 쓴다.
  //    - 조합 중인 줄(isComposingRef && 그 줄에 포커스가 있음)은 절대 건드리지 않는다.
  //    - 사용자가 방금 그 줄에 타이핑해서 store를 DOM과 동일하게 동기화한 일반적인
  //      케이스는 이미 텍스트가 같으므로 아무 것도 쓰지 않는다(캐럿 보존).
  // 2) 대기 중인 focus 요청(Enter 새 줄/Backspace dedent·병합/화살표 변환 등)을 적용한다.
  //    텍스트 동기화가 끝난 뒤에 캐럿을 옮겨야 위치가 어긋나지 않는다.
  useLayoutEffect(() => {
    const containerEl = containerRef.current;
    // 버그 수정(2026-09-09, 같은 줄에 주석 2개 이상일 때 간격 2배): spacer를 계산하기
    // 전에, 문단 중간(start>0)에 달린 주석들이 실제로 아직 첫 행 안에 있는지 먼저
    // 측정해 모아둔다(annotationSpaceMetrics/annotationSpacerSpecs 위 주석, isOffsetWithinFirstVisualRow
    // 주석 참고). 이 값을 이번 pass의 spacer 계산(annotationSpacerSpecs)에는 아직
    // 반영하지 않는다(state는 다음 렌더부터 반영) — annotationHeights 등 다른 측정과
    // 같은 관례로, 한두 프레임 안에 스스로 정착한다.
    const nextOnFirstRowIds = new Set<string>();
    for (const line of object.lines) {
      const el = lineElsRef.current.get(line.id);
      if (!el) continue;
      // Phase 4: 모든 ref가 붙은 뒤(=이 effect가 도는 시점) 등록해야 containerRef.current가
      // 확실히 존재한다. registerLineEl은 같은 값으로 다시 불러도 안전(멱등)하다.
      if (containerEl) registerLineEl(object.id, line.id, el, containerEl);
      for (const a of line.annotations ?? []) {
        if (a.start > 0 && isOffsetWithinFirstVisualRow(el, a.start)) {
          nextOnFirstRowIds.add(a.id);
        }
      }
      const spacers = annotationSpacerSpecs(line);
      if (lineDomMatchesRuns(el, line.runs, spacers)) continue;
      if (isComposingRef.current && document.activeElement === el) continue;
      renderRunsIntoDom(el, line.runs, spacers);
      // 버그 수정(undo 직후 같은 편집을 반복하면 두 번째 Ctrl+Z가 씹힘): 여기서 DOM을
      // store 기준으로 강제로 다시 그렸다는 것은 "외부에서"(undo/redo, PropertiesPanel의
      // 구간 서식 적용 등) 텍스트가 바뀌었다는 뜻이다. syncLineFromDom의 dedupe
      // 캐시(lastProcessedTextRef)를 그대로 두면, 예전에 이미 처리했던 것과 우연히 같은
      // 최종 텍스트가 다시 나타났을 때(예: 삭제 → undo → 같은 삭제 재수행) 실제로는
      // store가 그 사이 되돌아가 있었는데도 "이미 처리한 텍스트"로 오인해 handleInput을
      // 건너뛴다 — store가 갱신되지 않으니 history에도 기록되지 않고, 다음 Ctrl+Z가
      // undo할 대상이 없어 아무 반응도 하지 않는 버그로 이어졌다. 방금 다시 그린 DOM
      // 텍스트로 캐시를 맞춰두면 이후 비교가 항상 "지금 실제 DOM/store 상태" 기준이 된다.
      lastProcessedTextRef.current.set(line.id, el.textContent ?? '');
    }
    setAnnotationsOnFirstRow((prev) => (sameIdSet(prev, nextOnFirstRowIds) ? prev : nextOnFirstRowIds));

    const req = focusRequestRef.current;
    if (req) {
      focusRequestRef.current = null;
      const el = lineElsRef.current.get(req.lineId);
      if (el) focusLineAt(el, req.offset);
    } else if (isEditing && !wasEditingRef.current) {
      // 버그 수정: 방금 생성된 Text 객체는 (spawnTextAt이 store 상태를 만들면서)
      // 처음부터 isEditing=true로 마운트되는데, 이때는 명시적 focusRequest가 없어서
      // 위 분기가 실행되지 않아 caret이 아예 놓이지 않았다(그래서 사용자가 다시
      // 더블클릭해야만 캐럿이 생기는 버그). double-click(handleDoubleClick)처럼
      // 명시적 요청이 없을 때는 첫 줄 끝에 기본 caret을 놓는다. wasEditingRef로
      // "방금 편집 모드로 들어온 순간"에만(false→true 전이) 한 번 실행되도록 한다 —
      // 이미 편집 중인 상태에서 매 키 입력마다 재실행되는 일은 없다.
      const first = object.lines[0];
      const firstEl = first && lineElsRef.current.get(first.id);
      if (firstEl) focusLineAt(firstEl, lineText(first).length);
    }

    if (!hasEverHadContentRef.current && object.lines.some((line) => lineText(line) !== '')) {
      hasEverHadContentRef.current = true;
    }
    // 요구사항(빈 텍스트 상자 자동 삭제): Escape/다른 객체 선택/배경 클릭 등 편집을
    // 벗어나는 모든 경로가 isEditing을 true→false로 바꾸므로 이 한 곳에서 전부
    // 처리된다. 이 객체가 여전히 "선택된 유일한 객체"일 때만(=다른 객체를 클릭해서
    // 넘어간 게 아니라 Escape나 배경 클릭으로 여기서 벗어난 경우만) 선택도 함께
    // 해제한다 — 그렇지 않으면 막 새로 선택된 다른 객체의 선택이 지워져 버린다.
    if (wasEditingRef.current && !isEditing && !hasEverHadContentRef.current) {
      useObjectsStore.getState().removeObject(object.id);
      const interaction = useInteractionStore.getState();
      if (interaction.selectedIds.length === 1 && interaction.selectedIds[0] === object.id) {
        interaction.deselect();
      }
    }
    wasEditingRef.current = isEditing;

    // Phase 4: 하이라이트 사각형 재계산. 텍스트 sync가 끝난 뒤(=DOM이 store와
    // 일치한 뒤) Range.getClientRects()로 실제 글자 위치를 측정한다.
    // 여기서 나오는 값은 containerEl 기준 상대 좌표를 zoom으로 나눠 정규화한
    // 것이라 zoom 자체가 바뀌어도 값이 변하지 않는다(수식상 zoom이 상쇄됨) —
    // 그래서 이 effect가 zoom 변경에 반응하지 않아도 값은 항상 유효하다.
    if (containerEl) {
      const containerRect = containerEl.getBoundingClientRect();
      const zoom = useViewportStore.getState().zoom;
      // 버그 수정(형광펜이 커밋 직후 1px 아래로 "떨어져 보이는" 문제의 근본 원인):
      // getBoundingClientRect()는 항상 border box(테두리 바깥 모서리)를 반환하지만,
      // 이 컨테이너에 걸린 자식들의 position:absolute는 CSS 스펙상 padding box(테두리
      // 안쪽) 기준으로 배치된다 — 이 컨테이너는 border: '1px solid ...'가 있으므로
      // (아래 style 참고) 그 차이(=border 두께)만큼 매 좌표 계산이 항상 오른쪽/아래로
      // 밀려 있었다. element.clientLeft/clientTop이 정확히 그 border 두께(로컬 px,
      // zoom 영향 없음)이므로 zoom을 곱해 화면 px로 변환해 origin에 더해준다.
      const originLeft = containerRect.left + containerEl.clientLeft * zoom;
      const originTop = containerRect.top + containerEl.clientTop * zoom;
      const nextRects: HighlightRect[] = [];
      const nextAnchors: AnnotationAnchor[] = [];
      const nextHangingIndents = new Map<string, number>();
      for (const line of object.lines) {
        const el = lineElsRef.current.get(line.id);
        if (!el) continue;
        const textLen = el.textContent?.length ?? 0;

        // 요구사항(2026-09, 줄바꿈 매달린 들여쓰기): 이 줄이 '-'/'·'/':' 로 시작해서
        // 본문이 실제로 시작되는 지점이 있으면, 그 지점의 실제 렌더 픽셀 위치를 측정해
        // anchor.offsetPx와의 차이(=표시 기호 자체가 차지하는 폭)를 구해둔다. 상자
        // 폭을 넘겨 이 줄이 화면에서 접히면(soft-wrap), 아래 style의 paddingLeft/
        // textIndent가 이 값만큼 첫 줄은 원래 위치 그대로 두고 이어지는 줄만 오른쪽으로
        // 더 밀어(hanging indent) 본문 시작 지점에 맞춰 걸리게 한다.
        const hangingPrefixLen = computeHangingMarkerPrefixLength(lineText(line));
        if (hangingPrefixLen !== null) {
          const markerEndOffsetPx = measureCharOffsetPx(el, hangingPrefixLen, containerEl, zoom);
          const hang = markerEndOffsetPx - line.anchor.offsetPx;
          if (hang > 0.5) nextHangingIndents.set(line.id, hang);
        }

        for (const h of line.highlights ?? []) {
          const start = Math.max(0, Math.min(h.start, textLen));
          const end = Math.max(0, Math.min(h.end, textLen));
          if (end <= start) continue;
          const range = rangeForOffsets(el, start, end);
          if (!range) continue;
          const rects = mergeClientRectsByLine(range.getClientRects());
          for (let i = 0; i < rects.length; i++) {
            const r = rects[i];
            if (r.width <= 0 || r.height <= 0) continue;
            nextRects.push({
              key: `${h.id}-${i}`,
              highlightId: h.id,
              lineId: line.id,
              left: (r.left - originLeft) / zoom,
              top: (r.top - originTop) / zoom,
              width: r.width / zoom,
              height: r.height / zoom,
              color: h.color,
            });
          }
        }

        // Phase 4(버그 수정): 주석 anchor — 화살표가 가리킬 지점(구간의 왼쪽 끝/맨 위)만
        // 있으면 되므로 getClientRects()가 아니라 getBoundingClientRect()로 충분하다
        // (구간이 줄바꿈으로 여러 조각이어도 하나의 bounding box로 합쳐서 쓴다).
        // 화살표는 구간의 왼쪽 끝(=드래그한 텍스트의 첫 글자)을 정확히 가리켜야 하므로
        // rect.left(왼쪽 끝)를 기준으로 삼는다(가운데 정렬 아님).
        for (const a of line.annotations ?? []) {
          const start = Math.max(0, Math.min(a.start, textLen));
          const end = Math.max(0, Math.min(a.end, textLen));
          if (end <= start) continue;
          const range = rangeForOffsets(el, start, end);
          if (!range) continue;
          const rect = range.getBoundingClientRect();
          if (rect.width <= 0 && rect.height <= 0) continue;
          const anchorLeft = (rect.left - originLeft) / zoom;
          const top = (rect.top - originTop) / zoom;
          // 요구사항(2026-09-09 2차 수정, 아래 배치 시 anchor 자신의 글자와 겹치는
          // 버그): "아래" 배치의 시작점을 anchor.top이 아니라 이 구간의 실제 바닥
          // (anchor.top + height)으로 잡기 위해 필요하다 — 아래 AnnotationBubble.tsx
          // 참고.
          const height = rect.height / zoom;

          // target Text의 실제 가로 범위(컨테이너 padding 안쪽) 기준으로 clamp한다 —
          // Annotation은 Canvas/Frame 전체가 아니라 이 Text 객체의 박스를 벗어날 수 없다.
          const textInnerLeft = TEXT_PADDING;
          const textInnerRight = Math.max(textInnerLeft + MIN_ANNOTATION_WIDTH, object.width - TEXT_PADDING);

          // 요구사항 5번: anchor 구간이 실제로 렌더링된 DOM 요소의 computed font-size를
          // 직접 읽는다 — object.baseFontSize(객체 전체 기본값)가 아니라 이 위치의
          // 실제 값을 써야 Phase 8 부분 서식(구간별 다른 fontSize)에도 정확하다.
          // range.startContainer는 보통 텍스트 노드이므로 그 부모 엘리먼트(<span>
          // run 또는 line div 자신)에서 font-size를 읽는다. transform:scale로 확대/
          // 축소되는 조상 안에 있어도 computed font-size 자체는 transform 이전(레이아웃
          // 단계) 값이라 zoom으로 나눌 필요가 없다.
          const startNode = range.startContainer;
          const fontSizeEl =
            startNode.nodeType === Node.TEXT_NODE ? startNode.parentElement : (startNode as Element | null);
          const computedFontSizePx = fontSizeEl
            ? parseFloat(getComputedStyle(fontSizeEl).fontSize)
            : object.baseFontSize;
          const nominalScale =
            Number.isFinite(computedFontSizePx) && computedFontSizePx > 0
              ? computedFontSizePx / REFERENCE_FONT_SIZE
              : 1;
          // 요구사항(실제 렌더링 크기 반영): 단순 pt 비율(nominalScale)에 이 위치의
          // 실제 폰트가 기준 폰트 대비 얼마나 크게/작게 그려지는지의 실측 배율을 곱한다.
          const computedFontFamily = fontSizeEl
            ? getComputedStyle(fontSizeEl).fontFamily
            : object.fontFamily || DEFAULT_FONT_FAMILY;
          const fontScale = nominalScale * fontHeightScaleFor(computedFontFamily);

          // 버그 수정(생성 직후 화살표가 과도하게 세워 보이는 문제, AnnotationBubble.tsx의
          // DEFAULT_ANNOTATION_OFFSET_X_BASE 주석 참고): a.offsetX가 한 번도 설정된 적
          // 없으면(사용자가 아직 드래그해본 적 없는 새 주석) 0이 아니라 이 기본값을 써서,
          // annotation-arrow.svg가 실제로 그려진 자연스러운 각도에 가깝게 첫 프레임부터
          // 보이게 한다 — fontScale로 스케일해 다른 _BASE 상수들과 같은 비례를 따른다.
          // 사용자가 실제로 드래그하면 a.offsetX가 채워지면서 이 기본값은 더 이상 쓰이지 않는다.
          const offsetX = a.offsetX ?? DEFAULT_ANNOTATION_OFFSET_X_BASE * fontScale;
          const rawLeft = anchorLeft + offsetX;
          const clampedLeft = Math.min(Math.max(rawLeft, textInnerLeft), textInnerRight);
          const maxWidth = Math.max(MIN_ANNOTATION_WIDTH, textInnerRight - clampedLeft);

          nextAnchors.push({
            lineId: line.id,
            annotation: a,
            anchorLeft,
            top,
            height,
            left: clampedLeft,
            maxWidth,
            fontScale,
            computedFontSizePx: Number.isFinite(computedFontSizePx) && computedFontSizePx > 0 ? computedFontSizePx : object.baseFontSize,
          });
        }
      }
      setHighlightRects((prev) => (sameRects(prev, nextRects) ? prev : nextRects));
      setAnnotationAnchors((prev) => (sameAnchors(prev, nextAnchors) ? prev : nextAnchors));
      setHangingIndents((prev) => (sameHangingIndents(prev, nextHangingIndents) ? prev : nextHangingIndents));

      // 더 이상 존재하지 않는 주석의 높이 기록은 정리한다(메모리 누수 방지 + 언젠가
      // 같은 id가 재사용될 일은 없지만 깔끔하게 유지).
      const liveIds = new Set(nextAnchors.map((a) => a.annotation.id));
      setAnnotationHeights((prev) => {
        const staleKeys = Object.keys(prev).filter((id) => !liveIds.has(id));
        if (staleKeys.length === 0) return prev;
        const next = { ...prev };
        for (const k of staleKeys) delete next[k];
        return next;
      });
      for (const id of annotationSeasonedRef.current) {
        if (!liveIds.has(id)) annotationSeasonedRef.current.delete(id);
      }

      // 요구사항 4번: 텍스트 상자는 내부 스크롤 대신 내용에 맞춰 세로로 자동
      // 확장된다. scrollHeight는 실제로 화면에 그려지는 크기(overflow로 잘리는지와
      // 무관하게)가 아니라 "콘텐츠가 필요로 하는 전체 레이아웃 높이"를 그대로
      // 반영하므로, 매 렌더마다 이 값을 재서 object.height와 다르면 store에
      // 반영한다. DOM 텍스트 동기화(renderRunsIntoDom)와 주석 여백(reservedSpaceForLine,
      // paddingTop)이 이미 이 effect 앞부분에서 반영된 뒤이므로 scrollHeight가 항상
      // 최신 레이아웃을 반영한다. transform:scale로 확대/축소되는 조상(canvas-world)
      // 안에 있어도 scrollHeight 자체는 transform 이전 레이아웃 단계의 값이라
      // zoom으로 나눌 필요가 없다(다른 rect 기반 측정과 달리 getBoundingClientRect를
      // 쓰지 않기 때문).
      //
      // 위 hasPendingCustomFont() 주석 참고: 이 객체가 참조하는 커스텀 폰트 중 하나라도
      // 아직 로드되지 않았으면 이번 렌더의 scrollHeight는 잘못된(브라우저 기본 글꼴
      // 기준) 값이므로 아예 재지도, store에 반영하지도 않는다 — customFonts가 갱신되면
      // deps로 effect가 다시 돌아 그때 정확한 값으로 측정한다.
      if (hasPendingCustomFont()) return;
      const measuredHeight = containerEl.scrollHeight;
      const nextHeight = Math.max(MIN_TEXT_HEIGHT, measuredHeight);
      // 요구사항(자동 높이는 커지는 방향으로만): 이 effect가 아직 한 번도 높이를
      // 맞춰본 적 없으면(방금 생성/마운트) 첫 측정에 한해 커지든 줄어들든 그대로
      // 반영해서 실제 폰트 기준 자연스러운 높이로 맞추고, 그 이후로는 "콘텐츠가 실제로
      // 더 필요로 하게 됐을 때만" 키운다(줄어드는 방향은 절대 반영하지 않음).
      //
      // 버그 재발(2026-09, 커밋 6901e73): "리사이즈로 줄인 상자가 새로고침하면 다시
      // 커짐"을 고치려고 예전엔 object.manualHeight가 true면 이 블록 전체를 건너뛰게
      // 했는데, 그러면 리사이즈 이후 가로 폭을 더 줄여 줄바꿈이 늘어나도 세로가 전혀
      // 안 자라 글자가 상자 밖으로 삐져나오는 별개 버그가 생겼다. 그래서 "manualHeight
      // 여부와 무관하게 grow-only 규칙은 항상 적용한다"(nextHeight를 object.height와
      // 직접 비교)로 바꿨는데, 이게 원래 버그를 그대로 되살렸다 — 이 컨테이너는
      // overflow:'visible'이라 scrollHeight(=nextHeight)는 상자에 실제로 설정된
      // 높이와 무관하게 "내용이 차지하는 전체 레이아웃 높이"를 항상 그대로 반환한다
      // (헤드리스 브라우저로 직접 확인: overflow:visible + 고정 height여도 scrollHeight는
      // 줄어들지 않고 자식 콘텐츠의 실제 높이를 반환한다). 즉 사용자가 내용보다 작게
      // 리사이즈해두면 nextHeight는 그 이후로도 영원히 "내용의 전체 높이"를 가리키므로,
      // "nextHeight가 지금 object.height보다 크면 키운다"는 비교는 리사이즈 직후는
      // 물론 다음 렌더마다(그리고 새로고침 후 첫 렌더에도) 계속 참이 되어 무조건 다시
      // 키워버렸다("일정 크기보다 작게 안 만들어짐" 버그의 원인).
      //
      // 진짜 수정: nextHeight를 "지금 설정된 object.height"와 비교하는 대신, "직전에
      // 측정했던 콘텐츠 높이" 기준선(lastMeasuredContentHeightRef, 컴포넌트 인스턴스별로
      // 살아있음)과 비교한다. 콘텐츠 자체가 그 기준선보다 실제로 더 커졌을 때만
      // (타이핑/폰트 변경/줄바꿈 증가 등으로 진짜 더 많은 공간이 필요해졌을 때만) 그
      // 증가분을 상자가 못 따라가면 키운다 — 콘텐츠는 그대로인데 사용자가 상자만 줄인
      // 경우(리사이즈 직후, 그리고 새로고침 뒤 재측정)는 nextHeight가 기준선과 같으므로
      // 더 이상 자동으로 키우지 않는다. object.manualHeight는 여전히 "방금 생성된
      // 상자의 첫 측정에 한해 줄어드는 것도 허용"하는 예외(아래 isGenuinelyFreshObject)
      // 에서만 쓰인다 — 그 예외가 아니면(한 번이라도 리사이즈됐거나 이미 존재하던
      // 객체가 새로고침으로 다시 마운트된 경우) 이 effect의 첫 실행은 그 순간의 콘텐츠
      // 높이를 "기준선으로 조용히 채택"만 하고 object.height는 절대 건드리지 않는다 —
      // 그래서 사용자가 정해둔(또는 이미 저장돼 있던) 크기가 새로고침 직후에도 그대로
      // 유지된다.
      const isGenuinelyFreshObject = !object.manualHeight && object.createdAt === object.updatedAt;
      const baseline = lastMeasuredContentHeightRef.current;
      if (baseline === null) {
        // 이 컴포넌트 인스턴스에서 처음 도는 실행(방금 마운트/새로고침 후 재마운트).
        lastMeasuredContentHeightRef.current = nextHeight;
        if (isGenuinelyFreshObject && Math.abs(nextHeight - object.height) > 0.5) {
          useObjectsStore.getState().updateObject(object.id, { height: nextHeight }, `text:${object.id}`);
        }
      } else if (nextHeight - baseline > 0.5) {
        // 콘텐츠가 실제로 더 커졌다 — 기준선을 갱신하고, 지금 높이가 그걸 못
        // 따라가면(넘치면) 키운다.
        lastMeasuredContentHeightRef.current = nextHeight;
        if (nextHeight - object.height > 0.5) {
          // coalesceKey를 setTextLines와 같은 `text:${id}`로 맞춰서, 연속 타이핑 중
          // 매 키 입력마다 뒤따르는 높이 조정이 별도 undo 단계로 쌓이지 않고 방금
          // 커밋된 텍스트 편집 undo 단계에 자연스럽게 합쳐지게 한다(historyStore.ts의
          // 시간창 코얼레싱). 리사이즈 드래그(폭 변경) 도중이면 useObjectResize가 이미
          // 열어 둔 트랜잭션이 있어서 coalesceKey와 무관하게 그 트랜잭션에 합쳐진다.
          useObjectsStore.getState().updateObject(object.id, { height: nextHeight }, `text:${object.id}`);
        }
      } else if (nextHeight < baseline - 0.5) {
        // 콘텐츠가 줄었다(텍스트 삭제 등) — 기준선만 낮춰서 다음에 다시 늘어날 때
        // 정확히 비교되게 하고, 상자 자체는 여전히 줄이지 않는다(맨 위 요구사항).
        lastMeasuredContentHeightRef.current = nextHeight;
      }
    }
    // annotationHeights를 deps에 포함해야 한다: 주석 높이가 바뀌면(줄 수 증가) 그 줄의
    // paddingTop(reservedSpaceForLine)이 바뀌고, anchor.top(텍스트의 실제 렌더 위치)도
    // 그만큼 밀리므로 다시 측정해야 화살표/말풍선이 어긋나지 않는다. object.baseFontSize/
    // object.fontFamily도 포함한다 — 요구사항 5번(주석/밑줄 비례)의 fontScale 계산이
    // 이 값들에 의존하므로(폰트를 바꾸면 fontHeightScaleFor 배율도 달라진다),
    // PropertiesPanel에서 글자 크기/글꼴만 바꿔도(lines/width는 그대로) 다시 측정해야
    // 한다. object.lineHeight도 마찬가지 이유로 포함한다 — 사이드바에서 줄 간격만
    // 바꿔도(텍스트 자체는 그대로) 상자 높이와 spacer 위치를 다시 재야 한다.
    // 버그 수정(리사이즈 핸들로 상자를 줄이면 글자가 밖으로 삐져나온 채 복구되지 않음):
    // object.height는 예전엔 "이 effect 자신이 쓰는 값이라 deps에 넣으면 자기 자신을
    // 다시 트리거할 루프가 생긴다"는 이유로 의도적으로 빠져 있었다 — 그런데 그 결과
    // object.height "만" 바뀌는 경우(리사이즈 핸들로 폭은 그대로 두고 높이만 드래그하는
    // 경우 등 — object.lines/width/fontSize 등 다른 deps는 전혀 안 바뀜)엔 이 effect가
    // 아예 재실행되지 않아서, 리사이즈로 내용보다 작아진 높이를 자동으로 다시 키워주는
    // "커지는 방향으로만" 안전장치 자체가 발동할 기회가 없었다 — 즉 글자가 상자
    // 밖으로 넘쳐도 아무도 고쳐주지 않았다. 위 shouldApply의 임계값 비교(0.5px)가
    // 이 effect 자신의 updateObject 호출로 인한 재실행을 "다음 재실행에서 변화 없음"으로
    // 정확히 잡아내 멈추므로(다음 nextHeight가 방금 적용한 값과 같아짐), 실제로는
    // 루프 걱정 없이 안전하게 deps에 넣을 수 있다. customFonts는 위 주석(버그 수정) 참고 —
    // 커스텀 폰트가 비동기로 뒤늦게 등록됐을 때 실제 글자 위치로 재측정하기 위함이다.
  }, [
    object.id,
    object.lines,
    object.width,
    object.height,
    object.baseFontSize,
    object.fontFamily,
    object.lineHeight,
    object.manualHeight,
    isEditing,
    annotationHeights,
    annotationsOnFirstRow,
    customFonts,
  ]);

  const updateLines = (nextLines: TextLine[]) => {
    setTextLines(object.id, nextLines);
  };

  /**
   * 요구사항(줄 사이로 드래그 선택): 여러 줄에 걸친 선택(segments.length > 1 — 각 줄이
   * 독립된 contentEditable이라, 이런 선택은 아래 line div의 onPointerDown이 Selection
   * API(setBaseAndExtent)로 직접 만들어준 것이다)을 insertedRuns로 갈아치운다. 선택된
   * 첫 줄의 [start, 끝)과 마지막 줄의 [0, end) 사이(=완전히 선택된 중간 줄들 포함)를
   * 전부 들어내고, 그 자리에 insertedRuns를 끼워 하나의 줄로 합친다.
   * Backspace(insertedRuns=[]) · 문자 입력으로 선택 덮어쓰기 · 잘라내기 셋이 이 함수
   * 하나를 공유한다.
   */
  function computeCrossLineReplace(
    segments: SelectionSegment[],
    insertedRuns: TextRun[],
  ): { nextLines: TextLine[]; lineId: string; offset: number } | null {
    if (segments.length < 2) return null;
    const firstSeg = segments[0];
    const lastSeg = segments[segments.length - 1];
    const firstLineIndex = object.lines.findIndex((l) => l.id === firstSeg.lineId);
    const lastLineIndex = object.lines.findIndex((l) => l.id === lastSeg.lineId);
    if (firstLineIndex === -1 || lastLineIndex === -1 || firstLineIndex > lastLineIndex) return null;

    const firstLine = object.lines[firstLineIndex];
    const lastLine = object.lines[lastLineIndex];
    const insertedLength = insertedRuns.reduce((n, r) => n + r.text.length, 0);
    const joinOffset = firstSeg.start;
    const shiftAmount = joinOffset + insertedLength;

    const { before: runsBefore } = splitRunsAtOffset(firstLine.runs, firstSeg.start);
    const { after: runsAfter } = splitRunsAtOffset(lastLine.runs, lastSeg.end);
    const mergedRuns = joinRuns(joinRuns(runsBefore, insertedRuns), runsAfter);

    const { before: highlightsBefore } = splitHighlightsAtOffset(firstLine.highlights, firstSeg.start);
    const { after: highlightsAfterRaw } = splitHighlightsAtOffset(lastLine.highlights, lastSeg.end);
    const mergedHighlights = [
      ...highlightsBefore,
      ...highlightsAfterRaw.map((h) => ({ ...h, start: h.start + shiftAmount, end: h.end + shiftAmount })),
    ];

    const { before: annotationsBefore } = splitHighlightsAtOffset(firstLine.annotations, firstSeg.start);
    const { after: annotationsAfterRaw } = splitHighlightsAtOffset(lastLine.annotations, lastSeg.end);
    const mergedAnnotations = [
      ...annotationsBefore,
      ...annotationsAfterRaw.map((a) => ({ ...a, start: a.start + shiftAmount, end: a.end + shiftAmount })),
    ];

    const mergedLine: TextLine = {
      ...firstLine,
      runs: mergedRuns,
      highlights: mergedHighlights.length ? mergedHighlights : undefined,
      annotations: mergedAnnotations.length ? mergedAnnotations : undefined,
    };

    const nextLines = [...object.lines];
    nextLines.splice(firstLineIndex, lastLineIndex - firstLineIndex + 1, mergedLine);

    return { nextLines, lineId: mergedLine.id, offset: shiftAmount };
  }

  /**
   * 요구사항(붙여넣기가 커서 위치에 반영되도록): 줄마다 독립된 contentEditable이라
   * 커스텀 핸들러가 없으면 브라우저 기본 붙여넣기에 맡겨지는데, 줄바꿈이 있는 텍스트를
   * 붙이면 브라우저가 중첩 <div>를 만들고 이 앱의 DOM 동기화(lineDomSync.ts의
   * readRunsFromDom)가 그 구조를 모르는 채로 textContent만 이어붙여 버려서 줄바꿈이
   * 사라지고 커서 위치도 어긋난다. 그래서 항상 e.preventDefault()로 기본 동작을 막고
   * 클립보드의 순수 텍스트를 직접 커서(또는 선택 구간) 자리에 반영한다 — 줄바꿈이
   * 없으면 이 줄 안에서만 처리하고, 있으면 handleEnter와 같은 원리로 새 줄들을 만든다.
   */
  const handlePaste = (lineIndex: number) => (e: ReactClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!text) return;
    e.preventDefault();

    const lineEl = e.currentTarget;
    const current = object.lines[lineIndex];
    const caret = getCaretOffset(lineEl);
    const withinLine = getSelectionOffsetsWithinLine(lineEl);
    const start = withinLine ? withinLine.start : caret;
    const end = withinLine ? withinLine.end : caret;

    const segments = text.split(/\r\n|\r|\n/);

    const { before: runsBeforeStart } = splitRunsAtOffset(current.runs, start);
    const { after: runsAfterEnd } = splitRunsAtOffset(current.runs, end);
    const { before: highlightsBeforeStart } = splitHighlightsAtOffset(current.highlights, start);
    const { after: highlightsAfterEndRaw } = splitHighlightsAtOffset(current.highlights, end);
    const { before: annotationsBeforeStart } = splitHighlightsAtOffset(current.annotations, start);
    const { after: annotationsAfterEndRaw } = splitHighlightsAtOffset(current.annotations, end);

    const nextLines = [...object.lines];

    if (segments.length === 1) {
      const pasted = segments[0];
      const pastedRuns = pasted ? [{ text: pasted }] : [];
      const mergedRuns = joinRuns(joinRuns(runsBeforeStart, pastedRuns), runsAfterEnd);
      const shiftAmount = start + pasted.length;
      const mergedHighlights = [
        ...highlightsBeforeStart,
        ...highlightsAfterEndRaw.map((h) => ({ ...h, start: h.start + shiftAmount, end: h.end + shiftAmount })),
      ];
      const mergedAnnotations = [
        ...annotationsBeforeStart,
        ...annotationsAfterEndRaw.map((a) => ({ ...a, start: a.start + shiftAmount, end: a.end + shiftAmount })),
      ];
      nextLines[lineIndex] = {
        ...current,
        runs: mergedRuns,
        highlights: mergedHighlights.length ? mergedHighlights : undefined,
        annotations: mergedAnnotations.length ? mergedAnnotations : undefined,
      };
      focusRequestRef.current = { lineId: current.id, offset: shiftAmount };
      updateLines(nextLines);
      return;
    }

    const lastIndex = segments.length - 1;
    nextLines[lineIndex] = {
      ...current,
      runs: joinRuns(runsBeforeStart, segments[0] ? [{ text: segments[0] }] : []),
      highlights: highlightsBeforeStart.length ? highlightsBeforeStart : undefined,
      annotations: annotationsBeforeStart.length ? annotationsBeforeStart : undefined,
    };

    const middleLines: TextLine[] = [];
    for (let i = 1; i < lastIndex; i++) {
      middleLines.push({
        id: createLineId(),
        runs: segments[i] ? [{ text: segments[i] }] : [],
        anchor: current.anchor,
      });
    }

    const lastSegmentText = segments[lastIndex];
    const lastLineShift = lastSegmentText.length;
    const lastLine: TextLine = {
      id: createLineId(),
      runs: joinRuns(lastSegmentText ? [{ text: lastSegmentText }] : [], runsAfterEnd),
      anchor: current.anchor,
      highlights: highlightsAfterEndRaw.length
        ? highlightsAfterEndRaw.map((h) => ({ ...h, start: h.start + lastLineShift, end: h.end + lastLineShift }))
        : undefined,
      annotations: annotationsAfterEndRaw.length
        ? annotationsAfterEndRaw.map((a) => ({ ...a, start: a.start + lastLineShift, end: a.end + lastLineShift }))
        : undefined,
    };

    nextLines.splice(lineIndex + 1, 0, ...middleLines, lastLine);
    focusRequestRef.current = { lineId: lastLine.id, offset: lastLineShift };
    updateLines(nextLines);
  };

  /**
   * 요구사항(줄 사이로 드래그 선택): 여러 줄에 걸친 선택 상태에서 Ctrl+X를 누르면,
   * 네이티브 잘라내기는 포커스가 있는 줄(하나의 contentEditable)만 지울 뿐 다른
   * 줄들의 선택 구간은 그대로 남기거나 깨뜨릴 수 있다 — 그래서 이 경우만 직접
   * 클립보드에 선택된 텍스트를 쓰고 computeCrossLineReplace로 지운다. 한 줄 안의
   * 선택은(segments.length <= 1) 기존처럼 브라우저 기본 잘라내기에 맡긴다.
   */
  const handleCut = (e: ReactClipboardEvent<HTMLDivElement>) => {
    const segments = captureSelectionSegments().filter((s) => s.objectId === object.id);
    if (segments.length < 2) return;
    e.preventDefault();

    const text = segments
      .map((seg) => {
        const line = object.lines.find((l) => l.id === seg.lineId);
        return line ? lineText(line).slice(seg.start, seg.end) : '';
      })
      .join('\n');
    e.clipboardData?.setData('text/plain', text);

    const result = computeCrossLineReplace(segments, []);
    if (!result) return;
    focusRequestRef.current = { lineId: result.lineId, offset: result.offset };
    updateLines(result.nextLines);
  };

  const handleDoubleClick = () => {
    // 요구사항(객체 잠금): 잠긴 텍스트는 선택은 되지만(위 select 자체는 계속 허용)
    // 내용 편집 모드로는 들어가지 않는다 — contentEditable이 열리면 사실상 잠금이
    // 의미가 없어지므로 여기서 막는다.
    if (object.locked) {
      useInteractionStore.getState().select(object.id);
      return;
    }
    useInteractionStore.getState().select(object.id);
    useInteractionStore.getState().setMode('text-edit');
    const first = object.lines[0];
    if (first) {
      focusRequestRef.current = { lineId: first.id, offset: lineText(first).length };
    }
  };

  const handleEnter = (lineIndex: number, beforeText: string, lineEl: HTMLDivElement) => {
    const current = object.lines[lineIndex];
    const colonPoint = findColonAlignmentPoint(beforeText);

    let colonOffsetPx: number | undefined;
    if (colonPoint && containerRef.current) {
      colonOffsetPx = measureCharOffsetPx(lineEl, colonPoint.charIndex, containerRef.current, useViewportStore.getState().zoom);
    }

    const newAnchor = computeEnterAnchor(beforeText, current.anchor, colonOffsetPx);

    // Phase 4: 커서 위치(beforeText.length)를 기준으로 이 줄의 하이라이트/주석을
    // "이 줄에 남을 것"과 "새 줄로 옮겨갈 것"으로 나눈다.
    const { before: highlightsBefore, after: highlightsAfter } = splitHighlightsAtOffset(
      current.highlights,
      beforeText.length,
    );
    const { before: annotationsBefore, after: annotationsAfter } = splitHighlightsAtOffset(
      current.annotations,
      beforeText.length,
    );
    // Phase 8(부분 서식): 커서 위치에서 run도 나눠서 각 조각이 원래 스타일을 그대로
    // 유지한 채 이 줄/새 줄로 갈라진다(highlightModel.ts의 splitHighlightsAtOffset과
    // 같은 자리에서 쓰이는 텍스트 버전 — objects/text/runStyle.ts 참고).
    const { before: runsBefore, after: runsAfter } = splitRunsAtOffset(current.runs, beforeText.length);

    const updatedCurrent: TextLine = {
      ...current,
      runs: runsBefore,
      highlights: highlightsBefore.length ? highlightsBefore : undefined,
      annotations: annotationsBefore.length ? annotationsBefore : undefined,
    };
    const newLine: TextLine = {
      id: createLineId(),
      runs: runsAfter,
      anchor: newAnchor,
      highlights: highlightsAfter.length ? highlightsAfter : undefined,
      annotations: annotationsAfter.length ? annotationsAfter : undefined,
    };

    const nextLines = [...object.lines];
    nextLines[lineIndex] = updatedCurrent;
    nextLines.splice(lineIndex + 1, 0, newLine);

    focusRequestRef.current = { lineId: newLine.id, offset: 0 };
    updateLines(nextLines);
  };

  const handleBackspaceAtStart = (lineIndex: number) => {
    const current = object.lines[lineIndex];
    const parentAnchor = computeBackspaceAnchor(current.anchor);

    if (parentAnchor) {
      // dedent만 수행. 텍스트는 그대로 둔다.
      const nextLines = [...object.lines];
      nextLines[lineIndex] = { ...current, anchor: parentAnchor };
      focusRequestRef.current = { lineId: current.id, offset: 0 };
      updateLines(nextLines);
      return;
    }

    // 이미 root 단계 → 일반적인 backspace(윗 줄과 병합). 첫 줄이면 아무 것도 하지 않는다.
    if (lineIndex === 0) return;

    const prev = object.lines[lineIndex - 1];
    const prevText = lineText(prev);
    // Phase 8(부분 서식): mergeHighlightsForLineJoin과 같은 원리로 runs도 이어붙인다
    // (joinRuns가 경계의 두 run이 스타일까지 같으면 하나로 합쳐준다).
    const mergedRuns = joinRuns(prev.runs, current.runs);
    const mergedHighlights = mergeHighlightsForLineJoin(prev.highlights, current.highlights, prevText.length);
    const mergedAnnotations = mergeHighlightsForLineJoin(prev.annotations, current.annotations, prevText.length);

    const nextLines = [...object.lines];
    nextLines.splice(lineIndex - 1, 2, {
      ...prev,
      runs: mergedRuns,
      highlights: mergedHighlights.length ? mergedHighlights : undefined,
      annotations: mergedAnnotations.length ? mergedAnnotations : undefined,
    });

    focusRequestRef.current = { lineId: prev.id, offset: prevText.length };
    updateLines(nextLines);
  };

  const handleInput = (lineIndex: number, lineEl: HTMLDivElement) => {
    const current = object.lines[lineIndex];
    const oldText = lineText(current);
    let newText = lineEl.textContent ?? '';
    let cursorIndex = getCaretOffset(lineEl);

    const arrowResult = convertArrowTokenAtCursor(newText, cursorIndex);
    if (arrowResult.converted) {
      newText = arrowResult.text;
      cursorIndex = arrowResult.cursorIndex;
    }

    // Phase 8(부분 서식): 보통은 방금 타이핑한 span(run)의 텍스트만 읽어 그 run의
    // 스타일은 그대로 두고 내용만 갱신한다(readRunsFromDom). 화살표 토큰 변환(-> → →)은
    // 사용자가 실제로 친 것과 다른 텍스트로 갈아치우는 드문 구조적 변경이라 이 줄의
    // run 구성을 그대로 유지할 수 없다 — 그 순간만 단일 plain run으로 접는다(이 줄의
    // 기존 스타일이 있었다면 이번 한 번만 사라진다, 매우 드문 트레이드오프).
    const newRuns = arrowResult.converted
      ? (newText ? [{ text: newText }] : [])
      : readRunsFromDom(lineEl, current.runs);

    let nextAnchor = current.anchor;

    // 빈 줄에 처음으로 '-' 또는 '·'가 입력된 순간인지 확인 (요구사항 5번 B~E)
    if (oldText === '' && newText.length >= 1) {
      const bullet = detectLeadingBullet(newText);
      if (bullet) {
        if (lineIndex > 0) {
          const prev = object.lines[lineIndex - 1];
          // 요구사항(글자 크기/커스텀 폰트별 들여쓰기): 이 텍스트 상자의 기준
          // 글자 크기(baseFontSize)를 REFERENCE_FONT_SIZE(16) 대비 배율로 바꾸고,
          // 커스텀 폰트가 같은 font-size라도 실제 렌더링 크기가 다를 수 있다는 점을
          // fontHeightScaleFor(위 AnnotationBubble 크기 보정과 동일한 근거)로 보정해
          // BULLET_INDENT_UNIT(기준 12px)에 곱한다 — 글자가 크면 한 단계 들여쓰기도
          // 그만큼 넓어지고, 작으면 좁아진다.
          const bulletFontScale =
            (object.baseFontSize / REFERENCE_FONT_SIZE) * fontHeightScaleFor(object.fontFamily || DEFAULT_FONT_FAMILY);
          const indentUnit = BULLET_INDENT_UNIT * bulletFontScale;
          nextAnchor = computeAnchorForNewBullet(bullet, current.anchor, lineText(prev), prev.anchor, indentUnit);
        } else {
          // 첫 줄은 비교할 이전 줄이 없다 — root 그대로 두면 이 줄 아래에서 Backspace로
          // 여기까지 되돌아왔을 때 같은 기호 재사용 매칭이 안 되므로, 대신 이 기호로
          // anchor를 확립해둔다(들여쓰기는 하지 않음, anchorEngine.ts 참고).
          nextAnchor = computeAnchorForFirstLineBullet(bullet, current.anchor);
        }
      }
    }

    // Phase 4: 텍스트가 바뀐 만큼 이 줄의 하이라이트/주석 오프셋도 함께 보정한다.
    const nextHighlights = remapHighlightsForEdit(current.highlights, oldText, newText);
    const nextAnnotations = remapHighlightsForEdit(current.annotations, oldText, newText);

    const nextLines = [...object.lines];
    nextLines[lineIndex] = {
      ...current,
      runs: newRuns,
      anchor: nextAnchor,
      highlights: nextHighlights,
      annotations: nextAnnotations,
    };

    if (arrowResult.converted) {
      // 텍스트 길이가 바뀌므로(->  → →) DOM을 다시 써야 하고, 그만큼 캐럿도 보정해야 한다.
      // 실제 textContent 갱신은 useLayoutEffect가 store 변경을 감지해 처리한다.
      focusRequestRef.current = { lineId: current.id, offset: cursorIndex };
    }
    updateLines(nextLines);
  };

  // 버그 수정(IME 조합 중 줄바꿈된 직후에도 상자가 바로 자라지 않고 다음 글자를
  // 써야 자람): 조합(composition) 중에는 store(object.lines)를 건드리지 않으므로
  // (조합 버퍼를 깨뜨리지 않기 위해 — 위 onInput 참고) 아래 자동 높이 useLayoutEffect의
  // deps(object.lines 등)가 전혀 바뀌지 않아 effect가 다시 돌지 않는다. 하지만 IME가
  // 보여주는 조합 중 글자는 이미 실제 DOM에 반영돼 있어서(브라우저가 직접 그린다)
  // 그 시점에 이미 줄바꿈이 일어날 수 있다 — 그래서 조합이 끝나 store가 갱신될 때까지
  // (다음 글자를 쓰기 시작해 compositionend가 발생할 때까지) 상자 높이만 한 박자 늦게
  // 따라왔다. store를 건드리지 않고 DOM만 다시 재서(scrollHeight) "커지는 방향으로만"
  // 규칙만 그대로 적용하면 조합 중에도 안전하게 높이를 맞출 수 있다 — 아래 useLayoutEffect의
  // 자동 높이 로직과 완전히 같은 grow-only 판단을 재사용한다(단, 여기서는 store를
  // 전혀 건드리지 않으므로 lastMeasuredContentHeightRef/isGenuinelyFreshObject 같은
  // "첫 측정" 예외는 관여하지 않는다 — 그 예외는 이 effect가 이미 한 번 이상 정상
  // 실행된 뒤에만 의미가 있고, 조합 중간의 임시 측정은 그 자체로 별개의 실행이
  // 아니라 다음 effect 실행 전까지의 임시 보정일 뿐이다).
  const growHeightIfNeeded = () => {
    const containerEl = containerRef.current;
    if (!containerEl) return;
    const nextHeight = Math.max(MIN_TEXT_HEIGHT, containerEl.scrollHeight);
    // 버그 수정: 위 useLayoutEffect와 똑같이 object.height가 아니라 기준선
    // (lastMeasuredContentHeightRef)과 비교한다 — 그렇지 않으면 사용자가 리사이즈로
    // 줄여둔 상자에서 IME로 타이핑을 시작하는 순간(조합 중엔 store가 아직 안 갱신돼
    // 이 함수가 대신 돈다) scrollHeight가 늘 상자보다 크다는 이유로 매번 원래
    // 콘텐츠 높이로 되돌려버린다.
    const baseline = lastMeasuredContentHeightRef.current;
    if (baseline !== null && nextHeight - baseline <= 0.5) return;
    lastMeasuredContentHeightRef.current = nextHeight;
    if (nextHeight - object.height > 0.5) {
      useObjectsStore.getState().updateObject(object.id, { height: nextHeight }, `text:${object.id}`);
    }
  };

  // input(일반 타이핑) 또는 compositionend(IME 조합 확정) 이후 호출된다.
  // 같은 줄에 대해 동일한 최종 텍스트가 두 번(예: compositionend 직후 곧바로 이어지는
  // input 이벤트) 들어와도 store를 중복으로 건드리지 않도록 dedupe한다.
  const syncLineFromDom = (lineIndex: number, lineEl: HTMLDivElement) => {
    const current = object.lines[lineIndex];
    const domText = lineEl.textContent ?? '';
    if (lastProcessedTextRef.current.get(current.id) === domText) return;
    lastProcessedTextRef.current.set(current.id, domText);
    handleInput(lineIndex, lineEl);
  };

  const handleKeyDown = (lineIndex: number) => (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const lineEl = e.currentTarget;

    // IME(한글 등) 조합 중에는 Enter/Backspace/Escape/화살표 그 무엇도 가로채지 않는다.
    // 조합 중 Enter는 "줄바꿈"이 아니라 "조합 확정"이고, 조합 중 Backspace는 우리의
    // dedent/줄병합이 아니라 "조합 버퍼에서 한 글자 지우기"다. 이 판단을
    // nativeEvent.isComposing 하나에만 의존하지 않고 compositionstart/end로 직접
    // 추적한 isComposingRef를 우선으로 삼는다(브라우저별 타이밍 차이 대응).
    // 'Process'는 IME 조합 중 실제 키가 아직 해석되지 않았을 때 브라우저가 보고하는
    // 값으로, 이 값이 찍히는 것 자체는 정상적인 한글 입력 과정이다.
    const composing = isComposingRef.current || e.nativeEvent.isComposing || e.key === 'Process';
    if (composing) {
      return;
    }

    // 요구사항(Tab은 다음 줄로 넘어가지 않고 공백 4칸): contentEditable은 기본적으로
    // Tab을 "다음 포커스 대상으로 이동"으로 처리한다(각 줄이 독립된 focusable
    // contentEditable이라 실질적으로 "다음 줄로 넘어가는" 것처럼 보인다). execCommand로
    // 직접 삽입하면 브라우저가 뒤이어 'input' 이벤트를 쏴줘서 아래 onInput의 기존
    // 동기화 경로(syncLineFromDom)를 그대로 재사용할 수 있다.
    if (e.key === 'Tab') {
      e.preventDefault();
      const segments = captureSelectionSegments().filter((s) => s.objectId === object.id);
      if (segments.length > 1) {
        const result = computeCrossLineReplace(segments, [{ text: '    ' }]);
        if (result) {
          focusRequestRef.current = { lineId: result.lineId, offset: result.offset };
          updateLines(result.nextLines);
        }
        return;
      }
      document.execCommand('insertText', false, '    ');
      return;
    }

    // 요구사항(줄 사이로 드래그 선택): 여러 줄에 걸친 선택 상태에서 일반 문자를 입력하면,
    // 네이티브 입력은 포커스가 있는 줄(하나의 contentEditable)만 갱신하고 다른 줄들의
    // 선택 구간은 그대로 남아 데이터가 어긋난다 — 그래서 이 경우만 선택 전체를 지우고
    // 그 자리에 입력한 문자를 끼워 넣는다. 한 줄 안의 선택은(segments.length <= 1)
    // 브라우저 기본 동작(선택 부분을 지우고 타이핑)에 맡긴다.
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
      const segments = captureSelectionSegments().filter((s) => s.objectId === object.id);
      if (segments.length > 1) {
        e.preventDefault();
        const result = computeCrossLineReplace(segments, [{ text: e.key }]);
        if (result) {
          focusRequestRef.current = { lineId: result.lineId, offset: result.offset };
          updateLines(result.nextLines);
        }
        return;
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const fullText = lineEl.textContent ?? '';
      const offset = getCaretOffset(lineEl);
      handleEnter(lineIndex, fullText.slice(0, offset), lineEl);
      return;
    }

    if (e.key === 'Backspace') {
      const crossLineSegments = captureSelectionSegments().filter((s) => s.objectId === object.id);
      if (crossLineSegments.length > 1) {
        e.preventDefault();
        const result = computeCrossLineReplace(crossLineSegments, []);
        if (result) {
          focusRequestRef.current = { lineId: result.lineId, offset: result.offset };
          updateLines(result.nextLines);
        }
        return;
      }

      const offset = getCaretOffset(lineEl);
      const selection = window.getSelection();
      const collapsed = selection ? selection.isCollapsed : true;
      if (collapsed && offset === 0) {
        e.preventDefault();
        handleBackspaceAtStart(lineIndex);
      }
      // offset > 0 (일반적인 문자 삭제)는 preventDefault하지 않고 브라우저 기본 동작에
      // 맡긴다. 지워진 결과는 이어지는 input 이벤트(onInput)에서 store로 동기화된다.
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      useInteractionStore.getState().setMode('select');
      lineEl.blur();
      return;
    }

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const dir = e.key === 'ArrowUp' ? -1 : 1;
      const target = object.lines[lineIndex + dir];
      if (target) {
        e.preventDefault();
        const offset = getCaretOffset(lineEl);
        const targetEl = lineElsRef.current.get(target.id);
        if (targetEl) {
          // 대상 줄이 더 짧거나(특히 빈 줄) 방금 분리/병합되어 길이가 달라졌을 수 있으므로
          // 실제 DOM 길이를 넘지 않도록 clamp한다. 안 그러면 offset이 텍스트 노드 끝을
          // 넘어서 focusLineAt이 잘못된 위치에 캐럿을 두거나 예외를 던질 수 있다.
          const maxOffset = targetEl.textContent?.length ?? 0;
          focusLineAt(targetEl, Math.min(offset, maxOffset));
        }
      }
      return;
    }
  };

  return (
    <div
      ref={containerRef}
      onDoubleClick={handleDoubleClick}
      // 요구사항(화살표/사각형을 텍스트 상자 위에도 그릴 수 있게): FrameObjectView.tsx의
      // 빈 표면과 같은 표식 — canvas/interaction/useDrawShapeTool.ts가 이 속성을 가진
      // 요소(또는 그 후손) 위에서 시작한 드래그는 "객체 이동"이 아니라 "도형 그리기"로
      // 통과시켜도 된다고 판단한다. 실제로 그 판단이 적용되는지는 ObjectView.tsx의
      // skipDrag(화살표/사각형 도구가 켜져 있을 때만 이 텍스트 객체에 drag 핸들러를
      // 아예 붙이지 않음)에 달려 있다 — 이 속성 하나만으로는 아무 도구에도 영향이 없다.
      data-shape-drawable="true"
      style={{
        position: 'relative',
        // Phase 4: 아래 하이라이트 레이어(zIndex:-1)를 이 컨테이너 안에서만
        // "배경보다 위, 글자보다 아래"에 가두기 위한 독립 stacking context.
        isolation: 'isolate',
        width: '100%',
        height: '100%',
        padding: 6,
        fontSize: object.baseFontSize,
        color: object.color,
        background: isOnDarkFrame ? 'transparent' : 'rgba(255,255,255,0.7)',
        // 요구사항(텍스트 상자 테두리 옵션): borderEnabled(undefined는 true와 동일 —
        // 기존엔 항상 테두리가 있었다)가 false면 테두리 없이 반투명 배경만 남는다.
        border: object.borderEnabled === false ? 'none' : '1px solid #d9d9d9',
        borderRadius: 4,
        // 요구사항 4번: 내용이 상자 크기를 넘어가도 내부 스크롤 대신 세로로 자동
        // 확장된다(위 useLayoutEffect가 매 렌더마다 scrollHeight를 측정해 object.height를
        // 그 크기에 맞춰 갱신한다) — 그래서 overflow는 항상 'visible'이면 충분하고,
        // 이론상 스크롤이 필요한 상태 자체가 생기지 않는다.
        overflow: 'visible',
        fontFamily: object.fontFamily || DEFAULT_FONT_FAMILY,
        fontWeight: object.bold ? 700 : 400,
        cursor: isEditing ? 'text' : 'move',
      }}
    >
      {/* Phase 4: Highlight layer — 텍스트보다 뒤, 배경보다 앞. 하이라이트 rect 자체는
          항상 텍스트(line div)보다 아래에 그려지므로 pointer 이벤트를 여기서 받을 수
          없다(위에 있는 line div가 항상 먼저 히트된다) — 그래서 "클릭해서 하이라이트
          선택" 로직은 이 레이어가 아니라 아래 line div의 pointerdown/up에서 처리하고,
          여기서는 순수하게 시각적 표시(선택된 하이라이트에 점선 테두리)만 담당한다. */}
      <div style={{ position: 'absolute', inset: 0, zIndex: -1, pointerEvents: 'none' }}>
        {highlightRects.map((r) => {
          const isSelected =
            fineSelection?.kind === 'highlight' &&
            fineSelection.objectId === object.id &&
            fineSelection.id === r.highlightId;
          return (
            <div
              key={r.key}
              style={{
                position: 'absolute',
                left: r.left,
                top: r.top,
                width: r.width,
                height: r.height,
                background: highlightBackgroundFor(r.color),
                // 형광펜처럼 좌우(세로) 양 끝이 둥글게 — 고정된 작은 radius(3px) 대신
                // 높이의 절반을 써서 알약(캡슐) 모양을 만든다. rect 하나하나(줄바꿈으로
                // 쪼개진 조각 포함)에 독립적으로 적용되므로 값/투명도는 기존 그대로다.
                borderRadius: r.height / 2,
                outline: isSelected ? '1.5px dashed #4f8cff' : 'none',
                outlineOffset: 1,
              }}
            />
          );
        })}
      </div>

      {object.lines.map((line, index) => (
        <div
          key={line.id}
          ref={getLineRefCallback(line.id)}
          data-object-id={object.id}
          data-line-id={line.id}
          contentEditable={isEditing}
          suppressContentEditableWarning
          spellCheck={false}
          onKeyDown={isEditing ? handleKeyDown(index) : undefined}
          onInput={
            isEditing
              ? (e) => {
                  // 한글 등 IME 조합 중간 상태에서는 우리 로직(불릿 판정/화살표 변환/store 동기화)을
                  // 돌리지 않는다 — 조합 중에 store를 갱신하면 재렌더링이 DOM의 조합 버퍼를
                  // 덮어써서 입력이 깨질 수 있다. 조합이 끝나면 onCompositionEnd에서 한 번 더 처리한다.
                  const composing = isComposingRef.current || (e.nativeEvent as InputEvent).isComposing;
                  if (composing) {
                    // 버그 수정: 조합 중에도 DOM은 이미 갱신돼 있으므로(위 growHeightIfNeeded
                    // 주석 참고) store 동기화만 건너뛰고 높이는 그대로 다시 잰다 — 그래야
                    // 조합 중 줄바꿈이 일어난 바로 그 순간 상자도 함께 자란다.
                    growHeightIfNeeded();
                    return;
                  }
                  syncLineFromDom(index, e.currentTarget);
                }
              : undefined
          }
          onCompositionStart={
            isEditing
              ? () => {
                  isComposingRef.current = true;
                }
              : undefined
          }
          onCompositionEnd={
            isEditing
              ? (e) => {
                  isComposingRef.current = false;
                  syncLineFromDom(index, e.currentTarget);
                }
              : undefined
          }
          onPaste={isEditing ? handlePaste(index) : undefined}
          onCut={isEditing ? handleCut : undefined}
          onPointerDown={(e) => {
            if (isEditing) {
              e.stopPropagation();
              onLinePointerDown(e.ctrlKey || e.metaKey);
              // 요구사항(줄 사이로 드래그 선택): 처음엔 pointerdown의 기본 동작을 막지
              // 않고 pointermove에서만 Selection.setBaseAndExtent로 선택을 넓혀봤는데도
              // 여전히 안 됐다 — 원인은 우리가 preventDefault를 안 했으므로 브라우저
              // 자신의 네이티브 드래그-선택(mousedown에서 시작해 매 mousemove마다
              // "이 gesture는 이 contentEditable 안에서만 확장 가능"이라고 스스로
              // 판단해 되돌리는 내부 로직)이 우리 것과 별개로 계속 동작해서, 우리가
              // setBaseAndExtent로 넓힌 순간 바로 다음 native mousemove 처리에서 다시
              // 원래 줄 경계로 clamp해버렸기 때문이다.
              //
              // 그래서 이제 (더블/트리플 클릭이 아닌) 단일 클릭에 한해 pointerdown
              // 자체를 preventDefault한다 — Pointer Events 스펙상 취소 가능한
              // pointerdown의 기본 동작을 막으면 그 뒤로 이어지는 호환용 mousedown/
              // mousemove/mouseup/click이 이 제스처 동안 아예 발생하지 않아서(브라우저의
              // 네이티브 드래그-선택 자체가 시작되지 않아서), 우리가 직접 캐럿 배치부터
              // 드래그 확장까지 전부 책임지면 더 이상 경쟁 상대가 없다. 더블/트리플
              // 클릭(e.detail > 1)은 그대로 건드리지 않아 "더블클릭으로 단어 선택" 같은
              // 네이티브 동작은 예전처럼 남는다(다만 그 경우는 여전히 한 줄 안으로 제한됨).
              if (e.button === 0 && e.detail <= 1) {
                const lineEl = e.currentTarget;
                const anchorPos = caretPositionFromClientPoint(e.clientX, e.clientY);
                if (anchorPos) {
                  e.preventDefault();
                  lineEl.focus();
                  window.getSelection()?.setBaseAndExtent(anchorPos.node, anchorPos.offset, anchorPos.node, anchorPos.offset);

                  const handleDragMove = (moveEvent: PointerEvent) => {
                    if (moveEvent.buttons !== 1) {
                      cleanup();
                      return;
                    }
                    const current = caretPositionFromClientPoint(moveEvent.clientX, moveEvent.clientY);
                    if (!current) return;
                    // 이 텍스트 객체 밖(다른 객체/캔버스 빈 곳)으로 나가면 그 지점은
                    // 무시하고 선택을 마지막으로 유효했던 지점에 그대로 둔다 — 서로
                    // 다른 TextObject 사이로 선택이 새는 것을 막는다.
                    const currentEl =
                      current.node.nodeType === Node.TEXT_NODE ? current.node.parentElement : (current.node as Element);
                    if (!currentEl?.closest(`[data-object-id="${object.id}"][data-line-id]`)) return;
                    window.getSelection()?.setBaseAndExtent(anchorPos.node, anchorPos.offset, current.node, current.offset);
                  };
                  const handleDragEnd = () => cleanup();
                  function cleanup() {
                    window.removeEventListener('pointermove', handleDragMove);
                    window.removeEventListener('pointerup', handleDragEnd);
                  }
                  window.addEventListener('pointermove', handleDragMove);
                  window.addEventListener('pointerup', handleDragEnd);
                }
              }
              return;
            }
            // Phase 4(2차): select 도구에서만 "이 줄을 클릭했는지"를 추적한다 —
            // 하이라이트 rect 자체는 텍스트 뒤에 있어 pointer 이벤트를 받지 못하므로,
            // 여기서 시작 좌표만 기록해두고 pointerup에서 클릭인지 드래그인지 판정한다.
            // stopPropagation을 하지 않으므로, 그대로 드래그하면 기존 객체 이동
            // (useObjectDrag)이 지금까지와 동일하게 동작한다.
            if (activeTool === 'select') {
              lineClickStartRef.current.set(line.id, { x: e.clientX, y: e.clientY });
            }
          }}
          onPointerUp={(e) => {
            if (isEditing || activeTool !== 'select') return;
            const start = lineClickStartRef.current.get(line.id);
            lineClickStartRef.current.delete(line.id);
            if (!start) return;
            const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
            if (moved >= HIGHLIGHT_CLICK_THRESHOLD_PX) return; // 드래그였음 — 객체 이동에 맡긴다
            const offset = caretOffsetFromPoint(e.currentTarget, e.clientX, e.clientY);
            if (offset == null) return;
            const hit = (line.highlights ?? []).find((h) => offset >= h.start && offset < h.end);
            if (hit) {
              useInteractionStore
                .getState()
                .selectFine({ kind: 'highlight', objectId: object.id, lineId: line.id, id: hit.id });
            }
          }}
          style={{
            position: 'relative',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            // 요구사항(2026-09, 줄바꿈 매달린 들여쓰기): hangingIndents에 이 줄의 값이
            // 있으면(위 useLayoutEffect 참고 — '-'/'·'/':' 로 시작해 본문 시작 지점을
            // 측정할 수 있었던 줄만 채워진다) paddingLeft를 그 지점까지 늘리고, 대신
            // textIndent를 같은 폭만큼 음수로 줘서 "첫 줄"만 원래 anchor.offsetPx
            // 위치 그대로 보이게 되돌린다. textIndent는 첫 줄에만 적용되고 paddingLeft는
            // 줄 전체(=화면에서 접힌 이후 줄들 포함)에 적용되는 CSS 성질을 그대로
            // 이용한 것 — 그 값이 없는(=기호로 시작하지 않는) 줄은 기존과 완전히 동일하게
            // paddingLeft만으로 모든 화면 줄이 anchor.offsetPx에 맞춰 균일하게 들여써진다.
            paddingLeft: line.anchor.offsetPx + (hangingIndents.get(line.id) ?? 0),
            textIndent: hangingIndents.has(line.id) ? -(hangingIndents.get(line.id) ?? 0) : undefined,
            // Phase 4(2차): 이 줄에 주석이 하나라도 있으면 그 위에 말풍선+화살표가
            // 들어갈 공간을 미리 확보해서 텍스트와 겹치지 않게 한다. 주석이 여러 줄로
            // 늘어나도 잘리지 않도록(요구사항) 고정값이 아니라 실측 높이 기반으로 계산한다.
            paddingTop: reservedSpaceForLine(line),
            // 요구사항(2026-09-09, 주석을 텍스트 아래로도 이동 가능하게): 이 줄에
            // 달린 주석이 "텍스트 아래"로 이동했으면, 그만큼을 이 줄의 아래쪽에
            // 확보해서 다음 줄이 자연스럽게 밀려 내려가게 한다(paddingTop과 대칭).
            paddingBottom: reservedSpaceBelowForLine(line),
            minHeight: `${lineHeightRatio}em`,
            // 버그 수정(커스텀 글꼴에서 상자를 최소로 줄여도 빈 공간이 많이 남음):
            // 예전엔 사이드바에서 줄 간격을 명시적으로 조절한 적이 있을 때만 CSS
            // line-height를 지정하고, 그렇지 않으면 브라우저 기본값(line-height: normal)에
            // 맡겼다 — 그런데 normal은 그 글꼴 파일 안에 박혀 있는 ascent/descent/line-gap
            // 메타데이터를 기준으로 하기 때문에, 실제 글자(잉크) 높이와 무관하게 특정
            // 커스텀 글꼴에서는 1.4em(기본값)보다 훨씬 크게 잡힐 수 있다. 그 줄 box 높이가
            // 그대로 scrollHeight(아래 자동 높이 effect)에 반영돼 "최소로 줄여도" 실제로는
            // 줄지 않는 것처럼 보였다. 이제 항상 lineHeightRatio를 명시해서 글꼴의 내부
            // 메타데이터와 무관하게 일관되게(그리고 최소한으로) 렌더링한다.
            lineHeight: lineHeightRatio,
            outline: 'none',
            // Phase 4: 형광펜/주석 도구가 켜져 있을 때만 네이티브 텍스트 선택을 허용한다.
            // 기본값(select 도구)에서는 .canvas-root의 user-select:none을 그대로 물려받아
            // 기존처럼 드래그=객체 이동으로 동작한다.
            userSelect: allowNativeTextSelect ? 'text' : 'none',
            WebkitUserSelect: allowNativeTextSelect ? 'text' : 'none',
            cursor: allowNativeTextSelect ? 'text' : undefined,
          }}
        />
      ))}

      {/* Phase 4(2차): Annotation 말풍선 + 화살표. 텍스트보다 위에 그려져야 하므로
          (그리고 pointer 이벤트를 받아야 하므로) line 목록 뒤에, 별도 pointer-events:none
          래퍼 없이 배치한다 — 각 bubble이 필요한 영역에서만 자체적으로 클릭을 받는다. */}
      {annotationAnchors.map(({ lineId, annotation, anchorLeft, top, height, left, maxWidth, fontScale }) => {
        const isSelected =
          fineSelection?.kind === 'annotation' && fineSelection.objectId === object.id && fineSelection.id === annotation.id;
        // 주의: 여기서 텍스트 객체 자체의 isEditing(선택된 텍스트가 이 객체인지)을 쓰면
        // 안 된다 — 주석 편집 중에는 selectedId가 null이고 fineSelection만 채워진다.
        // "이 주석이 지금 타이핑 대상인가"는 mode==='text-edit' && 이 주석이 선택돼
        // 있는가로 독립적으로 판단해야 한다.
        const isAnnotationEditing = isSelected && mode === 'text-edit';
        return (
          <AnnotationBubble
            key={annotation.id}
            objectId={object.id}
            lineId={lineId}
            annotation={annotation}
            anchor={{ left: anchorLeft, top, height }}
            left={left}
            maxWidth={maxWidth}
            fontScale={fontScale}
            isSelected={isSelected}
            isEditing={isAnnotationEditing}
            onSelect={() =>
              useInteractionStore.getState().selectFine({ kind: 'annotation', objectId: object.id, lineId, id: annotation.id })
            }
            onEnterEdit={() => {
              useInteractionStore.getState().selectFine({ kind: 'annotation', objectId: object.id, lineId, id: annotation.id });
              useInteractionStore.getState().setMode('text-edit');
            }}
            onDragOffsetChange={(offsetX, offsetY) => {
              // 드래그 도중 실시간 반영. offsetX의 clamp는 다음 렌더의 측정 effect에서
              // anchorLeft/textInnerLeft/textInnerRight 기준으로 다시 계산되므로
              // 여기서는 store에 원값을 그대로 반영해도 안전하다(과도하게 벗어난
              // 값이 store에 잠깐 있더라도 렌더링되는 left/maxWidth는 항상 clamp된
              // 값만 쓰기 때문). offsetY는 이미 AnnotationBubble.tsx의 드래그
              // 핸들러가 snapAnnotationOffsetY로 "위"/"아래" 두 값 중 하나로 스냅해서
              // 넘겨주므로(요구사항: 이진법 위/아래 스냅), 여기서는 그대로 store에
              // 반영하기만 한다. targetTextId(이 Annotation이 속한 lineId/objectId)는
              // 전혀 건드리지 않는다 — 논리적 연결 유지.
              updateAnnotationOffset(object.id, lineId, annotation.id, offsetX, offsetY);
            }}
            onHeightChange={(height) => handleAnnotationHeightChange(annotation.id, height)}
            onTextChange={(text) => {
              // 타이핑 중(매 키 입력) — store 텍스트만 갱신한다. mode/selection은
              // 여기서 절대 건드리지 않는다(건드리면 편집 모드가 곧바로 풀려서
              // 한 글자만 입력되고 끊기는 버그, 그리고 그 직후 Backspace가 객체
              // 자체를 지워버리는 버그로 이어진다).
              //
              // "생성 직후 취소"만 자동 삭제 대상이다: 한 번도 내용이 있어본 적 없는
              // (annotationSeasonedRef에 없는) 주석이 타이핑 중 빈 문자열이 되는 "그
              // 순간" 바로 삭제한다(blur/Enter/Escape까지 기다리지 않는다). 한 번이라도
              // 내용이 있었던(=seasoned) 주석은 다시 비워도 절대 여기서 삭제하지 않는다
              // — 줄만 남기고 텍스트만 빈 채로 둔다.
              //
              // 버그 수정: 예전엔 편집을 "끝낼 때"(onFinishEditing)만 seasoned로
              // 표시했다 — 그래서 생성 후 한 번도 blur/Enter 없이 타이핑만 하다가
              // 마지막 글자까지 backspace로 지우면(글자를 쳤다가 다시 다 지운 것뿐인데도)
              // "아직 한 번도 seasoned된 적 없음"으로 잘못 판정돼 주석 자체가 사라졌다.
              // 이제 타이핑 중 텍스트가 한 번이라도 비어있지 않게 되는 즉시 seasoned로
              // 표시해서, 그 뒤 다시 backspace로 비워도 삭제되지 않게 한다.
              if (text.trim() !== '') annotationSeasonedRef.current.add(annotation.id);
              if (text.trim() === '' && !annotationSeasonedRef.current.has(annotation.id)) {
                removeAnnotation(object.id, lineId, annotation.id);
                useInteractionStore.getState().deselect();
                return;
              }
              updateAnnotationText(object.id, lineId, annotation.id, text);
            }}
            onFinishEditing={(text) => {
              // 요구사항: Enter는 항상 편집을 "완료"한다 — 내용이 비어 있어도(단, 생성
              // 직후 취소 케이스가 아니라면) 삭제하지 않고 그대로 편집 모드만 빠져나간다.
              if (text.trim() === '' && !annotationSeasonedRef.current.has(annotation.id)) {
                // 위 onTextChange에서 이미 지워졌을 확률이 높지만(타이핑으로 빈 문자열이
                // 됐다면), "생성만 하고 한 글자도 안 치고 바로 blur/Enter/Escape"한
                // 엣지 케이스를 위해 여기서도 한 번 더 방어적으로 정리한다.
                removeAnnotation(object.id, lineId, annotation.id);
                useInteractionStore.getState().deselect();
                return;
              }
              updateAnnotationText(object.id, lineId, annotation.id, text);
              if (text.trim() !== '') annotationSeasonedRef.current.add(annotation.id);
              useInteractionStore.getState().setMode('select');
            }}
            onCancelEmpty={() => {
              // 한 번도 내용을 친 적 없는(seasoned 아닌) 주석에서만 취소한다 — 한
              // 번이라도 내용이 있었던 주석은 지금 비어있어도 Backspace 한 번으로
              // 사라지면 안 된다(위 onTextChange 주석 참고).
              if (annotationSeasonedRef.current.has(annotation.id)) return;
              removeAnnotation(object.id, lineId, annotation.id);
              useInteractionStore.getState().deselect();
            }}
            onPasteAnnotation={(copied) => {
              // 요구사항(2026-09-15, 주석 개별 복사·붙여넣기): 방금 클릭으로 만든 빈
              // 주석을 편집하던 중 Ctrl+V로 복사해둔 주석을 적용하는 시점 —
              // AnnotationBubble.tsx의 handlePaste 참고. 새 주석(id)을 만들지 않고
              // "지금 이 주석"(annotation.id)을 objectsStore.applyAnnotationClipboard로
              // 통째로 덮어쓰므로, 화살표가 기존 화살표와 겹쳐 2개가 되는 일이 없다.
              // 형광펜 구간은 복사 출처와 id가 겹치지 않도록 새로 발급한다(같은
              // 형광펜을 여러 단어에 반복해서 붙여넣어도 서로 독립적인 구간이 되도록).
              const highlights: TextHighlight[] | undefined = copied.highlights?.map((h) => ({
                ...h,
                id: crypto.randomUUID(),
              }));
              useObjectsStore.getState().applyAnnotationClipboard(object.id, lineId, annotation.id, {
                text: copied.text,
                color: copied.color,
                fontFamily: copied.fontFamily,
                fontSize: copied.fontSize,
                highlights,
              });
              // 붙여넣은 내용이 비어있지 않다면 "한 번도 내용이 있어본 적 없는" 상태가
              // 아니므로, 위 onTextChange/onCancelEmpty의 자동 삭제 로직이 오작동하지
              // 않도록 seasoned로 표시해둔다.
              if (copied.text.trim() !== '') annotationSeasonedRef.current.add(annotation.id);
            }}
          />
        );
      })}
    </div>
  );
}
