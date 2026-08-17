import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useViewportStore } from '../../store/viewportStore';
import { useObjectsStore } from '../../store/objectsStore';
import { useInteractionStore } from '../../store/interactionStore';
import { useHistoryStore } from '../../store/historyStore';
import { useAlignmentGuideStore } from '../../store/alignmentGuideStore';
import { computeSmartGuides } from '../../objects/align/smartGuides';
import type { GuideTarget } from '../../objects/align/smartGuides';
import { alignmentScopeOf, objectsInAlignmentScope } from '../../objects/align/frameScope';

const DRAG_THRESHOLD_PX = 4; // screen px 기준. 이 이상 움직여야 '드래그'로 인정한다.
const SNAP_THRESHOLD_PX = 6; // screen px 기준. 정렬 가이드(smartGuides.ts)가 반응하는 민감도.

interface DragRefState {
  pointerId: number;
  startScreen: { x: number; y: number };
  /** 드래그 시작 시점에 선택돼 있던 모든 객체의 world 좌표(다중 선택 이동용). */
  startPositions: Record<string, { x: number; y: number }>;
  dragging: boolean;
}

/**
 * 객체 하나의 select + drag 인터랙션을 담당한다.
 * pointerdown → select, 이동 임계값을 넘으면 drag 모드로 전환하고
 * screen 이동량을 zoom으로 나눠 world 이동량으로 변환해 objectsStore에 반영한다.
 *
 * 중요: setPointerCapture는 pointerdown 시점이 아니라, 실제로 드래그 임계값을 넘어
 * "진짜 드래그"가 시작되는 순간(onPointerMove 안)에만 호출한다.
 * pointerdown에서 곧바로 캡처를 잡으면, 움직임이 전혀 없는 일반 클릭/더블클릭에서도
 * 브라우저가 뒤이어 합성해야 할 click/dblclick 이벤트를 아예 만들지 않는 경우가 있어
 * (실측: pointerdown/pointerup은 찍히지만 click/dblclick이 전혀 발생하지 않음),
 * 텍스트 객체 더블클릭으로 편집 모드에 진입하는 것 자체가 막혀버리는 문제가 있었다.
 * 드래그가 실제로 시작될 때만 capture를 잡으면, 움직임 없는 클릭/더블클릭은 이 훅이
 * 전혀 건드리지 않고 그대로 흘려보내 브라우저 기본 click/dblclick 합성이 정상 동작한다.
 *
 * Phase 7: 더 이상 worldX/worldY를 prop으로 받지 않는다 — 드래그 시작 시점에
 * objectsStore에서 직접 최신 좌표를 읽는다(다중 선택 시 여러 객체의 좌표가 필요해서
 * prop으로 넘기는 방식이 더 이상 맞지 않는다).
 *
 * 다중 선택 이동: pointerdown 시점에 (a) Shift가 눌려있으면 toggleSelect로 이
 * 객체만 선택을 켜고/끄고 드래그는 시작하지 않는다(Shift는 "선택 편집" 전용 —
 * Figma 등과 동일한 관례), (b) 이미 다중 선택에 포함된 객체를 그냥 누르면 선택을
 * 유지한 채 그 다중 선택 전체를 함께 옮긴다, (c) 그 외(선택 안 된 객체를 그냥
 * 누름)에는 단일 선택으로 교체한다. 실제 이동은 드래그 시작 시점 선택 전체의
 * 시작 좌표를 캡처해두고, 매 pointermove마다 그 시작 좌표 + 누적 delta로
 * "절대 좌표"를 다시 계산해 각 객체에 적용한다(증분이 아니라 절대값이라 프레임
 * 드롭이 있어도 어긋나지 않는다). Frame과 그 자식이 동시에 선택된 경우 자식은
 * moveObjectTo가 두 번(직접 + Frame cascade) 손댈 수 있지만, 두 경로 모두 같은
 * 목표 절대좌표로 수렴하므로 안전하다(objectsStore.ts moveObjectTo 주석 참고).
 */
