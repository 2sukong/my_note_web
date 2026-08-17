export type TextColorId = 'black' | 'red' | 'blue' | 'green' | 'orange';

/**
 * 요구사항(색상 관리 통합): 텍스트는 지금까지 프리셋 없이 자유 색상 피커만 있었는데,
 * 형광펜/주석/사각형/화살표와 동일하게 "기본 제공 색상도 삭제할 수 있어야 한다"는
 * 요구사항을 텍스트에도 적용하기 위해 작은 프리셋 팔레트를 새로 추가한다.
 * objects/shapes/strokeColors.ts와 같은 5색 구성(검정/빨강/파랑/초록/주황)을 쓰되,
 * 종이 위 잉크 색에 가깝게 손으로 다시 조율했다(도형 펜 색보다 살짝 차분한 톤).
 */
export const TEXT_COLORS: Record<TextColorId, { label: string; value: string }> = {
  black: { label: '검정', value: '#222222' },
  red: { label: '빨강', value: '#c0392b' },
  blue: { label: '파랑', value: '#1f5fb0' },
  green: { label: '초록', value: '#1e7d4f' },
  orange: { label: '주황', value: '#c0703a' },
};

export const TEXT_COLOR_IDS: TextColorId[] = ['black', 'red', 'blue', 'green', 'orange'];
