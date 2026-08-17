import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useToolStore } from '../../store/toolStore';
import { useObjectsStore } from '../../store/objectsStore';
import { useInteractionStore } from '../../store/interactionStore';
import { useHighlightDragStore } from '../../store/highlightDragStore';
import { captureAnnotationSelection, captureSelectionSegments, clearNativeSelection } from '../../objects/text/selectionCapture';

/** 요구사항(형광펜 실시간 드래그): 드래그 중 브라우저 네이티브 파란 선택 음영을
 * 숨기는 CSS 클래스 — Canvas.css에 `.highlight-dragging ::selection`으로 정의됨.
 * 실제 색은 이 클래스가 켜져 있는 동안 HighlightDragPreview.tsx가 대신 그린다. */
const HIDE_NATIVE_SELECTION_CLASS = 'highlight-dragging';

/**
 * Phase 4: activeTool이 'highlight' 또는 'annotation'일 때, 사용자가 텍스트를
 * 드래그해서 만든 selection이 끝나는 시점(pointerup)에 하이라이트/주석을 만든다.
 *
 * 이 훅은 캔버스 루트에 pointerup 리스너 하나만 추가한다 — 기존 pointerdown 기반
 * object drag(useObjectDrag)나 pan(usePan) 로직은 전혀 건드리지 않는다.
 * activeTool === 'select'(기본값)일 때는 즉시 리턴하므로 Phase 1~3 동작에 영향이 없다.
 *
 * Phase 4(2차): Annotation도 Highlight와 마찬가지로 더 이상 독립 CanvasObject가
 * 아니라 대상 줄(TextLine)에 anchor(start/end)와 함께 종속되는 데이터다. 그래서
 * "새 박스를 world 좌표에 만드는" 대신 objectsStore.addAnnotation으로 그 줄에
 * 데이터만 추가하고, 실제 화면 위치(말풍선/화살표)는 TextObjectView가 anchor를
 * 기준으로 매번 다시 계산해서 그린다.
 *
 * 요구사항(형광펜 실시간 드래그): 형광펜 도구는 이제 pointerup 한 번에 커밋하는 것
 * 외에, 드래그 도중(pointerdown~pointerup 사이) 매 selectionchange마다
 * highlightDragStore에 "지금까지 선택된 구간"을 실시간으로 기록한다 —
 * captureSelectionSegments()는 순수하게 "현재 네이티브 selection"을 읽어오는
 * 함수라서(Phase 4 그대로 재사용) 드래그 도중 오른쪽→왼쪽으로 되돌아가면 브라우저의
 * Selection 객체 자체가 이미 줄어들어 있고, 그걸 다시 읽으면 자동으로 더 짧은
 * 구간이 나온다 — 그래서 "되돌아온 부분이 지워지는" 동작을 위해 별도 로직이
 * 필요 없다. 실제 objectsStore 커밋(addHighlightSegments)은 여전히 pointerup에서
 * 딱 한 번만 일어난다(기존 로직 그대로) — 드래그 중 store를 반복해서 건드리지
 * 않기 위함이다. Annotation 자기 자신의 텍스트 위 형광펜(captureAnnotationSelection
 * 분기)은 이번 요구사항 범위 밖이라 건드리지 않았다 — 여전히 pointerup에만 반응한다.
 */
