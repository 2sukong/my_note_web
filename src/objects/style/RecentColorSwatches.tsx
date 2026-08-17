import { useRecentColorsStore } from '../../store/recentColorsStore';
import type { RecentColorCategory } from '../../store/recentColorsStore';

interface RecentColorSwatchesProps {
  category: RecentColorCategory;
  onPick: (color: string) => void;
  activeColor?: string;
  /** 스와치 하나의 CSS 클래스 — 상단 툴바(canvas-toolbar-swatch)와 사이드바
   * (properties-round-swatch)가 서로 다른 크기/스타일을 쓰므로 호출부에서 넘긴다. */
  swatchClassName: string;
}

/**
 * 요구사항: 텍스트/형광펜/주석 각각의 "자주 사용하는 색상"을 상단 툴바/사이드바
 * 어디서든 같은 방식으로 보여준다. 클릭하면 그 색을 적용하고, 우클릭하면 그
 * 자리에서 바로 목록에서 삭제한다(별도 확인 다이얼로그 없음 — 스와치가 작아서
 * 컨텍스트 메뉴 자체가 이미 "삭제하시겠습니까"에 준하는 명시적 동작이다).
 * 목록이 비어 있으면 행 자체를 렌더링하지 않는다(빈 자리가 차지되지 않도록).
 */
export function RecentColorSwatches({ category, onPick, activeColor, swatchClassName }: RecentColorSwatchesProps) {
  const recent = useRecentColorsStore((s) => s.byCategory[category]);
  const removeRecentColor = useRecentColorsStore((s) => s.removeRecentColor);

  if (!recent || recent.length === 0) return null;

  return (
    <>
      {recent.map((c) => (
        <button
          key={c}
          type="button"
          title={`${c} (우클릭: 목록에서 삭제)`}
          className={activeColor === c ? `${swatchClassName} is-active` : swatchClassName}
          style={{ background: c }}
          onClick={() => onPick(c)}
          onContextMenu={(e) => {
            e.preventDefault();
            removeRecentColor(category, c);
          }}
        />
      ))}
    </>
  );
}
