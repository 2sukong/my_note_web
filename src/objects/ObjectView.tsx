import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import type { CanvasObject } from '../types/object';
import { useObjectDrag } from '../canvas/interaction/useObjectDrag';
import { useInteractionStore } from '../store/interactionStore';
import { useToolStore, SHAPE_TOOL_IDS } from '../store/toolStore';
import { useObjectContextMenuStore } from '../store/objectContextMenuStore';
import { TextObjectView } from './text/TextObjectView';
import { ImageObjectView } from './image/ImageObjectView';
import { FrameObjectView } from './frame/FrameObjectView';
import { ShapeView } from './shapes/ShapeView';

interface ObjectViewProps {
  object: CanvasObject;
  /** 스페이스바가 눌려있는 동안(pan 제스처)엔 객체 위에서 시작한 드래그도 그 객체를
   * 선택/이동하지 않고 그대로 캔버스 pan(usePan.ts)으로 흘려보내야 한다 — Canvas.tsx가
   * usePan()의 로컬 state를 그대로 내려준다(버그 수정: 객체 위에서 스페이스+드래그
   * 시 pan과 동시에 그 객체가 선택되던 문제). */
  isSpacePressed: boolean;
}

/**
 * 모든 캔버스 객체의 공통 wrapper.
 * world 좌표계 안에서 위치/크기를 잡고, select+drag 인터랙션을 붙인 뒤
 * 타입별 내용은 하위 컴포넌트에 위임한다.
 * 선택 시각화(bounding box + resize handle)는 SelectionOverlay가 별도로 그린다.
 *
 * 이 객체가 현재 text-edit 중이면 drag 핸들러를 붙이지 않는다 — 그래야
 * contentEditable 안에서의 클릭/드래그(텍스트 커서 이동, 드래그 선택)가
 * 객체 이동 로직과 충돌하지 않는다.
 */