export function useTextSelectionTools(containerRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let highlightDragging = false;

    const stopHighlightDragPreview = () => {
      highlightDragging = false;
      useHighlightDragStore.getState().clear();
      document.body.classList.remove(HIDE_NATIVE_SELECTION_CLASS);
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (useToolStore.getState().activeTool !== 'highlight') return;
      highlightDragging = true;
      useHighlightDragStore.getState().clear(); // 이전 드래그의 잔여 프리뷰 제거
      document.body.classList.add(HIDE_NATIVE_SELECTION_CLASS);
    };

    // selectionchange는 document 전역 이벤트라서(브라우저 selection API 자체가 전역
    // 단일 객체다), 캔버스 밖 다른 곳에서 일어나는 selection 변화까지 반응하지
    // 않도록 highlightDragging 플래그로 반드시 게이팅해야 한다.
    //
    // 요구사항(주석 자기 자신의 텍스트도 본문과 동일하게 실시간 미리보기): 이전엔
    // captureSelectionSegments()(본문 줄 전용, data-line-id 기준)만 불러서 Annotation
    // 안쪽 드래그는 항상 빈 배열 → 미리보기 없음이었다. pointerup의 커밋 로직과 같은
    // 순서로 captureAnnotationSelection()을 먼저 시도하고(Annotation의 contentEditable
    // div는 data-line-id가 없어 captureSelectionSegments와 절대 겹치지 않는다), 아니면
    // 본문 segments로 대체한다.
    const handleSelectionChange = () => {
      if (!highlightDragging) return;
      if (useToolStore.getState().activeTool !== 'highlight') return;
      const annotationSeg = captureAnnotationSelection();
      if (annotationSeg) {
        useHighlightDragStore.getState().setAnnotationSegment(annotationSeg);
        return;
      }
      useHighlightDragStore.getState().setSegments(captureSelectionSegments());
    };

    const handlePointerUp = () => {
      if (highlightDragging) stopHighlightDragPreview();

      const { activeTool, highlightColor, highlightEraserActive, annotationColor, annotationFontFamily, annotationFontSize } =
        useToolStore.getState();
      if (activeTool === 'select') return;

      // 형광펜 도구일 때는 "본문 줄" 선택인지 "Annotation 자기 자신의 텍스트" 선택인지
      // 먼저 구분한다. Annotation의 contentEditable div는 data-line-id가 없으므로
      // captureSelectionSegments()는 이 경우 항상 빈 배열을 준다 — 그래서 이 분기를
      // segments 검사보다 먼저 둬야 한다(순서를 바꾸면 segments.length===0에서 그냥
      // return 해버려서 주석 안쪽 형광펜이 절대 동작하지 않는다).
      if (activeTool === 'highlight') {
        const annotationSeg = captureAnnotationSelection();
        if (annotationSeg) {
          // 요구사항(형광펜 지우개): 지우개 모드면 칠하는 대신 겹치는 하이라이트만
          // 지운다 — annotation.text 자체는 건드리지 않는다.
          if (highlightEraserActive) {
            useObjectsStore
              .getState()
              .eraseAnnotationHighlightRange(
                annotationSeg.objectId,
                annotationSeg.lineId,
                annotationSeg.annotationId,
                annotationSeg.start,
                annotationSeg.end,
              );
          } else {
            useObjectsStore
              .getState()
              .addAnnotationHighlight(
                annotationSeg.objectId,
                annotationSeg.lineId,
                annotationSeg.annotationId,
                annotationSeg.start,
                annotationSeg.end,
                highlightColor,
              );
          }
          clearNativeSelection();
          return;
        }
      }

      const segments = captureSelectionSegments();
      if (segments.length === 0) return;

      if (activeTool === 'highlight') {
        if (highlightEraserActive) {
          useObjectsStore.getState().eraseHighlightSegments(segments);
        } else {
          useObjectsStore.getState().addHighlightSegments(segments, highlightColor);
        }
        clearNativeSelection();
        return;
      }

      if (activeTool === 'annotation') {
        // 여러 줄에 걸쳐 드래그해도 anchor는 첫 세그먼트(선택을 시작한 지점) 하나로 삼는다 —
        // 주석 하나가 여러 줄에 걸쳐 있는 경우는 다루지 않는다(짧은 메모라는 성격상
        // 그 편이 자연스럽다).
        const anchor = segments[0];
        const targetObject = useObjectsStore.getState().objects[anchor.objectId];
        if (!targetObject || targetObject.type !== 'text') return;

        const annotationId = useObjectsStore
          .getState()
          .addAnnotation(
            anchor.objectId,
            anchor.lineId,
            anchor.start,
            anchor.end,
            annotationColor,
            annotationFontFamily,
            annotationFontSize,
          );

        clearNativeSelection();
        useInteractionStore
          .getState()
          .selectFine({ kind: 'annotation', objectId: anchor.objectId, lineId: anchor.lineId, id: annotationId });
        useInteractionStore.getState().setMode('text-edit');
      }
    };

    // pointercancel은 커밋 없이 프리뷰/CSS만 정리한다(제스처가 정상적으로 끝난 게
    // 아니므로 굳이 하이라이트를 확정하지 않는다) — 새로 추가된 정리 전용 경로라
    // 기존 handlePointerUp의 커밋 로직과는 분리했다.
    const handlePointerCancel = () => {
      if (highlightDragging) stopHighlightDragPreview();
    };

    el.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('selectionchange', handleSelectionChange);
    el.addEventListener('pointerup', handlePointerUp);
    el.addEventListener('pointercancel', handlePointerCancel);
    return () => {
      el.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('selectionchange', handleSelectionChange);
      el.removeEventListener('pointerup', handlePointerUp);
      el.removeEventListener('pointercancel', handlePointerCancel);
      // 언마운트 시점에 드래그가 진행 중이었다면 전역 CSS 클래스가 남지 않도록 정리한다.
      document.body.classList.remove(HIDE_NATIVE_SELECTION_CLASS);
    };
  }, [containerRef]);
}
