import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useToolStore } from '../store/toolStore';
import type { ToolId } from '../store/toolStore';
import { useInteractionStore } from '../store/interactionStore';
import { useTextDefaultPresetsStore } from '../store/textDefaultPresetsStore';
import type { TextDefaultPreset } from '../store/textDefaultPresetsStore';
import { MAX_TABLE_GRID_COLS, MAX_TABLE_GRID_ROWS } from '../objects/table/tableDefaults';
import {
  AnnotationIcon,
  ArrowToolIcon,
  DragHandleIcon,
  FrameToolIcon,
  HighlighterIcon,
  ImageToolIcon,
  LinkIcon,
  RectangleToolIcon,
  SelectIcon,
  TableToolIcon,
  TextToolIcon,
} from '../icons/Icons';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

interface ToolbarDragState {
  pointerId: number;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
}

const TOOL_ICONS: Record<ToolId, React.ComponentType<{ size?: number }>> = {
  select: SelectIcon,
  highlight: HighlighterIcon,
  annotation: AnnotationIcon,
  text: TextToolIcon,
  frame: FrameToolIcon,
  image: ImageToolIcon,
  arrow: ArrowToolIcon,
  rectangle: RectangleToolIcon,
  table: TableToolIcon,
  link: LinkIcon,
};

/**
 * Phase 4: 선택 / 형광펜 / 주석 도구를 고르는 작은 플로팅 툴바.
 *
 * 기존 canvas-hud(줌 표시, 뷰 초기화)와는 별개 컴포넌트로 두고 위치만 오른쪽
 * 위로 옮겨서 겹치지 않게 한다. 여기서 activeTool을 바꾸는 것 외에는 어떤
 * 캔버스/텍스트 로직도 건드리지 않는다 — 실제 동작은 ObjectView/TextObjectView/
 * useTextSelectionTools가 activeTool을 구독해서 처리한다.
 *
 * [메뉴/사이드바 상태 통합] 버튼을 클릭하면 항상 먼저 deselect()로 현재 선택
 * (객체 선택 + fineSelection)을 지운 뒤 setTool한다 — PropertiesPanel.tsx가
 * "선택된 것이 있으면 그 객체 자신의 패널, 없으면 activeTool의 기본값 패널"
 * 순서로 렌더링하므로, 이렇게 선택을 먼저 비워야 새로 클릭한 메뉴의 사이드바가
 * (이전에 열려있던 다른 사이드바를 밀어내고) 확실히 열린다.
 *
 * [색상 선택 위치 통합] 형광펜/주석 색상 프리셋 스와치를 이 툴바에 따로 두지
 * 않는다 — 오른쪽 사이드바(PropertiesPanel.tsx의 HighlightDefaultsSection/
 * AnnotationDefaultsSection, 그리고 fineSelection으로 이미 만들어진 하이라이트/
 * 주석을 고를 때는 HighlightSection/AnnotationSection)에 이미 "색상" + "자주
 * 사용하는 색상"이 있어서 중복이었고, 이 팝오버 카드 자체가 툴바와 분리된
 * 위치에 떠 있어 혼란을 줬다(텍스트/화살표/사각형도 이미 같은 이유로 여기 없다).
 *
 * [텍스트 기본값 저장] '텍스트' 버튼에 마우스를 올리면(hover) '제목'/'본문' 두
 * 항목이 있는 작은 메뉴가 뜬다 — PropertiesPanel의 '제목값으로 저장'/'본문값으로
 * 저장' 버튼으로 미리 저장해둔 프리셋(textDefaultPresetsStore)을 바로 적용하는
 * 단축 경로다. 항목을 클릭하면 그 프리셋 값으로 toolStore의 텍스트 기본값을
 * 맞추고 텍스트 도구를 활성화한다(저장된 값이 없으면 비활성화). '텍스트' 버튼 자체를
 * 클릭하는 것은(hover 메뉴가 아니라) 기존과 동일하게 현재 toolStore 값 그대로 텍스트
 * 도구를 켠다.
 */
