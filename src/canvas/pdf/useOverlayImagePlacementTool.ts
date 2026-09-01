import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useToolStore } from '../../store/toolStore';
import { usePdfOverlayImagePickerStore } from '../../store/pdfOverlayImagePickerStore';

/**
 * PDF 오버레이의 '이미지' 도구(Phase 6, 2026-08) — canvas/Canvas.tsx의
 * handleBackgroundClick 중 '이미지' 도구 분기와 같은 원리다: 빈 배경을 클릭하면 그
 * 자리를 usePdfOverlayImagePickerStore에 잠깐 저장해두고 파일 선택 대화상자를 연다
 * (실제 input[type=file] 엘리먼트와 파일 선택 이후 spawnOverlayImageAt 호출은
 * PdfViewerPanel.tsx가 직접 담당한다 — Canvas.tsx의 fileInputRef/handleFileInputChange와
 * 같은 이유: DOM 엘리먼트/ref가 필요한 부분이라 훅으로 분리하기보다 컴포넌트에 그대로
 * 둔다).
 *
 * useDrawOverlayTextTool.ts와 같은 "빈 배경 클릭"(target===el) 판정을 쓴다 — 이미 있는
 * 텍스트/도형/이미지 객체 위 클릭은 그 자식 엘리먼트가 target이 되므로 여기서 무시된다.
 * '선택' 도구로 배경을 클릭했을 때의 선택 해제는 useDrawOverlayTextTool.ts가 이미
 * 처리하므로(같은 click 이벤트에 리스너가 여러 개 붙어도 서로 독립적으로 동작) 여기서
 * 중복으로 다루지 않는다.
 */
export function useOverlayImagePlacementTool(
  containerRef: RefObject<HTMLDivElement | null>,
  pageWidth: number,
  pageHeight: number,
) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el || pageWidth <= 0 || pageHeight <= 0) return;

    const handleClick = (e: MouseEvent) => {
      if (e.target !== el) return;
      if (useToolStore.getState().activeTool !== 'image') return;

      const rect = el.getBoundingClientRect();
      const localX = ((e.clientX - rect.left) / rect.width) * pageWidth;
      const localY = ((e.clientY - rect.top) / rect.height) * pageHeight;

      usePdfOverlayImagePickerStore.getState().requestPicker(localX, localY);
      useToolStore.getState().setTool('select');
    };

    el.addEventListener('click', handleClick);
    return () => {
      el.removeEventListener('click', handleClick);
    };
  }, [containerRef, pageWidth, pageHeight]);
}
