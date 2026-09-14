import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useLinkStore } from '../../store/linkStore';
import { usePdfOverlayStore } from '../../store/pdfOverlayStore';
import { usePdfOverlaySelectionStore } from '../../store/pdfOverlaySelectionStore';
import { usePdfViewerStore } from '../../store/pdfViewerStore';
import { useLinkNavigationStore } from '../../store/linkNavigationStore';
import { useLinkDraftStore } from '../../store/linkDraftStore';
import { resolveAnchorPosition } from '../../utils/linkAnchor';
import { LinkIcon } from '../../icons/Icons';
import type { LinkAnchor, LinkRecord } from '../../types/link';

// 페이지-로컬(reference-scale) 단위 기준 — 다른 오버레이 객체(하이라이트/도형 등)와
// 같은 좌표계. 기존 20px의 1/3(7px)로 줄였다가, 너무 작다는 피드백으로 11px로 조정.
// 요구사항 변경(2026-09-14): 한때(2026-09-12~13)는 pageZoom/패널 폭과 무관하게 항상
// 같은 실제 화면 px로 고정했었는데(아래 옛 주석들은 그 결정의 기록), 사용자 피드백으로
// "다른 오버레이 객체들처럼 PDF 확대(Ctrl+휠)에 따라 아이콘도 같이 커지고 작아져야
// 한다"로 뒤집혔다 — 그래서 이제는 displayScale 보정 없이 이 값을 그대로 페이지-로컬
// 크기로 쓴다(main 캔버스 쪽 canvas/LinkMarkersLayer.tsx의 동일한 변경과 짝을 이룬다).
const MARKER_SIZE = 11;

// screen px 기준 — canvas/LinkMarkersLayer.tsx의 DRAG_THRESHOLD_PX와 동일(그 파일의
// LinkMarkerDot 바로 위 주석에 이유가 자세히 있다).
const DRAG_THRESHOLD_PX = 4;

/** canvas/interaction/useOverlayLinkTool.ts의 hitTestObjectId와 완전히 같은 규칙
 * (겹치면 zIndex가 가장 큰 것) — 마커를 드래그해서 놓았을 때도 링크를 처음 만들 때와
 * 같은 기준으로 "그 자리의 오버레이 객체"를 찾아야 하므로 그대로 복제해 쓴다(parallel
 * 구현 관례 — useOverlayLinkTool.ts 자체를 import하지 않고 이 파일 안에 둔다). */
function hitTestOverlayObjectId(local: { x: number; y: number }): string | null {
  const objects = usePdfOverlayStore.getState().objects;
  let best: { id: string; zIndex: number } | null = null;
  for (const obj of Object.values(objects)) {
    if (local.x < obj.x || local.x > obj.x + obj.width || local.y < obj.y || local.y > obj.y + obj.height) continue;
    if (!best || obj.zIndex > best.zIndex) best = { id: obj.id, zIndex: obj.zIndex };
  }
  return best?.id ?? null;
}

