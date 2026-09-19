import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import type { CanvasObject } from '../types/object';
import { useObjectDrag } from '../canvas/interaction/useObjectDrag';
import { useInteractionStore } from '../store/interactionStore';
import { useToolStore, SHAPE_TOOL_IDS } from '../store/toolStore';
import { useObjectContextMenuStore } from '../store/objectContextMenuStore';
import { useImagePickerStore } from '../store/imagePickerStore';
import { useViewportStore } from '../store/viewportStore';
import { clientToWorld } from '../utils/coords';
import { TextObjectView } from './text/TextObjectView';
import { ImageObjectView } from './image/ImageObjectView';
import { FrameObjectView } from './frame/FrameObjectView';
import { ShapeView } from './shapes/ShapeView';
import { TableObjectView } from './table/TableObjectView';
import { useTableEditStore } from '../store/tableEditStore';

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
  // 요구사항(이미지 전용 직선 형광펜): 형광펜 도구가 활성화된 동안 Image 객체 위에서
  // 드래그하면 "이미지 이동"이 아니라 "직선 형광펜 긋기"여야 한다 — isTextSelectMode와
  // 완전히 같은 이유로 drag 핸들러 자체를 떼서, pointerdown이 stopPropagation 없이
  // 캔버스 레벨 리스너(useImageHighlightTool.ts)까지 버블링되게 한다.
  const isImageHighlightMode = object.type === 'image' && activeTool === 'highlight';
  // Phase 6: 화살표/사각형 도구가 활성화된 동안엔 Frame 위에서도 드래그가 "Frame
  // 이동"이 아니라 "도형 그리기"여야 한다(요구사항 — Frame 위에서 도형이 생성되지
  // 않던 버그 수정). Frame은 이 pointerdown으로 스스로 할 일이 없으므로(자신의
  // onClick도 text/image 도구만 처리) 그냥 흘려보내면 useDrawShapeTool의 캔버스
  // 레벨 native 리스너가 그 이벤트를 받는다.
  // 요구사항(그리기 도구가 기존 객체를 가로챔): 화살표/사각형/텍스트 도구가 활성화된
  // 동안엔 객체 타입과 무관하게(Frame/Text뿐 아니라 Shape/Image 포함) 전부 drag
  // passthrough여야 한다 — 기존 객체 위에서 드래그를 시작해도 그 객체가 선택/이동되지
  // 않고 새 객체 그리기가 시작돼야 하기 때문이다. 실제 차단은 useObjectDrag.ts의
  // onPointerDown이 activeTool을 직접 확인해 self-guard하므로, 여기서는 그 핸들러를
  // 아예 붙이지 않아 불필요한 리스너를 줄이고 커서를 'default'로 보여주는 역할만 한다.
  const isDrawPassthrough = SHAPE_TOOL_IDS.includes(activeTool) || activeTool === 'text';
  // 요구사항: Frame은 더 이상 전체 영역이 드래그/선택 대상이 아니다 — 테두리/'Frame'
  // 라벨만 클릭·드래그해서 선택·이동할 수 있어야 하므로, 이 generic wrapper에는 Frame
  // 타입에 대해 drag 핸들러를 아예 붙이지 않는다. 실제 테두리/라벨 전용 드래그는
  // FrameObjectView.tsx가 자기 자신의 useObjectDrag 인스턴스로 별도 처리한다.
  const isFrame = object.type === 'frame';
  // 요구사항(표를 먼저 선택해야 그리기/지우개 가능): 이 표가 지금 "편집 모드"(더블클릭으로
  // 들어감 — objects/table/TableObjectView.tsx)에 있으면 generic drag를 붙이지 않는다.
  // Frame과 같은 이유 — 편집 모드 동안엔 TableObjectView 자신이 그리기/지우개/셀 범위
  // 드래그·contentEditable 클릭을 직접 처리해야 하므로, 이 wrapper가 먼저 pointerdown을
  // 가로채 객체 이동으로 처리해버리면 안 된다. 편집 모드가 아닐 때는 다른 객체(Image 등)와
  // 동일하게 이 wrapper의 이동/리사이즈 인프라를 그대로 쓴다.
  const editingTableId = useTableEditStore((s) => s.editingTableId);
  const isTableEditing = object.type === 'table' && editingTableId === object.id;
  // 버그 수정(표 셀 형광펜/주석): 표는 objects/table/TableObjectView.tsx의
  // allowNativeTextSelect가 "편집 모드로 들어가지 않아도" 형광펜/주석 도구가 켜져
  // 있으면 바로 셀 텍스트를 드래그 선택할 수 있게 해준다 — 그런데 이 wrapper의
  // skipDrag는 isTableEditing(더블클릭 편집 모드)만 알고 있어서, 편집 모드가 아닌
  // 표 위에서 형광펜 드래그를 시작하면 이 wrapper가 여전히 generic drag 핸들러를
  // 붙인 채였다. 그 결과 셀 텍스트는 정상적으로 선택되면서도 pointerdown이 동시에
  // "표 이동"으로도 해석되어 표 전체가 딸려 움직이는 회귀가 생겼다. isTextSelectMode와
  // 정확히 같은 원리로, 표 타입에 대해서도 형광펜/주석 도구가 활성화돼 있으면(편집
  // 모드 여부와 무관하게) drag 핸들러 자체를 떼어 pointerdown이 그대로 브라우저
  // 기본 텍스트 선택으로 이어지게 한다.
  const isTableTextSelectMode = object.type === 'table' && (activeTool === 'highlight' || activeTool === 'annotation');
  // 요구사항(이미지 삽입 확장, 2026-09): '이미지' 도구가 활성화된 동안엔 다른
  // 일회용 도구들(isDrawPassthrough)과 동일하게 기존 객체 위에서 select+drag가
  // 시작되면 안 된다 — 그래야 pointerdown이 먼저 그 객체를 선택해버리는 부작용 없이,
  // 아래 handleObjectClick이 깨끗하게 "이 자리에 이미지 삽입"만 처리한다. Frame은
  // 원래도 이 wrapper의 drag 대상이 아니므로(isFrame) 영향 없음.
  const isImagePlacementMode = activeTool === 'image';
  const skipDrag = isTextEditing || isTextSelectMode || isTableTextSelectMode || isImageHighlightMode || isDrawPassthrough || isImagePlacementMode || isFrame || isTableEditing || isSpacePressed;
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
      : isTextSelectMode || isTableTextSelectMode
        ? 'text'
        : isImageHighlightMode
          ? 'crosshair'
          : isSpacePressed
          ? 'inherit'
          // 요구사항(객체 잠금): 잠긴 객체는 이동할 수 없다는 걸 커서로도 알려준다
          // (선택 자체는 여전히 가능하므로 pointer-events는 그대로 둔다).
          : object.locked
            ? 'not-allowed'
            : isFrame || isDrawPassthrough || isImagePlacementMode || isTableEditing
              ? 'default'
              : 'move',
    touchAction: 'none',
  };

  // 요구사항(우클릭 쌓임 순서 메뉴): 객체 종류와 무관하게 전부 동일한 메뉴(canvas/
  // ObjectContextMenu.tsx)를 연다. 이미 다중 선택에 포함된 객체를 우클릭하면 그
  // 다중 선택을 유지하고(같은 동작을 여러 개에 한 번에 적용하고 싶을 수 있으니),
  // 그 외에는 이 객체 하나만 선택한다 — useObjectDrag.ts의 pointerdown 선택 규칙과
  // 동일한 원칙.
  // 요구사항(이미지 삽입 확장, 2026-09): '이미지' 도구가 활성화된 상태에서 기존
  // 객체(Text/Image/Arrow/Rectangle) 위를 클릭해도 그 자리에 새 이미지가 삽입되어야
  // 한다 — 지금까지는 Canvas.tsx의 handleBackgroundClick이 e.target===e.currentTarget
  // (즉 진짜 빈 캔버스)일 때만 반응해서, 객체 위를 클릭하면 아무 일도 일어나지
  // 않았다(그 객체가 선택될 뿐, 위 isImagePlacementMode로 이제 그마저도 막았다).
  // Frame은 이미 자기 표면 클릭을 스스로 처리하므로(FrameObjectView.tsx의
  // handleClick) 여기서는 제외한다 — 포함시키면 Frame 표면 클릭 시 그 안쪽
  // 핸들러와 이 바깥 wrapper 핸들러가 둘 다 반응해 이미지가 두 번(frameId 있음/
  // 없음 각각) 생긴다. stopPropagation으로 이 클릭이 canvas-root의
  // handleBackgroundClick까지 번지는 것도 막는다(그쪽은 target 불일치로 이미
  // 무시하지만, 의도를 명확히 하기 위해 명시적으로 막아둔다).
  const handleObjectClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (isFrame) return;
    const { activeTool: tool, setTool } = useToolStore.getState();
    if (tool !== 'image') return;
    e.stopPropagation();
    const world = clientToWorld({ x: e.clientX, y: e.clientY }, useViewportStore.getState());
    // if (isFrame) return; 위 줄 덕분에 TS도 여기선 object.type이 'frame'이 아님을
    // 알고 있어서(control flow narrowing) frameId 접근에 별도 분기가 필요 없다.
    const frameId = object.frameId ?? null;
    useImagePickerStore.getState().requestPicker(world.x, world.y, frameId);
    setTool('select');
  };

  // 버그 수정(2026-09-15, 링크 생성 좌클릭→우클릭 변경): canvas/interaction/
  // useLinkTool.ts가 이제 우클릭으로 링크 anchor를 찍는다. 그 훅은 containerRef(캔버스
  // 루트)에 직접 addEventListener한 네이티브 리스너라 React의 합성 dispatch보다
  // 항상 먼저 실행되므로(그 파일 주석 참고) 이 함수를 막지 않아도 링크 도구 자체는
  // 이미 정상 동작한다 — 다만 이 함수를 그대로 두면 "링크 anchor 지정"과 "객체 우클릭
  // 메뉴 열기"가 동시에 일어난다. activeTool==='link'일 때는 이 객체 컨텍스트 메뉴를
  // 열지 않고 그대로 리턴해서(preventDefault/stopPropagation도 하지 않음) 이벤트가
  // useLinkTool.ts가 이미 처리한 대로만 흘러가게 한다.
  const handleContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (useToolStore.getState().activeTool === 'link') return;
    e.preventDefault();
    e.stopPropagation();
    const { selectedIds, select } = useInteractionStore.getState();
    if (!selectedIds.includes(object.id)) select(object.id);
    useObjectContextMenuStore.getState().open(object.id, e.clientX, e.clientY);
  };

  return (
    <div
      className="canvas-object"
      // 요구사항(내보내기): canvas/actions.ts의 exportFrame이 "이 프레임 영역과 겹치는
      // 객체만" 골라내는 데 쓴다(html-to-image filter). 렌더링/인터랙션에는 전혀
      // 관여하지 않는 순수 식별용 속성이다.
      data-object-id={object.id}
      style={style}
      onClick={handleObjectClick}
      onContextMenu={handleContextMenu}
      {...(skipDrag ? {} : drag)}
    >
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
    case 'table':
      return <TableObjectView object={object} />;
    case 'arrow':
    case 'rectangle':
      // Phase 6: 이 wrapper div(이미 drag 핸들러가 붙어 있음) 안을 꽉 채우는
      // <svg>로 그린다 — objects/shapes/ShapeView.tsx 참고.
      return <ShapeView object={object} />;
    default:
      return null;
  }
}
