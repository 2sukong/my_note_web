import { create } from 'zustand';
import { DEFAULT_STROKE_WIDTH } from '../objects/shapes/strokeColors';
import { DEFAULT_FONT_FAMILY } from '../objects/text/fontOptions';
import { LINE_HEIGHT_DEFAULT } from '../objects/text/lineSpacing';
import { DEFAULT_FRAME_HEIGHT, DEFAULT_FRAME_WIDTH } from '../objects/frame/frameDefaults';
import type { FrameTheme } from '../objects/frame/frameStyles';
import type { TextDefaultPreset } from './textDefaultPresetsStore';

/**
 * Phase 4: 캔버스 상단 툴바에서 고르는 "현재 도구".
 *
 * interactionStore.mode(idle/select/drag/resize/pan/text-edit)와는 다른 개념이다.
 * mode는 pointer 제스처에 따라 시시각각 바뀌는 상태 머신이고, activeTool은
 * 사용자가 명시적으로 골라 유지하는 선택(형광펜 색을 고르고 여러 번 긋는 것처럼)이다.
 *
 * - 'select' (기본값): 기존 Phase 1~3 동작 그대로. 텍스트 객체를 드래그하면 이동한다.
 * - 'highlight': 텍스트 객체 위에서 드래그하면 객체 이동 대신 브라우저 네이티브
 *   텍스트 선택이 일어나고, 선택이 끝나면(pointerup) 그 구간에 highlightColor로
 *   하이라이트가 생성된다.
 * - 'annotation': 위와 동일하게 드래그로 텍스트를 선택하면, 그 시작 지점을 anchor로
 *   삼아 새 Annotation을 만들고 바로 편집 상태로 진입한다.
 * - 'text': 캔버스(또는 Frame 내부)를 한 번 클릭하면 그 위치에 새 Text 객체가
 *   생기고 바로 편집 상태로 들어간다. 클릭 한 번으로 소모되는 "1회용" 도구라서
 *   생성 직후 자동으로 'select'로 되돌아간다.
 * - 'frame': 캔버스를 클릭하면 그 위치에 A4 비율 기본 크기의 새 Frame이 생긴다.
 *   'text'와 마찬가지로 1회용이다.
 * - 'image' (Phase 5): 캔버스(또는 Frame 내부)를 클릭하면 그 위치를 기억해두고
 *   파일 선택 대화상자를 연다. 파일을 고르면 그 자리에 Image 객체가 생긴다.
 *   'text'/'frame'과 마찬가지로 1회용 — 클릭 즉시 'select'로 되돌아간다(실제
 *   배치는 imagePickerStore가 기억한 좌표로 파일 선택 완료 후 비동기로 일어난다).
 *   드래그 앤 드롭이나 Ctrl+V 붙여넣기로 이미지를 넣을 때는 이 도구를 거치지 않는다.
 * - 'arrow'/'rectangle' (Phase 6): 캔버스 빈 곳에서 드래그하면 시작점→끝점을 잇는
 *   도형이 생긴다(canvas/interaction/useDrawShapeTool.ts). text/frame/image처럼
 *   클릭 한 번이 아니라 드래그 자체가 1회용 제스처라서 pointerup 시점에 생성이
 *   확정되고 바로 'select'로 되돌아간다.
 *
 * 요구사항(메뉴/사이드바 상태 통합, 이번 라운드): selectedIds가 비어있을 때
 * activeTool이 'text'/'highlight'/'annotation'/'arrow'/'rectangle'이면
 * PropertiesPanel.tsx가 그 도구로 "다음에 만들 것"의 기본값을 보여준다
 * (textColor/textFontFamily, highlightColor, annotationColor/annotationFontFamily,
 * shapeStrokeColor/shapeStrokeWidth/shapeArrowHead/shapeLineStyle,
 * shapeRounded/shapeFillEnabled/shapeFillOpacity). 객체를 클릭해서 선택하면
 * (canvas/interaction/useObjectDrag.ts) 그 객체 종류에 맞춰 activeTool이 자동
 * 전환되고, 상단 메뉴 버튼을 직접 클릭하면(canvas/Toolbar.tsx) 그 반대로 선택이
 * 해제되고 이 도구의 기본값 패널이 열린다.
 */
export type ToolId =
  | 'select'
  | 'highlight'
  | 'annotation'
  | 'text'
  | 'frame'
  | 'image'
  | 'arrow'
  | 'rectangle';

export const SHAPE_TOOL_IDS: ToolId[] = ['arrow', 'rectangle'];

type LineStyle = 'solid' | 'dotted' | 'dashed';

