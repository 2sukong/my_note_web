export type StrokeColorId = 'black' | 'red' | 'blue' | 'green' | 'orange';

/**
 * 화살표/선/도형 도구의 펜 색상 팔레트. highlightColors.ts와 달리 배경을 칠하는
 * 반투명 색이 아니라 손으로 그은 획 자체의 색이라서 진하고 선명한 톤을 그대로 쓴다.
 */
export const STROKE_COLORS: Record<StrokeColorId, { label: string; value: string }> = {
  black: { label: '검정', value: '#2b2b2b' },
  red: { label: '빨강', value: '#e5484d' },
  blue: { label: '파랑', value: '#3b82f6' },
  green: { label: '초록', value: '#22a06b' },
  orange: { label: '주황', value: '#f2994a' },
};

export const STROKE_COLOR_IDS: StrokeColorId[] = ['black', 'red', 'blue', 'green', 'orange'];

export const DEFAULT_STROKE_WIDTH = 2.5;

function isPresetId(color: string): color is StrokeColorId {
  return Object.prototype.hasOwnProperty.call(STROKE_COLORS, color);
}

/**
 * 요구사항(사각형/화살표 자주 쓰는 색상): toolStore.shapeStrokeColor/
 * ArrowObject.strokeColor/ShapeObject.strokeColor는 이제 프리셋 id 5종뿐 아니라
 * ColorPickerPopover로 고른 자유 hex도 담을 수 있다(highlightColors.ts의
 * highlightSwatchFor와 동일한 패턴) — 프리셋이면 손으로 조율한 값을, 아니면 그
 * hex 문자열을 그대로 실제 CSS 색상으로 쓴다. 예전 toolStore.ts의
 * resolveStrokeColorValue(StrokeColorId 전용)를 대체한다.
 */
export function strokeColorValueFor(color: string): string {
  return isPresetId(color) ? STROKE_COLORS[color].value : color;
}
