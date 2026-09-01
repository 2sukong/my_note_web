import { useEffect } from 'react';
import type { RefObject } from 'react';
import { createPlainLine } from '../../objects/text/indentation/types';
import type { TextObject } from '../../types/object';
import { useToolStore } from '../../store/toolStore';
import { usePdfOverlayStore } from '../../store/pdfOverlayStore';
import { usePdfOverlaySelectionStore } from '../../store/pdfOverlaySelectionStore';

const DEFAULT_TEXT_WIDTH = 220; // 페이지 로컬 px(PDF_PAGE_REFERENCE_SCALE 기준) — canvas/actions.ts의
const DEFAULT_TEXT_HEIGHT = 60; // 같은 이름 상수와 같은 값. 오버레이는 world 좌표가 아니라 페이지 로컬
// px를 쓰지만, PDF_PAGE_REFERENCE_SCALE이 대략 메인 캔버스의 zoom=1과 비슷한 스케일이라
// 그대로 재사용해도 자연스러운 초기 크기가 나온다.

/**
 * PDF 오버레이의 '텍스트' 도구(Phase 6, 2026-08). 메인 캔버스의
 * canvas/interaction/useDrawTextTool.ts는 드래그해서 크기를 정하는 방식이지만,
 * 여기서는 v1 스코프 축소(요약 문서 참고: 실시간 브라우저 테스트가 불가능한 환경에서
 * 드래그 미리보기 인프라(textDrawDraftStore 포크 + DrawPreview 포크)를 새로 만드는
 * 비용 대비 가치가 낮다고 판단)로 "클릭 한 번 = 고정 크기로 즉시 생성 + 편집 진입"만
 * 지원한다 — spawnTextAt(드래그 없이 클릭만으로 만들 때 쓰는 경로)과 같은 관례다.
 *
 * useOverlayHighlightTool.ts와 같은 좌표 환산(containerRef의 실제 화면 표시 크기 대비
 * pageWidth/pageHeight 비로 클라이언트 px → 페이지 로컬 px)을 쓴다. 빈 배경(컨테이너
 * 자신, `.pdf-viewer-page` div)을 클릭했을 때만 반응한다 — 이미 있는 텍스트 상자나
 * 주석 위 클릭은 그 자식 엘리먼트가 target이 되므로 여기서 무시되고, 대신
 * PdfOverlayTextView.tsx 자신의 pointerdown/더블클릭 핸들러가 처리한다.
 */
export function useDrawOverlayTextTool(
  containerRef: RefObject<HTMLDivElement | null>,
  pageWidth: number,
  pageHeight: number,
) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el || pageWidth <= 0 || pageHeight <= 0) return;

    // 버그 수정(2026-09, 사각형/화살표를 그린 직후 바로 선택 해제되던 문제): 원래
    // 이 배경 클릭 판정을 native 'click' 이벤트에 얹었는데, click은 pointerup보다
    // 나중에 발생한다 — useDrawOverlayShapeTool.ts는 드래그가 끝나는 pointerup에서
    // 새 도형을 select()하고 activeTool을 'select'로 바꾸므로, 뒤이어 오는 이 'click'
    // 이벤트가 발생할 시점엔 이미 activeTool==='select'가 된 뒤라 아래 "select 도구로
    // 빈 배경 클릭 시 deselect" 분기가 즉시 실행돼 방금 만든 도형의 선택을 지워버렸다.
    // 메인 캔버스(Canvas.tsx의 handleBackgroundPointerDown)는 이 판정을 pointerdown
    // 시점에 하기 때문에(아직 activeTool이 그리기 도구인 채로 걸러짐 → 드래그 종료 후
    // 선택이 나중에 이뤄져도 안 지워짐) 이런 문제가 없다 — 여기도 같은 시점(pointerdown)
    // 으로 옮겨서 맞춘다.
    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (e.target !== el) return;

      // 요구사항(빈 배경 클릭으로 선택 해제): 'select' 도구로 빈 배경을 누르면 지금
      // 선택된 오버레이 객체가 있어도 선택을 지운다 — 메인 캔버스의 "빈 곳 클릭 시
      // deselect" 관례와 같다. 이 훅이 이미 "배경 자체(target===el)를 눌렀는지"를
      // 판별하고 있어서 별도 훅을 새로 만들지 않고 여기 얹었다.
      if (useToolStore.getState().activeTool === 'select') {
        usePdfOverlaySelectionStore.getState().select(null);
        return;
      }
      if (useToolStore.getState().activeTool !== 'text') return;

      const rect = el.getBoundingClientRect();
      const localX = ((e.clientX - rect.left) / rect.width) * pageWidth;
      const localY = ((e.clientY - rect.top) / rect.height) * pageHeight;

      const { textColor, textFontFamily, textFontSize, textBold, textBorderEnabled, textLineHeight } =
        useToolStore.getState();
      const t = Date.now();
      const id = crypto.randomUUID();
      const obj: TextObject = {
        id,
        type: 'text',
        x: localX,
        y: localY,
        width: DEFAULT_TEXT_WIDTH,
        height: DEFAULT_TEXT_HEIGHT,
        rotation: 0,
        zIndex: usePdfOverlayStore.getState().nextZIndex(),
        createdAt: t,
        updatedAt: t,
        lines: [createPlainLine('')],
        baseFontSize: textFontSize,
        color: textColor,
        fontFamily: textFontFamily,
        bold: textBold,
        borderEnabled: textBorderEnabled,
        lineHeight: textLineHeight,
        frameId: null,
      };
      usePdfOverlayStore.getState().addObject(obj);
      usePdfOverlaySelectionStore.getState().startEditing(id);
      useToolStore.getState().setTool('select');
    };

    // 텍스트 도구는 드래그로 크기를 정하지 않고 "누르는 즉시" 고정 크기로 생성한다(v1
    // 스코프 축소, 위 문서 주석 참고) — 그래서 pointerdown 시점에 바로 만들어도 클릭과
    // 체감상 다르지 않다. 이 요소 위에서 시작해 다른 곳으로 드래그해서 손을 떼는
    // 경우까지 막을 필요가 있는 별도 그리기 제스처가 텍스트 도구엔 없다(형광펜/사각형/
    // 화살표처럼 이 컨테이너에서 시작하는 경쟁 드래그가 없음).
    el.addEventListener('pointerdown', handlePointerDown);
    return () => {
      el.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [containerRef, pageWidth, pageHeight]);
}
