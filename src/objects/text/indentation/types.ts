export type BulletChar = '-' | '·';

export type AnchorSourceType = 'root' | 'inherit' | 'colon' | 'bullet';

/**
 * 들여쓰기의 논리적 기준점. 공백 개수가 아니라 이 anchor 체인(parent)으로
 * 계층을 표현한다(Python의 INDENT/DEDENT와 비슷한 개념). 같은 anchor를 여러 줄이
 * 공유할 수 있다(같은 기호가 반복되는 경우 새 anchor를 만들지 않고 재사용하기 때문).
 *
 * parent를 id 참조가 아니라 객체 자체로 들고 있어서, 상위 계층으로 이동(Backspace)할 때
 * 별도의 조회용 registry/map 없이 currentAnchor.parent만 따라가면 된다.
 */
export interface IndentAnchor {
  id: string;
  /** 텍스트 객체 좌상단 기준 상대 오프셋. zoom=1 기준으로 정규화된 절대 픽셀 값. */
  offsetPx: number;
  sourceType: AnchorSourceType;
  bulletChar?: BulletChar;
  /** Backspace 시 되돌아갈 상위 anchor. null이면 root(더 이상 dedent 불가). */
  parent: IndentAnchor | null;
}

export const ROOT_ANCHOR_ID = 'root';

export const ROOT_ANCHOR: IndentAnchor = {
  id: ROOT_ANCHOR_ID,
  offsetPx: 0,
  sourceType: 'root',
  parent: null,
};

/**
 * Phase 8(부분 서식): 필드가 설정된 run은 TextObject 전체 기본값(color/baseFontSize/
 * fontFamily/bold)을 오버라이드해서 그 부분만 다르게 그려진다. 설정 안 된 필드는
 * 부모(줄 div, 결국 TextObjectView 컨테이너)의 스타일을 그대로 상속한다 — 그래서
 * "드래그한 구간만 스타일이 다르다"는 요구사항을 만족시키면서도, 대부분의(스타일
 * 없는) run은 인라인 style을 하나도 갖지 않아 DOM이 불필요하게 무거워지지 않는다.
 * 실제 분할/병합/편집 로직은 objects/text/runStyle.ts, DOM 동기화는 TextObjectView.tsx
 * 참고.
 */
export interface TextRun {
  text: string;
  bold?: boolean;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  highlight?: boolean;
}

/**
 * Phase 4: 형광펜(Highlight)의 5색 계열. 실제 색상값(alpha 포함)은
 * objects/text/highlightColors.ts 에서 정의한다.
 */
export type HighlightColorId = 'red' | 'yellow' | 'blue' | 'purple' | 'green';

/**
 * 텍스트 드래그 선택으로 만들어진 형광펜 구간.
 * 독립 객체가 아니라 "해당 줄의 텍스트에 종속된 스타일 데이터"로 관리한다
 * (project architecture 결정 사항: Highlight는 top-level object가 아님).
 * start/end는 이 줄의 lineText() 기준 문자 오프셋(end는 배타적)이다.
 * 텍스트가 편집되면 objects/text/highlightModel.ts의 리맵 로직이 이 오프셋을 보정한다.
 *
 * color는 HighlightColorId 프리셋 하나(툴바에서 새로 만들 때) 또는 자유 hex 문자열
 * (PropertiesPanel의 ColorPickerPopover로 나중에 바꿨을 때)일 수 있다 — 그래서 타입은
 * 좁히지 않고 string 그대로 둔다. 실제 렌더링 배경색 계산은 highlightColors.ts의
 * highlightBackgroundFor가 담당한다(프리셋이면 손으로 조율한 값을, 아니면 hex에서
 * 계산한 값을 반환).
 */
export interface TextHighlight {
  id: string;
  start: number;
  end: number;
  color: string;
}

/**
 * 주석(Annotation)의 색상 계열. 실제 색상값은 objects/text/annotationColors.ts에서
 * 정의한다. 기본색(gold) 없이 이 3색 중 하나를 상단 툴바에서 반드시 골라야 한다.
 */
export type AnnotationColorId = 'red' | 'orange' | 'blue';

/**
 * Phase 4(2차): Annotation도 Highlight와 같은 원리로 "해당 줄의 텍스트에 종속된
 * 데이터"로 관리한다(더 이상 독립 CanvasObject가 아니다 — types/object.ts의
 * AnnotationObject는 제거됨). start/end는 anchor로 삼은 텍스트 구간이고,
 * text는 사용자가 입력한 짧은 메모 내용이다. 렌더링/편집은 TextObjectView +
 * AnnotationBubble이 담당한다.
 */
