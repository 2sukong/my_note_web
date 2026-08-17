import type { AnnotationColorId } from './indentation/types';
import { hexToRgba } from '../style/colorMath';

/**
 * 주석(말풍선 + 화살표)의 색상 팔레트. highlightColors.ts와 같은 구조를 따른다.
 * text: 말풍선 글자색이자 화살표 색(요구사항: 화살표는 주석 텍스트 색과 동일해야 함).
 * tick: PropertiesPanel의 색상 선택 스와치에서 이 프리셋을 대표하는 진한 색(더 이상
 * 화면에 밑줄로 그려지지는 않지만, 스와치 UI에서는 계속 쓰인다).
 * 기본색 없이 빨강/주황/파랑 3색만 제공한다.
 */
export const ANNOTATION_COLORS: Record<
  AnnotationColorId,
  { label: string; swatch: string; text: string; tick: string; selectedBg: string }
> = {
  red: {
    label: '빨강',
    swatch: '#e0453a',
    text: '#b5352c',
    tick: '#e0453a',
    selectedBg: 'rgba(255, 226, 222, 0.95)',
  },
  orange: {
    label: '주황',
    swatch: '#e08a3c',
    text: '#b56b2c',
    tick: '#e08a3c',
    selectedBg: 'rgba(255, 235, 214, 0.95)',
  },
  blue: {
    label: '파랑',
    swatch: '#3d7fe0',
    text: '#2c5cb5',
    tick: '#3d7fe0',
    selectedBg: 'rgba(220, 232, 255, 0.95)',
  },
};

export const ANNOTATION_COLOR_IDS: AnnotationColorId[] = ['red', 'orange', 'blue'];

function isPresetId(color: string): color is AnnotationColorId {
  return Object.prototype.hasOwnProperty.call(ANNOTATION_COLORS, color);
}

/**
 * Phase 8: TextAnnotation.color가 프리셋 3색 중 하나면 손으로 조율한 tick/text/
 * selectedBg를, ColorPickerPopover로 고른 임의의 hex라면 그 hex를 tick/text에
 * 그대로 쓰고 selectedBg만 옅은 배경으로 계산해서 준다.
 */
export function annotationVisualsFor(color: string): { text: string; tick: string; selectedBg: string } {
  if (isPresetId(color)) return ANNOTATION_COLORS[color];
  return { text: color, tick: color, selectedBg: hexToRgba(color, 0.15) };
}
