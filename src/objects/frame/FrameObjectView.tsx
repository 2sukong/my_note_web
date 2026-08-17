import type { FrameObject } from '../../types/object';
import { useToolStore } from '../../store/toolStore';
import { useViewportStore } from '../../store/viewportStore';
import { useImagePickerStore } from '../../store/imagePickerStore';
import { clientToWorld } from '../../utils/coords';
import { useObjectDrag } from '../../canvas/interaction/useObjectDrag';
import { FRAME_THEMES, resolveFrameTheme, resolveFrameCenterFold } from './frameStyles';

/** 요구사항(Frame 선택/삭제 동작 수정): Frame 테두리에서 이 정도 두께(화면 기준 px,
 * zoom과 무관하게 항상 이 굵기로 보인다 — SelectionOverlay.tsx의 HANDLE_SCREEN_SIZE와
 * 동일한 관례)만큼만 클릭/드래그하면 Frame 자체가 선택·이동된다. */
const FRAME_EDGE_HIT_SCREEN_PX = 10;

/**
 * Frame = 실제로 필기하는 종이 한 장. Canvas(무한 작업 공간)와는 다른 개념이고,
 * Text의 DOM 부모도 아니다 — 그냥 "이 영역이 페이지"라는 걸 보여주는 흰 배경 +
 * 옅은 테두리/그림자일 뿐이다(원칙 3, 4 참고).
 *
 * 요구사항(텍스트 상자 생성 경로 통합): 예전엔 이 Frame 내부를 더블클릭하면 그
 * 자리에 새 Text가 생겼지만(frameId로 이 Frame에 연결), 이제 Text는 오직 사이드바의
 * "텍스트 상자 생성" 버튼(canvas/actions.ts의 spawnTextAtViewportCenter,
 * PropertiesPanel.tsx)으로만 만들어지므로 그 더블클릭 핸들러를 제거했다 — Frame
 * 내부에 생기는 Text도 결국 이 버튼이 만든(항상 frameId 없는) Text를 드래그해
 * 옮겨 넣는 방식으로 대체된다.
 *
 * [수정] Frame 선택/이동: 예전엔 ObjectView.tsx가 모든 객체에 공통으로 붙이는
 * 전체 영역 드래그(useObjectDrag)를 Frame도 그대로 썼는데, 그러면 Frame 내부의
 * "빈 공간"(자식 객체가 없는 부분)을 클릭해도 Frame이 선택/드래그돼서, 마퀴
 * 선택이나 빈 캔버스처럼 자연스럽게 동작해야 할 내부 영역이 Frame에 가로채어졌다.
 * 이제 ObjectView.tsx는 Frame 타입에 대해 그 generic drag를 붙이지 않고(skipDrag),
 * 이 컴포넌트가 직접 useObjectDrag를 호출해서 테두리 4변 + 'Frame' 라벨에만 붙인다.
 * 내부(흰 배경) 자체는 pointerdown에 아무 반응도 하지 않으므로(stopPropagation도
 * 안 함) 그 위의 자식 객체 클릭이나 캔버스 레벨 마퀴 선택/그리기 도구가 평소
 * "빈 캔버스"에서처럼 자연스럽게 동작한다.
 */
