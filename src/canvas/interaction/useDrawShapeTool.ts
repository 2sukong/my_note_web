import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useViewportStore } from '../../store/viewportStore';
import { useToolStore, SHAPE_TOOL_IDS } from '../../store/toolStore';
import { useDrawDraftStore } from '../../store/drawDraftStore';
import { useObjectsStore } from '../../store/objectsStore';
import { useAlignmentGuideStore } from '../../store/alignmentGuideStore';
import { clientToWorld } from '../../utils/coords';
import { computeFreeCornerSnap } from '../../objects/align/smartGuides';
import type { GuideTarget } from '../../objects/align/smartGuides';
import { objectsInAlignmentScope } from '../../objects/align/frameScope';
import { spawnShapeFromDraft, findFrameAt } from '../actions';
import type { ShapeToolId } from '../actions';

const SNAP_THRESHOLD_PX = 6; // screen px 기준. 정렬 가이드(smartGuides.ts)가 반응하는 민감도.

/**
 * Phase 6: 화살표/사각형 도구가 활성화된 동안 캔버스 빈 곳을 드래그하면
 * 시작점→끝점을 잇는 도형을 만든다. text/frame/image 도구(클릭 한 번으로 확정)와
 * 달리 드래그 자체가 제스처이므로 usePan.ts와 같은 방식(containerRef에 native
 * pointer 이벤트 리스너를 직접 붙임)으로 구현했다 — React 합성 이벤트로는 pointerId
 * 추적/setPointerCapture를 다루기 더 번거롭기 때문이다.
 *
 * pointerdown 시점에는 objectsStore에 아무것도 추가하지 않는다 — drawDraftStore에만
 * draft를 기록하고, canvas/DrawPreview.tsx가 그 draft를 구독해 미리보기를 그린다.
 * 실제 객체는 pointerup에서 spawnShapeFromDraft로 한 번에 확정된다(너무 짧은 드래그는
 * 그 함수 안에서 무시됨). 확정 후에는 항상 'select' 도구로 되돌아간다(text/frame/image와
 * 동일한 "1회용 도구" 관례).
 */
