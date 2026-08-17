/**
 * #rgb 또는 #rrggbb 형태의 hex를 rgba(...)로 변환한다. 형광펜/주석 색이 미리 정의된
 * 프리셋이 아니라 ColorPickerPopover로 자유롭게 고른 임의의 hex일 때, 커스텀 배경/
 * 보조색을 계산하는 데 쓴다. 유효한 hex가 아니면(이미 rgba()이거나 색상 이름 등)
 * 그대로 돌려준다 — 억지로 파싱해서 깨뜨리지 않는다.
 */
export function hexToRgba(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  let h = match[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
