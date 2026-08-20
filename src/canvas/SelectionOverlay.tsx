import type { ArrowObject } from '../types/object';
import { useInteractionStore } from '../store/interactionStore';
import { useObjectsStore } from '../store/objectsStore';
import { useViewportStore } from '../store/viewportStore';
import { HANDLE_SCREEN_SIZE, RESIZE_HANDLES, handlePosition } from './interaction/resizeMath';
import type { Box, ResizeHandle } from './interaction/resizeMath';
import { useObjectResize } from './interaction/useObjectResize';
import { useGroupResize } from './interaction/useGroupResize';
import { useArrowCurveDrag } from './interaction/useArrowCurveDrag';
import { localEndpoints, curveMidpoint } from '../objects/shapes/shapeGeometry';
import { useImageCropStore } from '../store/imageCropStore';

/**
 * world 좌표 기준 선택 bounding box 오버레이. text-edit 모드에서는 편집 방해를
 * 피하기 위해 렌더링하지 않는다(선택 해제가 아니라 시각적 chrome만 숨김 — Escape나
 * 바깥 클릭으로 편집을 벗어나면 다시 보인다).
 *
 * Phase 7: 다중 선택 시 선택된 객체 각각에 얇은 테두리를 그린다. 8방향 resize
 * handle은 정확히 하나만 선택됐을 때만 개별 박스에 그린다(여러 bounding box에 handle을
 * 전부 그리면 시각적으로 번잡하므로).
 *
 * 요구사항(Ctrl+클릭 다중 선택 함께 리사이즈): 대신 선택이 2개 이상이면 잠기지 않은
 * 선택 객체들의 union bounding box 하나에 점선 테두리 + 8방향 handle을 추가로 그려서
 * (useGroupResize.ts) 전체를 한 번에 리사이즈할 수 있게 한다. 잠긴 객체는 이 union
 * box와 handle 모두에서 제외된다(이동과 동일한 규칙).
 */
export function SelectionOverlay() {
  const selectedIds = useInteractionStore((s) => s.selectedIds);
  const mode = useInteractionStore((s) => s.mode);
  const objectsRecord = useObjectsStore((s) => s.objects);
  const zoom = useViewportStore((s) => s.zoom);
  const croppingObjectId = useImageCropStore((s) => s.croppingObjectId);

  if (selectedIds.length === 0 || mode === 'text-edit') return null;

  const borderWidth = 1.5 / zoom;
  const showHandles = selectedIds.length === 1;
  // 요구사항(텍스트 상자 생성/크기조절, 2차): 텍스트 상자 높이도 이제 사용자가
  // resize handle로 직접 조절할 수 있다(더 이상 항상 내용에 맞춰 자동으로만 정해지지
  // 않음 — 내용이 현재 높이보다 더 필요할 때만 자동으로 커진다, TextObjectView.tsx의
  // hasAutoFitHeightOnceRef 참고). 그래서 다른 객체와 동일하게 8방향 핸들을 모두 쓴다.
  const handleList = RESIZE_HANDLES;

  const resizableGroupIds =
    selectedIds.length > 1 ? selectedIds.filter((id) => objectsRecord[id] && !objectsRecord[id].locked) : [];
  let groupBox: Box | null = null;
  for (const id of resizableGroupIds) {
    const o = objectsRecord[id];
    const box: Box = { x: o.x, y: o.y, width: o.width, height: o.height };
    groupBox = groupBox
      ? {
          x: Math.min(groupBox.x, box.x),
          y: Math.min(groupBox.y, box.y),
          width: Math.max(groupBox.x + groupBox.width, box.x + box.width) - Math.min(groupBox.x, box.x),
          height: Math.max(groupBox.y + groupBox.height, box.y + box.height) - Math.min(groupBox.y, box.y),
        }
      : box;
  }

  return (
    <>
      {selectedIds.map((id) => {
        const object = objectsRecord[id];
        if (!object) return null;
        // 요구사항(이미지 자르기): 지금 자르기 모드인 이미지는 ImageObjectView.tsx가
        // 자기 자신의 박스/핸들(잘려나갈 영역을 흐리게 보여주는 레이어 포함)을 직접
        // 그린다 — 여기서 일반 리사이즈 테두리/핸들까지 겹쳐 그리면 둘이 충돌한다.
        if (id === croppingObjectId) return null;
        const box: Box = { x: object.x, y: object.y, width: object.width, height: object.height };
        // Phase 5: Image이고 aspectRatioLocked(기본 true)면 현재 박스의 가로세로 비율을
        // 그대로 리사이즈 동안 유지한다(원본 naturalWidth/Height가 아니라 "지금 보이는"
        // 비율 기준 — 과거에 Shift로 자유 리사이즈해 비율을 바꿔놨어도 그 상태를 존중한다).
        const aspectRatio =
          object.type === 'image' && object.aspectRatioLocked ? box.width / box.height : undefined;
        // 요구사항(객체 잠금): 잠긴 객체는 리사이즈 핸들 자체를 그리지 않는다 —
        // 이동/삭제와 마찬가지로 크기조절도 막혀야 하므로, 핸들이 아예 없으면
        // useObjectResize 쪽에 별도 가드를 두지 않아도 자연히 막힌다.
        const showHandlesForThis = showHandles && !object.locked;

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
            {showHandlesForThis &&
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
            {showHandlesForThis && object.type === 'arrow' && (
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
      {groupBox && (
        <div
          style={{
            position: 'absolute',
            left: groupBox.x,
            top: groupBox.y,
            width: groupBox.width,
            height: groupBox.height,
            border: `${borderWidth}px dashed #4f8cff`,
            pointerEvents: 'none',
            zIndex: 10000, // 개별 박스(9999)보다 위에 그려 handle이 항상 클릭 가능하게 한다.
          }}
        >
          {handleList.map((handle) => (
            <GroupResizeHandleDot
              key={handle}
              handle={handle}
              objectIds={resizableGroupIds}
              box={groupBox as Box}
              size={HANDLE_SCREEN_SIZE / zoom}
              borderWidth={borderWidth}
            />
          ))}
        </div>
      )}
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

/** ResizeHandleDot과 같은 모양이지만 단일 객체가 아니라 useGroupResize로 선택 전체를 리사이즈한다. */
function GroupResizeHandleDot({
  handle,
  objectIds,
  box,
  size,
  borderWidth,
}: {
  handle: ResizeHandle;
  objectIds: string[];
  box: Box;
  size: number;
  borderWidth: number;
}) {
  const drag = useGroupResize(objectIds, box, handle);
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
