import { useToolStore } from '../store/toolStore';
import type { ToolId } from '../store/toolStore';
import { useInteractionStore } from '../store/interactionStore';
import { HIGHLIGHT_COLORS, HIGHLIGHT_COLOR_IDS } from '../objects/text/highlightColors';
import { ANNOTATION_COLORS, ANNOTATION_COLOR_IDS } from '../objects/text/annotationColors';
import type { AnnotationColorId, HighlightColorId } from '../objects/text/indentation/types';
import { usePresetColorVisibilityStore } from '../store/presetColorVisibilityStore';
import { RecentColorSwatches } from '../objects/style/RecentColorSwatches';
import { useTextDefaultPresetsStore } from '../store/textDefaultPresetsStore';
import type { TextPresetKind } from '../store/textDefaultPresetsStore';

/**
 * Phase 4: 선택 / 형광펜(+5색) / 주석 도구를 고르는 작은 플로팅 툴바.
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
 * [색상 관리 통합] 프리셋 스와치를 클릭하면 그 색이 "적용"만 되고 더 이상 자주
 * 쓰는 색상에 자동 기록되지 않는다(요구사항: 색상 선택만으로는 절대 자동 추가
 * 금지 — ColorPickerPopover.tsx의 명시적 "추가" 버튼을 눌러야만 기록된다).
 * 프리셋 스와치를 우클릭하면 그 자리에서 프리셋 목록 자체에서 숨겨진다(기본
 * 제공 색상도 삭제 가능해야 한다는 요구사항 — store/presetColorVisibilityStore.ts,
 * fontStore.ts의 hiddenBuiltinIds와 동일한 패턴).
 *
 * [색상 선택 위치 통합, 이번 라운드] 텍스트/화살표/사각형 버튼 옆에 있던 색상
 * 스와치 묶음은 제거했다 — 이 세 도구의 색은 이제 오른쪽 사이드바(PropertiesPanel.tsx의
 * TextDefaultsSection/ArrowDefaultsSection/RectangleDefaultsSection)에서만 고른다.
 * 형광펜/주석은 캔버스 위에서 바로 드래그해 만드는 즉시성이 커서(색을 자주 바꿔가며
 * 연속으로 긋는 사용 패턴) 기존처럼 버튼 옆 스와치를 그대로 둔다.
 *
 * [텍스트 기본값 저장, 이번 라운드] '텍스트' 버튼에 마우스를 올리면(hover) '제목'/
 * '본문' 두 항목이 있는 작은 메뉴가 뜬다 — PropertiesPanel의 '제목값으로 저장'/
 * '본문값으로 저장' 버튼으로 미리 저장해둔 프리셋(textDefaultPresetsStore)을 바로
 * 적용하는 단축 경로다. 항목을 클릭하면 그 프리셋 값으로 toolStore의 텍스트 기본값을
 * 맞추고 텍스트 도구를 활성화한다(저장된 값이 없으면 비활성화). '텍스트' 버튼 자체를
 * 클릭하는 것은(hover 메뉴가 아니라) 기존과 동일하게 현재 toolStore 값 그대로 텍스트
 * 도구를 켠다.
 */
export function Toolbar() {
  const activeTool = useToolStore((s) => s.activeTool);
  const highlightColor = useToolStore((s) => s.highlightColor);
  const annotationColor = useToolStore((s) => s.annotationColor);
  const setTool = useToolStore((s) => s.setTool);
  const setHighlightColor = useToolStore((s) => s.setHighlightColor);
  const setAnnotationColor = useToolStore((s) => s.setAnnotationColor);
  const applyTextDefaults = useToolStore((s) => s.applyTextDefaults);
  const deselect = useInteractionStore((s) => s.deselect);
  const hiddenByCategory = usePresetColorVisibilityStore((s) => s.hiddenByCategory);
  const hidePreset = usePresetColorVisibilityStore((s) => s.hidePreset);
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

  const visibleHighlightIds = HIGHLIGHT_COLOR_IDS.filter((id) => !hiddenByCategory.highlight.includes(id));
  const visibleAnnotationIds = ANNOTATION_COLOR_IDS.filter((id) => !hiddenByCategory.annotation.includes(id));

  return (
    <div className="canvas-toolbar">
      <ToolButton tool="select" activeTool={activeTool} label="선택" onClick={() => selectTool('select')} />
      <div className="canvas-toolbar-divider" />
      <ToolButton tool="highlight" activeTool={activeTool} label="형광펜" onClick={() => selectTool('highlight')} />
      {activeTool === 'highlight' && (
        <div className="canvas-toolbar-swatches">
          {visibleHighlightIds.map((id) => (
            <ColorSwatch
              key={id}
              id={id}
              active={highlightColor === id}
              onClick={() => setHighlightColor(id)}
              onHide={() => hidePreset('highlight', id)}
            />
          ))}
          <RecentColorSwatches
            category="highlight"
            onPick={setHighlightColor}
            activeColor={highlightColor}
            swatchClassName="canvas-toolbar-swatch"
          />
        </div>
      )}
      <div className="canvas-toolbar-divider" />
      <ToolButton tool="annotation" activeTool={activeTool} label="주석" onClick={() => selectTool('annotation')} />
      {activeTool === 'annotation' && (
        <div className="canvas-toolbar-swatches">
          {visibleAnnotationIds.map((id) => (
            <AnnotationColorSwatch
              key={id}
              id={id}
              active={annotationColor === id}
              onClick={() => setAnnotationColor(id)}
              onHide={() => hidePreset('annotation', id)}
            />
          ))}
          <RecentColorSwatches
            category="annotation"
            onPick={setAnnotationColor}
            activeColor={annotationColor}
            swatchClassName="canvas-toolbar-swatch"
          />
        </div>
      )}
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
  return (
    <button
      type="button"
      onClick={onClick}
      className={active ? 'canvas-toolbar-btn is-active' : 'canvas-toolbar-btn'}
    >
      {label}
    </button>
  );
}

/** 프리셋 스와치 공통: 클릭하면 적용, 우클릭하면 그 프리셋을 목록에서 숨긴다
 * (기본 제공 색상 삭제 요구사항 — 색이 아니라 "그 프리셋 슬롯"을 숨기는 것이라
 * usePresetColorVisibilityStore에 카테고리+id로 기록해두면 다음에도 안 보인다). */
function presetTitle(label: string): string {
  return `${label} (우클릭: 목록에서 삭제)`;
}

function ColorSwatch({
  id,
  active,
  onClick,
  onHide,
}: {
  id: HighlightColorId;
  active: boolean;
  onClick: () => void;
  onHide: () => void;
}) {
  const color = HIGHLIGHT_COLORS[id];
  return (
    <button
      type="button"
      title={presetTitle(color.label)}
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        onHide();
      }}
      className={active ? 'canvas-toolbar-swatch is-active' : 'canvas-toolbar-swatch'}
      style={{ background: color.swatch }}
    />
  );
}

function AnnotationColorSwatch({
  id,
  active,
  onClick,
  onHide,
}: {
  id: AnnotationColorId;
  active: boolean;
  onClick: () => void;
  onHide: () => void;
}) {
  const color = ANNOTATION_COLORS[id];
  return (
    <button
      type="button"
      title={presetTitle(color.label)}
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        onHide();
      }}
      className={active ? 'canvas-toolbar-swatch is-active' : 'canvas-toolbar-swatch'}
      style={{ background: color.swatch }}
    />
  );
}