/**
 * canvas/LinkMarkersLayer.tsx의 LinkMarkerDot과 완전히 같은 이유(그 파일 주석 참고)로
 * 존재하는 PDF 오버레이 쪽 parallel 구현 — 마커가 작아서(11px) 클릭 도중 살짝만
 * 흔들려도 네이티브 click이 마커 밖에서 잡혀 아예 발생하지 않는 문제를, pointerdown에
 * setPointerCapture를 걸고 pointerup에서 이동 거리로 직접 클릭 여부를 판정하는 방식으로
 * 고쳤다(2026-09-12). DRAG_THRESHOLD_PX를 넘는 움직임은 드래그로 보고 마커를 놓은
 * 자리로 재배치한다 — 좌표 변환은 canvas/pdf/useOverlayLinkTool.ts의 toLocal과 동일하게
 * `.pdf-viewer-page` 컨테이너의 getBoundingClientRect 기준이고, 그 컨테이너는
 * e.currentTarget(캡처된 마커 자신)에서 closest로 찾는다 — pointer capture는 실제
 * 포인터 이벤트 라우팅만 우회할 뿐 DOM 트리 자체는 그대로라 closest는 항상 정상
 * 동작한다. 객체 히트테스트는 DOM이 아니라 좌표 기반(hitTestOverlayObjectId)이라
 * elementFromPoint 트릭이 필요 없다.
 *
 * 크기: 이 마커의 위치와 크기는 모두 pageWidth/pageHeight 기준 페이지-로컬 좌표/단위를
 * %로 배치한다 — 다른 오버레이 객체(하이라이트/도형 등)와 완전히 같은 방식이라, PDF
 * 확대(Ctrl+휠 pageZoom)나 패널 폭에 따른 반응형 축소와 함께 자연스럽게 커지고
 * 작아진다. 요구사항 변경(2026-09-14): 한때(2026-09-12~13)는 canvas/LinkMarkersLayer.tsx
 * 마커와 항상 같은 실제 화면 px로 고정했었는데(displayScale로 보정), "다른 객체들처럼
 * 줌에 따라 같이 커지고 작아져야 한다"는 피드백으로 그 보정을 걷어냈다.
 */
function PdfOverlayLinkMarkerDot({
  anchorX,
  anchorY,
  pageWidth,
  pageHeight,
  isSelected,
  onNavigate,
  onSelect,
  onReposition,
}: {
  anchorX: number;
  anchorY: number;
  pageWidth: number;
  pageHeight: number;
  isSelected: boolean;
  /** 2026-09-13 수정(뒤로 버튼 제거): canvas/LinkMarkersLayer.tsx의 LinkMarkerDot과
   * 같은 이유로, 이동 후 뷰포트를 클릭 당시 마우스 위치에 맞추려면
   * (store/linkNavigationStore.ts의 navigateTo clientPoint 인자) pointerup의
   * clientX/Y가 필요하다. */
  onNavigate: (clientX: number, clientY: number) => void;
  onSelect: () => void;
  onReposition: (anchor: Pick<LinkAnchor, 'objectId' | 'x' | 'y' | 'anchorObjectX' | 'anchorObjectY'>) => void;
}) {
  const pointerStart = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const [dragLocalPos, setDragLocalPos] = useState<{ x: number; y: number } | null>(null);

  const toLocal = (e: ReactPointerEvent<HTMLDivElement>): { x: number; y: number } | null => {
    const pageEl = e.currentTarget.closest('.pdf-viewer-page');
    if (!pageEl) return null;
    const rect = pageEl.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * pageWidth,
      y: ((e.clientY - rect.top) / rect.height) * pageHeight,
    };
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== 0) return; // 우클릭은 여기서 아무 것도 하지 않고 onContextMenu로 넘긴다.
    pointerStart.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
    draggingRef.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current;
    if (!start || start.pointerId !== e.pointerId) return;
    if (!draggingRef.current) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_THRESHOLD_PX) return;
      draggingRef.current = true;
    }
    const local = toLocal(e);
    if (local) setDragLocalPos(local);
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!start || start.pointerId !== e.pointerId) return;
    e.stopPropagation();

    if (!draggingRef.current) {
      onNavigate(e.clientX, e.clientY);
      return;
    }
    draggingRef.current = false;
    setDragLocalPos(null);

    const local = toLocal(e);
    if (!local) return;
    const objectId = hitTestOverlayObjectId(local);
    const targetObject = objectId ? usePdfOverlayStore.getState().objects[objectId] : undefined;
    onReposition({
      objectId,
      x: local.x,
      y: local.y,
      ...(targetObject ? { anchorObjectX: targetObject.x, anchorObjectY: targetObject.y } : {}),
    });
  };

  const handlePointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointerStart.current = null;
    draggingRef.current = false;
    setDragLocalPos(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const centerX = dragLocalPos ? dragLocalPos.x : anchorX;
  const centerY = dragLocalPos ? dragLocalPos.y : anchorY;
  // MARKER_SIZE를 그대로 페이지-로컬 크기로 쓴다 — 위 컴포넌트 주석 참고(보정 없이
  // 다른 오버레이 객체와 같은 좌표계).
  const sizeLocal = MARKER_SIZE;
  const x = centerX - sizeLocal / 2;
  const y = centerY - sizeLocal / 2;

  return (
    <div
      data-link-marker="true"
      className={isSelected ? 'link-marker pdf-overlay-link-marker is-selected' : 'link-marker pdf-overlay-link-marker'}
      style={{
        position: 'absolute',
        left: `${(x / pageWidth) * 100}%`,
        top: `${(y / pageHeight) * 100}%`,
        width: `${(sizeLocal / pageWidth) * 100}%`,
        aspectRatio: '1 / 1',
        zIndex: 9999,
        pointerEvents: dragLocalPos ? 'none' : 'auto',
        cursor: dragLocalPos ? 'grabbing' : 'pointer',
      }}
      title="클릭: 이동 · 드래그: 재배치 · 우클릭: 선택(삭제)"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onSelect();
      }}
    >
      {/* 바깥 div와 같은 페이지-로컬 크기(sizeLocal)를 그대로 넣는다 — 이 SVG도
          .pdf-viewer-page의 transform:scale(pageZoom) 아래에서 함께 그려지므로 다른
          오버레이 객체처럼 pageZoom에 따라 자연스럽게 커지고 작아진다. */}
      <LinkIcon size={sizeLocal} />
    </div>
  );
}

