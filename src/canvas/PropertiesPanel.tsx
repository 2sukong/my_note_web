import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ArrowObject, CanvasObject, FrameObject, ShapeObject, TextObject } from '../types/object';
import { useInteractionStore } from '../store/interactionStore';
import { useObjectsStore } from '../store/objectsStore';
import { useHistoryStore } from '../store/historyStore';
import { useFontStore } from '../store/fontStore';
import { useToolStore } from '../store/toolStore';
import { useTextDefaultPresetsStore } from '../store/textDefaultPresetsStore';
import type { TextDefaultPreset, TextPresetKind } from '../store/textDefaultPresetsStore';
import { usePresetColorVisibilityStore } from '../store/presetColorVisibilityStore';
import { useTextRangeStore } from '../store/textRangeStore';
import { applyRunStyle, representativeRunStyle } from '../objects/text/runStyle';
import { BUILTIN_FONT_OPTIONS, DEFAULT_FONT_FAMILY } from '../objects/text/fontOptions';
import { LINE_HEIGHT_DEFAULT, LINE_HEIGHT_MAX, LINE_HEIGHT_MIN, LINE_HEIGHT_STEP, clampLineHeight } from '../objects/text/lineSpacing';
import { HIGHLIGHT_COLORS, HIGHLIGHT_COLOR_IDS, highlightSwatchFor } from '../objects/text/highlightColors';
import { ANNOTATION_COLORS, ANNOTATION_COLOR_IDS, annotationVisualsFor } from '../objects/text/annotationColors';
import { BUBBLE_FONT_SIZE_BASE } from '../objects/text/AnnotationBubble';
import { TEXT_COLORS, TEXT_COLOR_IDS } from '../objects/text/textColors';
import { STROKE_COLORS, STROKE_COLOR_IDS, strokeColorValueFor } from '../objects/shapes/strokeColors';
import { FRAME_SIZE_PRESETS } from '../objects/frame/frameDefaults';
import type { FrameSizePreset } from '../objects/frame/frameDefaults';
import { FRAME_THEMES, FRAME_THEME_IDS, resolveFrameTheme, resolveFrameCenterFold } from '../objects/frame/frameStyles';
import type { FrameTheme } from '../objects/frame/frameStyles';
import { ColorPickerPopover } from '../objects/style/ColorPickerPopover';
import { RecentColorSwatches } from '../objects/style/RecentColorSwatches';
import {
  ArrowHeadIcon,
  BoldIcon,
  BorderToggleIcon,
  CornerIcon,
  EraserIcon,
  FillIcon,
  LineStyleIcon,
  RotateIcon,
  StrokeWidthIcon,
  SwapIcon,
} from '../objects/style/StyleIcons';
import { ChevronDownIcon, PlusIcon } from '../icons/Icons';
import './PropertiesPanel.css';

const FONT_SIZE_PRESETS = [12, 14, 16, 18, 20, 24, 28, 32, 36, 48];
/** 주석 말풍선은 본문보다 훨씬 작게 쓰는 게 보통이라 본문용 FONT_SIZE_PRESETS와는
 * 별도의(더 작은 값 위주) 목록을 둔다 — BUBBLE_FONT_SIZE_BASE(11)를 포함한다. */
const ANNOTATION_FONT_SIZE_PRESETS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24];
/** 요구사항: 기존 4단계(1.5/2.5/4/6) 중 가장 얇은 두 개(1.5/2.5)만 남기고, 그보다도
 * 더 얇은 굵기(1)를 추가해 총 3단계로 좁혔다 — 두껍고 각진 화살표/사각형 선보다
 * 가는 선을 기본으로 쓰고 싶다는 요구사항. */
const STROKE_WIDTH_PRESETS = [1, 1.5, 2.5];
/** 요구사항(형광펜 굵기 조절): 이미지 위 직선 형광펜 전용 — FONT_SIZE_PRESETS와 같은
 * "드롭다운 + px 라벨" 디자인을 그대로 재사용한다(Row label="굵기" + Dropdown). */
const HIGHLIGHT_THICKNESS_PRESETS = [2, 4, 6, 8, 10, 14, 18, 24];

/**
 * Phase 8: 선택된 객체 종류에 따라 그 객체에 필요한 스타일 옵션만 보여주는 오른쪽
 * 사이드바. selectedIds가 정확히 하나(Text/Arrow/Rectangle)일 때, 또는 fineSelection이
 * 하이라이트/주석 하나를 가리킬 때 그 객체 자신의 스타일을 보여준다.
 *
 * [메뉴/사이드바 상태 통합, 이번 라운드] 선택된 것이 없어도 상단 툴바의
 * '텍스트'/'형광펜'/'주석'/'화살표'/'사각형' 버튼을 누르면 그 도구로 "다음에
 * 만들 것"의 기본값을 미리 설정할 수 있는 패널이 자동으로 열린다
 * (TextDefaultsSection/HighlightDefaultsSection/AnnotationDefaultsSection/
 * ArrowDefaultsSection/RectangleDefaultsSection — toolStore의 해당 필드를 직접
 * 바꾼다). 선택된 객체가 있을 때는 항상 그 객체 자신의 섹션이 우선한다 — 다중
 * 선택/Frame/Image처럼 어느 쪽에도 해당하지 않으면 아무것도 렌더링하지 않는다.
 * 텍스트는 "새로 만들 텍스트의 기본값" 같은 별도 안내문 없이 선택된 텍스트를 열
 * 때와 완전히 같은 제목("텍스트")과 같은 구성(글꼴/크기/색상/굵기)의 패널을 그대로
 * 재사용한다.
 *
 * 모든 변경은 objectsStore.updateObject(일반 객체) 또는
 * updateHighlightColor/updateAnnotationColor(하이라이트/주석)를 통해 즉시 반영되고,
 * 그 값 자체가 객체에 저장되므로 다시 선택했을 때 항상 마지막 설정이 그대로 유지된다.
 * 형광펜/주석/텍스트/도형 색은 프리셋 스와치(고정 팔레트, 우클릭으로 삭제 가능) +
 * ColorPickerPopover(자유 hex + 명시적으로 눌러야 저장되는 "자주 쓰는 색상")를
 * 함께 제공한다 — 다섯 카테고리 모두 동일한 원칙.
 *
 * Phase 8(부분 서식): Text 객체를 편집(mode==='text-edit')하는 동안 본문을 드래그로
 * 선택하면(TextObjectView.tsx의 useTextRangeSelection이 감지), TextSection의 글꼴/
 * 크기/색상/굵기 컨트롤이 객체 전체가 아니라 그 선택 구간에만 적용되도록 자동으로
 * 전환된다 — 한 텍스트 객체 안에서도 드래그한 부분만 다른 스타일을 가질 수 있다.
 */