export interface TextAnnotation {
  id: string;
  start: number;
  end: number;
  text: string;
  /**
   * TextHighlight.color와 같은 이유로 string이다 — AnnotationColorId 프리셋 하나이거나
   * ColorPickerPopover로 고른 자유 hex일 수 있다. 없으면(구버전 데이터의 하위 호환)
   * 'red'로 취급한다. 실제 tick/text 색 계산은 annotationColors.ts의
   * annotationVisualsFor가 담당한다.
   */
  color?: string;
  /**
   * Annotation을 anchor(선택했던 텍스트 구간)의 왼쪽 끝 기준으로 얼마나 수평
   * 이동시켰는지(world px, zoom=1 정규화). 기본값(undefined ~= 0)은 "anchor의
   * 왼쪽 끝에서 왼쪽 정렬로 시작"을 의미한다. 사용자가 Annotation을 드래그하면
   * 이 값만 바뀌고, anchor(=start/end, 즉 target Text와의 논리적 연결)는
   * 절대 바뀌지 않는다 — Text가 이동하면 anchor 자체가 컨테이너 기준 상대좌표라
   * 자동으로 같이 움직이고, Annotation을 이동하면 이 offsetX만 바뀐다.
   */
  offsetX?: number;
  /**
   * 요구사항(폰트 목록 통합): 이 주석 말풍선 텍스트에 쓰는 글꼴 — 본문 텍스트와
   * 완전히 같은 폰트 목록(BUILTIN_FONT_OPTIONS + fontStore.customFonts)에서 고른다.
   * 없으면(구버전 데이터의 하위 호환) DEFAULT_FONT_FAMILY로 취급한다. 생성 시점의
   * toolStore.annotationFontFamily가 초기값이 되고, PropertiesPanel의 글꼴 선택기로
   * 나중에 개별적으로 바꿀 수 있다(TextHighlight.color 등과 동일한 패턴).
   */
  fontFamily?: string;
  /**
   * 주석 크기 조절 요구사항: 말풍선 글자 크기(px, "기준 크기" — AnnotationBubble.tsx의
   * BUBBLE_FONT_SIZE_BASE와 동일한 스케일 기준에서 시작하는 값). 없으면(구버전 데이터의
   * 하위 호환) BUBBLE_FONT_SIZE_BASE(11)로 취급한다. 본문 텍스트의 실제 크기에 따른
   * 자동 배율(fontScale)은 이 값과 별개로 계속 곱해진다 — 즉 이 필드는 "본문 대비
   * 상대 배율"이 아니라 "주석 자신의 기준 글자 크기"를 사용자가 직접 조절하는 것이다.
   */
  fontSize?: number;
  /**
   * Annotation 자기 자신의 텍스트에 붙은 형광펜 구간. 본문 TextLine.highlights와
   * 완전히 같은 타입(TextHighlight)을 그대로 재사용한다 — 별도의 형광펜 시스템을
   * 새로 만들지 않는다. start/end는 annotation.text 기준 문자 오프셋이고,
   * objects/text/highlightModel.ts의 remapHighlightsForEdit가 본문과 동일한
   * 원리로 이 배열도 갱신한다(objectsStore.updateAnnotationText 참고).
   */
  highlights?: TextHighlight[];
}

export interface TextLine {
  id: string;
  runs: TextRun[];
  anchor: IndentAnchor;
  /** Phase 4. 없으면 하이라이트 없음. */
  highlights?: TextHighlight[];
  /** Phase 4(2차). 없으면 이 줄에 연결된 주석 없음. */
  annotations?: TextAnnotation[];
}

/** TextLine의 runs를 이어붙인 순수 문자열. anchor 판별 로직 입력으로 쓰인다. */
export function lineText(line: Pick<TextLine, 'runs'>): string {
  return line.runs.map((r) => r.text).join('');
}

/** TextObjectView.tsx가 Enter로 줄을 새로 나눌 때(handleEnter) runs를 직접 채운
 * TextLine을 만들 때도 같은 id 생성 규칙을 쓰기 위해 export한다. */
export function createLineId(): string {
  return crypto.randomUUID();
}

/** 스타일 없는 단일 run으로 이루어진 줄을 만든다. 주로 seed 데이터/새 줄 생성에 사용. */
export function createPlainLine(text: string, anchor: IndentAnchor = ROOT_ANCHOR): TextLine {
  return {
    id: createLineId(),
    runs: text ? [{ text }] : [],
    anchor,
  };
}
