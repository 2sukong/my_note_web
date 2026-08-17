import type { HighlightColorId } from './indentation/types';
import { hexToRgba } from '../style/colorMath';

/**
 * 형광펜으로 칠한 듯한 반투명 색상 팔레트.
 * 진한 글자색이 아니라 "연한 색 + alpha"여야 텍스트를 가리지 않는다는
 * 요구사항을 만족한다. 프로젝트의 종이색(#fafaf7 계열) 배경과 어울리도록
 * 채도를 낮춘 파스텔 톤으로 선택했다.
 */
export const HIGHLIGHT_COLORS: Record<HighlightColorId, { label: string; swatch: string; background: string }> = {
  red: {
    label: '다홍',
    swatch: '#ff8a73',
    background: 'rgba(255, 111, 87, 0.38)',
  },
  yellow: {
    label: '노랑',
    swatch: '#ffd54a',
    background: 'rgba(255, 213, 74, 0.45)',
  },
  blue: {
    label: '푸른',
    swatch: '#5b9dff',
    background: 'rgba(91, 157, 255, 0.32)',
  },
  purple: {
    label: '보라',
    swatch: '#b28aff',
    background: 'rgba(178, 138, 255, 0.35)',
  },
  green: {
    label: '초록',
    swatch: '#7bd389',
    background: 'rgba(123, 211, 137, 0.4)',
  },
};

export const HIGHLIGHT_COLOR_IDS: HighlightColorId[] = ['red', 'yellow', 'blue', 'purple', 'green'];

function isPresetId(color: string): color is HighlightColorId {
  return Object.prototype.hasOwnProperty.call(HIGHLIGHT_COLORS, color);
}

/**
 * Phase 8: TextHighlight.color가 프리셋 5색 중 하나면 손으로 조율한 배경색을,
 * ColorPickerPopover로 고른 임의의 hex라면 그 자리에서 계산한 반투명 배경을 준다.
 * "형광펜은 진한 색이 아니라 연한 색+alpha여야 글자를 가리지 않는다"는 프리셋의
 * 원칙을 커스텀 색에도 그대로 적용하기 위해 alpha를 고정값(0.4)으로 맞춘다.
 */
export function highlightBackgroundFor(color: string): string {
  if (isPresetId(color)) return HIGHLIGHT_COLORS[color].background;
  return hexToRgba(color, 0.4);
}

/** 스와치/피커 트리거에 보여줄 불투명 색 — 프리셋이면 그 swatch, 아니면 hex 그대로. */
export function highlightSwatchFor(color: string): string {
  return isPresetId(color) ? HIGHLIGHT_COLORS[color].swatch : color;
}
