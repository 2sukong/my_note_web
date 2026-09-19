/** 표(Table) 기본값. Frame/Text와 같은 스케일의 world 단위를 쓴다
 * (objects/frame/frameDefaults.ts, canvas/actions.ts의 DEFAULT_TEXT_WIDTH 참고). */
export const DEFAULT_TABLE_COL_WIDTH = 96;
export const DEFAULT_TABLE_ROW_HEIGHT = 36;
export const DEFAULT_TABLE_ROWS = 3;
export const DEFAULT_TABLE_COLS = 3;
export const MAX_TABLE_GRID_ROWS = 8;
export const MAX_TABLE_GRID_COLS = 10;

/** 표 지우개가 "정확히 선 위"로 인정하는 허용 오차. 화면 기준 고정 px를 zoom으로
 * 나눠 world 단위로 변환해서 쓴다(ShapeView.tsx의 ARROW_HIT_SCREEN_WIDTH와 동일한 관례). */
export const TABLE_ERASER_HIT_SCREEN_TOLERANCE = 6;

/** 요구사항(표 텍스트 글꼴/크기/색상): 셀에 fontFamily/fontSize/color가 지정돼
 * 있지 않을 때 쓰는 기본값 — store/toolStore.ts의 텍스트 기본값(textColor 등)과
 * 같은 값으로 맞춰서 새 텍스트 상자와 새 표 셀이 처음엔 같은 느낌으로 보이게 한다. */
export const DEFAULT_TABLE_TEXT_FONT_SIZE = 14;
export const DEFAULT_TABLE_TEXT_COLOR = '#222222';
