import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HexColorPicker } from 'react-colorful';
import { useRecentColorsStore } from '../../store/recentColorsStore';
import type { RecentColorCategory } from '../../store/recentColorsStore';

interface ColorPickerPopoverProps {
  label: string;
  value: string;
  onChange: (color: string) => void;
  /** 요구사항: 텍스트/형광펜/주석의 "자주 사용하는 색상"은 서로 독립적으로
   * 관리된다 — 이 컴포넌트가 어느 카테고리를 위해 쓰이는지 호출부가 명시한다. */
  category: RecentColorCategory;
}

const POPOVER_WIDTH = 200;
/** 실제 렌더 높이보다 넉넉한 예상치 — 화면 아래로 넘칠지 미리 판단하는 용도일 뿐,
 * 실제 크기는 CSS(width:100% 등)로 콘텐츠에 맞춰 자연스럽게 잡힌다. */
const POPOVER_HEIGHT_ESTIMATE = 340;
const VIEWPORT_MARGIN = 8;

/** #rgb, #rrggbb 형태만 유효한 색으로 취급한다(react-colorful의 HexColorPicker와 동일 규칙). */
function isValidHex(value: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
}

/**
 * 텍스트 색 / 형광펜 색 / 주석 색 / 화살표·사각형 테두리 색에 쓰는 자유 색상 선택기.
 *
 * react-colorful(의존성 없는 순수 클라이언트 라이브러리, 외부 네트워크 호출 없음) +
 * hex 텍스트 입력 + 카테고리별 "자주 사용하는 색상"(store/recentColorsStore.ts) 조합.
 * 트리거 버튼은 현재 색을 보여주는 작은 정사각형 스와치이고, 클릭하면 팝오버가 뜬다.
 *
 * 색은 드래그하는 동안 실시간으로 onChange가 불려서 캔버스에 바로 반영된다(다른
 * 도구들과 동일하게 즉시 미리보기).
 *
 * [수정] "자주 사용하는 색상"은 더 이상 색을 고르거나 팝오버를 닫는 것만으로
 * 자동 기록되지 않는다(요구사항: 색상 선택만으로는 절대 자동 추가되지 않아야
 * 함) — 팝오버 안의 "자주 쓰는 색상에 추가" 버튼을 명시적으로 눌렀을 때만
 * 현재 색(committedRef, 마지막으로 apply된 값)을 그 카테고리에 기록한다.
 *
 * [버그 수정] 팝오버를 트리거 바로 아래에 절대 위치(position:absolute)로 두면,
 * 이 컴포넌트를 담고 있는 조상 중 하나가 overflow:hidden/auto인 경우(예:
 * PropertiesPanel.css의 .properties-panel, .properties-panel-body) 팝오버가
 * 그 조상의 박스에 잘려 보이는 문제가 있었다. document.body에 createPortal로
 * 렌더링하고 position:fixed + 트리거의 실제 화면 좌표(getBoundingClientRect)로
 * 직접 배치해서 어떤 조상의 overflow 설정과도 무관하게 항상 온전히 보이게 한다.
 * 화면 오른쪽/아래로 넘칠 것 같으면 왼쪽/위로 뒤집어 배치한다.
 */
export function ColorPickerPopover({ label, value, onChange, category }: ColorPickerPopoverProps) {
  const [open, setOpen] = useState(false);
  const [hexInput, setHexInput] = useState(value);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const committedRef = useRef(value);

  const recent = useRecentColorsStore((s) => s.byCategory[category]) ?? [];
  const addRecentColor = useRecentColorsStore((s) => s.addRecentColor);
  const removeRecentColor = useRecentColorsStore((s) => s.removeRecentColor);

  useEffect(() => {
    setHexInput(value);
    committedRef.current = value;
  }, [value]);

  const computePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + 6;
    if (left + POPOVER_WIDTH + VIEWPORT_MARGIN > window.innerWidth) {
      left = Math.max(VIEWPORT_MARGIN, window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN);
    }
    if (top + POPOVER_HEIGHT_ESTIMATE + VIEWPORT_MARGIN > window.innerHeight) {
      top = Math.max(VIEWPORT_MARGIN, rect.top - POPOVER_HEIGHT_ESTIMATE - 6);
    }
    setPopoverPos({ top, left });
  };

  useEffect(() => {
    if (!open) return;
    computePosition();

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      close();
    };
    const handleReposition = () => computePosition();
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    setOpen(false);
  };

  const [justAdded, setJustAdded] = useState(false);
  const handleAddToRecent = () => {
    if (!committedRef.current) return;
    addRecentColor(category, committedRef.current);
    setJustAdded(true);
    window.setTimeout(() => setJustAdded(false), 1200);
  };

  const apply = (color: string) => {
    committedRef.current = color;
    setHexInput(color);
    onChange(color);
  };

  const handleHexInputChange = (raw: string) => {
    const next = raw.startsWith('#') ? raw : `#${raw}`;
    setHexInput(next);
    if (isValidHex(next)) apply(next);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="properties-color-trigger"
        style={{ background: value }}
        title={label}
        onClick={() => setOpen((o) => !o)}
      />
      {open &&
        popoverPos &&
        createPortal(
          <div
            ref={popoverRef}
            className="properties-color-popover"
            style={{ position: 'fixed', top: popoverPos.top, left: popoverPos.left }}
          >
            <HexColorPicker color={isValidHex(value) ? value : '#000000'} onChange={apply} />
            <input
              type="text"
              className="properties-color-hex-input"
              value={hexInput}
              onChange={(e) => handleHexInputChange(e.target.value)}
              spellCheck={false}
              maxLength={7}
            />
            {/* 요구사항: 자주 쓰는 색상은 이 버튼을 눌렀을 때만 저장된다(색상 선택
                자체나 다른 동작으로는 절대 자동 추가되지 않음). */}
            <button type="button" className="properties-color-add-recent-btn" onClick={handleAddToRecent}>
              {justAdded ? '자주 쓰는 색상에 추가됨' : '+ 자주 쓰는 색상에 추가'}
            </button>
            {recent.length > 0 && (
              <div className="properties-color-recent">
                {recent.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="properties-color-recent-swatch"
                    style={{ background: c }}
                    title={`${c} (우클릭: 목록에서 삭제)`}
                    onClick={() => apply(c)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      removeRecentColor(category, c);
                    }}
                  />
                ))}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
