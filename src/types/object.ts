/**
 * 캔버스 객체 공통 필드. 모든 객체는 world 좌표(x, y)와 world 크기(width, height)를
 * 가지며, zoom/pan이 바뀌어도 이 값들은 절대 변하지 않는다.
 */
export interface BaseObject {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number; // MVP에서는 0 고정
  zIndex: number;
  createdAt: number;
  updatedAt: number;
}

import type { TextLine } from '../objects/text/indentation/types';

/**
 * Phase 3: content는 줄 단위(TextLine[])로 관리된다.
 * 각 줄은 자신만의 indentation anchor를 가지며, 공백 개수가 아니라
 * anchor 체인으로 계층을 표현한다. 자세한 내용은 objects/text/indentation 참고.
 *
 * Phase 4(2차): frameId는 이 Text가 어떤 Frame에 "속해 있는지"를 나타내는
 * 순수 논리적 참조다. Frame이 DOM상 부모가 되는 구조가 아니다 — Frame을
 * 드래그로 옮기면 objectsStore.moveObjectTo가 frameId가 같은 객체들에게
 * 같은 이동량(delta)을 전파해줄 뿐, Text는 항상 독립된 world 좌표 객체다.
 * Frame 밖에서 만들어진 Text는 frameId가 없다(undefined/null 허용).
 */
export interface TextObject extends BaseObject {
  type: 'text';
  lines: TextLine[];
  baseFontSize: number;
  color: string;
  frameId?: string | null;
  /**
   * Phase 8(스타일 패널): CSS font-family 값 그대로 저장한다 — 기본 제네릭 키워드
   * (objects/text/fontOptions.ts, 예: 'serif'/'ui-monospace, monospace') 또는 사용자가
   * 업로드해 FontFace로 등록한 커스텀 폰트의 고유 family 이름(store/fontStore.ts).
   * undefined면 기존 기본값('system-ui, sans-serif')을 그대로 쓴다(하위 호환).
   */
  fontFamily?: string;
  /** true면 font-weight:700(굵게), 아니면 기본(400). 업로드 폰트가 굵은 버전이
   * 따로 없으면 브라우저가 합성(faux bold)해서라도 보여준다. */
  bold?: boolean;
  /** 요구사항(텍스트 상자 테두리 옵션): 상자 겉 테두리(1px 실선)를 보여줄지.
   * undefined는 true와 동일(기존 기본값 — 항상 테두리가 있었다). false면 테두리
   * 없이 반투명 배경만 남는다(배경 자체는 요구사항 범위 밖이라 그대로 유지). */
  borderEnabled?: boolean;
  /** 줄 사이 상하 간격. line-height 배수(글자 크기에 비례)로, 1.0~3.0 범위.
   * undefined면 기존 기본값(NATURAL_LINE_HEIGHT_RATIO=1.4)과 동일하게 렌더링된다. */
  lineHeight?: number;
}

export interface ImageObject extends BaseObject {
  type: 'image';
  imageId: string;
  naturalWidth: number;
  naturalHeight: number;
  aspectRatioLocked: boolean;
  /**
   * Phase 5: TextObject.frameId와 완전히 같은 원리. Frame 위에 놓인 Image가 그
   * Frame에 논리적으로 속하게 해서, Frame을 드래그하면 같이 이동한다
   * (objectsStore.moveObjectTo 참고). Frame과 DOM 부모-자식 관계는 아니다.
   */
  frameId?: string | null;
}

/**
 * 실제 손으로 쓰는 종이 한 장에 해당하는 필기 공간. Canvas(무한 작업 공간)와는
 * 다른 개념이다 — Frame은 그 위에 자유롭게 배치되는 "페이지" 하나일 뿐이고,
 * Text/Image 등은 Frame의 DOM 자식이 아니라 여전히 독립적인 world 좌표 객체다
 * (TextObject.frameId 참고). 기본 크기는 A4 비율(210:297)을 따른다.
 */
export interface FrameObject extends BaseObject {
  type: 'frame';
  label?: string;
  /** 프레임 배경 테마(objects/frame/frameStyles.ts의 FrameTheme) — 테두리 유무와는
   * 무관하고, 배경 색만 바꾼다. undefined는 'plain'(흰 배경, 기존 기본값)과 동일.
   * 'half'는 구버전 데이터 하위 호환용으로만 남아 있다(과거엔 "흰 배경 + 접선"이
   * 하나로 묶여 있었다) — 새로 만드는 프레임은 절대 'half'로 저장하지 않는다. 실제
   * 배경 테마는 항상 objects/frame/frameStyles.ts의 resolveFrameTheme(style)로
   * 읽는다(style이 'half'여도 안전하게 'plain'으로 해석해준다). */
  style?: 'plain' | 'dark' | 'half';
  /** 요구사항(어두운 프레임에서도 A4 절반을 쓸 수 있도록): 프레임 정중앙에 접선(fold
   * line)을 그릴지 여부 — style(배경 테마)과 완전히 독립된 축이라 다크 배경에도 켤 수
   * 있다. undefined면 objects/frame/frameStyles.ts의 resolveFrameCenterFold(style,
   * centerFold)로 판정한다(구버전 데이터는 style==='half'였으면 true로 해석돼 마이그
   * 레이션 없이도 그대로 접선이 보인다). 새로 만드는 프레임은 이 필드를 명시적으로
   * true/false로 저장하고, style은 배경 테마만 나타낸다. */
  centerFold?: boolean;
  /** centerFold가 true일 때만 의미가 있다 — 정중앙 접선이 세로(좌우를 가름)인지
   * 가로(상하를 가름)인지. undefined는 'vertical'(기존 기본값)과 동일.
   * PropertiesPanel.tsx의 "방향 전환"(가로/세로 비율만 바꾸는 기존 버튼)은 이 값을
   * 건드리지 않는다 — 값이 바뀌는 건 "전체 회전" 버튼(비율 + 이 축을 함께 뒤집어
   * 프레임과 접선을 통째로 90도 돌린 것처럼 보이게 함)뿐이다. */
  foldAxis?: 'vertical' | 'horizontal';
}