export function useObjectDrag(objectId: string) {
  const dragRef = useRef<DragRefState | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // 좌클릭만 select/drag 대상
    e.stopPropagation(); // 캔버스 레벨 pan/deselect/마퀴 핸들러로 전파되지 않도록

    const interaction = useInteractionStore.getState();
    if (e.shiftKey) {
      interaction.toggleSelect(objectId);
      // Shift+클릭은 선택 편집 자체가 목적이라, 같은 제스처로 곧바로 드래그를
      // 시작하지 않는다(선택이 막 꺼졌을 수도 있음 — 그 경우 옮길 대상이 없다).
      return;
    }
    if (!interaction.selectedIds.includes(objectId)) {
      interaction.select(objectId);
      // 버그 수정(텍스트 상자 선택 후 이동 시 상단 메뉴 오염): 예전엔 여기서 선택한
      // 객체 종류(text/arrow/rectangle)로 activeTool까지 자동 전환해서 상단 메뉴의
      // 해당 버튼을 강조했다. 하지만 PropertiesPanel.tsx는 이미 selectedIds만으로
      // (activeTool과 무관하게) 올바른 사이드바를 보여주므로 그 동기화는 불필요했고,
      // 부작용으로 activeTool이 'text'/'arrow'/'rectangle' 같은 "1회용 그리기 도구"
      // 상태로 남아버렸다. 그 상태에서 텍스트 상자를 선택해 옮긴 뒤 빈 캔버스를
      // 클릭하면 useDrawTextTool.ts/useDrawShapeTool.ts가 그 클릭을 "새로 그리기
      // 시작"으로 오해해 의도치 않은 새 텍스트 상자/도형이 생겼다. 이제 선택만으로는
      // activeTool을 건드리지 않으므로 상단 메뉴는 항상 '선택' 상태를 유지한다.
    }
    // else: 이미 다중 선택에 포함돼 있으면 선택을 그대로 유지한 채 드래그만 시작한다.

    const ids = useInteractionStore.getState().selectedIds;
    const objects = useObjectsStore.getState().objects;
    const startPositions: Record<string, { x: number; y: number }> = {};
    for (const id of ids) {
      const o = objects[id];
      if (o) startPositions[id] = { x: o.x, y: o.y };
    }

    dragRef.current = {
      pointerId: e.pointerId,
      startScreen: { x: e.clientX, y: e.clientY },
      startPositions,
      dragging: false,
    };
    // 여기서는 setPointerCapture를 호출하지 않는다 (위 주석 참고).
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== e.pointerId) return;

    // 버그 수정("로딩 걸린 객체를 클릭 해제하려 해도 잘 안 되는 경우"): 브라우저
    // 밖에서 마우스 버튼을 놓는 등의 이유로 pointerup/pointercancel이 이 요소에
    // 전달되지 못하면(드물지만 발생) dragRef가 영원히 남고, setPointerCapture로
    // 이 요소가 이 pointerId의 모든 후속 이벤트를 계속 가로챈다 — 그래서 사용자가
    // 배경을 클릭해도 그 클릭이 여기(멈춘 객체)로만 전달되고 배경 클릭(선택 해제)은
    // 전혀 발생하지 않는 것처럼 보인다. e.buttons===0(실제로는 버튼이 눌려있지
    // 않음)이면 pointerup을 놓친 것으로 간주하고, 다음 실제 pointerdown이 이 상태를
    // 오해석하기 전에 여기서 즉시 정리한다(capture 해제 + mode 복구).
    if (e.buttons === 0) {
      if (state.dragging) {
        useInteractionStore.getState().setMode('select');
        useHistoryStore.getState().endTransaction();
        useAlignmentGuideStore.getState().clear();
      }
      dragRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      return;
    }

    const dxScreen = e.clientX - state.startScreen.x;
    const dyScreen = e.clientY - state.startScreen.y;

    if (!state.dragging) {
      if (Math.hypot(dxScreen, dyScreen) < DRAG_THRESHOLD_PX) return;
      state.dragging = true;
      useInteractionStore.getState().setMode('drag');
      useHistoryStore.getState().beginTransaction('drag');
      // 실제 드래그로 확정된 이 시점에만 캡처를 잡는다 — 커서가 요소 밖으로
      // 나가도 이동을 계속 추적하기 위해 필요하지만, 클릭/더블클릭에는 관여하지 않는다.
      e.currentTarget.setPointerCapture(e.pointerId);
    }

    const { zoom } = useViewportStore.getState();
    const dxWorld = dxScreen / zoom;
    const dyWorld = dyScreen / zoom;

    // 요구사항(정렬 가이드): 다중 선택 전체를 하나의 바운딩 박스로 묶어서(zoom 무관하게
    // 항상 화면 SNAP_THRESHOLD_PX만큼) 다른 객체와의 정렬/등간격을 검사한다 — 선택된
    // 모든 객체가 같은 delta로 움직이므로, 그 delta에 스냅 보정치를 한 번만 더하면
    // 전부에 일관되게 적용된다. 드래그 대상 자신은 비교 대상(others)에서 제외해야
    // 스스로에게 스냅되는 무의미한 결과를 막을 수 있다.
    const objects = useObjectsStore.getState().objects;
    const movingIds = new Set(Object.keys(state.startPositions));
    let unionBox: { x: number; y: number; width: number; height: number } | null = null;
    for (const [id, start] of Object.entries(state.startPositions)) {
      const obj = objects[id];
      if (!obj) continue;
      const box = { x: start.x + dxWorld, y: start.y + dyWorld, width: obj.width, height: obj.height };
      unionBox = unionBox
        ? {
            x: Math.min(unionBox.x, box.x),
            y: Math.min(unionBox.y, box.y),
            width: Math.max(unionBox.x + unionBox.width, box.x + box.width) - Math.min(unionBox.x, box.x),
            height: Math.max(unionBox.y + unionBox.height, box.y + box.height) - Math.min(unionBox.y, box.y),
          }
        : box;
    }

    let finalDx = dxWorld;
    let finalDy = dyWorld;
    if (unionBox) {
      // 요구사항(정렬 가이드는 같은 프레임 안에서만): 다중 선택이어도 대표(첫 번째)
      // 드래그 대상의 프레임 소속을 기준으로 비교 범위를 정한다 — 서로 다른 프레임에
      // 걸친 다중 선택 드래그는 드문 경우라 이 정도 단순화로 충분하다.
      const primaryId = Object.keys(state.startPositions)[0];
      const primary = objects[primaryId];
      const scope = primary ? alignmentScopeOf(primary) : null;
      const candidates = objectsInAlignmentScope(
        Object.values(objects).filter((o) => !movingIds.has(o.id)),
        scope,
      );
      const others: GuideTarget[] = candidates.map((o) => ({ id: o.id, x: o.x, y: o.y, width: o.width, height: o.height }));
      const threshold = SNAP_THRESHOLD_PX / zoom;
      const snap = computeSmartGuides(unionBox, others, threshold);
      finalDx += snap.dx;
      finalDy += snap.dy;
      useAlignmentGuideStore.getState().setLines(snap.lines);
    }

    for (const [id, start] of Object.entries(state.startPositions)) {
      useObjectsStore.getState().moveObjectTo(id, start.x + finalDx, start.y + finalDy);
    }
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== e.pointerId) return;

    if (state.dragging) {
      useInteractionStore.getState().setMode('select');
      useHistoryStore.getState().endTransaction();
      useAlignmentGuideStore.getState().clear();
    }
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  };
}