interface ToolState {
  activeTool: ToolId;
  /**
   * 형광펜 도구로 새 하이라이트를 만들 때 쓰일 색. 프리셋 id(HighlightColorId) 하나
   * 이거나, 요구사항(자주 사용하는 색상)에 따라 ColorPickerPopover/최근색 목록에서
   * 고른 자유 hex일 수 있어 string으로 넓혀 둔다(TextHighlight.color와 동일한 이유).
   */
  highlightColor: string;
  /** 요구사항(형광펜 지우개): 켜져 있으면 형광펜 도구로 드래그했을 때 새로 칠하는
   * 대신 그 구간과 겹치는 하이라이트만 지운다(텍스트/주석 등 다른 데이터는 그대로).
   * 'highlight' 도구가 켜져 있을 때만 의미가 있다 — 다른 도구로 전환하면 자동으로
   * 꺼진다(아래 setTool 참고). */
  highlightEraserActive: boolean;
  /** 'annotation' 도구로 새 주석을 만들 때 쓰일 색. 위 highlightColor와 같은 이유로 string. */
  annotationColor: string;
  /** 요구사항(폰트 목록 통합): 새 주석을 만들 때 쓰일 기본 글꼴 — 본문 텍스트와
   * 완전히 같은 폰트 목록(BUILTIN_FONT_OPTIONS + fontStore.customFonts)을 공유한다. */
  annotationFontFamily: string;
  /** 요구사항(주석 크기 조절): 새 주석을 만들 때 쓰일 기본 글자 크기(px) —
   * AnnotationBubble.BUBBLE_FONT_SIZE_BASE와 같은 기준. */
  annotationFontSize: number;
  /**
   * Phase 6: 화살표/사각형을 그릴 때 쓰일 펜 색/두께. 요구사항(사각형/화살표
   * 자주 쓰는 색상)에 따라 프리셋 id뿐 아니라 자유 hex도 저장할 수 있어야 해서
   * StrokeColorId에서 string으로 넓혔다(highlightColor/annotationColor와 동일한 이유) —
   * strokeColors.ts의 strokeColorValueFor가 프리셋/자유값 여부와 무관하게 실제
   * CSS 색상 문자열로 변환해준다.
   */
  shapeStrokeColor: string;
  shapeStrokeWidth: number;
  /** 요구사항(사각형/화살표 사이드바 기본값): canvas/actions.ts의 spawnShapeFromDraft가
   * 새로 그리는 도형에 그대로 적용한다 — 기존엔 이 네 값이 하드코딩('triangle'/'solid'/
   * false/false/0.3)돼 있었다. */
  shapeArrowHead: 'none' | 'open' | 'triangle';
  shapeLineStyle: LineStyle;
  shapeRounded: boolean;
  shapeFillEnabled: boolean;
  shapeFillOpacity: number;
  /**
   * 요구사항 6번(이전 라운드): 상단 툴바의 '텍스트' 버튼을 클릭하면 오른쪽 사이드바가
   * 열려 "새로 만들 텍스트"의 기본 색상/글꼴/크기/굵기를 미리 설정할 수 있어야 한다
   * (선택된 객체가 없어도). canvas/actions.ts의 spawnTextAt/spawnTextFromClipboard가
   * 이 값들을 새 TextObject의 초기 color/fontFamily/baseFontSize/bold로 사용한다.
   */
  textColor: string;
  textFontFamily: string;
  textFontSize: number;
  textBold: boolean;
  /** 요구사항(텍스트 상자 테두리 옵션): 다음에 만들 텍스트 상자의 기본 테두리 여부 —
   * TextObject.borderEnabled와 같은 의미. */
  textBorderEnabled: boolean;
  /** 요구사항(텍스트 상자 생성 전 줄 간격): 다음에 만들 텍스트 상자의 기본 줄 간격 —
   * TextObject.lineHeight와 같은 의미(objects/text/lineSpacing.ts 기준). */
  textLineHeight: number;
  /** 요구사항(프레임 사이드바): 다음에 만들 Frame의 기본 크기/배경 스타일 —
   * canvas/actions.ts의 spawnFrameAt이 그대로 쓴다. */
  frameWidth: number;
  frameHeight: number;
  /** 배경 테마만 나타낸다(plain/dark) — 요구사항(어두운 프레임에서도 A4 절반을 쓸 수
   * 있도록): 접선 표시 여부는 더 이상 여기 섞여 있지 않고 frameCenterFold로 분리됐다. */
  frameStyle: FrameTheme;
  /** 다음에 만들 Frame에 정중앙 접선("A4 절반")을 넣을지 — frameStyle과 완전히
   * 독립이라 다크 배경에도 켤 수 있다. FrameObject.centerFold와 같은 의미. */
  frameCenterFold: boolean;
  /** frameCenterFold가 true일 때 접선이 세로/가로 어느 쪽인지 — FrameObject.foldAxis와
   * 같은 의미(objects/types/object.ts 참고). */
  frameFoldAxis: 'vertical' | 'horizontal';
  setTool: (tool: ToolId) => void;
  setHighlightColor: (color: string) => void;
  setHighlightEraserActive: (active: boolean) => void;
  setAnnotationColor: (color: string) => void;
  setAnnotationFontFamily: (family: string) => void;
  setAnnotationFontSize: (size: number) => void;
  setShapeStrokeColor: (color: string) => void;
  setShapeStrokeWidth: (width: number) => void;
  setShapeArrowHead: (style: 'none' | 'open' | 'triangle') => void;
  setShapeLineStyle: (style: LineStyle) => void;
  setShapeRounded: (rounded: boolean) => void;
  setShapeFillEnabled: (enabled: boolean) => void;
  setShapeFillOpacity: (opacity: number) => void;
  setTextColor: (color: string) => void;
  setTextFontFamily: (family: string) => void;
  setTextFontSize: (size: number) => void;
  setTextBold: (bold: boolean) => void;
  setTextBorderEnabled: (enabled: boolean) => void;
  setTextLineHeight: (height: number) => void;
  /** 요구사항(텍스트 기본값 저장): '제목'/'본문' 프리셋(textDefaultPresetsStore)을
   * 고르면 이 여섯 필드를 한 번에 그 값으로 맞춘다. */
  applyTextDefaults: (preset: TextDefaultPreset) => void;
  setFrameSize: (width: number, height: number) => void;
  setFrameStyle: (style: FrameTheme) => void;
  setFrameCenterFold: (centerFold: boolean) => void;
  setFrameFoldAxis: (axis: 'vertical' | 'horizontal') => void;
}

