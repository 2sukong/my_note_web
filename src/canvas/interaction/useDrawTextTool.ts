import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useViewportStore } from '../../store/viewportStore';
import { useToolStore } from '../../store/toolStore';
import { useTextDrawDraftStore } from '../../store/textDrawDraftStore';
import { useObjectsStore } from '../../store/objectsStore';
import { useAlignmentGuideStore } from '../../store/alignmentGuideStore';
import { clientToWorld } from '../../utils/coords';
import { computeFreeCornerSnap } from '../../objects/align/smartGuides';
import type { GuideTarget } from '../../objects/align/smartGuides';
import { objectsInAlignmentScope } from '../../objects/align/frameScope';
import { spawnTextFromDraft, findFrameAt } from '../actions';

const SNAP_THRESHOLD_PX = 6; // screen px 기준. 정렬 가이드(smartGuides.ts)가 반응하는 민감도.

/**
 * 요구사항(텍스트 상자 생성 경로 통합, 2차): '텍스트' 도구가 활성화된 동안 캔버스
 * 빈 곳(또는 Frame의 빈 표면)을 드래그하면 그 사각형 크기로 Text 상자가 생긴다 —
 * useDrawShapeTool.ts(화살표/사각형)와 정확히 같은 구조를 텍스트 전용으로 그대로
 * 옮겼다. 화살표/사각형 쪽 코드를 전혀 건드리지 않기 위해 별도 훅/스토어
 * (textDrawDraftStore.ts)로 분리했다.
 *
 * pointerdown 시점에는 objectsStore에 아무것도 추가하지 않는다 — textDrawDraftStore에만
 * draft를 기록하고, canvas/DrawPreview.tsx가 그 draft를 구독해 미리보기를 그린다.
 * 실제 객체는 pointerup에서 spawnTextFromDraft로 한 번에 확정된다(너무 짧은 드래그는
 * 그 함수 안에서 무시됨). 확정 후에는 항상 'select' 도구로 되돌아간다.
 */
export function useDrawTextTool(containerRef: RefObject<HTMLDivElement | null>) {
  const activeRef = useRef<{ pointerId: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      // 빈 캔버스 배경 또는 Frame의 빈 표면(data-shape-drawable) 위에서만 시작한다
      // (useDrawShapeTool.ts와 동일한 규칙).
      const target = e.target as HTMLElement;
      if (target !== el && target.dataset.shapeDrawable !== 'true') return;
      if (useToolStore.getState().activeTool !== 'text') return;

      const world = clientToWorld({ x: e.clientX, y: e.clientY }, useViewportStore.getState());
      activeRef.current = { pointerId: e.pointerId };
      useTextDrawDraftStore.getState().setDraft({ start: world, current: world });
      el.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: PointerEvent) => {
      const active = activeRef.current;
      if (!active || active.pointerId !== e.pointerId) return;
      // 버그 수정: useObjectDrag.ts와 동일한 이유로, 놓친 pointerup 때문에 캔버스가
      // pointer capture를 계속 들고 있는 상태를 e.buttons===0으로 감지해 정리한다.
      if (e.buttons === 0) {
        activeRef.current = null;
        useTextDrawDraftStore.getState().clearDraft();
        useAlignmentGuideStore.getState().clear();
        if (el.hasPointerCapture(e.pointerId)) {
          el.releasePointerCapture(e.pointerId);
        }
        return;
      }
      const draftBefore = useTextDrawDraftStore.getState().draft;
      if (!draftBefore) return;
      const viewport = useViewportStore.getState();
      const world = clientToWorld({ x: e.clientX, y: e.clientY }, viewport);

      // 요구사항(정렬 가이드): useDrawShapeTool.ts와 동일한 이유로 시작점은 고정한 채
      // 끝점만 다른 객체와의 정렬/같은 크기/정사각형 스냅 대상이다. 요구사항(같은
      // 프레임 안에서만): 시작점이 속한 Frame과 같은 범위의 객체만 비교한다 —
      // spawnTextFromDraft가 실제로 부여할 frameId와 같은 기준(findFrameAt).
      const scope = findFrameAt(draftBefore.start.x, draftBefore.start.y);
      const candidates = objectsInAlignmentScope(Object.values(useObjectsStore.getState().objects), scope);
      const others: GuideTarget[] = candidates.map((o) => ({ id: o.id, x: o.x, y: o.y, width: o.width, height: o.height }));
      const threshold = SNAP_THRESHOLD_PX / viewport.zoom;
      const snap = computeFreeCornerSnap(draftBefore.start, world, others, threshold, true, true);
      useAlignmentGuideStore.getState().setLines(snap.lines);
      useTextDrawDraftStore.getState().updateCurrent({ x: snap.x, y: snap.y });
    };

    const finishDraw = (e: PointerEvent) => {
      const active = activeRef.current;
      if (!active || active.pointerId !== e.pointerId) return;
      activeRef.current = null;
      if (el.hasPointerCapture(e.pointerId)) {
        el.releasePointerCapture(e.pointerId);
      }
      useAlignmentGuideStore.getState().clear();

      const draft = useTextDrawDraftStore.getState().draft;
      useTextDrawDraftStore.getState().clearDraft();
      if (!draft) return;

      // 시작점 기준으로 Frame 소속을 정한다(화살표/사각형과 동일한 규칙 —
      // canvas/actions.ts의 findFrameAt 참고). Frame이 이동하면 이 Text도 같이 따라간다.
      const frameId = findFrameAt(draft.start.x, draft.start.y);
      spawnTextFromDraft(draft.start, draft.current, frameId);
      useToolStore.getState().setTool('select');
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
