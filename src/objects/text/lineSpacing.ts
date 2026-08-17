/**
 * 텍스트 객체의 "줄 간격"(TextObject.lineHeight) 관련 공통 상수.
 * PropertiesPanel(사이드바 입력창)과 TextObjectView(실제 렌더링)가 같은 범위/기본값을
 * 써야 어긋나지 않으므로 여기 한 곳에서만 정의한다.
 */
export const LINE_HEIGHT_MIN = 1.0;
export const LINE_HEIGHT_MAX = 3.0;
export const LINE_HEIGHT_STEP = 0.1;
/** lineHeight가 저장돼 있지 않은(undefined) 기존 텍스트에 적용되는 기본 배수. */
export const LINE_HEIGHT_DEFAULT = 1.4;

export function clampLineHeight(value: number): number {
  if (Number.isNaN(value)) return LINE_HEIGHT_DEFAULT;
  return Math.min(LINE_HEIGHT_MAX, Math.max(LINE_HEIGHT_MIN, value));
}