export function Toolbar() {
  const activeTool = useToolStore((s) => s.activeTool);
  const setTool = useToolStore((s) => s.setTool);
  const applyTextDefaults = useToolStore((s) => s.applyTextDefaults);
  const deselect = useInteractionStore((s) => s.deselect);
  const textPresets = useTextDefaultPresetsStore((s) => s.presets);

  // 요구사항(상단 메뉴 카드 드래그 이동, 2026-09-09): 기본 위치는 CSS(position:fixed +
  // top:12px + left:50%/translateX(-50%))로 화면 상단 중앙에 고정돼 있다. dragPos가
  // null인 동안은 그 CSS를 그대로 두고, 손잡이(canvas-toolbar-handle)를 드래그하기
  // 시작한 순간부터만 화면 절대좌표(left/top, transform:none)로 전환해서 위치를
  // 픽셀 단위로 옮긴다 — 새로고침/재실행 시엔 다시 null로 시작하므로 위치를 저장하지
  // 않는다(요구사항 확정, localStorage 등에 굳이 남기지 않음). 화면 밖으로 나가지
  // 못하게 매 이동마다 카드 자신의 실측 크기(getBoundingClientRect)를 기준으로
  // left/top을 [0, innerWidth/Height - 카드폭/높이] 범위로 clamp한다.
  const toolbarRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<ToolbarDragState | null>(null);
  const [dragPos, setDragPos] = useState<{ left: number; top: number } | null>(null);

  // 요구사항(표 만들기): '표' 버튼 위에 마우스를 올리면 격자 피커가 뜬다(한글 2020의
  // '표 만들기' 대화상자와 같은 상호작용) — 격자 칸 위를 지나가면 그 칸까지의
  // 행수 x 열수를 미리보기로 보여주고(hover), 클릭하면 그 크기로 toolStore의
  // tableRows/tableCols를 갱신한 뒤 '표' 도구를 활성화한다. 이후 캔버스를 한 번
  // 클릭하면 그 자리에 표가 생긴다(Frame/Image와 같은 1회용 도구 관례 —
  // canvas/Canvas.tsx의 handleBackgroundClick 참고).
  const [tableHover, setTableHover] = useState<{ rows: number; cols: number } | null>(null);

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const rect = toolbarRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, startLeft: rect.left, startTop: rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== e.pointerId) return;
    // PdfViewerPanel.tsx의 onResizePointerMove와 같은 이유: 브라우저 밖에서 마우스를
    // 놓쳐 pointerup을 못 받는 경우 e.buttons===0으로 알아채고 정리한다.
    if (e.buttons === 0) {
      dragRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      return;
    }
    const rect = toolbarRef.current?.getBoundingClientRect();
    const width = rect?.width ?? 0;
    const height = rect?.height ?? 0;
    const maxLeft = Math.max(0, window.innerWidth - width);
    const maxTop = Math.max(0, window.innerHeight - height);
    setDragPos({
      left: clamp(state.startLeft + (e.clientX - state.startX), 0, maxLeft),
      top: clamp(state.startTop + (e.clientY - state.startY), 0, maxTop),
    });
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const selectTool = (tool: ToolId) => {
    deselect();
    setTool(tool);
  };

  const applyTextPreset = (preset: TextDefaultPreset) => {
    deselect();
    applyTextDefaults(preset);
    setTool('text');
  };

  const chooseTableSize = (rows: number, cols: number) => {
    deselect();
    useToolStore.getState().setTableGridSize(rows, cols);
    setTool('table');
    setTableHover(null);
  };

  // 요구사항(상단 메뉴 순서): 선택 / 텍스트·형광펜·주석 / 프레임·이미지 / 화살표·사각형
  // 네 그룹으로 나누고 그 사이에만 구분선을 둔다.
  return (
    <div
      className="canvas-toolbar"
      ref={toolbarRef}
      style={dragPos ? { left: dragPos.left, top: dragPos.top, transform: 'none' } : undefined}
    >
      <ToolButton tool="select" activeTool={activeTool} label="선택" onClick={() => selectTool('select')} />
      <div className="canvas-toolbar-divider" />

      {/* 요구사항(텍스트 스타일 저장, 2026-09 확장): '제목'/'본문' 두 개 고정 버튼 대신,
          사용자가 저장한 스타일 목록(textDefaultPresetsStore)을 그대로 나열한다. 저장된
          스타일이 하나도 없으면 빈 플라이아웃이 hover 시 뜨지 않도록 메뉴 래퍼 자체를
          생략하고 평범한 '텍스트' 버튼만 보여준다. */}
      {textPresets.length > 0 ? (
        <div className="canvas-toolbar-text-menu">
          <ToolButton tool="text" activeTool={activeTool} label="텍스트" onClick={() => selectTool('text')} />
          <div className="canvas-toolbar-text-flyout">
            {textPresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="canvas-toolbar-text-flyout-item"
                title={`저장된 '${preset.name}' 스타일로 텍스트 만들기`}
                onClick={() => applyTextPreset(preset.preset)}
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <ToolButton tool="text" activeTool={activeTool} label="텍스트" onClick={() => selectTool('text')} />
      )}
      <ToolButton tool="highlight" activeTool={activeTool} label="형광펜" onClick={() => selectTool('highlight')} />
      <ToolButton tool="annotation" activeTool={activeTool} label="주석" onClick={() => selectTool('annotation')} />

      <div className="canvas-toolbar-divider" />
      <ToolButton tool="frame" activeTool={activeTool} label="프레임" onClick={() => selectTool('frame')} />
      <ToolButton tool="image" activeTool={activeTool} label="이미지" onClick={() => selectTool('image')} />

      <div className="canvas-toolbar-divider" />
      <ToolButton tool="arrow" activeTool={activeTool} label="화살표" onClick={() => selectTool('arrow')} />
      <ToolButton tool="rectangle" activeTool={activeTool} label="사각형" onClick={() => selectTool('rectangle')} />

      {/* 요구사항(표 만들기): 아이콘 자체를 클릭하면 기존 사각형/화살표와 동일하게
          마지막으로 고른(또는 기본) 크기로 '표' 도구만 켠다. hover하면 뜨는 격자
          피커는 그 자리에서 바로 크기를 확정해 '표' 도구를 켜는 지름길이다. */}
      <div className="canvas-toolbar-table-menu">
        <ToolButton tool="table" activeTool={activeTool} label="표" onClick={() => selectTool('table')} />
        <div className="canvas-toolbar-table-flyout" onMouseLeave={() => setTableHover(null)}>
          <div className="canvas-toolbar-table-grid">
            {Array.from({ length: MAX_TABLE_GRID_ROWS }, (_, r) =>
              Array.from({ length: MAX_TABLE_GRID_COLS }, (_, c) => {
                const active = tableHover ? r < tableHover.rows && c < tableHover.cols : false;
                return (
                  <div
                    key={`${r}-${c}`}
                    className={active ? 'canvas-toolbar-table-cell is-active' : 'canvas-toolbar-table-cell'}
                    onMouseEnter={() => setTableHover({ rows: r + 1, cols: c + 1 })}
                    onClick={() => chooseTableSize(r + 1, c + 1)}
                  />
                );
              }),
            )}
          </div>
          <div className="canvas-toolbar-table-label">
            {tableHover ? `${tableHover.rows} x ${tableHover.cols}` : '표 크기 선택'}
          </div>
        </div>
      </div>

      {/* 요구사항(내부 하이퍼링크, Phase 9): 클릭 두 번(출발지→도착지)으로 링크를
          만드는 1회용 도구 — text/frame/image와 같은 관례로 별도 그룹(구분선)에 둔다.
          실제 클릭 처리는 canvas/interaction/useLinkTool.ts(메인 캔버스)/
          canvas/pdf/useOverlayLinkTool.ts(PDF)가 담당하고, 이 버튼은 다른 도구 버튼과
          완전히 동일하게 selectTool만 호출한다. */}
      <div className="canvas-toolbar-divider" />
      <ToolButton tool="link" activeTool={activeTool} label="링크" onClick={() => selectTool('link')} />

      {/* 요구사항(2026-09-09, 손잡이 위치를 오른쪽 끝으로): 손잡이-옆 아이콘 간격이
          다른 아이콘들 사이 간격과 같아야 하므로 다른 도구 버튼들과 같은 flex 컨테이너
          안에 그대로 두고(canvas-toolbar의 gap이 자동으로 적용됨), 카드 오른쪽 끝과
          손잡이 사이 간격도 그 gap과 같아야 하므로 canvas-toolbar의 padding을 gap과
          같은 값으로 맞췄다(Canvas.css 참고) — 그래야 이 마지막 요소와 오른쪽 테두리
          사이 여백이 다른 아이콘 사이 여백과 시각적으로 동일해진다. */}
      <div className="canvas-toolbar-divider" />
      <div
        className="canvas-toolbar-handle"
        title="드래그해서 이동"
        aria-label="드래그해서 이동"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <DragHandleIcon size={13} />
      </div>
    </div>
  );
}

function ToolButton({
  tool,
  activeTool,
  label,
  onClick,
}: {
  tool: ToolId;
  activeTool: ToolId;
  label: string;
  onClick: () => void;
}) {
  const active = tool === activeTool;
  const Icon = TOOL_ICONS[tool];
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={active ? 'canvas-toolbar-btn is-active' : 'canvas-toolbar-btn'}
    >
      <Icon size={18} />
    </button>
  );
}
