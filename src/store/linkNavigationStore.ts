import { create } from 'zustand';
import { useFileTreeStore } from '../storage/fileTreeStore';
import { useViewportStore } from '../store/viewportStore';
import { useObjectsStore } from '../store/objectsStore';
import { usePdfViewerStore, markSuppressNextAutoClose } from './pdfViewerStore';
import { centerViewportOn, viewportShowingPointAtClient } from '../utils/coords';
import { resolveAnchorPosition } from '../utils/linkAnchor';
import type { LinkAnchor } from '../types/link';
import type { Point, Viewport } from '../types/viewport';

/**
 * 링크를 따라 이동할 때의 "이전 위치" 스택(Phase 9) — store/historyStore.ts(Ctrl+Z/Y,
 * 객체 편집 undo/redo)와는 완전히 별개다. 의미 자체가 다르다: historyStore는 "무엇을
 * 바꿨는지"를 기록하고 되돌리지만, 이건 "어디서 보고 있었는지"만 기록하고 복원한다 —
 * 그래서 openPage()가 historyStore를 reset()하는 것과 무관하게 이 스택은 그대로
 * 남아있어야 한다(링크로 페이지를 넘나들어도 되짚어 나올 정보는 계속 유지되므로).
 *
 * 2026-09-13 수정("뒤로 버튼이 UX상 어울리지 않는다"): 전용 "뒤로가기" 버튼
 * (canvas/LinkBackButton.tsx)은 없앴다 — 대신 navigateTo가 화면 중앙이 아니라 방금
 * 링크를 클릭한 마우스 포인터의 화면 위치에 도착 지점을 맞춘다(아래 navigateTo의
 * clientPoint 인자, utils/coords.ts의 viewportShowingPointAtClient 참고). 도착 지점에는
 * 같은 링크의 반대쪽 anchor 마커가 그대로 떠 있으므로, 마우스를 옮기지 않고 그 자리를
 * 다시 클릭하면 곧바로 원래 위치로 돌아간다 — 버튼 없이 같은 "뒤로가기" 효과를 낸다.
 * 이 stack/goBack 자체는 그대로 남겨둔다(추후 키보드 단축키 등으로 다시 연결할 수 있게).
 */
interface NavigationSnapshot {
  pageId: string;
  viewport: Viewport;
  pdfOpenId: string | null;
  pdfPageIndex: number;
  pdfPageZoom: number;
}

interface LinkNavigationState {
  stack: NavigationSnapshot[];
  /** target으로 이동하기 직전의 현재 위치를 스택에 남기고 이동을 실행한다. clientPoint를
   * 넘기면(마우스로 링크 마커를 클릭한 경우) surface==='page' 타겟은 화면 중앙 대신 그
   * 지점에 도착 위치를 맞춘다 — 안 넘기면(예: 다른 진입 경로) 기존처럼 화면 중앙에 맞춘다. */
  navigateTo: (target: LinkAnchor, clientPoint?: Point) => Promise<void>;
  /** 스택에서 가장 최근 위치를 꺼내 복원한다. 스택이 비어 있으면 아무 일도 하지 않는다. */
  goBack: () => Promise<void>;
}

function captureSnapshot(pageId: string): NavigationSnapshot {
  const vp = useViewportStore.getState();
  const pv = usePdfViewerStore.getState();
  return {
    pageId,
    viewport: { zoom: vp.zoom, panX: vp.panX, panY: vp.panY },
    pdfOpenId: pv.openPdfId,
    pdfPageIndex: pv.currentPageIndex,
    pdfPageZoom: pv.pageZoom,
  };
}

/** snapshot의 pdfOpenId/pdfPageIndex/pdfPageZoom대로 PDF Viewer 상태를 복원(또는 닫음)한다. */
function restorePdfViewerState(snapshot: NavigationSnapshot) {
  if (snapshot.pdfOpenId) {
    usePdfViewerStore.getState().openViewer(snapshot.pdfOpenId, snapshot.pdfPageIndex);
    usePdfViewerStore.getState().setPageZoom(snapshot.pdfPageZoom);
  } else if (usePdfViewerStore.getState().openPdfId) {
    usePdfViewerStore.getState().closeViewer();
  }
}

export const useLinkNavigationStore = create<LinkNavigationState>((set, get) => ({
  stack: [],

  navigateTo: async (target, clientPoint) => {
    const currentPageId = useFileTreeStore.getState().currentPageId;
    if (!currentPageId) return;

    set((s) => ({ stack: [...s.stack, captureSnapshot(currentPageId)] }));

    const needsPageSwitch = currentPageId !== target.pageId;

    if (target.surface === 'pdf') {
      // 요구사항(2026-09 확정): PDF 타겟은 페이지 단위까지만 — pageIndex로 그 PDF의
      // 해당 페이지를 열면 끝이다. target.pdfId는 anchor 생성 시(useOverlayLinkTool.ts)
      // 항상 채워 넣으므로 여기서는 항상 존재한다고 가정한다.
      if (needsPageSwitch) {
        markSuppressNextAutoClose();
        await useFileTreeStore.getState().openPage(target.pageId);
      }
      usePdfViewerStore.getState().openViewer(target.pdfId as string, target.pageIndex ?? 0);
      return;
    }

    // surface === 'page': 필요하면 Page를 연 뒤, 링크가 "지금" 가리키는 위치(클릭
    // 당시의 정확한 지점 — objectId가 있으면 그 객체를 따라간다)를 화면에 맞춘다.
    // canvas/LinkMarkersLayer.tsx가 마커를 그리는 위치와 같은 계산식(resolveAnchorPosition)을
    // 써야 "마커가 보이던 자리 = 이동했을 때 화면에 나타나는 자리"가 항상 일치한다
    // (2026-09-12 수정 — 예전엔 여기만 객체 중심을 썼다).
    if (needsPageSwitch) {
      await useFileTreeStore.getState().openPage(target.pageId);
    }
    const objects = useObjectsStore.getState().objects;
    const obj = target.objectId ? objects[target.objectId] : undefined;
    const centerPoint = resolveAnchorPosition(target, obj);
    const zoom = useViewportStore.getState().zoom;
    // 2026-09-13 수정(뒤로 버튼 제거): clientPoint가 있으면(마우스로 마커를 클릭한
    // 경우) 화면 중앙 대신 그 지점에 도착 위치를 맞춘다 — 위 인터페이스 주석 참고.
    const nextViewport = clientPoint
      ? viewportShowingPointAtClient(centerPoint, zoom, clientPoint)
      : centerViewportOn(centerPoint, zoom);
    useViewportStore.getState().setViewport(nextViewport);
    // "페이지 위치로 이동"은 메인 캔버스를 보여주는 게 목적이므로, 같은 Page 안에서의
    // 이동이라 PdfLibraryRail의 자동 닫힘(currentPageId 변경 트리거)이 발동하지 않았을
    // 경우까지 포함해 명시적으로 Viewer를 닫는다.
    if (usePdfViewerStore.getState().openPdfId) usePdfViewerStore.getState().closeViewer();
  },

  goBack: async () => {
    const stack = get().stack;
    if (stack.length === 0) return;
    const snapshot = stack[stack.length - 1];
    set({ stack: stack.slice(0, -1) });

    const needsPageSwitch = useFileTreeStore.getState().currentPageId !== snapshot.pageId;
    if (needsPageSwitch && snapshot.pdfOpenId) markSuppressNextAutoClose();
    if (needsPageSwitch) await useFileTreeStore.getState().openPage(snapshot.pageId);
    useViewportStore.getState().setViewport(snapshot.viewport);
    restorePdfViewerState(snapshot);
  },
}));