/**
 * canvas/LinkMarkersLayer.tsx의 PDF 오버레이 대응물(Phase 9, parallel 구현). 이 PDF의
 * "지금 보고 있는 페이지"(openPdfId + currentPageIndex)를 source 또는 target으로
 * 가리키는 링크만 걸러서 보여준다 — PdfOverlayObjectsLayer.tsx와 마찬가지로
 * `.pdf-viewer-page` 안에서 pageWidth/pageHeight 기준 %로 배치한다.
 *
 * 크기 보정(displayScale) 없이 MARKER_SIZE를 그대로 페이지-로컬 단위로 쓴다(위
 * PdfOverlayLinkMarkerDot 주석 참고) — 2026-09-14 요구사항 변경으로 pageZoom/패널
 * 폭 보정 로직 자체를 걷어냈다.
 *
 * 클릭 동작(좌클릭=이동/우클릭=선택, 2026-09-11 확정, 2026-09-12 포인터 캡처로
 * 재구현 + 드래그 재배치 추가)은 canvas/LinkMarkersLayer.tsx와 완전히 동일한
 * 원칙이지만, "선택"의 저장 위치만 다르다 — 여기서는 interactionStore.fineSelection이
 * 아니라 pdfOverlaySelectionStore.selectedLinkId를 쓴다(그 store 자체가 메인 캔버스
 * 선택 상태와 완전히 분리된 병렬 구현이라는 기존 원칙을 그대로 따른다).
 *
 * 삭제(Delete/Backspace)도 PdfOverlayObjectsLayer.tsx의 keydown 리스너를 공유하지
 * 않고 이 컴포넌트가 자체적으로 하나 더 둔다 — selectedId(오버레이 객체 선택)와
 * selectedLinkId(링크 선택)는 서로 배타적이라 두 리스너가 동시에 반응할 일은 없다.
 */
