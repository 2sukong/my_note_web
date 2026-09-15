import { useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { TextAnnotation } from './indentation/types';
import { useViewportStore } from '../../store/viewportStore';
import { useToolStore } from '../../store/toolStore';
import { useHistoryStore } from '../../store/historyStore';
import { useFontStore } from '../../store/fontStore';
import { highlightBackgroundFor } from './highlightColors';
import { annotationVisualsFor } from './annotationColors';
import { DEFAULT_FONT_FAMILY } from './fontOptions';
import { mergeClientRectsByLine, caretPositionFromClientPoint, getCaretOffset, focusLineAt } from './domCaret';
import { convertArrowTokenAtCursor } from './arrowConvert';
import {
  ANNOTATION_TOTAL_GAP_BASE,
  snapAnnotationOffsetY,
  isAnnotationBelowAnchor,
} from './annotationLayout';

/**
 * 요구사항 5번: 아래 상수들은 모두 "텍스트 크기 16px일 때" 보기 좋게 튜닝된
 * 고정값이었다 — 텍스트 크기를 바꿔도 주석/밑줄이 그대로였던 문제의 원인이다.
 * 이제 실제 anchor 위치의 computed font-size에서 계산한 fontScale(TextObjectView.tsx
 * 참고, REFERENCE_FONT_SIZE=16 기준 배율)을 이 _BASE 상수들에 곱해서 쓴다
 * (컴포넌트 본문의 scaled* 값들). "_BASE"가 붙지 않은 예전 이름 그대로 쓰던
 * 곳은 없는지 확인할 것 — 실수로 원본 상수를 직접 쓰면 다시 고정 크기로 되돌아간다.
 */
/** ANNOTATION_TOTAL_GAP_BASE(주석의 기본 위치가 anchor로부터 얼마나 떨어지는지)와
 * isAnnotationBelowAnchor(위/아래 판정)는 TextObjectView.tsx도 똑같이 써야 해서
 * annotationLayout.ts로 뽑아 공유한다 — 자세한 설명은 그 파일의 문서 주석 참고. */
/** 드래그로 인정하는 최소 이동량(화면 px) — useObjectDrag와 동일한 관례. 포인터
 * 제스처 임계값이라 텍스트 크기와 무관하게 항상 고정이어야 한다(스케일 대상 아님). */
const DRAG_THRESHOLD_PX = 4;
/** 말풍선 자체의 padding(px, 기준 크기 기준). Y padding은 요구사항(텍스트-주석-텍스트
 * 간격 최소화)에 따라 최소한만 남긴다 — 0으로 없애면 말풍선 배경이 선택됐을 때
 * (isSelected) 글자에 배경이 바짝 붙어 답답해 보이므로 아주 작은 값만 유지한다. */
const BUBBLE_PADDING_X_BASE = 5;
const BUBBLE_PADDING_Y_BASE = 0.5;
/** 말풍선 글자 크기(px, 기준 크기 기준) — 본문의 baseFontSize와 무관하게 원래도
 * 항상 11px로 고정이었지만, 이제 본문 텍스트가 커지면 이 글자도 비례해서 커진다.
 * 사용자가 사이드바에서 주석 크기를 바꾸지 않았을 때(annotation.fontSize undefined)의
 * 기본값이기도 하다 — PropertiesPanel/toolStore/objectsStore가 이 값을 그대로
 * import해서 "구버전 데이터의 하위 호환 기본값"을 한 곳에서만 정의하게 한다. */
export const BUBBLE_FONT_SIZE_BASE = 11;
/** fontScale이 극단적으로 작거나 커도 화살표/말풍선이 안 보이거나 지나치게 커지지
 * 않도록 묶어두는 범위. */
const MIN_FONT_SCALE = 0.6;
const MAX_FONT_SCALE = 2.5;

/**
 * public/annotation-arrow.svg(뷰박스 178x178, 검정 단색 — 원본 130x130 그림을 -30도
 * 회전시켜 다시 내보낸 버전)에서 화살촉이 뾰족하게 모이는 끝(경로 데이터 상 약
 * (160.6, 56.4) — 주석 말풍선을 향한다)의 로컬 좌표를 이 컴포넌트가 고정 상수로
 * 알고 있어야 한다 — arrowTransformFor가 이 점을 targetHead(주석 텍스트의 첫 글자)에
 * 정확히 포개는 변환을 계산하기 때문이다. 요구사항(2026-09-09, 기울기 고정) 이후로는
 * 회전을 아예 하지 않으므로(SVG가 원래 그려진 각도 그대로 고정 스케일만 적용) tail
 * 쪽 좌표는 더 이상 필요 없다 — 방향 계산 자체가 없어졌기 때문. 이 SVG 파일 자체를
 * 다른 모양(다른 회전 각도 포함)으로 교체하면 이 좌표도 새 경로에 맞게 다시 잡아야
 * 한다 — 회전만 됐다면 원본 좌표(원본 130x130 기준 (111, 1))에 같은 회전을 적용해
 * 다시 계산하면 된다(rotate(30°) 후 x축으로 65만큼 평행이동 — 이 파일의 <clipPath>
 * transform과 동일한 변환). */
const ARROW_LOCAL_HEAD = { x: 160.63, y: 56.37 };
/** annotation-arrow.svg 자체의 뷰박스 한 변(정사각형, 178x178). */
const ARROW_SVG_SIZE = 178;
/** 화살촉 목표점을 첫 글자 왼쪽 가장자리에서 얼마나 띄우는지(기준 크기 기준, world px).
 * "글자 가운데를 향해 겨냥하되 글자 자체와는 겹치지 않는다"는 절충을 위한 값 — 너무
 * 작으면(예: 0) 여전히 글자 가장자리에 거의 붙어 겹쳐 보이고, 너무 크면 화살촉이 글자와
 * 멀어져 다시 "위쪽/옆쪽을 가리키는" 것처럼 보인다. */
const ARROW_HEAD_EDGE_GAP_BASE = 1.5;

/**
 * 버그 수정(주석 생성 직후 화살표가 과도하게 세워 보이는 문제): 주석은 항상 offsetX=0
 * (원문 글자 바로 위, 가로 이동 없음)으로 생성됐다. 그런데 화살표의 세로 낙차(원문
 * 첫 글자 → 말풍선 첫 글자)는 말풍선 높이+여백만으로 이미 상당한 반면, offsetX=0이면
 * 가로 낙차는 거의 없어서(패딩 몇 px뿐) tail→head가 사실상 수직에 가까워진다 — 그 결과
 * annotation-arrow.svg 원본이 실제로 그려진 각도(ARROW_LOCAL_TAIL→ARROW_LOCAL_HEAD,
 * 수평 기준 약 29°)에서 크게 벗어나 손그림 특유의 고리가 뒤틀려 보였다. 사용자가
 * 말풍선을 옆으로 드래그해 자연스러운 위치를 잡아준 뒤(=파일에 저장된 상태)에야 원래
 * 그려진 각도에 가까워져 "제대로 된" 화살표처럼 보였던 것 — 즉 "생성 직후"와 "드래그해
 * 정착된 후"가 달라 보인 원인은 화살표 로직 자체가 아니라 "생성 시 기본 오프셋이 0"이라는
 * 값 하나였다.
 *
 * 그래서 annotation.offsetX가 아직 한 번도 설정된 적 없는(생성 직후) 주석에는 0 대신
 * 이 상수를 기본값으로 쓴다(TextObjectView.tsx) — 원본 손그림이 그려진 자연스러운
 * 각도(수평 기준 약 29°)에 가깝게 첫 프레임부터 보이도록 역산한 값이다. 사용자가 직접
 * 드래그하는 순간 annotation.offsetX가 실제 값으로 채워지면서 이 기본값은 더 이상
 * 쓰이지 않는다.
 *
 * 역산 과정(기준 크기, scale=1, 갓 생성된 빈/짧은 한 줄 주석 기준):
 *  - 세로 낙차 |dy| ≈ 말풍선 높이(bubbleFontSize*lineHeight + 2*padding ≈
 *    11*1.1 + 1 ≈ 13.1) 중 첫 글자 세로 중심까지만 반영되므로 ≈ 8(근사치 — 정확한
 *    값은 실제 DOM 실측에 좌우된다).
 *  - 가로 낙차 dx = offsetX + (bubblePaddingX - edgeGap) = offsetX + 3.5.
 *  - 목표 각도 29°(tan29°≈0.554)를 맞추려면 dx ≈ |dy|/0.554 ≈ 14.6 → offsetX ≈ 11.
 * 실제 화면에서 살짝 다르게 보이면(직접 렌더링해서 확인할 수 없어 근사치다) 이 값만
 * 조정하면 된다 — 나머지 로직은 건드릴 필요 없다.
 */
export const DEFAULT_ANNOTATION_OFFSET_X_BASE = 11;

/**
 * 요구사항(2026-09-09, 화살표 크기 고정): 예전엔 화살표의 두 끝(tail/head)을 모두
 * targetTail/targetHead에 정확히 포개도록 스케일을 "두 목표점 사이 거리 / 원본 로컬
 * 길이"로 역산했다 — 그래서 주석을 텍스트에서 멀리 드래그할수록 화살표가 계속
 * 커지는 버그가 있었다(이번에 고치는 대상). 이제는 스케일이 드래그 거리와 무관하게
 * 텍스트 크기(scale, fontScale 기반)에만 비례하는 고정값이고, head 한 점만 정확히
 * targetHead(주석 말풍선 쪽 목표점)에 맞춘다 — tail은 더는 원문 텍스트에 정확히
 * 닿을 필요가 없다는 요구사항 그대로, 그냥 고정된 방향·크기로 자연스럽게 뻗어나간
 * 자리에 놓인다. 아래 기본값(0.11)은 "생성 직후 기본 위치(오프셋 없음, scale=1)"에서
 * 예전 거리 기반 스케일이 만들어내던 크기와 비슷하게 역산한 근사치다(주석
 * DEFAULT_ANNOTATION_OFFSET_X_BASE의 역산 과정 참고 — 그 때의 dx≈14.6, dy≈8 기준
 * targetLen≈16.6, localLen≈149.9이므로 16.6/149.9≈0.111) — 실제 화면에서 살짝
 * 다르게 보이면(직접 렌더링해서 확인할 수 없어 근사치다) 이 값만 조정하면 된다. */
const ARROW_SCALE_BASE = 0.11;

/**
 * 요구사항(2026-09-09, 사용자 피드백 — "주석 위치를 옮기면 화살표 기울기가 달라짐,
 * 기울기도 일정해야 한다"): 이전 버전은 스케일만 고정하고 회전각은 여전히 anchor→
 * targetHead 방향으로 매 렌더 다시 계산했다 — 그래서 드래그로 위치가 바뀔 때마다
 * 화살표가 같이 돌아가 "기울기가 계속 바뀌는" 것처럼 보였다(사용자가 지적한 버그).
 * 이제는 회전을 아예 계산하지 않는다 — annotation-arrow.svg가 원래 그려진 그대로의
 * 각도(회전 0)로 고정 스케일만 적용하고, head(주석 말풍선 쪽 목표점)만 정확히
 * targetHead에 맞춘다(tail은 원문 텍스트에 정확히 닿을 필요가 없다는 기존 요구사항
 * 그대로 — 방향 계산 자체가 사라졌으니 tail 좌표는 이제 아예 쓰지 않는다).
 *
 * flip=true면(요구사항: "텍스트 아래로 이동하면 저장된 화살표 SVG를 상하반전한
 * 형태여야 함") 로컬 y축 부호만 뒤집는다(d = -fixedScale) — 순수한 수직 반사만
 * 적용되고 회전 성분이 전혀 섞이지 않으므로, 원본 SVG를 그대로 위아래로 뒤집어
 * 붙인 모양이 정확히 나온다(전에는 "회전각 + 반사"가 뒤섞여 약 90도 기울어진 것처럼
 * 보이는 버그가 있었다 — 회전 자체를 없앤 지금은 그럴 여지가 없다). */
function arrowTransformFor(
  targetHead: { x: number; y: number },
  fixedScale: number,
  flip: boolean,
): { a: number; b: number; c: number; d: number; e: number; f: number } {
  const a = fixedScale;
  const b = 0;
  const c = 0;
  const d = flip ? -fixedScale : fixedScale;
  const e = targetHead.x - a * ARROW_LOCAL_HEAD.x;
  const f = targetHead.y - d * ARROW_LOCAL_HEAD.y;
  return { a, b, c, d, e, f };
}

interface AnnotationHighlightRect {
  key: string;
  highlightId: string;
  left: number;
  top: number;
  width: number;
  height: number;
  color: string;
}

interface AnnotationBubbleProps {
  objectId: string;
  lineId: string;
  annotation: TextAnnotation;
  /** anchor(사용자가 처음 선택했던 텍스트 구간)의 컨테이너 기준 상대 좌표. */
  anchor: {
    /** 구간의 왼쪽 끝 — 말풍선 자신의 왼쪽 정렬 기준이자, 화살표가 가리키는
     * "드래그한 텍스트의 첫 글자" 지점의 x좌표. */
    left: number;
    /** 구간의 맨 위 — 화살표가 가리키는 "드래그한 텍스트의 첫 글자" 지점의 y좌표. */
    top: number;
    /** 요구사항(2026-09-09 2차 수정 — 텍스트 아래로 옮긴 주석이 anchor 자신의 글자와
     * 겹치는 버그): 구간의 실제 렌더 높이. "아래" 배치는 이 높이만큼 anchor.top에서
     * 더 내려간 지점(=이 글자의 실제 바닥)부터 시작해야 anchor 자신의 글자를 덮지
     * 않는다 — "위" 배치는 anchor.top에서 위로만 띄우므로 이 값이 필요 없다. */
    height: number;
  };
  /** 현재 말풍선이 실제로 그려질 위치(anchor.left + offsetX를 target Text 범위로 clamp한 값). */
  left: number;
  /** target Text의 남은 가로 공간을 기준으로 계산된 최대 폭(px). 이 폭을 넘으면 자동 줄바꿈. */
  maxWidth: number;
  /** 요구사항 5번: anchor 위치의 실제 텍스트 크기 배율(REFERENCE_FONT_SIZE=16 기준).
   * 화살표 크기(간격 기반 자동 스케일)의 기준이 되는 간격, 말풍선 글자 크기/여백을
   * 전부 이 배율만큼 곱해서 렌더링한다. */
  fontScale: number;
  isSelected: boolean;
  isEditing: boolean;
  onSelect: () => void;
  onEnterEdit: () => void;
  /**
   * 타이핑 도중(onInput/onCompositionEnd)마다 호출된다 — store 텍스트만 동기화하고
   * 절대 편집 모드/선택 상태를 건드리지 않는다. (버그 수정: 예전엔 이 콜백 하나가
   * "매 키 입력 동기화"와 "편집 종료"를 겸했는데, 그 종료 로직(mode를 'select'로
   * 되돌리는 것)이 매 키 입력마다 같이 실행돼서 첫 글자만 입력되면 바로 편집 모드가
   * 풀려버렸다 — 이게 "한 글자만 입력됨" 버그와 "타이핑 중 Backspace가 주석 객체
   * 자체를 지워버림" 버그의 공통 원인이었다.)
   */
  onTextChange: (text: string) => void;
  /** 편집을 "끝낼 때"(Enter/Escape/blur)만 호출된다 — 빈 텍스트면 주석 삭제, 아니면
   * 최종 텍스트 반영 + 선택 모드로 복귀. */
  onFinishEditing: (text: string) => void;
  /** 요구사항: 한 번도 내용을 친 적 없는(seasoned 아닌) 주석에서, 이미 비어있는
   * 상태로 Backspace를 누르면(지울 글자가 없어 브라우저 기본 동작으론 아무 일도 안
   * 일어나는 상황) 그 자리에서 주석 자체를 취소(삭제)한다 — "실수로 만든 빈 주석을
   * Backspace 한 번으로 되돌리기". onTextChange의 "타이핑으로 빈 문자열이 되는 순간
   * 삭제"와 달리, 이건 애초에 지울 텍스트조차 없어서 input 이벤트 자체가 안 나는
   * 경우라 별도 경로가 필요하다. */
  onCancelEmpty: () => void;
  /** 드래그로 offsetX/offsetY가 바뀔 때마다 호출(라이브 미리보기). offsetX는 이미
   * clamp된 world px 값이고, offsetY는 이 컴포넌트가 snapAnnotationOffsetY로 미리
   * 스냅한 두 값(0 또는 totalGap*ANNOTATION_OFFSET_Y_BELOW_MULTIPLIER) 중 하나다
   * (요구사항: 상하 이진 스냅 — TextObjectView.tsx는 그대로 전달만 한다). */
  onDragOffsetChange: (offsetX: number, offsetY: number) => void;
  /** 이 말풍선이 실제로 렌더링된 높이(월드 px)가 바뀔 때마다 호출 — 부모가 줄 위 여백을 계산하는 데 쓴다. */
  onHeightChange: (height: number) => void;
}

/**
 * 텍스트 위에 붙는 작은 메모 하나. 사각형 박스로 감싸지 않는다(요구사항: 기존
 * 노란 박스 완전 제거) — 짧은 텍스트 + public/annotation-arrow.svg 손그림 화살표로
 * 원문 텍스트와 연결한다(요구사항: 기존 밑줄 제거, 화살표로 교체).
 *
 * 편집은 TextObjectView의 각 줄과 같은 원리(uncontrolled contentEditable +
 * compositionstart/end ref 추적)를 따른다 — 한글 IME 조합 중 재렌더링이 조합
 * 버퍼를 덮어쓰지 않게 하기 위함이다.
 *
 * 위치는 왼쪽 정렬이다 — anchor(가리키는 텍스트 구간)의 왼쪽 끝에서 시작해서
 * 오른쪽으로 자연스럽게 이어진다(가운데 정렬 아님). 사용자가 드래그하면 이
 * "왼쪽 끝" 위치만 anchor 기준 offsetX로 바뀌고, target Text와의 논리적 연결
 * (start/end anchor)은 절대 바뀌지 않는다 — TextObjectView가 매 렌더마다
 * anchor+offsetX로 실제 위치를 다시 계산해서 내려준다(고정 좌표를 어딘가에
 * 캐싱해두지 않는다). 줄 수 제한 없이 내용만큼 자연스럽게 늘어난다(요구사항) —
 * 글자 크기를 줄이는 대신 이 컴포넌트 자신의 높이를 실측해서 onHeightChange로
 * 보고하면, 부모가 그만큼 줄 위 여백을 넉넉히 확보해준다.
 */
export function AnnotationBubble({
  objectId,
  lineId,
  annotation,
  anchor,
  left,
  maxWidth,
  fontScale,
  isSelected,
  isEditing,
  onSelect,
  onEnterEdit,
  onTextChange,
  onFinishEditing,
  onCancelEmpty,
  onDragOffsetChange,
  onHeightChange,
}: AnnotationBubbleProps) {
  // 버그 수정(새로고침 후 형광펜/화살표가 다른 곳에 그려짐): 이 주석이 커스텀
  // (업로드한) 폰트를 쓰면, 그 폰트가 IndexedDB에서 비동기로 다시 등록되기 전에
  // 아래 측정 effect들이 먼저(폴백 글꼴 기준으로) 한 번 실행돼버릴 수 있다
  // (TextObjectView.tsx의 같은 이름 상수 주석 참고 — 근본 원인은 동일하다).
  // customFonts를 각 effect의 deps에 포함시켜 폰트 로딩이 끝나면 실제 글자 위치로
  // 다시 측정하게 한다 — 맨 위에서 선언해야 아래 첫 측정 effect보다 먼저 존재한다.
  const customFonts = useFontStore((s) => s.customFonts);
  // 요구사항 5번: 고정 px 상수들을 실제 텍스트 크기 배율로 스케일한다. 극단값은
  // MIN/MAX_FONT_SCALE로 묶어서 너무 작아 안 보이거나 너무 커서 화면을 뒤덮는
  // 것을 방지한다.
  const scale = Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, fontScale || 1));
  // 요구사항(주석 크기 조절): annotation.fontSize가 있으면 그 값을, 없으면(구버전
  // 데이터) 기존과 동일한 BUBBLE_FONT_SIZE_BASE를 "기준 글자 크기"로 쓴다. 이 값에
  // 대한 배율(sizeMultiplier)을 패딩에도 같이 곱해서, 사용자가 글자를 키우면
  // 말풍선 여백도 그에 비례해 자연스럽게 커지도록 한다.
  const sizeMultiplier = (annotation.fontSize ?? BUBBLE_FONT_SIZE_BASE) / BUBBLE_FONT_SIZE_BASE;
  const bubblePaddingX = BUBBLE_PADDING_X_BASE * scale * sizeMultiplier;
  const bubblePaddingY = BUBBLE_PADDING_Y_BASE * scale * sizeMultiplier;
  const bubbleFontSize = BUBBLE_FONT_SIZE_BASE * scale * sizeMultiplier;
  // 화살표가 붙는 기준선(과거엔 밑줄 자체였던 자리)까지의 총 여백 — "위" 기본
  // 위치가 anchor.top에서 얼마나 떨어지는지, "아래" 기본 위치가 anchor의 실제 바닥
  // (anchor.top + anchor.height)에서 얼마나 떨어지는지, 그리고 offsetY 축 위/아래
  // 판정 기준점(snapAnnotationOffsetY/isAnnotationBelowAnchor)에 쓰인다. anchor.height는
  // offsetY 판정 자체와는 무관하다(그 판정은 순수하게 offsetY/scale만 본다) — 오직
  // 실제 렌더 위치(아래 top/boxTopLocal/clip 계산)에서만 쓰인다.
  const totalGap = ANNOTATION_TOTAL_GAP_BASE * scale;
  // 요구사항(2026-09-09, 사용자 확인 — "이진법처럼 텍스트 위, 텍스트 아래로만 이동이
  // 가능하고 각각에서 더 움직일 수 있는 범위는 없음"): offsetY는 이제 자유 연속값이
  // 아니라 정확히 두 값(0="위" 기본 위치, totalGap*ANNOTATION_OFFSET_Y_BELOW_MULTIPLIER
  // ="아래" 기본 위치) 중 하나로만 저장된다 — 드래그 중 스냅 로직은 아래 핸들러
  // 참고(snapAnnotationOffsetY). 구버전 데이터(필드 자체가 없음)는 0(=기존과 동일한
  // "위" 위치)으로 취급되어 완전히 하위 호환된다.
  const offsetY = annotation.offsetY ?? 0;
  const isBelow = isAnnotationBelowAnchor(offsetY, scale);

  const bubbleRef = useRef<HTMLDivElement>(null);
  const textElRef = useRef<HTMLDivElement>(null);
  // 말풍선 자신의 마지막으로 실측된 렌더 높이(world px) — 아래 높이 측정 effect가
  // 매 렌더 채운다(useRef라 그 자체로는 재렌더를 트리거하지 않는다). "위/아래 두 곳
  // 중 하나"로 위치가 고정된 지금은 실제 박스 위치(아래 style) 계산에는 필요 없고
  // (translateY 트릭으로 CSS가 알아서 실제 높이만큼 밀어 올려주므로), 화살표가 이웃
  // 줄로 삐져나가지 않게 하는 클리핑 창(clipHeight, 아래) 계산에만 근사치로 쓴다 —
  // 클리핑은 안전장치일 뿐이라 한 프레임 지연되는 근사값으로도 충분하다. */
  const lastReportedHeightRef = useRef(0);
  const approxBubbleHeight = lastReportedHeightRef.current || BUBBLE_FONT_SIZE_BASE * 1.4 * scale;
  // 화살표가 가리킬 "주석 텍스트의 첫 글자" 목표점(로컬 좌표, anchor.left/top과 같은
  // 좌표계) — 아래 effect가 실측해서 채운다. 처음 마운트되어 아직 측정 전이면 null이고,
  // 그동안은 화살표를 그리지 않는다(잘못된 위치로 잠깐 보였다 튀는 것을 막기 위함 —
  // useLayoutEffect라 페인트 전에 채워지므로 실제로는 깜빡임이 없다).
  const [arrowHeadLocal, setArrowHeadLocal] = useState<{ x: number; y: number } | null>(null);
  const lastArrowHeadLocalRef = useRef<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const bubbleEl = bubbleRef.current;
    const textEl = textElRef.current;
    if (!bubbleEl || !textEl) return;
    const zoom = useViewportStore.getState().zoom;
    const bubbleRect = bubbleEl.getBoundingClientRect();
    const textRect = textEl.getBoundingClientRect();
    // 박스의 실제 렌더 top(로컬 좌표)을 이 자리에서 직접 구한다 — "위" 배치는 CSS의
    // translateY(-100%) 트릭으로 박스 바닥이 anchor.top - totalGap에 오도록 그려지므로
    // (렌더 스타일 참고), 그 실제 렌더 높이(bubbleRect.height, 지금 막 실측됨)를 빼면
    // top을 정확히 얻는다. "아래" 배치는 애초에 top 자체가 CSS 값(anchor.top + totalGap)
    // 그대로라 실측이 필요 없다.
    const boxTopLocal = isBelow ? anchor.top + anchor.height + totalGap : anchor.top - totalGap - bubbleRect.height / zoom;

    // 요구사항: 화살촉의 "방향"은 첫 글자의 세로 중심을 향해야 하지만(예전처럼 글자
    // 위쪽 여백을 가리키면 안 됨), 목표점 자체를 글자 정중앙(내부)으로 잡으면 화살촉
    // 끝이 글자 잉크와 겹쳐 보이는 버그가 생긴다. 그래서 세로는 첫 글자의 실제 중심을,
    // 가로는 글자에 닿기 직전(왼쪽 가장자리에서 살짝 띄운 지점)을 목표점으로 삼는다 —
    // "글자를 향해 정확히 겨냥하되 글자 자체는 침범하지 않는" 절충점이다. 글자의 실제
    // 세로 중심은 폰트마다(특히 커스텀 글꼴일수록) ascent/descent 비율이 달라 font-size
    // 만으로 근사할 수 없으므로, textRect(전체 텍스트 노드) 대신 첫 글자 한 개만 감싼
    // Range의 getBoundingClientRect()를 실측해서 쓴다 — 이러면 어떤 글꼴/크기를
    // 골라도 항상 실제 렌더링된 첫 글자를 기준으로 정확하다. 텍스트 노드가 없거나
    // (빈 문자열 등 드문 경우) 글자 rect를 얻지 못하면 textRect 전체로 대체한다.
    let charRect: { left: number; top: number; width: number; height: number } = textRect;
    const textNode = textEl.firstChild;
    if (textNode && textNode.nodeType === Node.TEXT_NODE && (textNode.textContent?.length ?? 0) > 0) {
      const charRange = document.createRange();
      charRange.setStart(textNode, 0);
      charRange.setEnd(textNode, 1);
      const r = charRange.getBoundingClientRect();
      if (r.width > 0 || r.height > 0) charRect = r;
    }
    const edgeGap = ARROW_HEAD_EDGE_GAP_BASE * scale * zoom; // 화면 px 기준으로 뺄 값이라 zoom을 곱한다.

    // 화살표의 목표점(head)을 로컬 좌표로 역산한다. boxTopLocal(방금 구함)에
    // charRect(첫 글자)와 bubbleEl 사이의 화면 픽셀 델타(/zoom)를 더하면 된다.
    const nextArrowHead = {
      x: left + (charRect.left - edgeGap - bubbleRect.left) / zoom,
      y: boxTopLocal + (charRect.top + charRect.height / 2 - bubbleRect.top) / zoom,
    };
    const prevHead = lastArrowHeadLocalRef.current;
    if (!prevHead || Math.hypot(nextArrowHead.x - prevHead.x, nextArrowHead.y - prevHead.y) > 0.25) {
      lastArrowHeadLocalRef.current = nextArrowHead;
      setArrowHeadLocal(nextArrowHead);
    }
    // annotation.fontFamily(주석 자신의 글꼴 — ascent/descent가 폰트마다 다름)가 바뀌면
    // 반드시 다시 측정해야 한다. 나머지 deps는 아래 높이 측정 effect와 같은 이유
    // (내용/폭/편집 상태/본문 fontScale이 바뀌면 레이아웃이 바뀔 수 있음). anchor.top/left,
    // offsetY/isBelow(boxTopLocal이 이 effect 안에서 이 값들로부터 파생됨)는 화살표
    // 목표점 계산에 직접 쓰이므로 반드시 deps에 있어야 한다(드래그로 위/아래가
    // 바뀌거나 줄바꿈 등으로 바뀔 때마다 다시 측정).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotation.text, annotation.fontFamily, annotation.fontSize, maxWidth, isEditing, fontScale, anchor.top, left, offsetY, isBelow, customFonts]);

  const isComposingRef = useRef(false);
  const wasEditingRef = useRef(false);
  // 버그 수정(요구사항: 더블클릭한 위치에서 바로 수정 가능하게): 더블클릭 시점의
  // 화면 좌표(clientX/clientY)를 기억해뒀다가, 그 직후 isEditing이 true로 바뀌는
  // 렌더에서(아래 effect) 그 좌표 아래의 실제 글자 위치로 커서를 옮긴다. 이 값이
  // 없으면(더블클릭이 아닌 다른 경로로 편집 모드에 들어간 경우 등) 기존처럼 끝으로
  // 폴백한다.
  const pendingCaretPointRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startScreen: { x: number; y: number };
    startOffsetX: number;
    startOffsetY: number;
    dragging: boolean;
  } | null>(null);
  // pointerup 직후 브라우저가 합성하는 click까지 억제하기 위한 플래그(진짜 드래그였을 때만).
  const suppressClickRef = useRef(false);
  const [highlightRects, setHighlightRects] = useState<AnnotationHighlightRect[]>([]);

  // 형광펜/주석 도구가 켜져 있는 동안(본문과 동일한 관례)에는 이 말풍선 자체를
  // 드래그로 옮기는 대신, 안의 텍스트를 드래그로 선택해서 형광펜을 칠 수 있어야 한다.
  const activeTool = useToolStore((s) => s.activeTool);
  const allowOwnDrag = !isEditing && activeTool === 'select';
  const allowNativeTextSelect = !isEditing && activeTool !== 'select';

  useLayoutEffect(() => {
    const el = textElRef.current;
    if (!el) return;
    if (el.textContent !== annotation.text) {
      if (isComposingRef.current && document.activeElement === el) return;
      el.textContent = annotation.text;
    }
  }, [annotation.text, isEditing]);

  useLayoutEffect(() => {
    const el = textElRef.current;
    if (isEditing && !wasEditingRef.current && el) {
      el.focus();
      // 버그 수정(요구사항 2번: 항상 끝에서 시작하는 대신 원하는 위치에서 바로 수정):
      // 더블클릭 좌표가 기억되어 있으면 그 좌표 아래의 실제 글자 위치를 찾아 커서를
      // 그 자리에 둔다. 좌표가 이미 이 텍스트 노드 범위를 벗어났거나(예: 그 사이
      // 텍스트가 바뀜) 애초에 좌표가 없으면(더블클릭이 아닌 경로로 편집 진입) 기존과
      // 동일하게 끝으로 폴백한다.
      const point = pendingCaretPointRef.current;
      pendingCaretPointRef.current = null;
      let placed = false;
      if (point) {
        const pos = caretPositionFromClientPoint(point.x, point.y);
        if (pos && el.contains(pos.node)) {
          const range = document.createRange();
          range.setStart(pos.node, pos.offset);
          range.collapse(true);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          placed = true;
        }
      }
      if (!placed) {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
    wasEditingRef.current = isEditing;
  }, [isEditing]);

  // 말풍선 자신의 실제 렌더 높이를 측정한다(요구사항: 줄 수가 늘어나면 글자 크기가
  // 아니라 박스 높이가 늘어나야 함). maxWidth가 좁아져도 줄바꿈이 늘어나 높이가
  // 바뀔 수 있으므로 함께 deps에 둔다. 화면 px를 zoom으로 나눠 다른 좌표들과 같은
  // "world px" 단위로 맞춘다.
  useLayoutEffect(() => {
    const el = bubbleRef.current;
    if (!el) return;
    const zoom = useViewportStore.getState().zoom;
    const h = el.getBoundingClientRect().height / zoom;
    if (Math.abs(h - lastReportedHeightRef.current) > 0.5) {
      lastReportedHeightRef.current = h;
      onHeightChange(h);
    }
    // fontScale(본문 글자 크기 변경)이나 annotation.fontFamily(이 주석 자신의 글꼴
    // 변경)가 바뀌면 말풍선 자체의 렌더 크기도 바뀌므로 다시 측정해야 한다 — 아래
    // highlightRects 측정 effect와 같은 이유. fontFamily가 빠져 있으면, 글꼴만 바꿨을
    // 때(글자 수/maxWidth/isEditing은 그대로) 높이가 재측정되지 않아 reservedSpaceForLine
    // (TextObjectView.tsx)이 옛 글꼴 기준 높이로 계속 남아 새 글꼴로 커진 주석과
    // 본문 텍스트가 겹치는 버그로 이어진다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotation.text, annotation.fontFamily, annotation.fontSize, maxWidth, isEditing, fontScale, customFonts]);

  // 주석 자기 자신의 형광펜 구간을 본문과 동일한 Range.getClientRects() 방식으로
  // 측정한다. 대상 컨테이너가 다를 뿐(TextObjectView 전체가 아니라 이 말풍선 자신)
  // 원리는 완전히 같다 — 그래서 형광펜 크기가 자동으로 주석의 실제 글자 크기(11px)에
  // 맞춰진다(본문의 고정 크기를 그대로 가져오지 않는다).
  useLayoutEffect(() => {
    const wrapEl = bubbleRef.current;
    const textEl = textElRef.current;
    const list = annotation.highlights ?? [];
    if (!wrapEl || !textEl || list.length === 0) {
      setHighlightRects((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const textNode = textEl.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
      setHighlightRects((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const zoom = useViewportStore.getState().zoom;
    const wrapRect = wrapEl.getBoundingClientRect();
    const textLen = textNode.textContent?.length ?? 0;
    const next: AnnotationHighlightRect[] = [];
    for (const h of list) {
      const start = Math.max(0, Math.min(h.start, textLen));
      const end = Math.max(0, Math.min(h.end, textLen));
      if (end <= start) continue;
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, end);
      // 버그 수정(주석 형광펜이 드래그한 위치에 정확히 그려지지 않음): 원래는
      // range.getClientRects()가 돌려주는 rect를 그대로 그렸는데, 복잡한 스크립트
      // (한글 등)는 글자 셰이핑/폰트 폴백 경계에서 시각적으로 하나로 이어진 구간도
      // 여러 개의 작은 rect로 쪼개져 나올 수 있다(domCaret.ts의 mergeClientRectsByLine
      // 문서 주석 참고 — 본문 하이라이트/드래그 미리보기는 이미 이 함수로 병합해서
      // 그리고 있었는데, 주석 자기 자신의 하이라이트만 이 병합을 거치지 않아 드래그로
      // 칠한 구간이 실제 글자 폭보다 좁게 쪼개지거나 어긋난 위치에 그려져 보였다).
      // 본문과 동일하게 같은 줄(세로로 겹치는) rect들을 하나로 합쳐서 그린다.
      const rects = mergeClientRectsByLine(range.getClientRects());
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (r.width <= 0 || r.height <= 0) continue;
        next.push({
          key: `${h.id}-${i}`,
          highlightId: h.id,
          left: (r.left - wrapRect.left) / zoom,
          top: (r.top - wrapRect.top) / zoom,
          width: r.width / zoom,
          height: r.height / zoom,
          color: h.color,
        });
      }
    }
    setHighlightRects(next);
    // 버그 수정: fontScale(본문 글자 크기 변경에서 비롯된 배율)과 annotation.fontFamily
    // (이 주석 자신의 글꼴)가 여기 빠져 있었다 — 본문 텍스트 크기를 키우거나 주석
    // 글꼴을 바꾸면 말풍선 글자가 실제로는 커지거나 다른 폭으로 다시 배치되는데,
    // annotation.text/maxWidth가 그대로면 이 effect가 다시 안 돌아서 형광펜 사각형이
    // 그 전 크기/위치로 고정돼 있던 것이 원인이었다.
  }, [annotation.text, annotation.highlights, annotation.fontFamily, annotation.fontSize, maxWidth, isEditing, fontScale, customFonts]);

  // 타이핑 중(매 키 입력) 호출 — store 동기화만 하고 mode/selection은 절대 건드리지 않는다.
  //
  // 요구사항 3번: 본문(TextObjectView.tsx의 handleInput)과 동일하게 ->, <-, =>, <=
  // 를 유니코드 화살표로 자동 변환한다(arrowConvert.ts, 본문과 규칙 공유). 변환이
  // 일어나면 텍스트 길이가 줄어들므로(2글자→1글자) DOM도 직접 다시 쓰고 커서도
  // 그만큼 당겨서 다시 놓아야 한다 — 그러지 않으면 다음 렌더에서 store 텍스트만
  // annotation.text로 동기화되고 화면엔 방금 친 "->"가 그대로 남는다.
  const syncText = (el: HTMLDivElement) => {
    if (isComposingRef.current) return;
    let newText = el.textContent ?? '';
    let cursorIndex = getCaretOffset(el);
    const arrowResult = convertArrowTokenAtCursor(newText, cursorIndex);
    if (arrowResult.converted) {
      newText = arrowResult.text;
      cursorIndex = arrowResult.cursorIndex;
      el.textContent = newText;
      focusLineAt(el, cursorIndex);
    }
    onTextChange(newText);
  };

  // 편집을 끝낼 때(Enter/Escape/blur)만 호출 — 최종 텍스트를 확정하고 편집 모드를 나간다.
  const finish = (el: HTMLDivElement) => {
    if (isComposingRef.current) return;
    onFinishEditing(el.textContent ?? '');
  };

  // 현재 offsetX = left(실제 렌더 위치) - anchor.left(원래 텍스트 위치). 드래그 시작 시의
  // 기준값으로 쓴다 — annotation.offsetX를 직접 prop으로 받지 않는 이유는 clamp된 값(left)이
  // 이미 "실제로 보이는 위치"를 정확히 반영하기 때문(드래그 도중에도 항상 이 값 기준으로 계산).
  const currentOffsetX = left - anchor.left;
  // offsetY는 이미 snapAnnotationOffsetY를 거쳐 저장된 두 값(0 또는 totalGap*배수) 중
  // 하나이므로(annotation.offsetY, 위 렌더 본문에서 이미 읽어둔 offsetY 변수), 드래그
  // 시작 시점의 기준값으로 그대로 쓴다 — 드래그 도중 후보값은 handlePointerMove가
  // snapAnnotationOffsetY로 다시 스냅한다.
  const currentOffsetY = offsetY;

  // 색상은 annotation.color(생성 시점의 toolStore.annotationColor, 또는 이후
  // PropertiesPanel의 ColorPickerPopover로 바꾼 자유 hex)를 따른다 — 없으면
  // (구버전 데이터의 하위 호환) 'red' 프리셋으로 취급한다.
  const colors = annotationVisualsFor(annotation.color ?? 'red');

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!allowOwnDrag || e.button !== 0) return; // 편집 중이거나 형광펜 도구 중엔 드래그 시작 안 함
    // 버그 수정(주석 자기 자신의 텍스트를 형광펜으로 드래그할 때 실시간 미리보기가
    // 전혀 안 뜨던 문제): 이 stopPropagation()이 위 조건과 무관하게 항상(형광펜 도구가
    // 켜져 있어 allowOwnDrag가 false일 때도) 먼저 실행되고 있었다 — pointerdown이
    // React 합성 이벤트 레벨이 아니라 실제 DOM에서도 더 이상 버블링되지 않아,
    // useTextSelectionTools.ts가 캔버스 루트에 붙여둔 pointerdown 리스너(형광펜
    // 드래그 시작을 알리는 highlightDragging 플래그를 여기서 켠다)가 주석 내부에서
    // 시작한 드래그에 대해서는 전혀 호출되지 못했다. 그 결과 네이티브 파란 선택
    // 음영을 숨기는 CSS도, 드래그 중 실시간 하이라이트 미리보기(HighlightDragPreview.tsx)도
    // 켜지지 않아 손을 뗄 때까지 아무 것도 안 보이다가 갑자기 나타나는 것처럼 느껴졌다.
    // 이제는 이 말풍선 자신을 실제로 드래그해 옮기는 경우(allowOwnDrag)에만
    // stopPropagation해서 그 제스처가 다른 도구 로직과 섞이지 않게 하고, 그 외(형광펜/
    // 주석 도구로 텍스트를 선택하는 경우)에는 그대로 버블링시켜 캔버스 루트가 정상적으로
    // 드래그 시작을 감지하게 한다.
    e.stopPropagation();
    dragRef.current = {
      pointerId: e.pointerId,
      startScreen: { x: e.clientX, y: e.clientY },
      startOffsetX: currentOffsetX,
      startOffsetY: currentOffsetY,
      dragging: false,
    };
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== e.pointerId) return;

    // 버그 수정: useObjectDrag.ts와 동일한 이유로, 놓친 pointerup 때문에 이 말풍선이
    // pointer capture를 계속 들고 있는 상태를 e.buttons===0으로 감지해 정리한다.
    if (e.buttons === 0) {
      if (state.dragging) {
        useHistoryStore.getState().endTransaction();
      }
      dragRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      return;
    }

    const dxScreen = e.clientX - state.startScreen.x;
    const dyScreen = e.clientY - state.startScreen.y;

    if (!state.dragging) {
      if (Math.hypot(dxScreen, dyScreen) < DRAG_THRESHOLD_PX) return;
      state.dragging = true;
      onSelect(); // 실제 드래그가 확정된 순간 선택 상태로 만든다(useObjectDrag와 동일한 관례).
      useHistoryStore.getState().beginTransaction('annotation-offset');
      e.currentTarget.setPointerCapture(e.pointerId);
    }

    const zoom = useViewportStore.getState().zoom;
    // 요구사항(2026-09-09, 이진법 위/아래 스냅): 세로는 raw 델타를 그대로 반영하지
    // 않고, snapAnnotationOffsetY로 "위" 기본 위치(0) 또는 "아래" 기본 위치(totalGap*
    // 배수) 중 하나로 스냅한 값만 내보낸다 — 드래그 중간에 그 중간 어떤 값도 store에
    // 반영되지 않는다(annotationLayout.ts의 snapAnnotationOffsetY 문서 주석 참고).
    const rawOffsetY = state.startOffsetY + dyScreen / zoom;
    onDragOffsetChange(state.startOffsetX + dxScreen / zoom, snapAnnotationOffsetY(rawOffsetY, scale));
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== e.pointerId) return;
    if (state.dragging) {
      suppressClickRef.current = true;
      useHistoryStore.getState().endTransaction();
    }
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // ── 화살표 변환 계산 ─────────────────────────────────────────────
  // 항상 "실제 DOM 최신 위치"에서 다시 계산한다(고정 좌표를 어딘가 저장해두지 않음) —
  // 그래서 본문 이동/줄바꿈/편집, 주석 이동/편집/줄 수 증가, 확대/축소 등 무엇이
  // 바뀌어도 다음 렌더에서 항상 올바른 값으로 그려진다.
  //
  // 요구사항(2026-09-09, 화살표 크기+기울기 고정): 스케일은 드래그 거리와 무관하게
  // fontScale 기반 고정값이고(ARROW_SCALE_BASE 주석 참고), 회전은 아예 하지 않는다
  // (arrowTransformFor 주석 참고) — anchor는 더 이상 방향 계산에 쓰이지 않고, head
  // 한 점만 arrowHeadLocal(주석 말풍선의 첫 글자, 위 측정 effect가 채운다)에 정확히
  // 맞춘다. arrowHeadLocal이 아직 측정 전(null)이면 화살표를 그리지 않는다. isBelow면
  // (요구사항: 주석이 텍스트 아래로 이동하면 화살표 SVG가 상하 반전) flip=true로
  // 넘겨 순수 수직 반사 성분만 섞인 변환을 만든다.
  const arrowFixedScale = ARROW_SCALE_BASE * scale;
  const arrowTransform = arrowHeadLocal ? arrowTransformFor(arrowHeadLocal, arrowFixedScale, isBelow) : null;
  // 요구사항(새로고침/드래그 시 다른 줄과 겹치는 버그 수정): 화살표 크기가 이제
  // 고정이라 예전만큼 위험하지는 않지만, 그래도 안전장치로 이 주석에 실제로 예약된
  // 세로 공간 밖으로는 화살표가 그려지지 않도록 계속 클리핑한다. 위(!isBelow)면
  // [anchor.top - totalGap - approxBubbleHeight, anchor.top] 구간(그 위는 이전 줄의
  // 영역), 아래(isBelow)면 [anchor.top, anchor.top + totalGap + approxBubbleHeight]
  // 구간(그 아래는 다음 줄의 영역)으로 클리핑한다 — 아래 JSX의 실제 박스 위치(top/
  // translateY)와 마찬가지로 totalGap만큼 anchor.top에서 띄우고, 실측 높이 대신
  // approxBubbleHeight(근사치)로 폭을 잡는다(클리핑은 안전장치일 뿐이라 한 프레임
  // 지연되는 근사값으로도 충분하다). 가로는 두 목표점 사이 + 고리가 옆으로 부풀
  // 여유(clipMarginX)만큼만 넉넉히 열어둔다.
  const clipTop = isBelow ? anchor.top : anchor.top - totalGap - approxBubbleHeight;
  const clipBottom = isBelow ? anchor.top + anchor.height + totalGap + approxBubbleHeight : anchor.top;
  const clipHeight = Math.max(0, clipBottom - clipTop);
  const clipMarginX = 400;
  const arrowXs = arrowHeadLocal ? [anchor.left, arrowHeadLocal.x] : [anchor.left];
  const clipLeft = Math.min(...arrowXs) - clipMarginX;
  const clipWidth = Math.max(...arrowXs) - Math.min(...arrowXs) + clipMarginX * 2;

  return (
    <>
      {/* 요구사항 3번: 화살표는 말풍선/본문 텍스트와 겹치지 않도록 별도 레이어로
          그린다 — bubble div보다 먼저(DOM/스택 순서상 아래에) 배치해서, 화살표 끝이
          글자 모서리에 정확히 닿더라도 실제 글자(말풍선 텍스트)가 항상 그 위에
          그려져 가려지지 않는다. pointerEvents:none이라 클릭도 가로채지 않는다.
          색은 이 주석의 텍스트 색(colors.text)과 동일하게 맞춘다(요구사항 2번) —
          annotation-arrow.svg는 검정 단색이라, 그 실루엣을 CSS mask로 떼어내고
          원하는 배경색을 채우는 방식으로 재염색한다(SVG 파일 자체는 그대로 재사용).
          바깥 div(overflow:hidden)가 클리핑 창이고, 안쪽 div가 실제 화살표 도형이다
          — 안쪽 div의 left/top을 클리핑 창의 원점만큼 되돌려서, 클리핑 창이 어디
          있든 화살표 자신의 world 좌표(변환 행렬에 이미 녹아있는 값)는 그대로
          유지된다. */}
      {arrowTransform && clipHeight > 0 && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: clipLeft,
            top: clipTop,
            width: clipWidth,
            height: clipHeight,
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: -clipLeft,
              top: -clipTop,
              width: ARROW_SVG_SIZE,
              height: ARROW_SVG_SIZE,
              transformOrigin: '0 0',
              transform: `matrix(${arrowTransform.a}, ${arrowTransform.b}, ${arrowTransform.c}, ${arrowTransform.d}, ${arrowTransform.e}, ${arrowTransform.f})`,
              backgroundColor: colors.text,
              WebkitMaskImage: 'url(/annotation-arrow.svg)',
              maskImage: 'url(/annotation-arrow.svg)',
              WebkitMaskRepeat: 'no-repeat',
              maskRepeat: 'no-repeat',
              WebkitMaskSize: '100% 100%',
              maskSize: '100% 100%',
              WebkitMaskPosition: '0 0',
              maskPosition: '0 0',
            }}
          />
        </div>
      )}
      <div
        ref={bubbleRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={(e) => {
          e.stopPropagation();
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          // 버그 수정(요구사항 2번): 형광펜 도구로 이 주석 자신의 텍스트를 드래그해
          // 선택하는 동작도, 마우스를 떼는 순간 브라우저가 pointerdown/up 쌍으로부터
          // 합성 click을 이 바깥 div까지 올려보낸다(안쪽 textElRef div엔 별도
          // onClick이 없어 그대로 버블링됨) — 그 결과 형광펜으로 칠하려던 것뿐인데
          // 이 주석이 선택되어(fineSelection) PropertiesPanel이 주석 패널로 바뀌고
          // 말풍선에도 선택 배경이 들어가 버렸다. "클릭해서 이 주석을 선택"은 select
          // 도구일 때만 의미가 있는 동작이므로, 다른 도구(형광펜 등)가 켜져 있을 때는
          // 이 click이 무엇이든(진짜 클릭이든 드래그 후 합성된 것이든) 선택하지 않는다.
          if (activeTool !== 'select') return;
          onSelect();
        }}
        onDoubleClick={(e) => {
          // stopPropagation 필수: 안 하면 이 더블클릭이 TextObjectView 컨테이너까지
          // bubbling돼서 "텍스트 객체 전체 편집 모드 진입"까지 같이 발동해버린다
          // (pointerdown에서의 stopPropagation은 별개 이벤트인 dblclick에는 영향이 없다).
          e.stopPropagation();
          // 요구사항(주석 도구가 켜져 있어도 기존 주석 편집 가능): 예전엔 select
          // 도구가 아니면(형광펜/주석 도구 포함) 무조건 편집 진입을 막았다 — 형광펜
          // 도구로 단어를 더블클릭(네이티브 단어 선택)해서 칠하려는 것일 수 있어서다.
          // 그 이유는 'highlight' 도구에만 해당하고, 'annotation' 도구로는 이 주석
          // 자신의 텍스트를 드래그해서 칠할 일이 없으므로(새 주석을 만드는 도구일 뿐)
          // 막을 이유가 없다 — 'highlight' 도구일 때만 계속 막는다.
          if (activeTool === 'highlight') return;
          // 더블클릭 좌표를 기억해둔다 — 편집 모드로 전환된 직후(위 isEditing effect)
          // 이 좌표 아래의 실제 글자 위치에 커서를 놓기 위함(요구사항 2번).
          pendingCaretPointRef.current = { x: e.clientX, y: e.clientY };
          onEnterEdit();
        }}
        style={{
          position: 'absolute',
          left,
          // 요구사항(2026-09-09, 이진법 위/아래 스냅): "위" 배치는 박스의 정확한 실제
          // 높이를 몰라도(그 높이는 이 컴포넌트가 렌더된 뒤에야 실측 가능) CSS
          // translateY(-100%)만으로 "박스 바닥이 top 값에 오도록" 정확히 그릴 수 있다
          // — 그래서 top엔 그냥 anchor.top - totalGap(바닥이 와야 할 자리)을 주고
          // transform으로 끌어올린다. "아래" 배치는 top 자체가 박스 좌상단이 와야 할
          // 자리(anchor.top + totalGap)와 같으므로 그대로 쓰고 transform은 필요 없다.
          top: isBelow ? anchor.top + anchor.height + totalGap : anchor.top - totalGap,
          transform: isBelow ? undefined : 'translateY(-100%)',
          maxWidth,
          padding: `${bubblePaddingY}px ${bubblePaddingX}px`,
          fontSize: bubbleFontSize,
          // 요구사항(텍스트-주석-텍스트 간격 최소화): 1.15 → 1.1로 살짝 줄여 말풍선
          // 자체의 세로 폭(과 그만큼 줄 위에 예약되는 여백)을 조금 더 아낀다. 그 이상
          // 줄이면(예: 1.0) 일부 글꼴에서 descender가 다음 줄과 시각적으로 붙어 보일
          // 위험이 커서 여기서 멈춘다.
          lineHeight: 1.1,
          fontFamily: annotation.fontFamily || DEFAULT_FONT_FAMILY,
          color: colors.text,
          textAlign: 'left',
          background: isSelected ? colors.selectedBg : 'transparent',
          borderRadius: 3,
          cursor: isEditing ? 'text' : allowOwnDrag ? 'move' : 'text',
          whiteSpace: 'pre-wrap',
          // 한글 단어가 한 글자씩 부자연스럽게 끊기지 않도록 keep-all을 우선하고,
          // (URL처럼) 정말 끊을 수밖에 없는 긴 토큰만 overflow-wrap으로 최후에 끊는다.
          wordBreak: 'keep-all',
          overflowWrap: 'break-word',
          touchAction: 'none',
          // Phase 4: 아래 highlight 레이어(zIndex:-1)를 이 말풍선 안에서만 "배경보다
          // 위, 글자보다 아래"로 가두는 독립 stacking context(본문과 동일한 기법).
          isolation: 'isolate',
        }}
      >
        {highlightRects.length > 0 && (
          <div style={{ position: 'absolute', inset: 0, zIndex: -1, pointerEvents: 'none' }}>
            {highlightRects.map((r) => (
              <div
                key={r.key}
                style={{
                  position: 'absolute',
                  left: r.left,
                  top: r.top,
                  width: r.width,
                  height: r.height,
                  background: highlightBackgroundFor(r.color),
                  borderRadius: r.height / 2,
                }}
              />
            ))}
          </div>
        )}
        <div
          ref={textElRef}
          data-object-id={objectId}
          data-owner-line-id={lineId}
          data-annotation-id={annotation.id}
          contentEditable={isEditing}
          suppressContentEditableWarning
          spellCheck={false}
          onInput={
            isEditing
              ? (e) => {
                  const composing = isComposingRef.current || (e.nativeEvent as InputEvent).isComposing;
                  if (composing) return;
                  syncText(e.currentTarget);
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
                  syncText(e.currentTarget);
                }
              : undefined
          }
          onBlur={isEditing ? (e) => finish(e.currentTarget) : undefined}
          onKeyDown={
            isEditing
              ? (e) => {
                  const composing = isComposingRef.current || e.nativeEvent.isComposing || e.key === 'Process';
                  if (composing) return;
                  // 주석 편집 중의 (지울 글자가 있는) Backspace/Delete/방향키는 여기서
                  // 아무 것도 가로채지 않는다 — preventDefault를 호출하지 않으므로
                  // 브라우저 기본 동작(contentEditable 안에서 글자 삭제/커서 이동)이
                  // 그대로 일어난다. 객체(주석) 자체를 지우는 것은 이 컴포넌트 바깥,
                  // "선택은 됐지만 편집 중은 아닌" 상태에서만 동작하는 전역 삭제
                  // 단축키의 몫이다 — 편집 중에는 mode==='text-edit'이라 그 훅이
                  // 스스로 비활성화된다. 텍스트가 빈 문자열이 되는 순간의 즉시 삭제는
                  // onTextChange(TextObjectView)가 담당한다.
                  //
                  // 예외: 이미 비어있는 상태에서 Backspace를 누르면(지울 글자가 없어
                  // 브라우저 기본 동작만으로는 input 이벤트조차 안 나는 상황) "이 빈
                  // 주석 자체를 취소"하는 신호로 취급한다.
                  if (e.key === 'Backspace' && (e.currentTarget.textContent ?? '').length === 0) {
                    e.preventDefault();
                    onCancelEmpty();
                    return;
                  }
                  if (e.key === 'Enter' || e.key === 'Escape') {
                    e.preventDefault();
                    finish(e.currentTarget);
                    e.currentTarget.blur();
                  }
                }
              : undefined
          }
          style={{
            outline: 'none',
            minWidth: 12,
            // 요구사항(텍스트-주석-텍스트 간격 최소화): 이 minHeight가 실제로 말풍선의
            // 렌더 높이를 결정한다(위 bubble div의 lineHeight:1.1보다 커서 그쪽이 아니라
            // 이 값이 이긴다) — 빈 주석("메모" 플레이스홀더)도 클릭 가능한 최소 높이를
            // 갖도록 line-height보다 살짝 여유를 두되(1.15em), 예전(1.3em)만큼 크게
            // 남기지는 않는다.
            minHeight: '1.15em',
            userSelect: allowNativeTextSelect ? 'text' : undefined,
            WebkitUserSelect: allowNativeTextSelect ? 'text' : undefined,
          }}
        >
          {isEditing ? undefined : annotation.text || '메모'}
        </div>
      </div>
    </>
  );
}