export function useDrawShapeTool(containerRef: RefObject<HTMLDivElement | null>) {
  const activeRef = useRef<{ pointerId: number; tool: ShapeToolId } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handlePointerDown = (e: PointerEvent) => {
      // 알려진 한계(문서화만 해둠, MVP 범위 밖): 스페이스+좌클릭 드래그(pan)와 이 도구가
      // 동시에 활성화될 수 있는 조합은 따로 막지 않는다 — usePan.ts의 isSpacePressed는
      // 그 훅 로컬 상태라 여기서 읽을 수 없고, 두 훅 다 같은 el에 별개의 pointerdown
      // 리스너를 붙이는 구조라 이 경우 pan과 draw가 동시에 시작될 수 있다. 실사용에서
      // "그리기 도구가 켜진 채로 스페이스를 누르는" 조합은 드물어서 우선순위를 낮췄다.
      if (e.button !== 0) return;
      // 빈 캔버스 배경, Frame의 빈 표면, 또는 Text 상자(data-shape-drawable) 위에서만
      // 시작한다. Frame은 "페이지 배경"에 가까운 개념이라 예외로 허용하고, Text는
      // 요구사항(화살표/사각형을 텍스트 상자 위에도 그릴 수 있어야 함)에 따라
      // 허용한다. 그 외 실제 객체(Image/다른 도형) 위/핸들 위는 각자의 핸들러가
      // 처리하도록 그대로 막는다(버그 수정: 예전엔 el 자신이어야만 통과해서 Frame
      // 위에서 전혀 그려지지 않았다).
      //
      // Text 상자는 Frame의 빈 표면과 달리 내부에 줄 div/span/하이라이트 레이어 등
      // 여러 겹의 후손 엘리먼트가 있어서, 실제로 클릭되는 e.target은 컨테이너 자신이
      // 아니라 그 안의 어떤 후손인 경우가 대부분이다 — 그래서 정확히 같은 엘리먼트인지
      // (target.dataset)가 아니라 조상 중에 그 표식이 있는지(closest)로 확인한다.
      const target = e.target as HTMLElement;
      if (target !== el && !target.closest('[data-shape-drawable="true"]')) return;

      const tool = useToolStore.getState().activeTool;
      if (!SHAPE_TOOL_IDS.includes(tool)) return;

      const world = clientToWorld({ x: e.clientX, y: e.clientY }, useViewportStore.getState());
      activeRef.current = { pointerId: e.pointerId, tool: tool as ShapeToolId };
      useDrawDraftStore.getState().setDraft({ tool: tool as ShapeToolId, start: world, current: world });
      el.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: PointerEvent) => {
      const active = activeRef.current;
      if (!active || active.pointerId !== e.pointerId) return;
      // 버그 수정: useObjectDrag.ts와 동일한 이유로, 놓친 pointerup 때문에 캔버스가
      // pointer capture를 계속 들고 있는 상태를 e.buttons===0으로 감지해 정리한다.
      if (e.buttons === 0) {
        activeRef.current = null;
        useDrawDraftStore.getState().clearDraft();
        useAlignmentGuideStore.getState().clear();
        if (el.hasPointerCapture(e.pointerId)) {
          el.releasePointerCapture(e.pointerId);
        }
        return;
      }
      const draftBefore = useDrawDraftStore.getState().draft;
      if (!draftBefore) return;
      const viewport = useViewportStore.getState();
      const world = clientToWorld({ x: e.clientX, y: e.clientY }, viewport);

      // 요구사항(정렬 가이드): 시작점(draft.start)은 고정한 채, 커서를 따라가는 끝점만
      // 다른 객체와의 정렬/같은 크기 스냅 대상이다(objects/align/smartGuides.ts의
      // computeFreeCornerSnap). matchSize=true — 생성 중에는 아직 확정되지 않은
      // 폭/높이가 다른 객체와 같아지는 순간도 감지해야 한다(이동 중에는 크기가
      // 안 바뀌므로 useObjectDrag.ts는 이 옵션을 쓰지 않는다). matchSquare는
      // 사각형 도구에서만(화살표에는 정사각형 개념이 의미 없다).
      // 요구사항(정렬 가이드는 같은 프레임 안에서만): 시작점이 속한 Frame(없으면
      // 최상위)과 같은 범위의 객체만 비교 대상으로 삼는다 — spawnShapeFromDraft가
      // 실제로 이 도형에 부여할 frameId와 같은 기준(findFrameAt)이라 일관적이다.
      const scope = findFrameAt(draftBefore.start.x, draftBefore.start.y);
      const candidates = objectsInAlignmentScope(Object.values(useObjectsStore.getState().objects), scope);
      const others: GuideTarget[] = candidates.map((o) => ({ id: o.id, x: o.x, y: o.y, width: o.width, height: o.height }));
      const threshold = SNAP_THRESHOLD_PX / viewport.zoom;
      const matchSquare = active.tool === 'rectangle';
      const snap = computeFreeCornerSnap(draftBefore.start, world, others, threshold, true, matchSquare);
      useAlignmentGuideStore.getState().setLines(snap.lines);
      useDrawDraftStore.getState().updateCurrent({ x: snap.x, y: snap.y });
    };

    const finishDraw = (e: PointerEvent) => {
      const active = activeRef.current;
      if (!active || active.pointerId !== e.pointerId) return;
      activeRef.current = null;
      if (el.hasPointerCapture(e.pointerId)) {
        el.releasePointerCapture(e.pointerId);
      }
      useAlignmentGuideStore.getState().clear();

      const draft = useDrawDraftStore.getState().draft;
      useDrawDraftStore.getState().clearDraft();
      if (!draft) return;

      const { shapeStrokeColor, shapeStrokeWidth, setTool } = useToolStore.getState();
      // 시작점 기준으로 Frame 소속을 정한다(Text/Image 배치와 동일한 규칙 —
      // canvas/actions.ts의 findFrameAt 참고). Frame이 이동하면 이 도형도 같이 따라간다.
      const frameId = findFrameAt(draft.start.x, draft.start.y);
      spawnShapeFromDraft(draft.tool, draft.start, draft.current, shapeStrokeColor, shapeStrokeWidth, frameId);
      setTool('select');
    };

    el.addEventListener('pointerdown', handlePointerDown);
    el.addEventListener('pointermove', handlePointerMove);
    el.addEventListener('pointerup', finishDraw);
    el.addEventListener('pointercancel', finishDraw);

    return () => {
      el.removeEventListener('pointerdown', handlePointerDown);
      el.removeEventListener('pointermove', handlePointerMove);
      el.removeEventListener('pointerup', finishDraw);
      el.removeEventListener('pointercancel', finishDraw);
    };
  }, [containerRef]);
}
