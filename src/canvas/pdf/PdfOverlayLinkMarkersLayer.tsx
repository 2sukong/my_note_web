import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

// 실제 화면 CSS px 기준(2026-09-12 수정 — 아래 displayScale 관련 주석 참고). 요구사항:
// 기존 20px의 1/3(7px)로 줄였다가, 너무 작다는 피드백으로 11px로 조정 — 그리고 이제는
// 메인 캔버스 마커(canvas/LinkMarkersLayer.tsx)와 항상 같은 실제 화면 크기가 되도록
// pageZoom/화면 크기와 무관하게 고정된다.
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
 * 크기(2026-09-12 수정, "PDF 마커가 일반 페이지 마커보다 크게/작게 보임"): 이 마커의
 * 위치는 pageWidth/pageHeight 기준 페이지-로컬 좌표를 %로 배치하므로 PDF 확대(Ctrl+휠
 * pageZoom)나 패널 폭에 따른 반응형 축소와 함께 자연스럽게 따라 움직여야 맞지만, 크기는
 * 그와 무관하게 canvas/LinkMarkersLayer.tsx의 마커와 항상 같은 실제 화면 px여야 한다
 * (요구사항). PdfOverlayObjectsLayer.tsx가 글자 크기(baseFontSize)를 실제 px로 바꿀 때
 * 쓰는 것과 같은 displayScale(그 파일 주석 참고 — "화면에 실제로 그려지는 px 대 페이지
 * 기준 px" 비율)을 그대로 재사용해, 목표 실제 px(MARKER_SIZE)를 거꾸로 페이지-로컬
 * 단위로 환산해서(MARKER_SIZE / displayScale) 그 값을 %로 넣는다 — 곱하는 방향만
 * 반대일 뿐 같은 변환이다.
 *
 * 버그 수정(2026-09-13, "PDF 확대(Ctrl+휠) 후 아이콘 크기가 다시 어긋남"): 아래
 * PdfOverlayLinkMarkersLayer의 displayScale은 (1) 패널 폭에 따른 반응형 축소(max-width:
 * 100%, 실제 레이아웃을 바꾸는 CSS)와 (2) pageZoom(`.pdf-viewer-page`의
 * transform:scale, 시각적으로만 확대) 두 가지가 함께 만드는 최종 비율이다. 예전엔 이
 * 둘을 구분하지 않고 래퍼의 getBoundingClientRect().width(transform 이후 크기를
 * 포함)를 ResizeObserver 콜백에서 그대로 쟀는데, ResizeObserver는 스펙상 "레이아웃
 * 박스" 크기만 관찰해서 transform만 바뀌는 경우(=pageZoom만 바뀌는 경우)에는 콜백
 * 자체가 다시 호출되지 않는다 — 그 결과 pageZoom을 바꾼 뒤에는 measure()가 다시
 * 실행되지 않아 displayScale이 확대 전 값에 멈춰버렸다(마커가 pageZoom 배율만큼
 * 더 커지거나 작아져 보임). 고친 방식: ResizeObserver 쪽에서는 offsetWidth(transform의
 * 영향을 받지 않는 순수 레이아웃 폭)로 "반응형 축소분"(layoutRatio)만 재고, pageZoom은
 * usePdfViewerStore를 reactive하게 구독해서 렌더링마다 곱한다 — pageZoom이 바뀌면 이
 * 구독 자체가 리렌더를 일으키므로 ResizeObserver 없이도 항상 최신 값으로 계산된다.
 */
function PdfOverlayLinkMarkerDot({
  anchorX,
  anchorY,
  pageWidth,
  pageHeight,
  displayScale,
  isSelected,
  onNavigate,
  onSelect,
  onReposition,
}: {
  anchorX: number;
  anchorY: number;
  pageWidth: number;
  pageHeight: number;
  displayScale: number;
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
  // 목표 실제 px(MARKER_SIZE)를 페이지-로컬 단위로 환산 — 위 컴포넌트 주석의
  // displayScale 설명 참고.
  const sizeLocal = displayScale > 0 ? MARKER_SIZE / displayScale : MARKER_SIZE;
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
      {/* 버그 수정: 이 SVG도 결국 .pdf-viewer-page의 transform:scale(pageZoom) 아래에서
          그려지므로, 목표 실제 px(MARKER_SIZE)가 아니라 위에서 이미 역산해 둔
          페이지-로컬 크기(sizeLocal)를 넣어야 같은 배율을 한 번 더 받아 최종적으로
          MARKER_SIZE와 맞아떨어진다 — 여기에 MARKER_SIZE를 그대로 넣으면 아이콘만
          이중으로 배율을 받아 마커 원(div) 크기와 어긋난다. */}
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
 * displayScale 측정도 PdfOverlayObjectsLayer.tsx와 완전히 같은 방식이다(그 파일의
 * 동일한 주석 참고) — 래퍼가 부모 `.pdf-viewer-page`와 정확히 같은 크기로 그려지므로
 * (inset:0) 래퍼 자신의 layoutRatio(offsetWidth 기준 반응형 축소분)에 pageZoom을
 * reactive하게 곱해 "화면에 실제로 그려지는 px 대 페이지 기준 px" 비율을 얻는다(위
 * PdfOverlayLinkMarkerDot 주석의 "버그 수정(2026-09-13...)" 참고 — 예전엔
 * getBoundingClientRect만으로 쟀다가 Ctrl+휠 확대 후 값이 갱신되지 않는 문제가 있었다).
 * 각 마커(PdfOverlayLinkMarkerDot)는 이 비율로 목표 실제 px(MARKER_SIZE)를 계산해
 * pageZoom/패널 크기와 무관하게 항상 같은 화면 크기를 유지한다.
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
  // 버그 수정(2026-09-13): layoutRatio는 "반응형 축소분"만(offsetWidth — transform의
  // 영향을 받지 않는 순수 레이아웃 폭 기준) ResizeObserver로 잰다. pageZoom은
  // usePdfViewerStore를 아래에서 reactive하게 구독해 렌더링마다 곱한다 — 위 컴포넌트
  // 주석의 "버그 수정(2026-09-13...)" 참고.
  const [layoutRatio, setLayoutRatio] = useState(1);
  const pageZoom = usePdfViewerStore((s) => s.pageZoom);
  const displayScale = layoutRatio * (pageZoom > 0 ? pageZoom : 1);
  const links = useLinkStore((s) => s.links);
  const overlayObjects = usePdfOverlayStore((s) => s.objects);
  const selectedLinkId = usePdfOverlaySelectionStore((s) => s.selectedLinkId);
  const openPdfId = usePdfViewerStore((s) => s.openPdfId);
  const currentPageIndex = usePdfViewerStore((s) => s.currentPageIndex);
  // 요구사항(링크 생성 UX 개선, 2026-09-13): canvas/LinkMarkersLayer.tsx와 동일한
  // 이유로, 🔗 도구의 첫 번째 클릭이 이 PDF 페이지를 가리키면 두 번째 클릭을 기다리는
  // 동안 강조된 임시 마커를 보여준다.
  const pendingDraft = useLinkDraftStore((s) => s.pending);

  useLayoutEffect(() => {
    const el = wrapperRef.current;
    if (!el || pageWidth <= 0) return;

    const measure = () => {
      const width = el.offsetWidth;
      if (width > 0) setLayoutRatio(width / pageWidth);
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [pageWidth]);

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
            displayScale={displayScale}
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
        const sizeLocal = displayScale > 0 ? MARKER_SIZE / displayScale : MARKER_SIZE;
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