export function ObjectView({ object, isSpacePressed }: ObjectViewProps) {
  const isTextEditing = useInteractionStore(
    (s) => s.mode === 'text-edit' && s.selectedIds.length === 1 && s.selectedIds[0] === object.id,
  );
  // Phase 4: 형광펜/주석 도구가 활성화된 동안에는 텍스트 객체 위에서 드래그가
  // "객체 이동"이 아니라 "텍스트 선택"이어야 한다(요구사항 5번). 이때만 drag
  // 핸들러를 아예 붙이지 않아서, pointerdown이 stopPropagation/캡처를 하지 않고
  // 브라우저 기본 텍스트 선택으로 이어지게 한다. activeTool==='select'(기본값)이면
  // 이 조건은 항상 false라서 Phase 1~3 동작에 아무 영향이 없다.
  const activeTool = useToolStore((s) => s.activeTool);
  // [수정] 예전엔 activeTool !== 'select'(즉 어떤 도구든)이면 무조건 텍스트 선택
  // 모드였는데, 이제 '텍스트' 도구도 "선택된 텍스트 객체의 종류에 맞춰 자동
  // 전환되는 상단 메뉴 상태"로 쓰이기 시작하면서, 텍스트 객체를 선택한 뒤
  // 그대로 드래그해서 옮기는 게 막혀버리는 문제가 생겼다(activeTool이 'text'가
  // 되면서 이 조건이 true가 되어 drag 핸들러가 빠져버림). 텍스트 범위 드래그
  // 선택이 실제로 필요한 도구는 형광펜/주석뿐이므로 이 두 가지로 좁힌다 — 그
  // 결과 '텍스트'/'프레임'/'이미지'/'화살표'/'사각형' 도구가 활성화돼 있어도
  // 기존 텍스트 객체는 항상 정상적으로 드래그 이동할 수 있다.
  const isTextSelectMode = object.type === 'text' && (activeTool === 'highlight' || activeTool === 'annotation');
  // Phase 6: 화살표/사각형 도구가 활성화된 동안엔 Frame 위에서도 드래그가 "Frame
  // 이동"이 아니라 "도형 그리기"여야 한다(요구사항 — Frame 위에서 도형이 생성되지
  // 않던 버그 수정). Frame은 이 pointerdown으로 스스로 할 일이 없으므로(자신의
  // onClick도 text/image 도구만 처리) 그냥 흘려보내면 useDrawShapeTool의 캔버스
  // 레벨 native 리스너가 그 이벤트를 받는다.
  // 요구사항(화살표/사각형을 텍스트 상자 위에도 그릴 수 있게): Text도 같은 원리로
  // 확장한다 — TextObjectView.tsx의 컨테이너에 이미 data-shape-drawable="true"를
  // 붙여뒀으므로(useDrawShapeTool.ts가 target.closest로 그 후손까지 인식), 여기서
  // drag 핸들러만 떼면 pointerdown이 그대로 캔버스 레벨 리스너까지 흘러간다. Image는
  // 요구사항 범위 밖이라 그대로 자기 드래그(이동/리사이즈)를 유지한다.
  const isDrawPassthrough = (object.type === 'frame' || object.type === 'text') && SHAPE_TOOL_IDS.includes(activeTool);
  // 요구사항: Frame은 더 이상 전체 영역이 드래그/선택 대상이 아니다 — 테두리/'Frame'
  // 라벨만 클릭·드래그해서 선택·이동할 수 있어야 하므로, 이 generic wrapper에는 Frame
  // 타입에 대해 drag 핸들러를 아예 붙이지 않는다. 실제 테두리/라벨 전용 드래그는
  // FrameObjectView.tsx가 자기 자신의 useObjectDrag 인스턴스로 별도 처리한다.
  const isFrame = object.type === 'frame';
  const skipDrag = isTextEditing || isTextSelectMode || isDrawPassthrough || isFrame || isSpacePressed;
  const drag = useObjectDrag(object.id);

  const style: CSSProperties = {
    position: 'absolute',
    left: object.x,
    top: object.y,
    width: object.width,
    height: object.height,
    zIndex: object.zIndex,
    // Frame은 이제 내부 전체가 아니라 테두리/라벨만 이동 가능하므로(FrameObjectView.tsx가
    // 그 부분에 자체 cursor:'move'를 지정한다), 이 바깥 wrapper 기본 커서는 'move'로
    // 오해를 주지 않도록 'default'로 둔다. Text도 draw-passthrough 중엔(이동이 아니라
    // 도형을 그리는 중이므로) 같은 이유로 'move'가 아니라 'default'를 보여준다.
    cursor: isTextEditing
      ? 'text'
      : isTextSelectMode
        ? 'text'
        : isSpacePressed
          ? 'inherit'
          : isFrame || isDrawPassthrough
            ? 'default'
            : 'move',
    touchAction: 'none',
  };

  // 요구사항(우클릭 쌓임 순서 메뉴): 객체 종류와 무관하게 전부 동일한 메뉴(canvas/
  // ObjectContextMenu.tsx)를 연다. 이미 다중 선택에 포함된 객체를 우클릭하면 그
  // 다중 선택을 유지하고(같은 동작을 여러 개에 한 번에 적용하고 싶을 수 있으니),
  // 그 외에는 이 객체 하나만 선택한다 — useObjectDrag.ts의 pointerdown 선택 규칙과
  // 동일한 원칙.
  const handleContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const { selectedIds, select } = useInteractionStore.getState();
    if (!selectedIds.includes(object.id)) select(object.id);
    useObjectContextMenuStore.getState().open(object.id, e.clientX, e.clientY);
  };

  return (
    <div className="canvas-object" style={style} onContextMenu={handleContextMenu} {...(skipDrag ? {} : drag)}>
      {renderContent(object)}
    </div>
  );
}

function renderContent(object: CanvasObject) {
  switch (object.type) {
    case 'text':
      return <TextObjectView object={object} />;
    case 'image':
      return <ImageObjectView object={object} />;
    case 'frame':
      return <FrameObjectView object={object} />;
    case 'arrow':
    case 'rectangle':
      // Phase 6: 이 wrapper div(이미 drag 핸들러가 붙어 있음) 안을 꽉 채우는
      // <svg>로 그린다 — objects/shapes/ShapeView.tsx 참고.
      return <ShapeView object={object} />;
    default:
      return null;
  }
}
