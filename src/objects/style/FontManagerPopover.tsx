import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFontStore } from '../../store/fontStore';
import { BUILTIN_FONT_OPTIONS } from '../text/fontOptions';

interface FontManagerPopoverProps {
  /** 현재 선택 중인 font-family 값 — 목록에서 어떤 항목이 지금 쓰이고 있는지
   * 살짝 강조해 보여주는 용도(삭제 자체와는 무관). */
  currentFamily: string;
}

const POPOVER_WIDTH = 220;
const POPOVER_HEIGHT_ESTIMATE = 260;
const VIEWPORT_MARGIN = 8;

/**
 * 요구사항 3번: 글꼴 목록에서 사용자가 추가한 글꼴을 삭제할 수 있어야 하고,
 * "클로드가 기본적으로 설정한 글꼴들도 모두 삭제 가능하게" 해달라는 요청에 따라
 * 기본 제공 폰트(objects/text/fontOptions.ts) 5종도 목록에서 숨길 수 있다
 * (store/fontStore.ts:removeBuiltinFont — 실제 코드/기능을 지우는 게 아니라
 * "숨김 처리"이지만, 사용자 입장에선 드롭다운/이 목록 어디에도 다시 안 나타나므로
 * 체감상 삭제와 동일하다).
 *
 * ColorPickerPopover.tsx와 동일한 이유로 createPortal + position:fixed를 쓴다 —
 * 이 컴포넌트도 PropertiesPanel의 overflow:hidden/auto 조상 안에 위치하므로,
 * 절대 위치로 두면 잘려 보이는 문제가 똑같이 생긴다.
 *
 * 최소 1개는 항상 남겨둔다(전부 지우면 글꼴 드롭다운이 빈 목록이 되는 것을 막기
 * 위한 안전장치) — 마지막 하나의 삭제 버튼은 비활성화된다.
 */
export function FontManagerPopover({ currentFamily }: FontManagerPopoverProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const customFonts = useFontStore((s) => s.customFonts);
  const hiddenBuiltinIds = useFontStore((s) => s.hiddenBuiltinIds);
  const removeCustomFont = useFontStore((s) => s.removeCustomFont);
  const removeBuiltinFont = useFontStore((s) => s.removeBuiltinFont);

  const visibleBuiltins = BUILTIN_FONT_OPTIONS.filter((f) => !hiddenBuiltinIds.includes(f.id));
  const totalCount = visibleBuiltins.length + customFonts.length;
  const isLastOne = totalCount <= 1;

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
    setPos({ top, left });
  };

  useEffect(() => {
    if (!open) return;
    computePosition();
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
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

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="properties-add-font-btn"
        title="글꼴 목록 관리(삭제)"
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open &&
        pos &&
        createPortal(
          <div ref={popoverRef} className="font-manager-popover" style={{ position: 'fixed', top: pos.top, left: pos.left }}>
            <div className="font-manager-title">글꼴 목록 관리</div>
            <ul className="font-manager-list">
              {visibleBuiltins.map((f) => (
                <li key={f.id} className={f.family === currentFamily ? 'font-manager-item is-current' : 'font-manager-item'}>
                  <span style={{ fontFamily: f.family }}>{f.label}</span>
                  <button
                    type="button"
                    className="font-manager-remove"
                    title={isLastOne ? '마지막 글꼴은 삭제할 수 없습니다' : '목록에서 삭제'}
                    disabled={isLastOne}
                    onClick={() => removeBuiltinFont(f.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
              {customFonts.map((f) => (
                <li key={f.id} className={f.family === currentFamily ? 'font-manager-item is-current' : 'font-manager-item'}>
                  <span style={{ fontFamily: f.family }}>{f.label}</span>
                  <button
                    type="button"
                    className="font-manager-remove"
                    title={isLastOne ? '마지막 글꼴은 삭제할 수 없습니다' : '목록에서 삭제'}
                    disabled={isLastOne}
                    onClick={() => removeCustomFont(f.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
              {totalCount === 0 && <li className="font-manager-empty">사용 가능한 글꼴이 없습니다</li>}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}
