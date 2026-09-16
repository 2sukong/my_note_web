import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useLinkStore } from '../../store/linkStore';
import { usePdfOverlayStore } from '../../store/pdfOverlayStore';
import { usePdfOverlaySelectionStore } from '../../store/pdfOverlaySelectionStore';
import { usePdfViewerStore } from '../../store/pdfViewerStore';
import { useLinkNavigationStore } from '../../store/linkNavigationStore';
import { useLinkDraftStore } from '../../store/linkDraftStore';
import { resolveAnchorPosition } from '../../utils/linkAnchor';
import { PDF_OVERLAY_ABSOLUTE_SIZE_CALIBRATION } from '../../objects/pdf/pdfRaster';
import { LinkIcon } from '../../icons/Icons';
import type { LinkAnchor, LinkRecord } from '../../types/link';

// 아이콘의 "페이지-로컬 기준" 크기값 — 실제 화면 CSS px 변환은 아래 CALIBRATION만
// 곱하면 끝난다(더 이상 displayScale을 JS로 실측할 필요가 없다 — 버그 수정 주석 참고).
const MARKER_SIZE = 11;

// 버그 수정(2026-09-16, 2차): 1차 수정(JS로 layoutRatio를 ResizeObserver로 실측해서
// MARKER_SIZE*displayScale*CALIBRATION을 <div>의 width/height로 쓰는 방식)로도 여전히
// 사용자에게는 작게 보였다 — 사용자 제안대로, canvas/pdf/PdfOverlayHighlightLayer.tsx
// (형광펜)가 쓰는 것과 완전히 같은 기법으로 바꿨다: 이 레이어 전체를
// `<svg viewBox="0 0 pageWidth pageHeight">`로 감싸고 100%/100%로 채우면, "페이지
// 로컬 좌표 → 실제 화면 px" 변환을 브라우저 SVG 엔진이 알아서(그리고 정확하게)
// 처리한다 — JS 실측(ResizeObserver, offsetWidth) 자체가 필요 없어진다. pageZoom도
// `.pdf-viewer-page`의 transform:scale이 이 svg 전체에 그대로 적용되므로 별도 처리가
// 필요 없다(형광펜 strokeWidth와 완전히 같은 원리). 남은 건 형광펜과 동일하게
// PDF_OVERLAY_ABSOLUTE_SIZE_CALIBRATION 하나만 곱해서, 메인 캔버스와 같은 숫자가
// 비슷한 크기로 보이도록 맞추는 것뿐이다.
//
// 마커는 이제 각 링크마다 <g transform="translate(x,y)">로 감싸고, 그 안에 투명한
// 히트박스 <rect>(클릭 판정용 — SVG는 <g> 자체가 빈 영역에 히트테스트를 안 주므로
// 필요)와 LinkIcon(중첩 <svg>로 그대로 재사용)을 넣는 구조로 바꿨다.
const CALIBRATED_SIZE = MARKER_SIZE * PDF_OVERLAY_ABSOLUTE_SIZE_CALIBRATION;

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
 * 존재하는 PDF 오버레이 쪽 parallel 구현 — 마커가 작아서 클릭 도중 살짝만 흔들려도
 * 네이티브 click이 마커 밖에서 잡혀 아예 발생하지 않는 문제를, pointerdown에
 * setPointerCapture를 걸고 pointerup에서 이동 거리로 직접 클릭 여부를 판정하는 방식으로
 * 고쳤다(2026-09-12). DRAG_THRESHOLD_PX를 넘는 움직임은 드래그로 보고 마커를 놓은
 * 자리로 재배치한다 — 좌표 변환은 canvas/pdf/useOverlayLinkTool.ts의 toLocal과 동일하게
 * `.pdf-viewer-page` 컨테이너의 getBoundingClientRect 기준이고, 그 컨테이너는
 * e.currentTarget(캡처된 마커 자신)에서 closest로 찾는다 — Element.closest()는 SVG
 * 엘리먼트에서도 정상 동작하고(같은 DOM 트리를 그대로 타고 올라간다), pointer capture도
 * SVGElement에서 그대로 지원된다. 객체 히트테스트는 DOM이 아니라 좌표 기반
 * (hitTestOverlayObjectId)이라 elementFromPoint 트릭이 필요 없다.
 *
 * 렌더링(2026-09-16 2차 수정, 파일 상단 주석 참고): <g transform="translate(...)">로
 * 중심을 옮기고, 그 안에 투명 히트박스 <rect>(SVG는 <g>만으로는 빈 공간이 클릭을 안
 * 받으므로 필요) + LinkIcon(중첩 <svg>, 부모 viewBox의 page-local 단위를 그대로 폭/높이로
 * 받는다)을 그린다.
 */
