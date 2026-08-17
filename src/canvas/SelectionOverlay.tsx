import type { ArrowObject } from '../types/object';
import { useInteractionStore } from '../store/interactionStore';
import { useObjectsStore } from '../store/objectsStore';
import { useViewportStore } from '../store/viewportStore';
import { RESIZE_HANDLES } from './interaction/resizeMath';
import type { Box, ResizeHandle } from './interaction/resizeMath';
import { useObjectResize } from './interaction/useObjectResize';
import { useArrowCurveDrag } from './interaction/useArrowCurveDrag';
import { localEndpoints, curveMidpoint } from '../objects/shapes/shapeGeometry';

const HANDLE_SCREEN_SIZE = 8; // 화면 기준 px, zoom과 무관하게 항상 이 크기로 보인다.

function handlePosition(handle: ResizeHandle, width: number, height: number, size: number) {
  const half = size / 2;
  const table: Record<ResizeHandle, { left: number; top: number; cursor: string }> = {
    nw: { left: -half, top: -half, cursor: 'nwse-resize' },
    n: { left: width / 2 - half, top: -half, cursor: 'ns-resize' },
    ne: { left: width - half, top: -half, cursor: 'nesw-resize' },
    e: { left: width - half, top: height / 2 - half, cursor: 'ew-resize' },
    se: { left: width - half, top: height - half, cursor: 'nwse-resize' },
    s: { left: width / 2 - half, top: height - half, cursor: 'ns-resize' },
    sw: { left: -half, top: height - half, cursor: 'nesw-resize' },
    w: { left: -half, top: height / 2 - half, cursor: 'ew-resize' },
  };
  return table[handle];
}

/**
 * world 좌표 기준 선택 bounding box 오버레이. text-edit 모드에서는 편집 방해를
 * 피하기 위해 렌더링하지 않는다(선택 해제가 아니라 시각적 chrome만 숨김 — Escape나
 * 바깥 클릭으로 편집을 벗어나면 다시 보인다).
 *
 * Phase 7: 다중 선택 시 선택된 객체 각각에 얇은 테두리를 그린다. 8방향 resize
 * handle은 정확히 하나만 선택됐을 때만 그린다 — 여러 객체를 한 번에 리사이즈하는
 * 기능은 범위 밖이고(요구사항: Undo/Redo·Copy/Paste/Delete·다중 선택), 여러
 * bounding box에 handle을 전부 그리면 시각적으로도 번잡하다. 다중 선택은
 * "이동/삭제/복사"만 지원한다.
 */
export function SelectionOverlay() {
  const selectedIds = useInteractionStore((s) => s.selectedIds);
  const mode = useInteractionStore((s) => s.mode);
  const objectsRecord = useObjectsStore((s) => s.objects);
  const zoom = useViewportStore((s) => s.zoom);

  if (selectedIds.length === 0 || mode === 'text-edit') return null;

  const borderWidth = 1.5 / zoom;
  const showHandles = selectedIds.length === 1;
  // 요구사항(텍스트 상자 생성/크기조절, 2차): 텍스트 상자 높이도 이제 사용자가
  // resize handle로 직접 조절할 수 있다(더 이상 항상 내용에 맞춰 자동으로만 정해지지
  // 않음 — 내용이 현재 높이보다 더 필요할 때만 자동으로 커진다, TextObjectView.tsx의
  // hasAutoFitHeightOnceRef 참고). 그래서 다른 객체와 동일하게 8방향 핸들을 모두 쓴다.
  const handleList = RESIZE_HANDLES;

  return (
    <>
      {selectedIds.map((id) => {
        const object = objectsRecord[id];
        if (!object) return null;
        const box: Box = { x: object.x, y: object.y, width: object.width, height: object.height };
        // Phase 5: Image이고 aspectRatioLocked(기본 true)면 현재 박스의 가로세로 비율을
        // 그대로 리사이즈 동안 유지한다(원본 naturalWidth/Height가 아니라 "지금 보이는"
        // 비율 기준 — 과거에 Shift로 자유 리사이즈해 비율을 바꿔놨어도 그 상태를 존중한다).
        const aspectRatio =
          object.type === 'image' && object.aspectRatioLocked ? box.width / box.height : undefined;

        return (
          <div
            key={id}
            style={{
              position: 'absolute',
              left: box.x,
              top: box.y,
              width: box.width,
              height: box.height,
              border: `${borderWidth}px solid #4f8cff`,
              pointerEvents: 'none',
              zIndex: 9999, // 객체 zIndex와 무관하게 선택 오버레이는 항상 최상단
            }}
          >
            {showHandles &&
              handleList.map((handle) => (
                <ResizeHandleDot
                  key={handle}
                  handle={handle}
                  objectId={object.id}
                  box={box}
                  size={HANDLE_SCREEN_SIZE / zoom}
                  borderWidth={borderWidth}
                  aspectRatio={aspectRatio}
                />
              ))}
            {showHandles && object.type === 'arrow' && (
              <ArrowCurveHandleDot
                objectId={object.id}
                object={object}
                box={box}
                size={HANDLE_SCREEN_SIZE / zoom}
                borderWidth={borderWidth}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

function ResizeHandleDot({
  handle,
  objectId,
  box,
  size,
  borderWidth,
  aspectRatio,
}: {
  handle: ResizeHandle;
  objectId: string;
  box: Box;
  size: number;
  borderWidth: number;
  aspectRatio?: number;
}) {
  const drag = useObjectResize(objectId, box, handle, aspectRatio);
  const pos = handlePosition(handle, box.width, box.height, size);

  return (
    <div
      {...drag}
      style={{
        position: 'absolute',
        left: pos.left,
        top: pos.top,
        width: size,
        height: size,
        background: '#ffffff',
        border: `${borderWidth}px solid #4f8cff`,
        borderRadius: 2,
        cursor: pos.cursor,
        pointerEvents: 'auto',
        touchAction: 'none',
      }}
    />
  );
}

/**
 * 화살표 전용 곡률 조절 핸들. ResizeHandleDot과 같은 크기/톤이지만 원형에 다른
 * 색으로(#ff9142) 구분해서, "박스를 리사이즈하는 8개 사각 핸들"과 "선 자체를
 * 휘게 하는 핸들"이 시각적으로 다른 동작임을 알 수 있게 한다. 위치는 항상 실제
 * 곡선이 지나가는 t=0.5 지점(curveMidpoint)이라, curveOffset이 0이면 그냥 선의
 * 중점에 놓인다 — 처음 화살표를 그리고 나서도 "여기를 드래그하면 휘어진다"는
 * 자리가 바로 보인다.
 */
function ArrowCurveHandleDot({
  objectId,
  object,
  box,
  size,
  borderWidth,
}: {
  objectId: string;
  object: ArrowObject;
  box: Box;
  size: number;
  borderWidth: number;
}) {
  const { p1, p2 } = localEndpoints(box.width, box.height, !!object.flipY, !!object.reverseArrow);
  const handlePoint = curveMidpoint(p1, p2, object.curveOffset ?? 0);
  const drag = useArrowCurveDrag(objectId, box, p1, p2);

  return (
    <div
      {...drag}
      style={{
        position: 'absolute',
        left: handlePoint.x - size / 2,
        top: handlePoint.y - size / 2,
        width: size,
        height: size,
        background: '#ffffff',
        border: `${borderWidth}px solid #ff9142`,
        borderRadius: '50%',
        cursor: 'grab',
        pointerEvents: 'auto',
        touchAction: 'none',
      }}
    />
  );
}