export function PropertiesPanel() {
  const selectedIds = useInteractionStore((s) => s.selectedIds);
  const fineSelection = useInteractionStore((s) => s.fineSelection);
  const deselect = useInteractionStore((s) => s.deselect);
  const objectsRecord = useObjectsStore((s) => s.objects);
  const activeTool = useToolStore((s) => s.activeTool);
  const setTool = useToolStore((s) => s.setTool);

  if (fineSelection?.kind === 'highlight') {
    const owner = objectsRecord[fineSelection.objectId];
    const line = owner?.type === 'text' ? owner.lines.find((l) => l.id === fineSelection.lineId) : undefined;
    const highlight = line?.highlights?.find((h) => h.id === fineSelection.id);
    if (!highlight) return null;
    return (
      <PanelShell title="형광펜" onClose={deselect}>
        <HighlightSection
          color={highlight.color}
          onChange={(color) =>
            useObjectsStore
              .getState()
              .updateHighlightColor(fineSelection.objectId, fineSelection.lineId, fineSelection.id, color)
          }
        />
      </PanelShell>
    );
  }

  if (fineSelection?.kind === 'annotation') {
    const owner = objectsRecord[fineSelection.objectId];
    const line = owner?.type === 'text' ? owner.lines.find((l) => l.id === fineSelection.lineId) : undefined;
    const annotation = line?.annotations?.find((a) => a.id === fineSelection.id);
    if (!annotation) return null;
    return (
      <PanelShell title="주석" onClose={deselect}>
        <AnnotationSection
          color={annotation.color ?? 'red'}
          onChange={(color) =>
            useObjectsStore
              .getState()
              .updateAnnotationColor(fineSelection.objectId, fineSelection.lineId, fineSelection.id, color)
          }
          fontFamily={annotation.fontFamily || DEFAULT_FONT_FAMILY}
          onFontFamilyChange={(fontFamily) =>
            useObjectsStore
              .getState()
              .updateAnnotationFontFamily(fineSelection.objectId, fineSelection.lineId, fineSelection.id, fontFamily)
          }
          fontSize={annotation.fontSize ?? BUBBLE_FONT_SIZE_BASE}
          onFontSizeChange={(fontSize) =>
            useObjectsStore
              .getState()
              .updateAnnotationFontSize(fineSelection.objectId, fineSelection.lineId, fineSelection.id, fontSize)
          }
        />
      </PanelShell>
    );
  }

  if (selectedIds.length === 1) {
    const object = objectsRecord[selectedIds[0]];
    if (!object) return null;

    const update = (patch: Partial<CanvasObject> & Record<string, unknown>, coalesceKey?: string) =>
      useObjectsStore.getState().updateObject(object.id, patch, coalesceKey);

    if (object.type === 'text') {
      return (
        <PanelShell title="텍스트" onClose={deselect}>
          <TextSection object={object} update={update} />
        </PanelShell>
      );
    }
    if (object.type === 'arrow') {
      return (
        <PanelShell title="화살표" onClose={deselect}>
          <ArrowSection object={object} update={update} />
        </PanelShell>
      );
    }
    if (object.type === 'rectangle') {
      return (
        <PanelShell title="사각형" onClose={deselect}>
          <RectangleSection object={object} update={update} />
        </PanelShell>
      );
    }
    if (object.type === 'frame') {
      return (
        <PanelShell title="프레임" onClose={deselect}>
          <FrameSection object={object} update={update} />
        </PanelShell>
      );
    }
    return null;
  }

  // 요구사항(Ctrl+클릭/Ctrl+드래그 다중 선택 사이드바): 2개 이상 선택됐을 때, 선택된
  // 객체의 종류가 전부 같으면 그 종류의 사이드바를 보여준다(다르면 아무것도 보여주지
  // 않는다). 표시되는 현재 값은 첫 번째로 선택된 객체를 대표로 삼지만, 컨트롤을
  // 조작하면 updateAll이 선택된 모든 객체에 같은 patch를 적용한다 — 한 번의 undo로
  // 묶이도록 트랜잭션으로 감싼다(그렇지 않으면 objectsStore.mutate가 객체마다
  // 별도의 history 항목을 만든다).
  if (selectedIds.length > 1) {
    const objects = selectedIds.map((id) => objectsRecord[id]).filter((o): o is CanvasObject => !!o);
    if (objects.length === 0) return null;
    const firstType = objects[0].type;
    if (!objects.every((o) => o.type === firstType)) return null;

    const representative = objects[0];
    const updateAll = (patch: Record<string, unknown>, coalesceKey?: string) => {
      useHistoryStore.getState().beginTransaction(coalesceKey ?? 'multi-style');
      for (const o of objects) {
        useObjectsStore.getState().updateObject(o.id, patch);
      }
      useHistoryStore.getState().endTransaction();
    };

    if (representative.type === 'text') {
      return (
        <PanelShell title="텍스트" onClose={deselect}>
          <TextSection object={representative} update={updateAll} />
        </PanelShell>
      );
    }
    if (representative.type === 'arrow') {
      return (
        <PanelShell title="화살표" onClose={deselect}>
          <ArrowSection object={representative} update={updateAll} />
        </PanelShell>
      );
    }
    if (representative.type === 'rectangle') {
      return (
        <PanelShell title="사각형" onClose={deselect}>
          <RectangleSection object={representative} update={updateAll} />
        </PanelShell>
      );
    }
    if (representative.type === 'frame') {
      return (
        <PanelShell title="프레임" onClose={deselect}>
          <FrameSection object={representative} update={updateAll} />
        </PanelShell>
      );
    }
    return null;
  }

  // 선택된 객체가 없어도, 상단 툴바에서 텍스트/형광펜/주석/화살표/사각형 도구를
  // 고르는 즉시 그 도구의 기본값 패널이 열린다. 닫기 버튼은 지울 선택이 없으므로
  // deselect() 대신 도구를 'select'로 되돌린다.
  if (selectedIds.length === 0) {
    if (activeTool === 'text') {
      return (
        <PanelShell title="텍스트" onClose={() => setTool('select')}>
          <TextDefaultsSection />
        </PanelShell>
      );
    }
    if (activeTool === 'highlight') {
      return (
        <PanelShell title="형광펜" onClose={() => setTool('select')}>
          <HighlightDefaultsSection />
        </PanelShell>
      );
    }
    if (activeTool === 'annotation') {
      return (
        <PanelShell title="주석" onClose={() => setTool('select')}>
          <AnnotationDefaultsSection />
        </PanelShell>
      );
    }
    if (activeTool === 'arrow') {
      return (
        <PanelShell title="화살표" onClose={() => setTool('select')}>
          <ArrowDefaultsSection />
        </PanelShell>
      );
    }
    if (activeTool === 'rectangle') {
      return (
        <PanelShell title="사각형" onClose={() => setTool('select')}>
          <RectangleDefaultsSection />
        </PanelShell>
      );
    }
    if (activeTool === 'frame') {
      return (
        <PanelShell title="프레임" onClose={() => setTool('select')}>
          <FrameDefaultsSection />
        </PanelShell>
      );
    }
  }

  return null;
}

function PanelShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (!panelRef.current || panelRef.current.contains(e.target as Node)) return;
      // 버그 수정: 캔버스(.canvas-root) 내부 클릭은 자체 핸들러(배경 클릭으로 프레임/
      // 이미지 생성, 텍스트 드래그로 형광펜/주석 커밋 등)가 activeTool/selection을
      // 이미 알맞게 처리한다. 그 클릭의 pointerdown 단계에서 여기가 먼저 onClose
      // (예: setTool('select'))를 호출해버리면, 뒤이어 오는 click/pointerup 시점엔
      // activeTool이 이미 'select'로 바뀐 뒤라 프레임 생성이나 형광펜/주석 드래그
      // 커밋이 조용히 무시됐다 — 캔버스 밖(파일트리 사이드바 등) 클릭에만 반응해야 한다.
      if ((e.target as HTMLElement).closest('.canvas-root')) return;
      // 버그 수정(드롭다운으로 값을 고르면 사이드바가 닫힘): Dropdown/FontDropdown의
      // 옵션 목록은 document.body에 portal로 띄워져(properties-dropdown-list) DOM상
      // panelRef의 자식이 아니다 — 그래서 옵션을 클릭하면(pointerdown이 click보다
      // 먼저 발생) 위 panelRef.current.contains 검사를 통과하지 못하고 여기로 와서
      // onClose(예: 선택 없을 때는 setTool('select'))가 먼저 실행돼버려, 값을 고른
      // 직후 도구가 꺼지는 문제가 있었다(형광펜 굵기 드롭다운뿐 아니라 텍스트/주석
      // "크기" 드롭다운도 동일하게 영향받음). 포털 목록도 패널의 일부로 취급한다.
      if ((e.target as HTMLElement).closest('.properties-dropdown-list')) return;
      onClose();
    }
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [onClose]);

  return (
    <div className="properties-panel" ref={panelRef}>
      <div className="properties-panel-header">
        <span>{title} 스타일</span>
      </div>
      <div className="properties-panel-body">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="properties-row">
      <span className="properties-row-label">{label}</span>
      <div className="properties-row-control">{children}</div>
    </div>
  );
}

/**
 * 요구사항(자주 사용하는 색상 위치 통합): 색상을 갖는 모든 객체 사이드바(텍스트/
 * 형광펜/주석/화살표/사각형, 선택된 객체·기본값 패널 모두)의 마지막 줄에 항상
 * 동일한 형태로 둔다 — 라벨이 길어서(다른 라벨은 2~4자) Row의 "라벨 56px 고정폭 +
 * 오른쪽 컨트롤" 가로 배치 대신, 라벨을 위에 두고 스와치를 그 아래에서 감싸게 한다.
 */
function FrequentColorsRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="properties-recent-row">
      <span className="properties-recent-label">자주 사용하는 색상</span>
      <div className="properties-recent-swatches">{children}</div>
    </div>
  );
}