function PdfOverlayLinkMarkerDot({
  anchorX,
  anchorY,
  pageWidth,
  pageHeight,
  isSelected,
  isDraft,
  onNavigate,
  onSelect,
  onReposition,
}: {
  anchorX: number;
  anchorY: number;
  pageWidth: number;
  pageHeight: number;
  isSelected: boolean;
  /** true면 아직 링크가 아닌 대기 중 draft 마커 — 클릭/드래그에 반응하지 않는
   * 순수 표시용(아래 PdfOverlayLinkMarkersLayer의 draft 렌더링이 이 값을 true로 넘긴다). */
  isDraft?: boolean;
  /** 2026-09-13 수정(뒤로 버튼 제거): canvas/LinkMarkersLayer.tsx의 LinkMarkerDot과
   * 같은 이유로, 이동 후 뷰포트를 클릭 당시 마우스 위치에 맞추려면
   * (store/linkNavigationStore.ts의 navigateTo clientPoint 인자) pointerup의
   * clientX/Y가 필요하다. */
  onNavigate?: (clientX: number, clientY: number) => void;
  onSelect?: () => void;
  onReposition?: (anchor: Pick<LinkAnchor, 'objectId' | 'x' | 'y' | 'anchorObjectX' | 'anchorObjectY'>) => void;
}) {
  // 버그 수정(2026-09-16): canvas/LinkMarkersLayer.tsx의 LinkMarkerDot과 완전히 같은
  // 이유(그 파일의 동일한 주석 참고) — 드래그 중 렌더 위치를 커서의 "절대" 페이지-로컬
  // 좌표로 그대로 덮어쓰면, 마커 중심이 아닌 가장자리를 잡고 드래그를 시작했을 때
  // DRAG_THRESHOLD_PX를 넘는 순간 마커가 커서 밑으로 튀었다. pointerdown 시점의
  // 페이지-로컬 좌표를 기준으로 커서가 그동안 이동한 만큼(delta)만 원래 anchorX/Y에
  // 더하는 방식으로 바꿔 튀지 않게 한다.
  const pointerStart = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const dragStartLocalRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const [dragLocalPos, setDragLocalPos] = useState<{ x: number; y: number } | null>(null);

  const toLocal = (e: ReactPointerEvent<SVGGElement>): { x: number; y: number } | null => {
    const pageEl = e.currentTarget.closest('.pdf-viewer-page');
    if (!pageEl) return null;
    const rect = pageEl.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * pageWidth,
      y: ((e.clientY - rect.top) / rect.height) * pageHeight,
    };
  };

  const handlePointerDown = (e: ReactPointerEvent<SVGGElement>) => {
    if (isDraft) return;
    // 버그 수정(2026-09-16, PDF Viewer Space+드래그 이동 도입): PdfOverlayShapeView.tsx와
    // 같은 이유로, Space+드래그로 페이지를 옮기려는 제스처가 마커의 작은 히트 영역
    // 위에서 시작됐다고 해서 마커가 재배치돼서는 안 된다.
    if (usePdfViewerStore.getState().isSpacePressed) return;
    e.stopPropagation();
    if (e.button !== 0) return; // 우클릭은 여기서 아무 것도 하지 않고 onContextMenu로 넘긴다.
    pointerStart.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
    dragStartLocalRef.current = toLocal(e);
    draggingRef.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: ReactPointerEvent<SVGGElement>) => {
    const start = pointerStart.current;
    if (!start || start.pointerId !== e.pointerId) return;
    if (!draggingRef.current) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_THRESHOLD_PX) return;
      draggingRef.current = true;
    }
    const currentLocal = toLocal(e);
    const dragStartLocal = dragStartLocalRef.current;
    if (currentLocal && dragStartLocal) {
      setDragLocalPos({
        x: anchorX + (currentLocal.x - dragStartLocal.x),
        y: anchorY + (currentLocal.y - dragStartLocal.y),
      });
    } else if (currentLocal) {
      setDragLocalPos(currentLocal);
    }
  };

  const handlePointerUp = (e: ReactPointerEvent<SVGGElement>) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!start || start.pointerId !== e.pointerId) return;
    e.stopPropagation();

    if (!draggingRef.current) {
      dragStartLocalRef.current = null;
      onNavigate?.(e.clientX, e.clientY);
      return;
    }
    draggingRef.current = false;
    setDragLocalPos(null);

    const currentLocal = toLocal(e);
    const dragStartLocal = dragStartLocalRef.current;
    dragStartLocalRef.current = null;
    if (!currentLocal) return;
    const local = dragStartLocal
      ? { x: anchorX + (currentLocal.x - dragStartLocal.x), y: anchorY + (currentLocal.y - dragStartLocal.y) }
      : currentLocal;
    // 히트테스트는 실제 커서의 페이지-로컬 좌표(currentLocal) 기준으로 하고(그 자리에
    // 있는 진짜 오버레이 객체를 찾아야 하므로), anchor에 저장하는 위치는 delta
    // 보정된 local을 쓴다 — LinkMarkerDot과 같은 이유로 두 계산을 분리한다.
    const objectId = hitTestOverlayObjectId(currentLocal);
    const targetObject = objectId ? usePdfOverlayStore.getState().objects[objectId] : undefined;
    onReposition?.({
      objectId,
      x: local.x,
      y: local.y,
      ...(targetObject ? { anchorObjectX: targetObject.x, anchorObjectY: targetObject.y } : {}),
    });
  };

  const handlePointerCancel = (e: ReactPointerEvent<SVGGElement>) => {
    pointerStart.current = null;
    dragStartLocalRef.current = null;
    draggingRef.current = false;
    setDragLocalPos(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const centerX = dragLocalPos ? dragLocalPos.x : anchorX;
  const centerY = dragLocalPos ? dragLocalPos.y : anchorY;
  const half = CALIBRATED_SIZE / 2;

  const classNames = ['link-marker', 'pdf-overlay-link-marker'];
  if (isSelected) classNames.push('is-selected');
  if (isDraft) classNames.push('is-draft');

  return (
    <g
      data-link-marker="true"
      className={classNames.join(' ')}
      transform={`translate(${centerX - half}, ${centerY - half})`}
      style={{
        pointerEvents: isDraft ? 'none' : dragLocalPos ? 'none' : 'auto',
        cursor: dragLocalPos ? 'grabbing' : 'pointer',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={(e) => {
        if (isDraft) return;
        e.preventDefault();
        e.stopPropagation();
        onSelect?.();
      }}
    >
      {/* 투명 히트박스 — <g>/아이콘 획(stroke)만으로는 빈 안쪽 공간이 클릭을 못 받으므로
          아이콘과 정확히 같은 자리(0,0 ~ CALIBRATED_SIZE)에 fill="transparent"인 사각형을
          깔아 둔다(fill="none"과 달리 "transparent"는 그 영역도 히트테스트에 포함된다). */}
      <rect x={0} y={0} width={CALIBRATED_SIZE} height={CALIBRATED_SIZE} fill="transparent" />
      {/* LinkIcon(icons/Icons.tsx)이 반환하는 <svg viewBox="0 0 20 20" width height>를
          중첩 svg로 그대로 재사용한다 — width/height를 부모(이 <svg> viewBox)의 page-local
          단위로 주면, 바깥 <svg viewBox="0 0 pageWidth pageHeight">가 화면 px로 변환할 때
          자동으로 함께 스케일된다(파일 상단 버그 수정 주석 참고) — 형광펜과 완전히 같은
          원리라 별도 JS 배율 계산이 필요 없다. */}
      <LinkIcon size={CALIBRATED_SIZE} />
    </g>
  );
}

/**
 * canvas/LinkMarkersLayer.tsx의 PDF 오버레이 대응물(Phase 9, parallel 구현). 이 PDF의
 * "지금 보고 있는 페이지"(openPdfId + currentPageIndex)를 source 또는 target으로
 * 가리키는 링크만 걸러서 보여준다.
 *
 * 렌더링 방식(2026-09-16 2차 수정): canvas/pdf/PdfOverlayHighlightLayer.tsx(형광펜)와
 * 완전히 같은 `<svg viewBox="0 0 pageWidth pageHeight">` 기법으로 전체를 감싼다 — 1차
 * 수정(JS로 layoutRatio를 실측해서 <div> 크기에 곱하는 방식)이 여전히 작게 보인다는
 * 피드백으로, 아예 JS 실측 자체가 필요 없는 이 방식으로 바꿨다. 파일 상단 주석 참고.
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

  if (!openPdfId || pageWidth <= 0 || pageHeight <= 0) return null;

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
    <svg
      viewBox={`0 0 ${pageWidth} ${pageHeight}`}
      preserveAspectRatio="none"
      // zIndex(2026-09-16 2차 수정): 예전엔 마커 하나하나의 <div>에 zIndex:9999를 직접
      // 줬는데, 그 값이 사라지면 PdfOverlayTextView.tsx가 텍스트 객체마다 주는
      // zIndex:object.zIndex(작은 정수)가 이 <svg>(zIndex 없음=auto)보다 쌓임 순서상
      // 위로 올라간다 — position이 있고 z-index가 정수인 형제가 z-index:auto인 형제보다
      // 항상 위에 쌓이기 때문(DOM 순서와 무관). 그래서 이 <svg> 전체에 9999를 줘서 항상
      // 맨 위에 오게 한다(마커 하나하나가 아니라 레이어 전체에 한 번만 주면 충분하다).
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 9999 }}
    >
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
        return (
          <PdfOverlayLinkMarkerDot
            anchorX={pos.x}
            anchorY={pos.y}
            pageWidth={pageWidth}
            pageHeight={pageHeight}
            isSelected={false}
            isDraft
          />
        );
      })()}
    </svg>
  );
}
