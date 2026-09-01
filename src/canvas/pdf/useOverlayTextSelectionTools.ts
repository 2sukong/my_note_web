import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useToolStore } from '../../store/toolStore';
import { usePdfOverlayStore } from '../../store/pdfOverlayStore';
import { usePdfOverlaySelectionStore } from '../../store/pdfOverlaySelectionStore';
import { captureAnnotationSelection, captureSelectionSegments, clearNativeSelection } from '../../objects/text/selectionCapture';

/**
 * PDF 오버레이 위 형광펜/주석 도구(Phase 6) — canvas/interaction/useTextSelectionTools.ts의
 * pointerup-커밋 뼈대를 그대로 따르되, v1 스코프 축소로 실시간 드래그 미리보기
 * (highlightDragStore/HighlightDragPreview.tsx)는 옮기지 않았다 — 드래그 도중에는
 * 브라우저 네이티브 파란 선택 음영이 그대로 보이다가, 손을 떼는 순간(pointerup)에만
 * 실제 하이라이트/주석이 생긴다. captureSelectionSegments()/captureAnnotationSelection()은
 * document 전역에서 [data-line-id]/[data-annotation-id]를 찾는 순수 함수라(§ 파일 상단
 * 주석) 메인 캔버스 쪽과 완전히 동일하게 재사용할 수 있다 — PdfOverlayTextView.tsx/
 * PdfOverlayAnnotationNote.tsx가 같은 data-* 속성 규약을 그대로 따르기 때문이다.
 *
 * toolStore(활성 도구/색/폰트 기본값)는 메인 캔버스와 완전히 같은 전역 store를
 * 공유한다(v3 §2-7: "PDF 오버레이 필기는 기존 Toolbar/toolStore를 그대로 재사용하고
 * PDF 전용 툴바를 새로 만들지 않는다"는 확정 요구사항) — 여기서 새로 만들 값은
 * usePdfOverlaySelectionStore(어떤 객체가 선택/편집 중인지)뿐이다.
 *
 * 버그 수정(2026-08, 형광펜/주석이 전혀 안 만들어지던 문제): pageWidth/pageHeight를
 * 이 훅의 좌표 계산에는 안 쓰지만(네이티브 selection 기반이라 픽셀 변환이 필요 없다),
 * effect의 재실행 트리거로는 필요하다 — containerRef(pageRef)는 REF 객체 자체라
 * 절대 참조가 바뀌지 않으므로, deps가 [containerRef]뿐이면 effect가 "딱 한 번",
 * 그것도 PdfViewerPanel의 첫 렌더(=stagePage가 아직 null이라 pageRef.current가 아직
 * null인 시점)에만 실행되고 다시는 실행되지 않는다 — 즉 리스너가 한 번도 실제로
 * 붙지 못한 채로 있었다. useOverlayHighlightTool.ts/useDrawOverlayTextTool.ts처럼
 * pageWidth/pageHeight를 deps에 넣어서, 페이지 래스터가 로딩된 뒤(stagePage 설정 →
 * pageRef.current가 채워진 뒤) effect가 다시 돌아 정상적으로 리스너가 붙게 한다.
 */
export function useOverlayTextSelectionTools(
  containerRef: RefObject<HTMLDivElement | null>,
  pageWidth: number,
  pageHeight: number,
) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el || pageWidth <= 0 || pageHeight <= 0) return;

    const handlePointerUp = () => {
      const { activeTool, highlightColor, highlightEraserActive, annotationColor, annotationFontFamily, annotationFontSize } =
        useToolStore.getState();
      if (activeTool === 'select' || activeTool === 'text') return;

      // 형광펜 도구는 "본문 줄" 선택인지 "Annotation 자기 자신의 텍스트" 선택인지 먼저
      // 구분한다 — captureSelectionSegments()가 항상 빈 배열을 주는 경우(Annotation의
      // contentEditable div는 data-line-id가 없음)라서 이 분기를 먼저 둬야 한다.
      if (activeTool === 'highlight') {
        const annotationSeg = captureAnnotationSelection();
        if (annotationSeg) {
          if (highlightEraserActive) {
            usePdfOverlayStore
              .getState()
              .eraseAnnotationHighlightRange(
                annotationSeg.objectId,
                annotationSeg.lineId,
                annotationSeg.annotationId,
                annotationSeg.start,
                annotationSeg.end,
              );
          } else {
            usePdfOverlayStore
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
          usePdfOverlayStore.getState().eraseHighlightSegments(segments);
        } else {
          usePdfOverlayStore.getState().addHighlightSegments(segments, highlightColor);
        }
        clearNativeSelection();
        return;
      }

      if (activeTool === 'annotation') {
        // 여러 줄에 걸쳐 드래그해도 anchor는 첫 세그먼트 하나로 삼는다(메인 캔버스와
        // 동일한 관례 — 짧은 메모라는 성격상 여러 줄 앵커는 다루지 않는다).
        const anchor = segments[0];
        const targetObject = usePdfOverlayStore.getState().objects[anchor.objectId];
        if (!targetObject || targetObject.type !== 'text') return;

        const annotationId = usePdfOverlayStore
          .getState()
          .addAnnotation(anchor.objectId, anchor.lineId, anchor.start, anchor.end, annotationColor, annotationFontFamily, annotationFontSize);

        clearNativeSelection();
        // 메인 캔버스는 interactionStore.selectFine + setMode('text-edit')로 처리하지만,
        // 오버레이는 그 상태 머신이 없다 — 대신 부모 Text 상자를 선택 상태로 표시하고
        // (텍스트 자체를 편집 모드로 만들지는 않는다, 방금 만든 주석 입력창에 곧바로
        // 포커스가 가므로 그걸로 충분), 새로 만든 주석에 포커스 요청 신호만 보낸다 —
        // PdfOverlayAnnotationNote.tsx가 이 신호를 보고 자기 자신에 focus+커서를 준다.
        usePdfOverlaySelectionStore.getState().select(anchor.objectId);
        usePdfOverlaySelectionStore.getState().requestAnnotationFocus(annotationId);
      }
    };

    el.addEventListener('pointerup', handlePointerUp);
    return () => {
      el.removeEventListener('pointerup', handlePointerUp);
    };
  }, [containerRef, pageWidth, pageHeight]);
}
