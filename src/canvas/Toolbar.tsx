import { useToolStore } from '../store/toolStore';
import type { ToolId } from '../store/toolStore';
import { useInteractionStore } from '../store/interactionStore';
import { useTextDefaultPresetsStore } from '../store/textDefaultPresetsStore';
import type { TextPresetKind } from '../store/textDefaultPresetsStore';
import {
  AnnotationIcon,
  ArrowToolIcon,
  FrameToolIcon,
  HighlighterIcon,
  ImageToolIcon,
  RectangleToolIcon,
  SelectIcon,
  TextToolIcon,
} from '../icons/Icons';

const TOOL_ICONS: Record<ToolId, React.ComponentType<{ size?: number }>> = {
  select: SelectIcon,
  highlight: HighlighterIcon,
  annotation: AnnotationIcon,
  text: TextToolIcon,
  frame: FrameToolIcon,
  image: ImageToolIcon,
  arrow: ArrowToolIcon,
  rectangle: RectangleToolIcon,
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

  const selectTool = (tool: ToolId) => {
    deselect();
    setTool(tool);
  };

  const applyTextPreset = (kind: TextPresetKind) => {
    const preset = textPresets[kind];
    if (!preset) return;
    deselect();
    applyTextDefaults(preset);
    setTool('text');
  };

  // 요구사항(상단 메뉴 순서): 선택 / 텍스트·형광펜·주석 / 프레임·이미지 / 화살표·사각형
  // 네 그룹으로 나누고 그 사이에만 구분선을 둔다.
  return (
    <div className="canvas-toolbar">
      <ToolButton tool="select" activeTool={activeTool} label="선택" onClick={() => selectTool('select')} />
      <div className="canvas-toolbar-divider" />

      <div className="canvas-toolbar-text-menu">
        <ToolButton tool="text" activeTool={activeTool} label="텍스트" onClick={() => selectTool('text')} />
        <div className="canvas-toolbar-text-flyout">
          <button
            type="button"
            className="canvas-toolbar-text-flyout-item"
            disabled={!textPresets.title}
            title={textPresets.title ? '저장된 제목값으로 텍스트 만들기' : '아직 저장된 제목값이 없습니다'}
            onClick={() => applyTextPreset('title')}
          >
            제목
          </button>
          <button
            type="button"
            className="canvas-toolbar-text-flyout-item"
            disabled={!textPresets.body}
            title={textPresets.body ? '저장된 본문값으로 텍스트 만들기' : '아직 저장된 본문값이 없습니다'}
            onClick={() => applyTextPreset('body')}
          >
            본문
          </button>
        </div>
      </div>
      <ToolButton tool="highlight" activeTool={activeTool} label="형광펜" onClick={() => selectTool('highlight')} />
      <ToolButton tool="annotation" activeTool={activeTool} label="주석" onClick={() => selectTool('annotation')} />

      <div className="canvas-toolbar-divider" />
      <ToolButton tool="frame" activeTool={activeTool} label="프레임" onClick={() => selectTool('frame')} />
      <ToolButton tool="image" activeTool={activeTool} label="이미지" onClick={() => selectTool('image')} />

      <div className="canvas-toolbar-divider" />
      <ToolButton tool="arrow" activeTool={activeTool} label="화살표" onClick={() => selectTool('arrow')} />
      <ToolButton tool="rectangle" activeTool={activeTool} label="사각형" onClick={() => selectTool('rectangle')} />
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