export function FrameObjectView({ object }: { object: FrameObject }) {
  const drag = useObjectDrag(object.id);
  const zoom = useViewportStore((s) => s.zoom);
  const edgeThickness = FRAME_EDGE_HIT_SCREEN_PX / zoom;
  // 요구사항(어두운 프레임에서도 A4 절반을 쓸 수 있도록): 배경 테마(styleDef)와 접선
  // 표시 여부(showCenterFold)를 독립적으로 판정한다 — 더 이상 style==='half'라는
  // 하나의 값에 묶여 있지 않다. resolveFrameTheme/resolveFrameCenterFold가 구버전
  // 데이터(style:'half')도 그대로 올바르게 해석해준다.
  const styleDef = FRAME_THEMES[resolveFrameTheme(object.style)];
  const showCenterFold = resolveFrameCenterFold(object.style, object.centerFold);

  // '이미지' 도구가 활성화된 상태에서 Frame 내부를 클릭해도(Canvas 배경 클릭과
  // 동일하게) 새 객체가 생겨야 한다 — 이번엔 frameId가 이 Frame으로 채워진다.
  // Canvas.tsx의 handleBackgroundClick은 target===canvas-root일 때만 반응하므로
  // Frame 위 클릭은 여기서 별도로 처리해야 한다.
  const handleClick = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    const { activeTool: tool, setTool } = useToolStore.getState();
    if (tool !== 'image') return;

    const world = clientToWorld({ x: e.clientX, y: e.clientY }, useViewportStore.getState());
    // Phase 5: 이미지는 frame처럼 즉시 spawn하지 않는다 — 파일 선택 대화상자가
    // 비동기라서, 위치(+frameId)만 기억해뒀다가 Canvas.tsx가 파일 선택 완료 후
    // spawnImageAt을 호출한다.
    useImagePickerStore.getState().requestPicker(world.x, world.y, object.id);
    setTool('select');
  };

  return (
    <div
      onClick={handleClick}
      // Phase 6: useDrawShapeTool.ts가 "빈 배경 위에서만 드래그를 시작한다"는
      // 판정에 이 div도 포함시키기 위한 표식. Frame은 다른 객체(Text/Image)와
      // 달리 "페이지 배경"에 가까운 개념이라, 화살표/사각형 도구는 Frame 위에서도
      // (다른 실제 객체 위가 아닌 한) 그리기를 시작할 수 있어야 한다.
      data-shape-drawable="true"
      style={{
        width: '100%',
        height: '100%',
        background: styleDef.background,
        border: `1px solid ${styleDef.borderColor}`,
        boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
        position: 'relative',
      }}
    >
      {showCenterFold ? (
        // "A4 절반" 접선: 정중앙, 분할 축 기준 길이의 95%(양쪽 2.5%씩 여백), 색은
        // 테두리와 동일. pointerEvents:'none'이 중요 — 이게 없으면 이 선이 클릭/드래그를
        // 가로채서, 정확히 이 선 위에서는 도형 그리기/마퀴 선택이 시작되지 않는 버그가
        // 생긴다(부모 div의 data-shape-drawable 판정이 e.target !== el이 되어
        // useDrawShapeTool.ts 등이 무시해버림). foldAxis==='horizontal'이면 상하를
        // 가르는 가로선(PropertiesPanel.tsx의 "전체 회전" 버튼 참고) — 기본(undefined)은
        // 좌우를 가르는 세로선.
        (object.foldAxis ?? 'vertical') === 'horizontal' ? (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '2.5%',
              right: '2.5%',
              height: 1,
              background: styleDef.borderColor,
              transform: 'translateY(-50%)',
              pointerEvents: 'none',
            }}
          />
        ) : (
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '2.5%',
              bottom: '2.5%',
              width: 1,
              background: styleDef.borderColor,
              transform: 'translateX(-50%)',
              pointerEvents: 'none',
            }}
          />
        )
      ) : null}

      {object.label ? (
        <span
          {...drag}
          style={{
            position: 'absolute',
            left: 0,
            top: -22,
            fontSize: 12,
            color: styleDef.labelColor,
            fontFamily: 'system-ui, sans-serif',
            userSelect: 'none',
            cursor: 'move',
            touchAction: 'none',
          }}
        >
          {object.label}
        </span>
      ) : null}

      {/* Frame 선택/이동 전용 히트 영역(테두리 4변). 내부 배경 자체는 이 요소들
          바깥이라 pointerdown에 반응하지 않는다 — 자식 객체 선택이나 캔버스
          레벨 마퀴 선택/그리기 도구가 그대로 우선한다. */}
      <div {...drag} style={{ position: 'absolute', left: 0, top: 0, right: 0, height: edgeThickness, cursor: 'move', touchAction: 'none' }} />
      <div {...drag} style={{ position: 'absolute', left: 0, bottom: 0, right: 0, height: edgeThickness, cursor: 'move', touchAction: 'none' }} />
      <div {...drag} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: edgeThickness, cursor: 'move', touchAction: 'none' }} />
      <div {...drag} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: edgeThickness, cursor: 'move', touchAction: 'none' }} />
    </div>
  );
}
