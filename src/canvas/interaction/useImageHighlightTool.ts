import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useViewportStore } from '../../store/viewportStore';
import { useToolStore } from '../../store/toolStore';
import { useObjectsStore } from '../../store/objectsStore';
import { useImageHighlightDraftStore } from '../../store/imageHighlightDraftStore';
import { clientToWorld } from '../../utils/coords';
import {
  resolveHighlightStrokeWidth,
  segmentDistance,
  snapNearHorizontal,
  thicknessRatioFor,
} from '../../objects/image/imageHighlightGeometry';

const MIN_DRAG_PX = 3; // 이미지 로컬 px 기준. 이보다 짧으면 실수로 찍은 클릭으로 보고 무시한다.

/**
 * 요구사항(이미지/PDF 전용 직선 형광펜): OCR 등으로 실제 텍스트가 인식되지 않는
 * 이미지 위에서는 브라우저 네이티브 텍스트 선택(useTextSelectionTools.ts)이 애초에
 * 일어나지 않으므로, 별도로 "드래그 시작점→끝점을 잇는 직선"만 만드는 도구가 필요하다.
 * useDrawShapeTool.ts와 완전히 같은 뼈대(containerRef에 native pointer 리스너, draft
 * store에 진행 중 상태를 담아 실시간 미리보기, pointerup에 한 번만 objectsStore 커밋)를
 * 따르되, 대상이 "캔버스 빈 곳"이 아니라 "Image 객체 위"라는 점만 다르다.
 *
 * ObjectView.tsx가 activeTool==='highlight'인 동안 Image 객체의 useObjectDrag를
 * 스킵해주므로(isImageHighlightMode), 이 훅의 pointerdown이 객체 div에서 멈추지 않고
 * 여기까지 정상적으로 버블링된다(useObjectDrag.onPointerDown의 stopPropagation 참고).
 *
 * 좌표는 항상 "그 이미지 객체의 현재 x/y/width/height 기준 로컬 px"로 다룬다 — 드래그
 * 도중에는 이미지가 리사이즈되지 않으므로 draft에 그대로 저장해도 안전하고, 커밋
 * 시점에만 width/height로 나눠 0~1 비율로 정규화해서 objectsStore에 넘긴다(리사이즈에도
 * 선이 함께 늘어나도록).
 */
export function useImageHighlightTool(containerRef: RefObject<HTMLDivElement | null>) {
  const activeRef = useRef<{ pointerId: number; objectId: string } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const findImageObjectId = (target: HTMLElement): string | null => {
      const objectEl = target.closest<HTMLElement>('[data-object-id]');
      if (!objectEl) return null;
      const objectId = objectEl.dataset.objectId;
      if (!objectId) return null;
      const obj = useObjectsStore.getState().objects[objectId];
      if (!obj || obj.type !== 'image' || obj.locked) return null;
      return objectId;
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (useToolStore.getState().activeTool !== 'highlight') return;
      const objectId = findImageObjectId(e.target as HTMLElement);
      if (!objectId) return;

      const obj = useObjectsStore.getState().objects[objectId];
      if (!obj) return;
      const world = clientToWorld({ x: e.clientX, y: e.clientY }, useViewportStore.getState());
      const local = { x: world.x - obj.x, y: world.y - obj.y };

      activeRef.current = { pointerId: e.pointerId, objectId };
      useImageHighlightDraftStore.getState().setDraft({ objectId, start: local, current: local });
      el.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: PointerEvent) => {
      const active = activeRef.current;
      if (!active || active.pointerId !== e.pointerId) return;
      // 버그 방지: useObjectDrag.ts/useDrawShapeTool.ts와 동일한 이유로, 놓친 pointerup
      // 때문에 캡처가 계속 남아있는 상태를 e.buttons===0으로 감지해 정리한다.
      if (e.buttons === 0) {
        activeRef.current = null;
        useImageHighlightDraftStore.getState().clearDraft();
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
        return;
      }
      const obj = useObjectsStore.getState().objects[active.objectId];
      if (!obj) return;
      const draft = useImageHighlightDraftStore.getState().draft;
      if (!draft) return;
      const world = clientToWorld({ x: e.clientX, y: e.clientY }, useViewportStore.getState());
      // 요구사항: 시작점(draft.start)은 손을 뗄 때까지 절대 바뀌지 않는다 — 드래그
      // 도중 손이 떨려도 갱신되는 건 끝점(current)뿐이라 미리보기가 항상 직선이다.
      const raw = { x: world.x - obj.x, y: world.y - obj.y };
      // 요구사항(형광펜 가이드): 수평에 가까운 각도(5도 이내)로 그으면 완전한 수평선으로
      // 스냅한다 — 그 각도를 벗어나면 원래 좌표를 그대로 써서 자유로운 각도를 유지한다.
      useImageHighlightDraftStore.getState().updateCurrent(snapNearHorizontal(draft.start, raw));
    };

    const finishDraw = (e: PointerEvent) => {
      const active = activeRef.current;
      if (!active || active.pointerId !== e.pointerId) return;
      activeRef.current = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);

      const draft = useImageHighlightDraftStore.getState().draft;
      useImageHighlightDraftStore.getState().clearDraft();
      if (!draft) return;

      const obj = useObjectsStore.getState().objects[draft.objectId];
      if (!obj || obj.type !== 'image') return;

      const length = Math.hypot(draft.current.x - draft.start.x, draft.current.y - draft.start.y);
      if (length < MIN_DRAG_PX) return;

      const { highlightEraserActive, highlightColor, highlightThickness } = useToolStore.getState();

      if (highlightEraserActive) {
        // 요구사항(형광펜 지우개 일관성): 텍스트 형광펜과 마찬가지로, 지우개 모드로
        // 드래그한 구간과 겹치는 기존 직선만 지운다 — 다른 하이라이트/이미지 자체는
        // 그대로 둔다. 임계값은 지금 그리려는 굵기가 아니라 "그 하이라이트 자신의
        // 굵기"를 써야 한다 — 하이라이트마다 굵기가 다를 수 있어서(요구사항: 굵기 조절).
        const toRemove = (obj.highlights ?? [])
          .filter(
            (h) =>
              segmentDistance(
                draft.start,
                draft.current,
                { x: h.x1 * obj.width, y: h.y1 * obj.height },
                { x: h.x2 * obj.width, y: h.y2 * obj.height },
              ) <= resolveHighlightStrokeWidth(h.thicknessRatio, obj.width, obj.height),
          )
          .map((h) => h.id);
        if (toRemove.length > 0) useObjectsStore.getState().removeImageHighlights(draft.objectId, toRemove);
        return;
      }

      // 요구사항(형광펜 굵기 조절/리사이즈 스케일링): 사이드바에서 고른 굵기(px, 지금
      // 이 이미지 크기 기준)를 비율로 바꿔 저장한다 — 나중에 이미지를 리사이즈해도
      // resolveHighlightStrokeWidth가 이 비율로 그때그때의 실제 굵기를 다시 계산한다.
      useObjectsStore
        .getState()
        .addImageHighlight(
          draft.objectId,
          draft.start.x / obj.width,
          draft.start.y / obj.height,
          draft.current.x / obj.width,
          draft.current.y / obj.height,
          highlightColor,
          thicknessRatioFor(highlightThickness, obj.width, obj.height),
        );
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