function Tile({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={active ? 'properties-tile is-active' : 'properties-tile'}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}

/** 요구사항: 한 속성에 선택지가 여럿인 Tile 행(화살촉/선 스타일/모서리/채우기/굵기/
 * 배경/A4 절반)을 하나의 회색 트랙으로 감싼다 — 단독 토글 Tile(굵게/테두리 등)에는
 * 쓰지 않는다. */
function TileGroup({ children }: { children: React.ReactNode }) {
  return <div className="properties-tile-group">{children}</div>;
}

const DROPDOWN_WIDTH_MIN = 90;
const DROPDOWN_HEIGHT_ESTIMATE = 200;
const DROPDOWN_VIEWPORT_MARGIN = 8;

/**
 * 요구사항(둥근 카드 드롭다운): 텍스트/주석 "크기"처럼 펼쳐지는 목록이 둥근 모서리
 * 카드 모양이어야 하는 자리에 쓰는 커스텀 드롭다운 — 네이티브 <select>는 옵션
 * 목록(팝업)의 모양을 CSS로 바꿀 수 없어서 직접 만들었다. ColorPickerPopover.tsx와
 * 같은 이유로 document.body에 portal + position:fixed로 띄운다(조상의
 * overflow:hidden에 잘리지 않도록).
 */
function Dropdown<T extends string | number>({
  value,
  options,
  labelOf,
  onChange,
}: {
  value: T;
  options: T[];
  labelOf: (v: T) => string;
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const computePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(rect.width, DROPDOWN_WIDTH_MIN);
    let left = rect.left;
    let top = rect.bottom + 4;
    if (left + width + DROPDOWN_VIEWPORT_MARGIN > window.innerWidth) {
      left = Math.max(DROPDOWN_VIEWPORT_MARGIN, window.innerWidth - width - DROPDOWN_VIEWPORT_MARGIN);
    }
    if (top + DROPDOWN_HEIGHT_ESTIMATE + DROPDOWN_VIEWPORT_MARGIN > window.innerHeight) {
      top = Math.max(DROPDOWN_VIEWPORT_MARGIN, rect.top - DROPDOWN_HEIGHT_ESTIMATE - 4);
    }
    setPos({ top, left, width });
  };

  useEffect(() => {
    if (!open) return;
    computePosition();
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
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
        className="properties-select properties-dropdown-trigger"
        onClick={() => setOpen((o) => !o)}
      >
        <span>{labelOf(value)}</span>
        <ChevronDownIcon />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={listRef}
            className="properties-dropdown-list"
            style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.width }}
          >
            {options.map((opt) => (
              <button
                key={String(opt)}
                type="button"
                className={opt === value ? 'properties-dropdown-item is-active' : 'properties-dropdown-item'}
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                }}
              >
                {labelOf(opt)}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * 요구사항(폰트 드롭다운): 글꼴 선택도 "크기"와 같은 둥근 카드 드롭다운으로 —
 * 네이티브 <select>는 옵션 팝업 모양을 CSS로 바꿀 수 없어서(Dropdown과 같은 이유)
 * 직접 만든다. 추가로 이 목록만의 두 가지 동작이 더 있다: 각 항목을 우클릭하면
 * 그 폰트를 목록에서 지우고(기본 제공 폰트는 숨김 처리, 커스텀 업로드 폰트는 실제
 * 삭제 — useFontStore 참고. 마지막 하나는 드롭다운이 완전히 비는 것을 막기 위해
 * 삭제할 수 없다), 목록 맨 아래 "폰트 파일 추가" 항목이 파일 선택 창을 연다 — 예전엔
 * 이 두 기능이 select 옆의 별도 +버튼과 "..." 관리 팝오버(FontManagerPopover)로
 * 따로 떨어져 있었다.
 */
function FontDropdown({ currentFamily, onPick }: { currentFamily: string; onPick: (family: string) => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const customFonts = useFontStore((s) => s.customFonts);
  const registerFontFile = useFontStore((s) => s.registerFontFile);
  const removeCustomFont = useFontStore((s) => s.removeCustomFont);
  const removeBuiltinFont = useFontStore((s) => s.removeBuiltinFont);
  const visibleBuiltins = useVisibleBuiltinFonts();
  const totalCount = visibleBuiltins.length + customFonts.length;
  const isLastOne = totalCount <= 1;

  const currentLabel =
    visibleBuiltins.find((f) => f.family === currentFamily)?.label ??
    customFonts.find((f) => f.family === currentFamily)?.label ??
    currentFamily;

  const computePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(rect.width, DROPDOWN_WIDTH_MIN);
    let left = rect.left;
    let top = rect.bottom + 4;
    if (left + width + DROPDOWN_VIEWPORT_MARGIN > window.innerWidth) {
      left = Math.max(DROPDOWN_VIEWPORT_MARGIN, window.innerWidth - width - DROPDOWN_VIEWPORT_MARGIN);
    }
    if (top + DROPDOWN_HEIGHT_ESTIMATE + DROPDOWN_VIEWPORT_MARGIN > window.innerHeight) {
      top = Math.max(DROPDOWN_VIEWPORT_MARGIN, rect.top - DROPDOWN_HEIGHT_ESTIMATE - 4);
    }
    setPos({ top, left, width });
  };

  useEffect(() => {
    if (!open) return;
    computePosition();
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
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

  const handleFontFileChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void registerFontFile(file)
      .then((font) => onPick(font.family))
      .catch(() => {
        // 폰트 파일이 깨졌거나 브라우저가 파싱하지 못하는 형식 — 조용히 무시(선택 유지).
      });
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="properties-select properties-dropdown-trigger"
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ fontFamily: currentFamily }}>{currentLabel}</span>
        <ChevronDownIcon />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={listRef}
            className="properties-dropdown-list"
            style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.width }}
          >
            {visibleBuiltins.map((f) => (
              <button
                key={f.id}
                type="button"
                style={{ fontFamily: f.family }}
                className={f.family === currentFamily ? 'properties-dropdown-item is-active' : 'properties-dropdown-item'}
                title={isLastOne ? undefined : `${f.label} (우클릭: 목록에서 삭제)`}
                onClick={() => {
                  onPick(f.family);
                  setOpen(false);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (isLastOne) return;
                  removeBuiltinFont(f.id);
                }}
              >
                {f.label}
              </button>
            ))}
            {customFonts.map((f) => (
              <button
                key={f.id}
                type="button"
                style={{ fontFamily: f.family }}
                className={f.family === currentFamily ? 'properties-dropdown-item is-active' : 'properties-dropdown-item'}
                title={isLastOne ? undefined : `${f.label} (우클릭: 목록에서 삭제)`}
                onClick={() => {
                  onPick(f.family);
                  setOpen(false);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (isLastOne) return;
                  removeCustomFont(f.id);
                }}
              >
                {f.label}
              </button>
            ))}
            <button
              type="button"
              className="properties-dropdown-add-item"
              onClick={() => fileInputRef.current?.click()}
            >
              <PlusIcon size={11} />
              폰트 추가
            </button>
          </div>,
          document.body,
        )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".ttf,.otf,.woff,.woff2"
        style={{ display: 'none' }}
        onChange={handleFontFileChange}
      />
    </>
  );
}

function decimalsOf(step: number): number {
  const s = String(step);
  const i = s.indexOf('.');
  return i === -1 ? 0 : s.length - i - 1;
}

/**
 * 숫자를 직접 입력하거나 −/+ 버튼으로 한 단위씩 조절하는 공용 입력창(줄 간격 등).
 * 입력창에는 타이핑 도중 값을 그대로 보여주고(예: "1." 같은 중간 상태), blur/Enter
 * 시점에만 min/max로 clamp해 onChange를 호출한다 — 매 keystroke마다 clamp하면 "1"을
 * 지우고 다시 쓰려는 도중에도 값이 튀어 타이핑이 불편해진다.
 */
