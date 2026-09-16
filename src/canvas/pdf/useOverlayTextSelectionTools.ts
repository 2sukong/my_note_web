import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useToolStore } from '../../store/toolStore';
import { usePdfOverlayStore } from '../../store/pdfOverlayStore';
import { captureSelectionSegments, clearNativeSelection } from '../../objects/text/selectionCapture';

/**
 * PDF 오버레이 위 형광펜 도구(Phase 6) — canvas/interaction/useTextSelectionTools.ts의
 * pointerup-커밋 뼈대를 그대로 따르되, v1 스코프 축소로 실시간 드래그 미리보기
 * (highlightDragStore/HighlightDragPreview.tsx)는 옮기지 않았다 — 드래그 도중에는
 * 브라우저 네이티브 파란 선택 음영이 그대로 보이다가, 손을 떼는 순간(pointerup)에만
 * 실제 하이라이트가 생긴다. captureSelectionSegments()는 document 전역에서
 * [data-line-id]를 찾는 순수 함수라(§ 파일 상단 주석) 메인 캔버스 쪽과 완전히 동일하게
 * 재사용할 수 있다 — PdfOverlayTextView.tsx가 같은 data-* 속성 규약을 그대로 따르기
 * 때문이다.
 *
 * 요구사항(2026-09-16, "PDF에서 주석 사용 기능 삭제"): 원래 이 훅은 형광펜과 주석
 * (annotation) 도구를 함께 처리했었다(그래서 이름이 SelectionTools) — 버그가 많다는
 * 피드백으로 주석 생성 분기를 완전히 없앴다. 아래 handlePointerUp의 주석 참고.
 *
 * toolStore(활성 도구/색 기본값)는 메인 캔버스와 완전히 같은 전역 store를 공유한다
 * (v3 §2-7: "PDF 오버레이 필기는 기존 Toolbar/toolStore를 그대로 재사용하고 PDF 전용
 * 툴바를 새로 만들지 않는다"는 확정 요구사항).
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
      const { activeTool, highlightColor, highlightEraserActive } = useToolStore.getState();
      // 요구사항(2026-09-16, "PDF에서 주석 사용 기능 삭제"): 버그가 많다는 사용자
      // 피드백으로 PDF 오버레이의 주석(annotation) 생성 기능 자체를 없앴다 — 예전엔
      // 여기서 activeTool==='annotation'일 때 addAnnotation을 호출하고, activeTool===
      // 'highlight'일 때도 "Annotation 자기 자신의 텍스트" 위 형광펜(captureAnnotationSelection)을
      // 먼저 처리했었다. 이제 이 도구가 반응하는 건 본문 줄 형광펜(아래 highlight
      // 분기)뿐이다 — activeTool이 'annotation'이면 이 리스너는 그냥 아무 것도 하지
      // 않는다(메인 캔버스의 주석 기능 자체는 그대로 남아있다 — 삭제 대상은 PDF
      // 오버레이 한정). 남은 데이터 모델(TextLine.annotations, pdfOverlayStore.ts의
      // addAnnotation류 액션)은 일부러 건드리지 않았다 — 메인 캔버스와 타입을 공유하고
      // 있고, 텍스트 편집(줄 분할/병합) 로직이 그 필드를 계속 참조하므로 지우면 오히려
      // 기존에 저장된 PDF 파일의 데이터가 깨질 위험이 있다. 대신 렌더링(아래
      // PdfOverlayTextView.tsx의 PdfOverlayAnnotationNote 호출 제거)과 생성 진입점만
      // 막아서, 사용자 눈에는 기능이 완전히 사라진 것처럼 보이게 했다.
      if (activeTool === 'select' || activeTool === 'text' || activeTool === 'annotation') return;

      const segments = captureSelectionSegments();

      if (activeTool === 'highlight') {
        if (segments.length === 0) return;
        if (highlightEraserActive) {
          usePdfOverlayStore.getState().eraseHighlightSegments(segments);
        } else {
          usePdfOverlayStore.getState().addHighlightSegments(segments, highlightColor);
        }
        clearNativeSelection();
      }
    };

    el.addEventListener('pointerup', handlePointerUp);
    return () => {
      el.removeEventListener('pointerup', handlePointerUp);
    };
  }, [containerRef, pageWidth, pageHeight]);
}