/**
 * Phase 6: BaseObject의 x/y/width/height를 그대로 canonical bounding box로 쓴다
 * (다른 모든 객체 타입과 동일 — useObjectDrag/useObjectResize/SelectionOverlay/
 * useObjectDeleteShortcut을 전혀 수정하지 않고 그대로 재사용하기 위함). 문제는
 * canonical box가 항상 x<=x+width, y<=y+height라서 선분의 "방향"(4가지 대각선
 * 조합) 정보가 사라진다는 것 — 그래서 이 두 플래그로만 방향을 되살린다:
 *  - flipY: false면 로컬 (0,0)->(width,height) 대각선(NW-SE), true면
 *    (width,0)->(0,height) 대각선(NE-SW).
 *  - reverseArrow: 꼬리(시작점)와 머리(화살촉/끝점)의 순서를 뒤집을지.
 * 계산은 objects/shapes/shapeGeometry.ts의 computeDiagonal/localEndpoints 참고.
 *
 * frameId는 TextObject.frameId와 완전히 같은 원리 — Frame 위에서 그린 화살표가
 * 그 Frame에 논리적으로 속하게 해서, Frame을 드래그하면 같이 이동한다
 * (objectsStore.moveObjectTo 참고).
 */
export interface ArrowObject extends BaseObject {
  type: 'arrow';
  strokeColor: string;
  strokeWidth: number;
  flipY?: boolean;
  reverseArrow?: boolean;
  frameId?: string | null;
  /**
   * Phase 8(스타일 패널): 화살촉 모양 3종.
   *  - 'none': 화살촉 없이 선만(사용자 요청 — 참고 이미지에는 없었지만 추가 요청됨).
   *  - 'open': 참고 이미지의 "기존 화살표 모양" — 속을 채우지 않고 선 두 개로만
   *    이루어진 열린(ㅅ자) 화살촉.
   *  - 'triangle': 참고 이미지의 "속 채운 삼각형" — 기존에 항상 그려지던 모양.
   * undefined는 'triangle'과 동일(하위 호환 기본값).
   */
  arrowHead?: 'none' | 'open' | 'triangle';
  /** 선 스타일 3종(실선/점선/파선). undefined는 'solid'와 동일(기존 기본값). */
  lineStyle?: 'solid' | 'dotted' | 'dashed';
  /**
   * 선의 중간을 드래그해 만든 곡률. 시작점/끝점(p1/p2)은 그대로 두고, 그 사이를
   * 2차 베지어 곡선으로 휘게 한다(shapeGeometry.ts의 quadraticControlPoint 참고).
   * 절대 px가 아니라 "p1->p2 길이 대비 수직 방향 비율"로 저장한다 — 그래야 리사이즈로
   * 화살표 길이가 바뀌어도 굽은 정도가 비례해서 같이 늘어난다(길이에 무관한 절대
   * px였다면 늘렸을 때 상대적으로 밋밋해지거나 과하게 휘어 보였을 것).
   * undefined/0은 기존과 동일한 직선.
   */
  curveOffset?: number;
}

/** box 전체를 채우는 사각형으로 그려진다(objects/shapes/ShapeView.tsx). frameId는
 * ArrowObject.frameId와 같은 원리. */
export interface ShapeObject extends BaseObject {
  type: 'rectangle';
  strokeColor: string;
  strokeWidth: number;
  frameId?: string | null;
  /** Phase 8(스타일 패널): 모서리를 둥글게 처리할지(뾰족/둥근 두 상태만 지원 —
   * 반지름 슬라이더는 범위 밖). undefined는 false(뾰족, 기존 기본값)와 동일. */
  rounded?: boolean;
  /** 테두리 선 스타일 3종(실선/점선/파선) — ArrowObject.lineStyle과 같은 의미.
   * undefined는 'solid'와 동일(기존 기본값). */
  lineStyle?: 'solid' | 'dotted' | 'dashed';
  /** 내부를 테두리 색으로 채울지. undefined는 false(투명, 기존 기본값)와 동일.
   * 채우기 색은 항상 strokeColor를 그대로 쓴다(별도 fill 색상을 고르지 않는다 —
   * 요구사항: "내부: 투명 / 테두리 색상 채우기"). */
  fillEnabled?: boolean;
  /** fillEnabled일 때만 쓰이는 내부 채우기의 불투명도(0~1). undefined는 0.3과 동일. */
  fillOpacity?: number;
}

export type CanvasObject =
  | TextObject
  | ImageObject
  | FrameObject
  | ArrowObject
  | ShapeObject;

export type CanvasObjectType = CanvasObject['type'];