function NumberStepper({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const decimals = decimalsOf(step);
  const factor = 10 ** decimals;
  const format = (v: number) => v.toFixed(decimals);
  const [text, setText] = useState(format(value));

  useEffect(() => {
    setText(format(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = (raw: number) => {
    const clamped = Math.min(max, Math.max(min, Math.round(raw * factor) / factor));
    onChange(clamped);
    setText(format(clamped));
  };

  return (
    <div className="properties-number-stepper">
      <button
        type="button"
        className="properties-stepper-btn"
        onClick={() => commit(value - step)}
        disabled={value <= min}
        aria-label="줄이기"
        title="줄이기"
      >
        −
      </button>
      <input
        type="number"
        inputMode="decimal"
        className="properties-stepper-input"
        value={text}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const parsed = Number(text);
          commit(Number.isFinite(parsed) ? parsed : value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      <button
        type="button"
        className="properties-stepper-btn"
        onClick={() => commit(value + step)}
        disabled={value >= max}
        aria-label="늘리기"
        title="늘리기"
      >
        +
      </button>
    </div>
  );
}

/**
 * 프리셋 색상 스와치 공통 UI. 클릭하면 적용, 우클릭하면 그 프리셋을 카테고리별
 * 목록에서 숨긴다(usePresetColorVisibilityStore — 기본 제공 색상도 삭제할 수
 * 있어야 한다는 요구사항). id와 실제 CSS 색을 어떻게 연결할지, 클릭/활성 판정을
 * 어떻게 할지는 호출부마다 다르므로(하이라이트/주석은 id 자체를 저장하고, 텍스트/
 * 도형은 실제 hex를 저장) 콜백으로 위임한다.
 */
function PresetSwatchRow<T extends string>({
  ids,
  labelOf,
  swatchOf,
  isActive,
  onPick,
  onHide,
}: {
  ids: T[];
  labelOf: (id: T) => string;
  swatchOf: (id: T) => string;
  isActive: (id: T) => boolean;
  onPick: (id: T) => void;
  onHide: (id: T) => void;
}) {
  return (
    <>
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          title={`${labelOf(id)} (우클릭: 목록에서 삭제)`}
          onClick={() => onPick(id)}
          onContextMenu={(e) => {
            e.preventDefault();
            onHide(id);
          }}
          className={isActive(id) ? 'properties-round-swatch is-active' : 'properties-round-swatch'}
          style={{ background: swatchOf(id) }}
        />
      ))}
    </>
  );
}

/** BUILTIN_FONT_OPTIONS에서 사용자가 목록 관리 팝오버로 숨긴(요구사항 3번) 항목을 뺀다. */
function useVisibleBuiltinFonts() {
  const hiddenBuiltinIds = useFontStore((s) => s.hiddenBuiltinIds);
  return BUILTIN_FONT_OPTIONS.filter((f) => !hiddenBuiltinIds.includes(f.id));
}

/**
 * toolStore의 "다음에 만들 것"용 기본 글꼴(textFontFamily/annotationFontFamily)이
 * 실제로 드롭다운에 보이는 옵션과 항상 일치하도록 맞춘다.
 *
 * 이 값들은 새로고침할 때마다 DEFAULT_FONT_FAMILY로 초기화되는데(세션 간 영속화
 * 대상이 아님), 사용자가 기본 제공 폰트를 전부 삭제해버리면 그 값과 일치하는
 * <option>이 하나도 안 남는다 — 그러면 <select value={currentFamily}>가 "화면엔
 * 목록의 첫 옵션이 보이지만 실제 상태는 그와 다른 값"으로 어긋난 채 렌더링된다.
 * 이 상태에서 바로 타이핑하면 화면에 보이는 폰트가 아니라 그 어긋난 실제 값이
 * 적용되고, 심지어 화면에 이미 보이는 값을 한 번 더 클릭해도(네이티브 select
 * 입장에선 "이미 선택돼 있던 값 그대로"라 change 이벤트 자체가 안 나서) 고쳐지지
 * 않는다 — 다른 폰트로 한 번 바꿨다가 되돌려야만 실제로 반영되는 버그로 나타났다.
 * 그래서 현재 값이 보이는 목록에 없으면 목록의 첫 항목으로 상태 자체를 맞춰서
 * "화면에 보이는 값 = 다음에 실제로 적용될 값"을 항상 보장한다.
 */
function useSyncDefaultFontFamily(currentFamily: string, setFamily: (family: string) => void) {
  const hiddenBuiltinIds = useFontStore((s) => s.hiddenBuiltinIds);
  const customFonts = useFontStore((s) => s.customFonts);
  useEffect(() => {
    const visibleBuiltinFamilies = BUILTIN_FONT_OPTIONS.filter((f) => !hiddenBuiltinIds.includes(f.id)).map(
      (f) => f.family,
    );
    const available = [...visibleBuiltinFamilies, ...customFonts.map((f) => f.family)];
    if (available.length > 0 && !available.includes(currentFamily)) {
      setFamily(available[0]);
    }
  }, [currentFamily, hiddenBuiltinIds, customFonts, setFamily]);
}

function FontPickerRow({
  currentFamily,
  onPick,
}: {
  currentFamily: string;
  onPick: (family: string) => void;
}) {
  return (
    <Row label="글꼴">
      <FontDropdown currentFamily={currentFamily} onPick={onPick} />
    </Row>
  );
}

function TextSection({
  object,
  update,
}: {
  object: TextObject;
  update: (patch: Partial<TextObject> & Record<string, unknown>, coalesceKey?: string) => void;
}) {
  // Phase 8(부분 서식): 편집 중 드래그로 선택한 구간이 있으면(useTextRangeSelection이
  // 채워준다) 아래 컨트롤들은 객체 전체가 아니라 그 구간에만 적용된다. store에서는
  // 참조가 안정적인 원본 배열만 구독하고(getOrderedObjects와 같은 이유로, 셀렉터
  // 안에서 매번 새 배열을 만들면 안 된다), 이 objectId에 해당하는 것만 컴포넌트
  // 본문에서 걸러낸다.
  //
  // 요구사항(Ctrl+드래그로 비연속 다중 구간 선택): liveSegments(지금 드래그 중/방금
  // 끝난 네이티브 선택)와 committedSegments(Ctrl+드래그로 이전에 커밋해둔 구간들)를
  // 합쳐서 "지금 스타일을 적용할 전체 구간"으로 쓴다.
  const liveSegments = useTextRangeStore((s) => s.liveSegments);
  const committedSegments = useTextRangeStore((s) => s.committedSegments);
  const rangeSegments = [...committedSegments, ...liveSegments].filter((seg) => seg.objectId === object.id);
  const hasRange = rangeSegments.length > 0;
  // 여러 줄에 걸친 구간이어도 "현재 값" 표시는 첫 세그먼트의 대표 스타일 하나로
  // 단순화한다(대부분의 리치 텍스트 에디터도 같은 방식을 쓴다 — runStyle.ts 참고).
  const rangeStyle = hasRange
    ? representativeRunStyle(
        object.lines.find((l) => l.id === rangeSegments[0].lineId)?.runs ?? [],
        rangeSegments[0].start,
        rangeSegments[0].end,
      )
    : null;

  const applyToRangeOrObject = <K extends 'fontFamily' | 'fontSize' | 'color' | 'bold'>(
    field: K,
    value: K extends 'fontSize' ? number : K extends 'bold' ? boolean : string,
  ) => {
    if (hasRange) {
      // 요구사항(Ctrl+드래그로 비연속 다중 구간 선택): 한 줄 안에 구간이 여러 개일
      // 수 있으므로(예: 같은 줄의 "apple"과 "cherry"를 각각 Ctrl+드래그로 커밋)
      // find로 하나만 집지 않고 그 줄에 속한 구간을 전부 순서대로 적용한다.
      const nextLines = object.lines.map((line) => {
        const segsForLine = rangeSegments.filter((s) => s.lineId === line.id);
        if (segsForLine.length === 0) return line;
        let runs = line.runs;
        for (const seg of segsForLine) {
          runs = applyRunStyle(runs, seg.start, seg.end, { [field]: value });
        }
        return { ...line, runs };
      });
      useObjectsStore.getState().setTextLines(object.id, nextLines);
      return;
    }
    if (field === 'fontFamily') update({ fontFamily: value as string });
    else if (field === 'fontSize') update({ baseFontSize: value as number });
    else if (field === 'color') update({ color: value as string }, `style-color:${object.id}`);
    else update({ bold: value as boolean });
  };

  const currentFamily = (hasRange ? rangeStyle?.fontFamily : object.fontFamily) || DEFAULT_FONT_FAMILY;
  const currentSize = (hasRange ? rangeStyle?.fontSize : undefined) ?? object.baseFontSize;
  const currentColor = (hasRange ? rangeStyle?.color : undefined) ?? object.color;
  const currentBold = hasRange ? !!rangeStyle?.bold : !!object.bold;
  const sizeOptions = FONT_SIZE_PRESETS.includes(currentSize)
    ? FONT_SIZE_PRESETS
    : [...FONT_SIZE_PRESETS, currentSize].sort((a, b) => a - b);

  const hiddenTextIds = usePresetColorVisibilityStore((s) => s.hiddenByCategory.text);
  const hidePreset = usePresetColorVisibilityStore((s) => s.hidePreset);
  const visibleTextIds = TEXT_COLOR_IDS.filter((id) => !hiddenTextIds.includes(id));

  return (
    <>
      {hasRange && (
        <p className="properties-range-hint">선택한 구간에만 적용됩니다</p>
      )}
      <FontPickerRow currentFamily={currentFamily} onPick={(family) => applyToRangeOrObject('fontFamily', family)} />
      <Row label="줄 간격">
        {/* 요구사항(줄 간격 조절): 부분 서식(hasRange) 대상이 아니라 텍스트 상자 전체의
            속성이므로(TextRun이 아니라 TextObject에 저장됨) 테두리 옵션과 같은 방식으로
            applyToRangeOrObject가 아니라 update를 직접 쓴다. */}
        <NumberStepper
          value={clampLineHeight(object.lineHeight ?? LINE_HEIGHT_DEFAULT)}
          min={LINE_HEIGHT_MIN}
          max={LINE_HEIGHT_MAX}
          step={LINE_HEIGHT_STEP}
          onChange={(next) => update({ lineHeight: next }, `line-height:${object.id}`)}
        />
      </Row>
      <Row label="크기">
        <Dropdown
          value={currentSize}
          options={sizeOptions}
          labelOf={(s) => `${s}px`}
          onChange={(s) => applyToRangeOrObject('fontSize', s)}
        />
      </Row>
      <Row label="텍스트 색상">
        <ColorPickerPopover
          label="텍스트 색상"
          value={currentColor}
          onChange={(color) => applyToRangeOrObject('color', color)}
          category="text"
        />
      </Row>
      <Row label="굵기">
        <Tile active={currentBold} onClick={() => applyToRangeOrObject('bold', !currentBold)} title="굵게">
          <BoldIcon />
        </Tile>
      </Row>
      <Row label="테두리">
        {/* 요구사항(텍스트 상자 테두리 옵션): 부분 서식(hasRange) 대상이 아니라 상자
            전체의 속성이므로 applyToRangeOrObject가 아니라 update를 직접 쓴다. */}
        <Tile
          active={object.borderEnabled !== false}
          onClick={() => update({ borderEnabled: object.borderEnabled === false })}
          title={object.borderEnabled === false ? '테두리 표시' : '테두리 숨기기'}
        >
          <BorderToggleIcon enabled={object.borderEnabled !== false} />
        </Tile>
      </Row>
      <FrequentColorsRow>
        {/* 요구사항(자주 사용하는 색상 위치 통합): 프리셋 5색 + 사용자가 ColorPickerPopover의
            "추가" 버튼으로 저장해둔 자유 색상을 여기 한 줄에 모아 보여준다 — "색상" 행은
            이제 현재 색을 보여주는 피커 트리거 하나만 남긴다. */}
        <PresetSwatchRow
          ids={visibleTextIds}
          labelOf={(id) => TEXT_COLORS[id].label}
          swatchOf={(id) => TEXT_COLORS[id].value}
          isActive={(id) => currentColor === TEXT_COLORS[id].value}
          onPick={(id) => applyToRangeOrObject('color', TEXT_COLORS[id].value)}
          onHide={(id) => hidePreset('text', id)}
        />
        <RecentColorSwatches
          category="text"
          onPick={(color) => applyToRangeOrObject('color', color)}
          activeColor={currentColor}
          swatchClassName="properties-round-swatch"
        />
      </FrequentColorsRow>
    </>
  );
}

/** 선택된 Text가 없어도(상단 툴바 '텍스트' 버튼만 눌렀을 때) 다음에 새로 만들
 * Text의 기본 색상/글꼴을 미리 정해둔다 — toolStore.textColor/textFontFamily를
 * 직접 읽고 쓴다(canvas/actions.ts:spawnTextAt이 이 값을 그대로 쓴다). 선택된
 * 텍스트를 열 때(TextSection)와 동일한 제목/구성을 쓰고, 별도 안내문은 두지
 * 않는다(요구사항: '새로 만들 텍스트의 기본값' 영역 제거, 기존 텍스트 사이드바가
 * 바로 열려야 함).
 *
 * 요구사항(텍스트 상자 생성 경로 통합, 2차): 화살표/사각형과 완전히 동일하게, Text도
 * 이 도구가 활성화된 동안 캔버스를 드래그해야만 만들어진다(canvas/interaction/
 * useDrawTextTool.ts) — 그래서 화살표/사각형 기본값 패널(ArrowDefaultsSection/
 * RectangleDefaultsSection)과 마찬가지로 여기엔 생성 버튼이 없다. 여기서 미리
 * 골라둔 글꼴/크기/색상/굵기는 드래그로 만들어질 다음 Text에 그대로 적용된다. */
function TextDefaultsSection() {
  const textColor = useToolStore((s) => s.textColor);
  const textFontFamily = useToolStore((s) => s.textFontFamily);
  const textFontSize = useToolStore((s) => s.textFontSize);
  const textBold = useToolStore((s) => s.textBold);
  const textBorderEnabled = useToolStore((s) => s.textBorderEnabled);
  const textLineHeight = useToolStore((s) => s.textLineHeight);
  const setTextColor = useToolStore((s) => s.setTextColor);
  const setTextFontFamily = useToolStore((s) => s.setTextFontFamily);
  const setTextFontSize = useToolStore((s) => s.setTextFontSize);
  const setTextBold = useToolStore((s) => s.setTextBold);
  const setTextBorderEnabled = useToolStore((s) => s.setTextBorderEnabled);
  const setTextLineHeight = useToolStore((s) => s.setTextLineHeight);
  const hiddenTextIds = usePresetColorVisibilityStore((s) => s.hiddenByCategory.text);
  const hidePreset = usePresetColorVisibilityStore((s) => s.hidePreset);
  const visibleTextIds = TEXT_COLOR_IDS.filter((id) => !hiddenTextIds.includes(id));
  const sizeOptions = FONT_SIZE_PRESETS.includes(textFontSize)
    ? FONT_SIZE_PRESETS
    : [...FONT_SIZE_PRESETS, textFontSize].sort((a, b) => a - b);
  useSyncDefaultFontFamily(textFontFamily, setTextFontFamily);

  return (
    <>
      <FontPickerRow currentFamily={textFontFamily || DEFAULT_FONT_FAMILY} onPick={setTextFontFamily} />
      <Row label="줄 간격">
        {/* 요구사항(텍스트 상자 생성 전 줄 간격): TextSection과 동일한 컨트롤을
            toolStore.textLineHeight에 직접 연결한다 — 아직 만들어진 객체가 없으므로
            여기서는 toolStore가 원본이다(ArrowDefaultsSection과 같은 원리). */}
        <NumberStepper
          value={clampLineHeight(textLineHeight)}
          min={LINE_HEIGHT_MIN}
          max={LINE_HEIGHT_MAX}
          step={LINE_HEIGHT_STEP}
          onChange={setTextLineHeight}
        />
      </Row>
      <Row label="크기">
        <Dropdown value={textFontSize} options={sizeOptions} labelOf={(s) => `${s}px`} onChange={setTextFontSize} />
      </Row>
      <Row label="텍스트 색상">
        <ColorPickerPopover label="텍스트 색상" value={textColor} onChange={setTextColor} category="text" />
      </Row>
      <Row label="굵기">
        <Tile active={textBold} onClick={() => setTextBold(!textBold)} title="굵게">
          <BoldIcon />
        </Tile>
      </Row>
      <Row label="테두리">
        <Tile
          active={textBorderEnabled}
          onClick={() => setTextBorderEnabled(!textBorderEnabled)}
          title={textBorderEnabled ? '테두리 숨기기' : '테두리 표시'}
        >
          <BorderToggleIcon enabled={textBorderEnabled} />
        </Tile>
      </Row>
      <FrequentColorsRow>
        <PresetSwatchRow
          ids={visibleTextIds}
          labelOf={(id) => TEXT_COLORS[id].label}
          swatchOf={(id) => TEXT_COLORS[id].value}
          isActive={(id) => textColor === TEXT_COLORS[id].value}
          onPick={(id) => setTextColor(TEXT_COLORS[id].value)}
          onHide={(id) => hidePreset('text', id)}
        />
        <RecentColorSwatches
          category="text"
          onPick={setTextColor}
          activeColor={textColor}
          swatchClassName="properties-round-swatch"
        />
      </FrequentColorsRow>
      <SaveTextDefaultsRow
        preset={{
          color: textColor,
          fontFamily: textFontFamily,
          fontSize: textFontSize,
          bold: textBold,
          borderEnabled: textBorderEnabled,
          lineHeight: clampLineHeight(textLineHeight),
        }}
      />
    </>
  );
}

/**
 * 요구사항(텍스트 기본값 저장): 지금 사이드바에 설정된 값을 '제목'/'본문' 프리셋으로
 * 수동 저장한다(자동 저장 아님 — 버튼을 눌러야만 textDefaultPresetsStore에 기록됨).
 * 저장된 프리셋은 상단 툴바 '텍스트' 버튼에 마우스를 올렸을 때 뜨는 메뉴에서 바로
 * 적용할 수 있다(canvas/Toolbar.tsx).
 */
function SaveTextDefaultsRow({ preset }: { preset: TextDefaultPreset }) {
  const savePreset = useTextDefaultPresetsStore((s) => s.savePreset);
  const [savedKind, setSavedKind] = useState<TextPresetKind | null>(null);

  const handleSave = (kind: TextPresetKind) => {
    savePreset(kind, preset);
    setSavedKind(kind);
    window.setTimeout(() => setSavedKind((current) => (current === kind ? null : current)), 1200);
  };

  return (
    <div className="properties-save-preset-row">
      <button type="button" className="properties-save-preset-btn" onClick={() => handleSave('title')}>
        {savedKind === 'title' ? '저장됨' : '제목값으로 저장'}
      </button>
      <button type="button" className="properties-save-preset-btn" onClick={() => handleSave('body')}>
        {savedKind === 'body' ? '저장됨' : '본문값으로 저장'}
      </button>
    </div>
  );
}

function ArrowSection({
  object,
  update,
}: {
  object: ArrowObject;
  update: (patch: Partial<ArrowObject> & Record<string, unknown>, coalesceKey?: string) => void;
}) {
  const arrowHead = object.arrowHead ?? 'triangle';
  const lineStyle = object.lineStyle ?? 'solid';
  const hiddenShapeIds = usePresetColorVisibilityStore((s) => s.hiddenByCategory.shape);
  const hidePreset = usePresetColorVisibilityStore((s) => s.hidePreset);
  const visibleStrokeIds = STROKE_COLOR_IDS.filter((id) => !hiddenShapeIds.includes(id));

  return (
    <>
      <Row label="화살촉">
        <TileGroup>
          <Tile active={arrowHead === 'none'} onClick={() => update({ arrowHead: 'none' })} title="없음">
            <ArrowHeadIcon style="none" />
          </Tile>
          <Tile active={arrowHead === 'open'} onClick={() => update({ arrowHead: 'open' })} title="기존 화살표 모양">
            <ArrowHeadIcon style="open" />
          </Tile>
          <Tile active={arrowHead === 'triangle'} onClick={() => update({ arrowHead: 'triangle' })} title="속 채운 삼각형">
            <ArrowHeadIcon style="triangle" />
          </Tile>
        </TileGroup>
      </Row>
      <LineStyleRow value={lineStyle} onChange={(v) => update({ lineStyle: v })} />
      <StrokeWidthRow value={object.strokeWidth} onChange={(strokeWidth) => update({ strokeWidth })} />
      <Row label="색상">
        <ColorPickerPopover
          label="선 색상"
          value={object.strokeColor}
          onChange={(strokeColor) => update({ strokeColor }, `style-color:${object.id}`)}
          category="shape"
        />
      </Row>
      <FrequentColorsRow>
        <PresetSwatchRow
          ids={visibleStrokeIds}
          labelOf={(id) => STROKE_COLORS[id].label}
          swatchOf={(id) => STROKE_COLORS[id].value}
          isActive={(id) => object.strokeColor === STROKE_COLORS[id].value}
          onPick={(id) => update({ strokeColor: STROKE_COLORS[id].value }, `style-color:${object.id}`)}
          onHide={(id) => hidePreset('shape', id)}
        />
        <RecentColorSwatches
          category="shape"
          onPick={(strokeColor) => update({ strokeColor }, `style-color:${object.id}`)}
          activeColor={object.strokeColor}
          swatchClassName="properties-round-swatch"
        />
      </FrequentColorsRow>
    </>
  );
}

function RectangleSection({
  object,
  update,
}: {
  object: ShapeObject;
  update: (patch: Partial<ShapeObject> & Record<string, unknown>, coalesceKey?: string) => void;
}) {
  const rounded = object.rounded ?? false;
  const lineStyle = object.lineStyle ?? 'solid';
  const fillEnabled = object.fillEnabled ?? false;
  const fillOpacity = object.fillOpacity ?? 0.3;
  const hiddenShapeIds = usePresetColorVisibilityStore((s) => s.hiddenByCategory.shape);
  const hidePreset = usePresetColorVisibilityStore((s) => s.hidePreset);
  const visibleStrokeIds = STROKE_COLOR_IDS.filter((id) => !hiddenShapeIds.includes(id));

  return (
    <>
      <LineStyleRow value={lineStyle} onChange={(v) => update({ lineStyle: v })} />
      <StrokeWidthRow value={object.strokeWidth} onChange={(strokeWidth) => update({ strokeWidth })} />
      <Row label="모서리">
        <TileGroup>
          <Tile active={!rounded} onClick={() => update({ rounded: false })} title="뾰족">
            <CornerIcon rounded={false} />
          </Tile>
          <Tile active={rounded} onClick={() => update({ rounded: true })} title="둥근 모서리">
            <CornerIcon rounded={true} />
          </Tile>
        </TileGroup>
      </Row>
      <Row label="채우기">
        <TileGroup>
          <Tile active={!fillEnabled} onClick={() => update({ fillEnabled: false })} title="투명">
            <FillIcon filled={false} />
          </Tile>
          <Tile active={fillEnabled} onClick={() => update({ fillEnabled: true })} title="테두리 색상 채우기">
            <FillIcon filled={true} />
          </Tile>
        </TileGroup>
      </Row>
      {fillEnabled && (
        <Row label="투명도">
          <input
            type="range"
            className="properties-range"
            min={0.05}
            max={1}
            step={0.05}
            value={fillOpacity}
            onChange={(e) => update({ fillOpacity: Number(e.target.value) }, `style-opacity:${object.id}`)}
          />
          <span className="properties-range-value">{Math.round(fillOpacity * 100)}%</span>
        </Row>
      )}
      <Row label="테두리 색상">
        <ColorPickerPopover
          label="테두리 색상"
          value={object.strokeColor}
          onChange={(strokeColor) => update({ strokeColor }, `style-color:${object.id}`)}
          category="shape"
        />
      </Row>
      <FrequentColorsRow>
        <PresetSwatchRow
          ids={visibleStrokeIds}
          labelOf={(id) => STROKE_COLORS[id].label}
          swatchOf={(id) => STROKE_COLORS[id].value}
          isActive={(id) => object.strokeColor === STROKE_COLORS[id].value}
          onPick={(id) => update({ strokeColor: STROKE_COLORS[id].value }, `style-color:${object.id}`)}
          onHide={(id) => hidePreset('shape', id)}
        />
        <RecentColorSwatches
          category="shape"
          onPick={(strokeColor) => update({ strokeColor }, `style-color:${object.id}`)}
          activeColor={object.strokeColor}
          swatchClassName="properties-round-swatch"
        />
      </FrequentColorsRow>
    </>
  );
}

/** 선택된 Arrow가 없어도(상단 툴바 '화살표' 버튼만 눌렀을 때) 다음에 그릴 화살표의
 * 기본값을 미리 정해둔다 — toolStore.shapeArrowHead/shapeLineStyle/shapeStrokeColor/
 * shapeStrokeWidth를 직접 읽고 쓴다(canvas/actions.ts:spawnShapeFromDraft가 이 값을
 * 그대로 쓴다). ArrowSection과 달리 아직 만들어진 객체가 없으므로 toolStore가 원본이다. */
function ArrowDefaultsSection() {
  const arrowHead = useToolStore((s) => s.shapeArrowHead);
  const lineStyle = useToolStore((s) => s.shapeLineStyle);
  const strokeColor = useToolStore((s) => s.shapeStrokeColor);
  const strokeWidth = useToolStore((s) => s.shapeStrokeWidth);
  const setShapeArrowHead = useToolStore((s) => s.setShapeArrowHead);
  const setShapeLineStyle = useToolStore((s) => s.setShapeLineStyle);
  const setShapeStrokeColor = useToolStore((s) => s.setShapeStrokeColor);
  const setShapeStrokeWidth = useToolStore((s) => s.setShapeStrokeWidth);
  const hiddenShapeIds = usePresetColorVisibilityStore((s) => s.hiddenByCategory.shape);
  const hidePreset = usePresetColorVisibilityStore((s) => s.hidePreset);
  const visibleStrokeIds = STROKE_COLOR_IDS.filter((id) => !hiddenShapeIds.includes(id));

  return (
    <>
      <Row label="화살촉">
        <TileGroup>
          <Tile active={arrowHead === 'none'} onClick={() => setShapeArrowHead('none')} title="없음">
            <ArrowHeadIcon style="none" />
          </Tile>
          <Tile active={arrowHead === 'open'} onClick={() => setShapeArrowHead('open')} title="기존 화살표 모양">
            <ArrowHeadIcon style="open" />
          </Tile>
          <Tile active={arrowHead === 'triangle'} onClick={() => setShapeArrowHead('triangle')} title="속 채운 삼각형">
            <ArrowHeadIcon style="triangle" />
          </Tile>
        </TileGroup>
      </Row>
      <LineStyleRow value={lineStyle} onChange={setShapeLineStyle} />
      <StrokeWidthRow value={strokeWidth} onChange={setShapeStrokeWidth} />
      <Row label="색상">
        {/* toolStore.shapeStrokeColor는 프리셋 id('black' 등) 또는 자유 hex를 그대로
            들고 있다가 spawn 시점에 strokeColorValueFor로 해석된다(DrawPreview.tsx도
            동일) — 이미 만들어진 객체(ArrowSection)와 달리 여기서는 id 자체로
            비교/저장한다. */}
        <ColorPickerPopover label="선 색상" value={strokeColorValueFor(strokeColor)} onChange={setShapeStrokeColor} category="shape" />
      </Row>
      <FrequentColorsRow>
        <PresetSwatchRow
          ids={visibleStrokeIds}
          labelOf={(id) => STROKE_COLORS[id].label}
          swatchOf={(id) => STROKE_COLORS[id].value}
          isActive={(id) => strokeColor === id}
          onPick={(id) => setShapeStrokeColor(id)}
          onHide={(id) => hidePreset('shape', id)}
        />
        <RecentColorSwatches
          category="shape"
          onPick={setShapeStrokeColor}
          activeColor={strokeColorValueFor(strokeColor)}
          swatchClassName="properties-round-swatch"
        />
      </FrequentColorsRow>
    </>
  );
}

/** ArrowDefaultsSection과 대칭되는 사각형용 기본값 패널. */
function RectangleDefaultsSection() {
  const rounded = useToolStore((s) => s.shapeRounded);
  const lineStyle = useToolStore((s) => s.shapeLineStyle);
  const strokeColor = useToolStore((s) => s.shapeStrokeColor);
  const strokeWidth = useToolStore((s) => s.shapeStrokeWidth);
  const fillEnabled = useToolStore((s) => s.shapeFillEnabled);
  const fillOpacity = useToolStore((s) => s.shapeFillOpacity);
  const setShapeRounded = useToolStore((s) => s.setShapeRounded);
  const setShapeLineStyle = useToolStore((s) => s.setShapeLineStyle);
  const setShapeStrokeColor = useToolStore((s) => s.setShapeStrokeColor);
  const setShapeStrokeWidth = useToolStore((s) => s.setShapeStrokeWidth);
  const setShapeFillEnabled = useToolStore((s) => s.setShapeFillEnabled);
  const setShapeFillOpacity = useToolStore((s) => s.setShapeFillOpacity);
  const hiddenShapeIds = usePresetColorVisibilityStore((s) => s.hiddenByCategory.shape);
  const hidePreset = usePresetColorVisibilityStore((s) => s.hidePreset);
  const visibleStrokeIds = STROKE_COLOR_IDS.filter((id) => !hiddenShapeIds.includes(id));

  return (
    <>
      <LineStyleRow value={lineStyle} onChange={setShapeLineStyle} />
      <StrokeWidthRow value={strokeWidth} onChange={setShapeStrokeWidth} />
      <Row label="모서리">
        <TileGroup>
          <Tile active={!rounded} onClick={() => setShapeRounded(false)} title="뾰족">
            <CornerIcon rounded={false} />
          </Tile>
          <Tile active={rounded} onClick={() => setShapeRounded(true)} title="둥근 모서리">
            <CornerIcon rounded={true} />
          </Tile>
        </TileGroup>
      </Row>
      <Row label="채우기">
        <TileGroup>
          <Tile active={!fillEnabled} onClick={() => setShapeFillEnabled(false)} title="투명">
            <FillIcon filled={false} />
          </Tile>
          <Tile active={fillEnabled} onClick={() => setShapeFillEnabled(true)} title="테두리 색상 채우기">
            <FillIcon filled={true} />
          </Tile>
        </TileGroup>
      </Row>
      {fillEnabled && (
        <Row label="투명도">
          <input
            type="range"
            className="properties-range"
            min={0.05}
            max={1}
            step={0.05}
            value={fillOpacity}
            onChange={(e) => setShapeFillOpacity(Number(e.target.value))}
          />
          <span className="properties-range-value">{Math.round(fillOpacity * 100)}%</span>
        </Row>
      )}
      <Row label="테두리 색상">
        <ColorPickerPopover label="테두리 색상" value={strokeColorValueFor(strokeColor)} onChange={setShapeStrokeColor} category="shape" />
      </Row>
      <FrequentColorsRow>
        <PresetSwatchRow
          ids={visibleStrokeIds}
          labelOf={(id) => STROKE_COLORS[id].label}
          swatchOf={(id) => STROKE_COLORS[id].value}
          isActive={(id) => strokeColor === id}
          onPick={(id) => setShapeStrokeColor(id)}
          onHide={(id) => hidePreset('shape', id)}
        />
        <RecentColorSwatches
          category="shape"
          onPick={setShapeStrokeColor}
          activeColor={strokeColorValueFor(strokeColor)}
          swatchClassName="properties-round-swatch"
        />
      </FrequentColorsRow>
    </>
  );
}

/** FRAME_SIZE_PRESETS 중 하나를 고르는 가변폭 텍스트 버튼 행. FrameSection(선택된
 * Frame)과 FrameDefaultsSection(다음에 만들 Frame) 둘 다에서 공유한다 — 현재 폭/높이가
 * 어느 프리셋과 정확히 일치하는지(activeId)는 호출부가 계산해서 넘긴다(직접 입력이나
 * 방향 전환으로 프리셋 값에서 벗어나면 자연스럽게 아무 것도 활성화되지 않는다). */
function FrameSizePresetRow({
  activeId,
  onPick,
}: {
  activeId?: string;
  onPick: (preset: FrameSizePreset) => void;
}) {
  return (
    <div className="properties-recent-row">
      <span className="properties-recent-label">크기 프리셋</span>
      <div className="properties-recent-swatches">
        {FRAME_SIZE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={activeId === preset.id ? 'properties-preset-btn is-active' : 'properties-preset-btn'}
            onClick={() => onPick(preset)}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** "A4 절반" 접선 미리보기 전용 선 색상. 실제 프레임(FrameObjectView.tsx)은
 * 테두리와 같은 def.borderColor를 접선에도 그대로 쓰지만, 다크 테마의
 * borderColor(#3a3d44)는 배경(#1f2126)과 거의 같은 톤이라 18px 미니 스와치에서는
 * 사실상 안 보인다 — 아이콘에서만 더 밝은 회색으로 대비를 높인다. */
const FOLD_LINE_PREVIEW_COLOR: Record<FrameTheme, string> = {
  plain: '#c2c2c2',
  dark: '#7a7a7a',
};

/** FRAME_THEMES 배경을 타일 안에 축소해서 보여주는 미리보기 스와치. showFold이면
 * 실제 프레임과 같은 비율(높이의 90%, 위아래 5%씩 여백)로 접선도 함께 그려준다 —
 * 요구사항(어두운 프레임에서도 A4 절반을 쓸 수 있도록): 배경 테마와 접선 표시 여부가
 * 이제 독립된 두 축이라, 이 스와치도 둘을 각각 인자로 받는다(어떤 조합이든 미리보기
 * 가능). */
function FrameStylePreview({ themeId, showFold }: { themeId: FrameTheme; showFold: boolean }) {
  const def = FRAME_THEMES[themeId];
  return (
    <div
      style={{
        position: 'relative',
        width: 18,
        height: 18,
        borderRadius: 3,
        boxSizing: 'border-box',
        background: def.background,
        border: `1px solid ${def.borderColor}`,
      }}
    >
      {showFold ? (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '2.5%',
            bottom: '2.5%',
            width: 1,
            background: FOLD_LINE_PREVIEW_COLOR[themeId],
            transform: 'translateX(-50%)',
          }}
        />
      ) : null}
    </div>
  );
}

/** 배경 테마(plain/dark) 선택 — 접선 표시 여부와 완전히 독립이라 이 값만 바꿔서는
 * A4 절반 상태(centerFold)가 절대 꺼지지 않는다. 요구사항: 이 행은 "배경색"만
 * 고르는 자리이므로, 현재 접선이 켜져 있어도 미리보기에는 절대 접선을 함께
 * 보여주지 않는다(showFold를 그대로 물려받으면 흰 배경 스와치에도 줄이 섞여
 * 보여 혼동을 준다). */
function FrameThemeRow({
  active,
  onChange,
}: {
  active: FrameTheme;
  onChange: (theme: FrameTheme) => void;
}) {
  return (
    <Row label="배경">
      <TileGroup>
        {FRAME_THEME_IDS.map((id) => (
          <Tile key={id} active={active === id} onClick={() => onChange(id)} title={FRAME_THEMES[id].label}>
            <FrameStylePreview themeId={id} showFold={false} />
          </Tile>
        ))}
      </TileGroup>
    </Row>
  );
}

/** 요구사항(어두운 프레임에서도 A4 절반을 쓸 수 있도록): 정중앙 접선("A4 절반") on/off를
 * 배경 테마와 별개의 행으로 둔다 — 다크 배경을 선택한 채로도 이 토글만으로 접선을 켤 수 있다. */
function FrameFoldRow({
  theme,
  active,
  onChange,
}: {
  theme: FrameTheme;
  active: boolean;
  onChange: (showFold: boolean) => void;
}) {
  return (
    <Row label="A4 절반">
      <TileGroup>
        <Tile active={!active} onClick={() => onChange(false)} title="접선 없음">
          <FrameStylePreview themeId={theme} showFold={false} />
        </Tile>
        <Tile active={active} onClick={() => onChange(true)} title="정중앙에 접선 표시">
          <FrameStylePreview themeId={theme} showFold={true} />
        </Tile>
      </TileGroup>
    </Row>
  );
}

/** 프레임 크기 범위(world px) — 너무 작으면 다루기 어렵고, 너무 크면 캔버스를
 * 통째로 가려버리므로 다른 객체들보다 넉넉한 범위를 둔다. */
const FRAME_SIZE_MIN = 40;
const FRAME_SIZE_MAX = 4000;
const FRAME_SIZE_STEP = 10;

function FrameSection({
  object,
  update,
}: {
  object: FrameObject;
  update: (patch: Partial<FrameObject> & Record<string, unknown>, coalesceKey?: string) => void;
}) {
  const theme = resolveFrameTheme(object.style);
  const showFold = resolveFrameCenterFold(object.style, object.centerFold);
  const activePresetId = FRAME_SIZE_PRESETS.find((p) => p.width === object.width && p.height === object.height)?.id;

  return (
    <>
      <Row label="이름">
        <input
          type="text"
          className="properties-select"
          value={object.label ?? ''}
          placeholder="Frame"
          onChange={(e) => update({ label: e.target.value }, `frame-label:${object.id}`)}
        />
      </Row>
      <FrameSizePresetRow
        activeId={activePresetId}
        onPick={(preset) => update({ width: preset.width, height: preset.height }, `frame-size:${object.id}`)}
      />
      <Row label="폭">
        <NumberStepper
          value={object.width}
          min={FRAME_SIZE_MIN}
          max={FRAME_SIZE_MAX}
          step={FRAME_SIZE_STEP}
          onChange={(width) => update({ width }, `frame-size:${object.id}`)}
        />
      </Row>
      <Row label="높이">
        <NumberStepper
          value={object.height}
          min={FRAME_SIZE_MIN}
          max={FRAME_SIZE_MAX}
          step={FRAME_SIZE_STEP}
          onChange={(height) => update({ height }, `frame-size:${object.id}`)}
        />
      </Row>
      <Row label="방향">
        {/* 요구사항: A4 절반(접선 표시 중)이라 옵션이 두 개가 되면, 다른 다중 선택지
            행과 똑같이 하나의 회색 트랙(TileGroup) 안에 담는다 — 옵션이 하나뿐일
            때(showFold===false)는 굳이 트랙으로 감싸지 않고 기존처럼 단독 타일로 둔다. */}
        {showFold ? (
          <TileGroup>
            <Tile
              active={false}
              onClick={() => update({ width: object.height, height: object.width }, `frame-size:${object.id}`)}
              title="가로/세로 비율만 전환 (접선 방향 유지)"
            >
              <SwapIcon />
            </Tile>
            {/* 위 버튼(비율만 전환)과 달리 접선의 분할 방향(좌우↔상하)까지 함께
                뒤집어서, 프레임과 접선을 통째로 90도 돌린 것처럼 보이게 한다
                (FrameObject.foldAxis 주석 참고). */}
            <Tile
              active={false}
              onClick={() =>
                update(
                  {
                    width: object.height,
                    height: object.width,
                    foldAxis: (object.foldAxis ?? 'vertical') === 'vertical' ? 'horizontal' : 'vertical',
                  },
                  `frame-size:${object.id}`,
                )
              }
              title="프레임 전체 회전 (접선 방향도 함께 전환)"
            >
              <RotateIcon />
            </Tile>
          </TileGroup>
        ) : (
          <Tile
            active={false}
            onClick={() => update({ width: object.height, height: object.width }, `frame-size:${object.id}`)}
            title="가로/세로 전환"
          >
            <SwapIcon />
          </Tile>
        )}
      </Row>
      {/* 배경 테마와 A4 절반(접선) 표시는 서로 독립된 축이다(요구사항: 어두운
          프레임에서도 A4 절반을 쓸 수 있도록) — 배경만 바꿔도(예: 다크로 전환) 이미
          켜져 있던 접선이 꺼지지 않도록, 테마를 바꿀 때도 현재 showFold 값을 그대로
          함께 저장한다(구버전 style:'half' 데이터가 처음 배경을 바꾸는 순간 접선을
          잃지 않게 하는 안전장치이기도 하다). */}
      <FrameThemeRow active={theme} onChange={(next) => update({ style: next, centerFold: showFold })} />
      <FrameFoldRow theme={theme} active={showFold} onChange={(next) => update({ centerFold: next })} />
    </>
  );
}

/** 선택된 Frame이 없어도(상단 툴바 '프레임' 버튼만 눌렀을 때) 다음에 만들 Frame의
 * 기본 크기/스타일을 미리 정해둔다 — toolStore.frameWidth/frameHeight/frameStyle을
 * 직접 읽고 쓴다(Canvas.tsx의 handleBackgroundClick이 이 값을 그대로 spawnFrameAt에
 * 넘긴다). 이름(label)은 인스턴스마다 다르게 붙이는 값이라 여기엔 없다 — 항상
 * 'Frame'으로 만들어진 뒤 FrameSection에서 개별적으로 바꾼다. */
function FrameDefaultsSection() {
  const frameWidth = useToolStore((s) => s.frameWidth);
  const frameHeight = useToolStore((s) => s.frameHeight);
  const frameStyle = useToolStore((s) => s.frameStyle);
  const frameCenterFold = useToolStore((s) => s.frameCenterFold);
  const frameFoldAxis = useToolStore((s) => s.frameFoldAxis);
  const setFrameSize = useToolStore((s) => s.setFrameSize);
  const setFrameStyle = useToolStore((s) => s.setFrameStyle);
  const setFrameCenterFold = useToolStore((s) => s.setFrameCenterFold);
  const setFrameFoldAxis = useToolStore((s) => s.setFrameFoldAxis);
  const activePresetId = FRAME_SIZE_PRESETS.find((p) => p.width === frameWidth && p.height === frameHeight)?.id;

  return (
    <>
      <FrameSizePresetRow activeId={activePresetId} onPick={(preset) => setFrameSize(preset.width, preset.height)} />
      <Row label="폭">
        <NumberStepper
          value={frameWidth}
          min={FRAME_SIZE_MIN}
          max={FRAME_SIZE_MAX}
          step={FRAME_SIZE_STEP}
          onChange={(width) => setFrameSize(width, frameHeight)}
        />
      </Row>
      <Row label="높이">
        <NumberStepper
          value={frameHeight}
          min={FRAME_SIZE_MIN}
          max={FRAME_SIZE_MAX}
          step={FRAME_SIZE_STEP}
          onChange={(height) => setFrameSize(frameWidth, height)}
        />
      </Row>
      <Row label="방향">
        {frameCenterFold ? (
          <TileGroup>
            <Tile active={false} onClick={() => setFrameSize(frameHeight, frameWidth)} title="가로/세로 비율만 전환 (접선 방향 유지)">
              <SwapIcon />
            </Tile>
            <Tile
              active={false}
              onClick={() => {
                setFrameSize(frameHeight, frameWidth);
                setFrameFoldAxis(frameFoldAxis === 'vertical' ? 'horizontal' : 'vertical');
              }}
              title="프레임 전체 회전 (접선 방향도 함께 전환)"
            >
              <RotateIcon />
            </Tile>
          </TileGroup>
        ) : (
          <Tile active={false} onClick={() => setFrameSize(frameHeight, frameWidth)} title="가로/세로 전환">
            <SwapIcon />
          </Tile>
        )}
      </Row>
      <FrameThemeRow active={frameStyle} onChange={setFrameStyle} />
      <FrameFoldRow theme={frameStyle} active={frameCenterFold} onChange={setFrameCenterFold} />
    </>
  );
}

function LineStyleRow({
  value,
  onChange,
}: {
  value: 'solid' | 'dotted' | 'dashed';
  onChange: (v: 'solid' | 'dotted' | 'dashed') => void;
}) {
  return (
    <Row label="선 스타일">
      <TileGroup>
        <Tile active={value === 'solid'} onClick={() => onChange('solid')} title="실선">
          <LineStyleIcon style="solid" />
        </Tile>
        <Tile active={value === 'dotted'} onClick={() => onChange('dotted')} title="점선">
          <LineStyleIcon style="dotted" />
        </Tile>
        <Tile active={value === 'dashed'} onClick={() => onChange('dashed')} title="파선">
          <LineStyleIcon style="dashed" />
        </Tile>
      </TileGroup>
    </Row>
  );
}

function StrokeWidthRow({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <Row label="굵기">
      <TileGroup>
        {STROKE_WIDTH_PRESETS.map((w) => (
          <Tile key={w} active={value === w} onClick={() => onChange(w)} title={`${w}px`}>
            <StrokeWidthIcon width={w} />
          </Tile>
        ))}
      </TileGroup>
    </Row>
  );
}

function HighlightSection({
  color,
  onChange,
}: {
  color: string;
  onChange: (color: string) => void;
}) {
  const hiddenHighlightIds = usePresetColorVisibilityStore((s) => s.hiddenByCategory.highlight);
  const hidePreset = usePresetColorVisibilityStore((s) => s.hidePreset);
  const visibleHighlightIds = HIGHLIGHT_COLOR_IDS.filter((id) => !hiddenHighlightIds.includes(id));

  return (
    <>
      <Row label="색상">
        {/* 요구사항: 색을 고르거나 프리셋을 클릭하는 것만으로는 "자주 쓰는 색상"에
            자동 추가되지 않는다 — ColorPickerPopover 안의 명시적 "추가" 버튼만 기록한다. */}
        <ColorPickerPopover label="형광펜 색상" value={highlightSwatchFor(color)} onChange={onChange} category="highlight" />
      </Row>
      <FrequentColorsRow>
        <PresetSwatchRow
          ids={visibleHighlightIds}
          labelOf={(id) => HIGHLIGHT_COLORS[id].label}
          swatchOf={(id) => HIGHLIGHT_COLORS[id].swatch}
          isActive={(id) => color === id}
          onPick={(id) => onChange(id)}
          onHide={(id) => hidePreset('highlight', id)}
        />
        <RecentColorSwatches
          category="highlight"
          onPick={onChange}
          activeColor={highlightSwatchFor(color)}
          swatchClassName="properties-round-swatch"
        />
      </FrequentColorsRow>
    </>
  );
}

/** 형광펜 버튼만 눌렀을 때(하이라이트 선택 없음) 다음에 그을 형광펜의 기본색을
 * 미리 정해둔다. 상단 툴바의 스와치와 같은 값(toolStore.highlightColor)을
 * 공유하므로 어느 쪽에서 바꿔도 서로 즉시 반영된다. */
function HighlightDefaultsSection() {
  const highlightColor = useToolStore((s) => s.highlightColor);
  const setHighlightColor = useToolStore((s) => s.setHighlightColor);
  const eraserActive = useToolStore((s) => s.highlightEraserActive);
  const setHighlightEraserActive = useToolStore((s) => s.setHighlightEraserActive);
  // 요구사항(형광펜 굵기 조절): 이미지 위 직선 형광펜에만 쓰인다(텍스트/주석 형광펜은
  // 줄 높이를 그대로 따르는 알약 모양이라 굵기 개념이 없다) — useImageHighlightTool.ts가
  // 새 하이라이트를 커밋할 때 이 값을 읽는다.
  const highlightThickness = useToolStore((s) => s.highlightThickness);
  const setHighlightThickness = useToolStore((s) => s.setHighlightThickness);
  const thicknessOptions = HIGHLIGHT_THICKNESS_PRESETS.includes(highlightThickness)
    ? HIGHLIGHT_THICKNESS_PRESETS
    : [...HIGHLIGHT_THICKNESS_PRESETS, highlightThickness].sort((a, b) => a - b);
  return (
    <>
      {/* 요구사항(형광펜 지우개): 색상 선택과 별개로, 이 지우개가 켜져 있는 동안은
          드래그해도 색을 칠하는 대신 그 자리의 하이라이트만 지운다(텍스트는 그대로) —
          이미 만들어진 하이라이트 하나를 편집하는 HighlightSection(fineSelection)이
          아니라, "다음 드래그가 어떻게 동작할지"를 정하는 이 기본값 패널에만 둔다. */}
      <Row label="지우개">
        <Tile
          active={eraserActive}
          onClick={() => setHighlightEraserActive(!eraserActive)}
          title={eraserActive ? '지우개 끄기' : '형광펜 지우개'}
        >
          <EraserIcon active={eraserActive} />
        </Tile>
      </Row>
      {/* 요구사항(형광펜 굵기 조절): TextDefaultsSection의 "크기" 행과 완전히 같은
          디자인(Dropdown + px 라벨)을 그대로 재사용한다. */}
      <Row label="굵기">
        <Dropdown
          value={highlightThickness}
          options={thicknessOptions}
          labelOf={(s) => `${s}px`}
          onChange={setHighlightThickness}
        />
      </Row>
      <HighlightSection color={highlightColor} onChange={setHighlightColor} />
    </>
  );
}

function AnnotationSection({
  color,
  onChange,
  fontFamily,
  onFontFamilyChange,
  fontSize,
  onFontSizeChange,
}: {
  color: string;
  onChange: (color: string) => void;
  /** 요구사항(폰트 목록 통합): 주석 사이드바에도 본문 텍스트와 같은 폰트 목록/선택기를 둔다. */
  fontFamily: string;
  onFontFamilyChange: (family: string) => void;
  /** 요구사항(주석 크기 조절): 말풍선 글자 크기(px, AnnotationBubble.BUBBLE_FONT_SIZE_BASE 기준). */
  fontSize: number;
  onFontSizeChange: (size: number) => void;
}) {
  const hiddenAnnotationIds = usePresetColorVisibilityStore((s) => s.hiddenByCategory.annotation);
  const hidePreset = usePresetColorVisibilityStore((s) => s.hidePreset);
  const visibleAnnotationIds = ANNOTATION_COLOR_IDS.filter((id) => !hiddenAnnotationIds.includes(id));
  const sizeOptions = ANNOTATION_FONT_SIZE_PRESETS.includes(fontSize)
    ? ANNOTATION_FONT_SIZE_PRESETS
    : [...ANNOTATION_FONT_SIZE_PRESETS, fontSize].sort((a, b) => a - b);

  return (
    <>
      <FontPickerRow currentFamily={fontFamily || DEFAULT_FONT_FAMILY} onPick={onFontFamilyChange} />
      <Row label="크기">
        <Dropdown value={fontSize} options={sizeOptions} labelOf={(s) => `${s}px`} onChange={onFontSizeChange} />
      </Row>
      <Row label="색상">
        <ColorPickerPopover label="주석 색상" value={annotationVisualsFor(color).tick} onChange={onChange} category="annotation" />
      </Row>
      <FrequentColorsRow>
        <PresetSwatchRow
          ids={visibleAnnotationIds}
          labelOf={(id) => ANNOTATION_COLORS[id].label}
          swatchOf={(id) => ANNOTATION_COLORS[id].swatch}
          isActive={(id) => color === id}
          onPick={(id) => onChange(id)}
          onHide={(id) => hidePreset('annotation', id)}
        />
        <RecentColorSwatches
          category="annotation"
          onPick={onChange}
          activeColor={annotationVisualsFor(color).tick}
          swatchClassName="properties-round-swatch"
        />
      </FrequentColorsRow>
    </>
  );
}

/** HighlightDefaultsSection과 대칭되는 주석용 기본값 패널. 글꼴은
 * toolStore.annotationFontFamily를 공유한다(canvas/interaction/useTextSelectionTools.ts의
 * addAnnotation 호출이 이 값을 새 주석의 초기 fontFamily로 그대로 쓴다). */
function AnnotationDefaultsSection() {
  const annotationColor = useToolStore((s) => s.annotationColor);
  const setAnnotationColor = useToolStore((s) => s.setAnnotationColor);
  const annotationFontFamily = useToolStore((s) => s.annotationFontFamily);
  const setAnnotationFontFamily = useToolStore((s) => s.setAnnotationFontFamily);
  const annotationFontSize = useToolStore((s) => s.annotationFontSize);
  const setAnnotationFontSize = useToolStore((s) => s.setAnnotationFontSize);
  useSyncDefaultFontFamily(annotationFontFamily, setAnnotationFontFamily);
  return (
    <AnnotationSection
      color={annotationColor}
      onChange={setAnnotationColor}
      fontFamily={annotationFontFamily}
      onFontFamilyChange={setAnnotationFontFamily}
      fontSize={annotationFontSize}
      onFontSizeChange={setAnnotationFontSize}
    />
  );
}
