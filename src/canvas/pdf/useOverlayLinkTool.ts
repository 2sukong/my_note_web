import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useToolStore } from '../../store/toolStore';
import { usePdfViewerStore } from '../../store/pdfViewerStore';
import { usePdfLibraryStore } from '../../store/pdfLibraryStore';
import { usePdfOverlayStore } from '../../store/pdfOverlayStore';
import { useLinkDraftStore } from '../../store/linkDraftStore';
import { useLinkStore } from '../../store/linkStore';
import type { LinkAnchor } from '../../types/link';

/**
 * 🔗(링크) 도구 — PDF 오버레이 쪽(Phase 9). canvas/interaction/useLinkTool.ts의
 * "우클릭 두 번" 뼈대를 그대로 따르되, PDF 쪽은 canvas/pdf/useDrawOverlayShapeTool.ts와
 * 같은 이유로 data-object-id 같은 DOM 마커가 없어(PdfOverlayObjectsLayer.tsx 주석
 * 참고) 좌표 기반 기하 히트테스트로 "이 우클릭이 어떤 오버레이 객체 위인지"를 직접
 * 계산한다 — 겹치는 객체가 있으면 zIndex가 가장 큰(가장 위에 그려진) 것을 고른다.
 *
 * 요구사항 변경(2026-09-15, 좌클릭→우클릭): canvas/interaction/useLinkTool.ts와
 * 동일한 이유 — Space+좌클릭 드래그로 페이지 위치를 먼저 옮긴(pan) 뒤에 링크를
 * 놓아야 하는 경우가 있는데, 좌클릭 트리거였을 때는 그 pan 제스처의 mouseup에서
 * click이 같이 발생해 의도치 않게 anchor가 찍혔다. 우클릭은 pan 트리거(좌클릭/
 * 중클릭)와 겹치지 않으므로 이 문제가 생기지 않는다.
 *
 * 'select' 도구가 아닐 때는 PdfOverlayTextView.tsx/PdfOverlayShapeView.tsx/
 * PdfOverlayImageView.tsx 자신의 pointerdown 핸들러가 이미 아무 것도 하지 않고 그대로
 * 넘겨주므로(각자의 `activeTool !== 'select'` 가드), 이 훅이 컨테이너(페이지 엘리먼트)
 * 레벨에서 받는 우클릭에 별도 stopPropagation 대응이 필요 없다 —
 * useDrawOverlayShapeTool.ts와 동일한 전제. PDF 오버레이 객체들은(메인 캔버스의
 * ObjectView.tsx와 달리) 자기 자신의 onContextMenu 핸들러가 없으므로(v1 범위 —
 * "우클릭 쌓임 순서 메뉴"는 메인 캔버스 전용) 여기서 별도로 막을 것도 없다.
 *
 * linkDraftStore를 canvas/interaction/useLinkTool.ts와 공유해서, 메인 캔버스와 PDF
 * 사이를 잇는 링크(Page↔PDF)도 이 두 훅만으로 자연스럽게 만들어진다.
 */
export function useOverlayLinkTool(containerRef: RefObject<HTMLDivElement | null>, pageWidth: number, pageHeight: number) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el || pageWidth <= 0 || pageHeight <= 0) return;

    const toLocal = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * pageWidth,
        y: ((e.clientY - rect.top) / rect.height) * pageHeight,
      };
    };

    /** 이 페이지-로컬 좌표 아래 오버레이 객체가 있으면 그 id를, 없으면 null을 반환한다. */
    const hitTestObjectId = (local: { x: number; y: number }): string | null => {
      const objects = usePdfOverlayStore.getState().objects;
      let best: { id: string; zIndex: number } | null = null;
      for (const obj of Object.values(objects)) {
        if (local.x < obj.x || local.x > obj.x + obj.width || local.y < obj.y || local.y > obj.y + obj.height) continue;
        if (!best || obj.zIndex > best.zIndex) best = { id: obj.id, zIndex: obj.zIndex };
      }
      return best?.id ?? null;
    };

    const handleContextMenu = (e: MouseEvent) => {
      if (useToolStore.getState().activeTool !== 'link') return;
      const target = e.target as HTMLElement;
      // 링크 마커 자신(canvas/pdf/PdfOverlayLinkMarkersLayer.tsx) 우클릭은 여기서
      // 걸러낸다 — canvas/interaction/useLinkTool.ts와 같은 이유(그 파일의 동일한
      // 주석 참고): 마커의 stopPropagation은 React 합성 이벤트에만 유효하고, 이
      // 훅처럼 DOM에 직접 붙인 네이티브 리스너에는 영향을 주지 않는다.
      if (target.closest('[data-link-marker]')) return;
      // 브라우저/OS 기본 우클릭 메뉴가 뜨지 않도록 막는다.
      e.preventDefault();

      const { openPdfId, currentPageIndex } = usePdfViewerStore.getState();
      if (!openPdfId) return;
      // PdfLibraryRecord.pageId — 이 PDF가 속한(=지금 열려 있는) Page의 id. entries는
      // 그 Page 스코프로만 채워져 있으므로(pdfLibraryStore.ts 주석 참고) 지금 열려 있는
      // openPdfId가 이 목록에 있다는 것 자체가 곧 "지금 Page 소속"이라는 뜻이다.
      const record = usePdfLibraryStore.getState().entries.find((r) => r.id === openPdfId);
      if (!record) return;

      const local = toLocal(e);
      const objectId = hitTestObjectId(local);
      // 버그 수정(2026-09-12): canvas/interaction/useLinkTool.ts와 같은 이유로,
      // objectId가 잡히면 그 오버레이 객체의 "지금" 원점을 anchorObjectX/Y로 같이
      // 남긴다(utils/linkAnchor.ts의 resolveAnchorPosition 참고).
      const targetObject = objectId ? usePdfOverlayStore.getState().objects[objectId] : undefined;
      const anchor: LinkAnchor = {
        surface: 'pdf',
        pageId: record.pageId,
        pdfId: openPdfId,
        pageIndex: currentPageIndex,
        objectId,
        x: local.x,
        y: local.y,
        ...(targetObject ? { anchorObjectX: targetObject.x, anchorObjectY: targetObject.y } : {}),
      };

      const pending = useLinkDraftStore.getState().pending;
      if (!pending) {
        useLinkDraftStore.getState().setPending(anchor);
        return;
      }
      useLinkDraftStore.getState().clear();
      void useLinkStore.getState().addLink(pending, anchor);
      useToolStore.getState().setTool('select');
    };

    el.addEventListener('contextmenu', handleContextMenu);
    return () => el.removeEventListener('contextmenu', handleContextMenu);
  }, [containerRef, pageWidth, pageHeight]);
}
