import { useRecentColorsStore } from '../../store/recentColorsStore';
import type { RecentColorCategory } from '../../store/recentColorsStore';

interface RecentColorSwatchesProps {
  category: RecentColorCategory;
  onPick: (color: string) => void;
  activeColor?: string;
  /** 스와치 하나의 CSS 클래스 — 호출부(사이드바의 properties-round-swatch 등)마다
   * 크기/스타일이 다를 수 있어 넘겨받는다. */
  swatchClassName: string;
  /** 요구사항(팔레트 폐지, 2026-09-08): 사이드바 "색상" 줄에 프리셋 없이 즐겨찾기만
   * 한 줄로 합쳐지면서, 라벨/색상 원과 겹치지 않을 만큼만 보여줘야 하는 자리가
   * 생겼다 — store(recentColorsStore.ts)는 최대 8개까지 들고 있지만(팝오버 안의
   * 자체 목록은 그대로 8개 다 보여줌), 이 prop을 넘긴 곳에서만 화면에 보이는
   * 개수를 그보다 더 좁게 자른다. 최신 항목이 배열 맨 앞이라 항상 "가장 최근에
   * 추가한 것부터" 보인다. 생략하면(undefined) 기존처럼 전부 보여준다. */
  max?: number;
}

/**
 * 요구사항: 텍스트/형광펜/주석 각각의 "자주 사용하는 색상"을 상단 툴바/사이드바
 * 어디서든 같은 방식으로 보여준다. 클릭하면 그 색을 적용하고, 우클릭하면 그
 * 자리에서 바로 목록에서 삭제한다(별도 확인 다이얼로그 없음 — 스와치가 작아서
 * 컨텍스트 메뉴 자체가 이미 "삭제하시겠습니까"에 준하는 명시적 동작이다).
 * 목록이 비어 있으면 행 자체를 렌더링하지 않는다(빈 자리가 차지되지 않도록).
 */
export function RecentColorSwatches({ category, onPick, activeColor, swatchClassName, max }: RecentColorSwatchesProps) {
  const recent = useRecentColorsStore((s) => s.byCategory[category]);
  const removeRecentColor = useRecentColorsStore((s) => s.removeRecentColor);

  if (!recent || recent.length === 0) return null;
  const visible = max === undefined ? recent : recent.slice(0, max);

  return (
    <>
      {visible.map((c) => (
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