export function PdfOverlayLinkMarkersLayer({ pageWidth, pageHeight }: { pageWidth: number; pageHeight: number }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const links = useLinkStore((s) => s.links);
  const overlayObjects = usePdfOverlayStore((s) => s.objects);
  const selectedLinkId = usePdfOverlaySelectionStore((s) => s.selectedLinkId);
  const openPdfId = usePdfViewerStore((s) => s.openPdfId);
  const currentPageIndex = usePdfViewerStore((s) => s.currentPageIndex);
  // 요구사항(링크 생성 UX 개선, 2026-09-13): canvas/LinkMarkersLayer.tsx와 동일한
  // 이유로, 🔗 도구의 첫 번째 클릭이 이 PDF 페이지를 가리키면 두 번째 클릭을 기다리는
  // 동안 강조된 임시 마커를 보여준다.
  const pendingDraft = useLinkDraftStore((s) => s.pending);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const { selectedLinkId: id, editingId } = usePdfOverlaySelectionStore.getState();
      if (!id || editingId) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      void useLinkStore.getState().removeLink(id);
      usePdfOverlaySelectionStore.getState().selectLink(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!openPdfId) return null;

  const matchesHere = (anchor: LinkAnchor) =>
    anchor.surface === 'pdf' && anchor.pdfId === openPdfId && anchor.pageIndex === currentPageIndex;

  const entries: Array<{ key: string; link: LinkRecord; side: 'source' | 'target'; anchor: LinkAnchor; other: LinkAnchor }> = [];
  for (const link of Object.values(links)) {
    if (matchesHere(link.source)) entries.push({ key: `${link.id}:source`, link, side: 'source', anchor: link.source, other: link.target });
    if (matchesHere(link.target)) entries.push({ key: `${link.id}:target`, link, side: 'target', anchor: link.target, other: link.source });
  }

  const showDraft =
    pendingDraft?.surface === 'pdf' && pendingDraft.pdfId === openPdfId && pendingDraft.pageIndex === currentPageIndex;

  return (
    <div ref={wrapperRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {entries.map(({ key, link, side, anchor, other }) => {
        const obj = anchor.objectId ? overlayObjects[anchor.objectId] : undefined;
        // 위치 계산은 canvas/LinkMarkersLayer.tsx와 동일하게 resolveAnchorPosition에
        // 위임한다(2026-09-12 수정 — 그 파일의 동일한 주석 참고).
        const pos = resolveAnchorPosition(anchor, obj);
        const isSelected = selectedLinkId === link.id;

        return (
          <PdfOverlayLinkMarkerDot
            key={key}
            anchorX={pos.x}
            anchorY={pos.y}
            pageWidth={pageWidth}
            pageHeight={pageHeight}
            isSelected={isSelected}
            onNavigate={(clientX, clientY) =>
              void useLinkNavigationStore.getState().navigateTo(other, { x: clientX, y: clientY })
            }
            onSelect={() => usePdfOverlaySelectionStore.getState().selectLink(link.id)}
            onReposition={(patch) =>
              void useLinkStore.getState().updateAnchor(link.id, side, {
                surface: 'pdf',
                pageId: anchor.pageId,
                pdfId: anchor.pdfId,
                pageIndex: anchor.pageIndex,
                ...patch,
              })
            }
          />
        );
      })}
      {showDraft && (() => {
        const obj = pendingDraft.objectId ? overlayObjects[pendingDraft.objectId] : undefined;
        const pos = resolveAnchorPosition(pendingDraft, obj);
        const sizeLocal = MARKER_SIZE;
        const x = pos.x - sizeLocal / 2;
        const y = pos.y - sizeLocal / 2;
        return (
          <div
            className="link-marker pdf-overlay-link-marker is-draft"
            style={{
              position: 'absolute',
              left: `${(x / pageWidth) * 100}%`,
              top: `${(y / pageHeight) * 100}%`,
              width: `${(sizeLocal / pageWidth) * 100}%`,
              aspectRatio: '1 / 1',
              zIndex: 9999,
              pointerEvents: 'none',
            }}
          >
            <LinkIcon size={sizeLocal} />
          </div>
        );
      })()}
    </div>
  );
}