export const useToolStore = create<ToolState>((set) => ({
  activeTool: 'select',
  highlightColor: 'yellow',
  highlightEraserActive: false,
  annotationColor: 'red',
  annotationFontFamily: DEFAULT_FONT_FAMILY,
  // objects/text/AnnotationBubble.tsx의 BUBBLE_FONT_SIZE_BASE와 같은 값 — 컴포넌트
  // 파일을 store가 import하지 않기 위해 리터럴로 둔다(textFontSize:16과 같은 관례).
  annotationFontSize: 11,
  shapeStrokeColor: 'black',
  shapeStrokeWidth: DEFAULT_STROKE_WIDTH,
  shapeArrowHead: 'triangle',
  shapeLineStyle: 'solid',
  shapeRounded: false,
  shapeFillEnabled: false,
  shapeFillOpacity: 0.3,
  textColor: '#222222',
  textFontFamily: DEFAULT_FONT_FAMILY,
  textFontSize: 16,
  textBold: false,
  textBorderEnabled: true,
  textLineHeight: LINE_HEIGHT_DEFAULT,
  frameWidth: DEFAULT_FRAME_WIDTH,
  frameHeight: DEFAULT_FRAME_HEIGHT,
  frameStyle: 'plain',
  frameCenterFold: false,
  frameFoldAxis: 'vertical',

  // 요구사항(형광펜 지우개): 형광펜 도구를 벗어나면 지우개 모드도 함께 꺼서, 나중에
  // 다시 형광펜 도구로 돌아왔을 때 지우개가 켜진 채로 남아있는 것을 방지한다.
  setTool: (tool) => set((s) => ({ activeTool: tool, highlightEraserActive: tool === 'highlight' ? s.highlightEraserActive : false })),
  // 색을 고르는 것은 "칠하겠다"는 의도이므로 지우개 모드를 함께 끈다.
  setHighlightColor: (color) => set({ highlightColor: color, activeTool: 'highlight', highlightEraserActive: false }),
  setHighlightEraserActive: (active) => set({ highlightEraserActive: active, activeTool: 'highlight' }),
  setAnnotationColor: (color) => set({ annotationColor: color, activeTool: 'annotation' }),
  setAnnotationFontFamily: (family) => set({ annotationFontFamily: family }),
  setAnnotationFontSize: (size) => set({ annotationFontSize: size }),
  setShapeStrokeColor: (color) => set({ shapeStrokeColor: color }),
  setShapeStrokeWidth: (width) => set({ shapeStrokeWidth: width }),
  setShapeArrowHead: (style) => set({ shapeArrowHead: style }),
  setShapeLineStyle: (style) => set({ shapeLineStyle: style }),
  setShapeRounded: (rounded) => set({ shapeRounded: rounded }),
  setShapeFillEnabled: (enabled) => set({ shapeFillEnabled: enabled }),
  setShapeFillOpacity: (opacity) => set({ shapeFillOpacity: opacity }),
  setTextColor: (color) => set({ textColor: color }),
  setTextFontFamily: (family) => set({ textFontFamily: family }),
  setTextFontSize: (size) => set({ textFontSize: size }),
  setTextBold: (bold) => set({ textBold: bold }),
  setTextBorderEnabled: (enabled) => set({ textBorderEnabled: enabled }),
  setTextLineHeight: (height) => set({ textLineHeight: height }),
  applyTextDefaults: (preset) =>
    set({
      textColor: preset.color,
      textFontFamily: preset.fontFamily,
      textFontSize: preset.fontSize,
      textBold: preset.bold,
      textBorderEnabled: preset.borderEnabled,
      textLineHeight: preset.lineHeight,
    }),
  setFrameSize: (width, height) => set({ frameWidth: width, frameHeight: height }),
  setFrameStyle: (style) => set({ frameStyle: style }),
  setFrameCenterFold: (centerFold) => set({ frameCenterFold: centerFold }),
  setFrameFoldAxis: (axis) => set({ frameFoldAxis: axis }),
}));
