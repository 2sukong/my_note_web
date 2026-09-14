import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useLinkStore } from '../store/linkStore';
import { useObjectsStore } from '../store/objectsStore';
import { useInteractionStore } from '../store/interactionStore';
import { useFileTreeStore } from '../storage/fileTreeStore';
import { useLinkNavigationStore } from '../store/linkNavigationStore';
import { useLinkDraftStore } from '../store/linkDraftStore';
import { useViewportStore } from '../store/viewportStore';
import { resolveAnchorPosition } from '../utils/linkAnchor';
import { clientToWorld } from '../utils/coords';
import { LinkIcon } from '../icons/Icons';
import type { LinkAnchor, LinkRecord } from '../types/link';

// world 단위(다른 필기 객체와 같은 좌표계) 기준. 요구사항 변경(2026-09-14): 기존엔
// "캔버스 줌과 무관하게 항상 같은 실제 화면 크기"로 고정했었는데(2026-09-12 결정,
// PDF 오버레이 마커 canvas/pdf/PdfOverlayLinkMarkersLayer.tsx와 화면 px 크기를
// 맞추려는 목적), 사용자 피드백으로 "다른 객체들처럼 Ctrl+스크롤 확대/축소에 따라
// 아이콘도 같이 커지고 작아져야 한다"로 뒤집혔다 — 그래서 이제는 zoom으로 나누는
// 보정을 하지 않고 이 값을 그대로 world 크기로 쓴다(아래 LinkMarkerDot의 sizeWorld
// 참고). 값 자체(11)는 zoom=1(기본 배율)일 때 예전 목표 화면 px와 같은 크기로
// 보이도록 그대로 유지했다.
const MARKER_SIZE = 11;

// screen px 기준 — useObjectDrag.ts/useMarqueeSelect.ts의 DRAG_THRESHOLD_PX와 같은
// 관례(값도 동일하게 4px). 이 이하 움직임은 "클릭"(이동), 이상은 "드래그"(재배치)로
// 간주한다. 아래 LinkMarkerDot 주석 참고.
const DRAG_THRESHOLD_PX = 4;

/**
 * 링크 마커 하나(좌클릭=이동, 좌클릭 드래그=재배치, 우클릭=선택)의 실제 포인터 처리.
 *
 * 버그 수정(2026-09-12, "좌클릭 드래그 시 이동 안 됨"): 원래는 그냥 onClick을 썼는데,
 * 마커 자체가 작다 보니(요구사항: 1/3 크기로 축소) 클릭하는 순간 손이 살짝만 떨려도
 * (트랙패드/마우스 모두 흔함) pointerup이 마커 바깥에서 일어난다 — 브라우저의 네이티브
 * click 이벤트는 "pointerdown과 pointerup이 같은 엘리먼트 위(또는 그 안)"일 때만
 * 그 엘리먼트에서 발생하므로, 이 경우 click 자체가 마커에서 전혀 발생하지 않아
 * onClick이 아예 호출되지 않았다(= 이동이 씹힘). 그래서 네이티브 click에 기대지
 * 않고 직접 판정한다: pointerdown 시점에 setPointerCapture로 커서가 밖으로 나가도
 * 계속 이 엘리먼트가 후속 이벤트를 받도록 고정해두고, pointerup 시점에 시작 지점과의
 * 거리로 클릭/드래그를 가른다.
 *
 * 기능 추가(2026-09-12, "마커 자체를 드래그해서 옮기기"): DRAG_THRESHOLD_PX를 넘는
 * 움직임은 더 이상 "취소"가 아니라 실제 재배치로 처리한다 — 드래그 중에는 마커가
 * 커서를 따라 실시간으로 움직이고(world 좌표는 utils/coords.ts의 clientToWorld로
 * 매 pointermove마다 다시 계산), 놓는 순간(pointerup) 그 자리에 필기 객체가 있으면
 * (요구사항 확정) 그 객체에 새로 바인딩하고, 없으면 좌표만 갱신한다 — 링크를 처음
 * 만들 때(canvas/interaction/useLinkTool.ts)와 완전히 같은 규칙(data-object-id
 * closest 히트테스트)을 그대로 재사용한다. 드래그 중엔 elementFromPoint가 자기 자신을
 * 돌려주지 않도록(마커가 커서 바로 아래 그려지므로) pointerEvents를 'none'으로
 * 끈다 — pointerdown에서 잡은 캡처는 pointer-events CSS와 무관하게 이 엘리먼트로
 * 계속 라우팅되므로(스펙상 캡처가 히트테스트를 완전히 우회함) 안전하다.
 *
 * useObjectDrag.ts는 "실제 드래그 임계값을 넘는 순간"에만 setPointerCapture를 잡는데
 * (그 파일 주석: pointerdown에서 곧바로 잡으면 움직임 없는 클릭/더블클릭의 네이티브
 * click/dblclick 합성이 막히는 경우가 있었다고 함), 여기서는 애초에 네이티브 click에
 * 기대지 않고 pointerup에서 직접 이동/재배치를 실행하므로 그 문제와 무관하다 —
 * pointerdown 시점에 바로 캡처를 잡아도 안전하다.
 */
function LinkMarkerDot({
  anchorX,
  anchorY,
  pageId,
  isSelected,
  onNavigate,
  onSelect,
  onReposition,
}: {
  anchorX: number;
  anchorY: number;
  pageId: string;
  isSelected: boolean;
  /** 2026-09-13 수정(뒤로 버튼 제거): 이동 후 뷰포트를 클릭 당시 마우스 위치에 맞추려면
   * (store/linkNavigationStore.ts의 navigateTo clientPoint 인자) pointerup의 clientX/Y가
   * 필요하다 — 그래서 인자 없는 콜백 대신 그 좌표를 그대로 넘긴다. */
  onNavigate: (clientX: number, clientY: number) => void;
  onSelect: () => void;
  onReposition: (anchor: LinkAnchor) => void;
}) {
  const pointerStart = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const [dragWorldPos, setDragWorldPos] = useState<{ x: number; y: number } | null>(null);
  // 요구사항 변경(2026-09-14): canvas-world는 pan/zoom을 transform:scale(zoom)으로
  // 적용하므로(Canvas.css .canvas-world 주석), 이 마커도 다른 world 객체(하이라이트,
  // 텍스트 등)와 완전히 같은 world 좌표계 안에 있다 — MARKER_SIZE를 그대로 폭/높이로
  // 쓰면 그 스케일을 그대로 받아서 줌에 따라 화면 크기가 같이 커졌다 작아졌다 한다.
  // 예전(2026-09-12)엔 이걸 "버그"로 보고 zoom으로 나눠 화면 크기를 고정했었지만,
  // 사용자 피드백으로 "다른 객체들처럼 줌에 따라 커지고 작아지는 게 맞다"로 뒤집혔다 —
  // 그래서 이제는 보정 없이 MARKER_SIZE를 그대로 world 크기로 쓴다.
  const sizeWorld = MARKER_SIZE;

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
    setDragWorldPos(clientToWorld({ x: e.clientX, y: e.clientY }, useViewportStore.getState()));
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
    setDragWorldPos(null);

    // 마커 자신은 지금 pointerEvents:none이라 elementFromPoint가 그 "아래" 진짜
    // 엘리먼트를 돌려준다 — useLinkTool.ts와 동일한 data-object-id closest 규칙.
    const dropTarget = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const objectId = dropTarget?.closest('[data-object-id]')?.getAttribute('data-object-id') ?? null;
    const world = clientToWorld({ x: e.clientX, y: e.clientY }, useViewportStore.getState());
    const targetObject = objectId ? useObjectsStore.getState().objects[objectId] : undefined;
    const anchor: LinkAnchor = {
      surface: 'page',
      pageId,
      objectId,
      x: world.x,
      y: world.y,
      ...(targetObject ? { anchorObjectX: targetObject.x, anchorObjectY: targetObject.y } : {}),
    };
    onReposition(anchor);
  };

  const handlePointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointerStart.current = null;
    draggingRef.current = false;
    setDragWorldPos(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const centerX = dragWorldPos ? dragWorldPos.x : anchorX;
  const centerY = dragWorldPos ? dragWorldPos.y : anchorY;

  return (
    <div
      data-link-marker="true"
      className={isSelected ? 'link-marker is-selected' : 'link-marker'}
      style={{
        position: 'absolute',
        left: centerX - sizeWorld / 2,
        top: centerY - sizeWorld / 2,
        width: sizeWorld,
        height: sizeWorld,
        zIndex: 9999,
        pointerEvents: dragWorldPos ? 'none' : 'auto',
        cursor: dragWorldPos ? 'grabbing' : 'pointer',
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
      {/* 바깥 div와 같은 world 크기(sizeWorld)를 그대로 넣는다 — 이 SVG도 canvas-world의
          transform:scale(zoom) 아래에서 함께 그려지므로 다른 world 객체처럼 줌에 따라
          자연스럽게 커지고 작아진다. */}
      <LinkIcon size={sizeWorld} />
    </div>
  );
}

/**
 * 메인 캔버스 위의 링크 마커들(Phase 9). Object의 world 좌표를 그대로 쓰는
 * objects/ObjectView.tsx와 마찬가지로 canvas-world(pan/zoom transform이 이미 걸린
 * 컨테이너) 안에 그려진다 — 그래서 이 컴포넌트 자신은 world 좌표 → screen 좌표 변환을
 * 전혀 신경 쓰지 않는다.
 *
 * 한 링크(source/target 두 anchor)가 이 Page를 가리키면 이 Page 쪽 anchor 위치에
 * 마커 하나가 뜬다 — source/target 어느 쪽이든 이 Page에 있으면 보이므로, 링크는
 * 사실상 양방향이다(만든 순서와 무관하게 양쪽 끝 모두에서 서로를 향해 이동할 수
 * 있다). 같은 링크의 두 anchor가 모두 이 Page에 있으면(같은 Page 안의 두 지점을
 * 잇는 링크) 마커 두 개가 각자 자리에 뜬다. 어느 쪽 anchor인지(side)는
 * updateAnchor(linkId, side, ...) 호출 시 source/target 중 무엇을 갈아끼울지
 * 알아야 하므로 entries에 같이 담아둔다.
 *
 * 클릭 동작(2026-09-11 확정, 2026-09-12 포인터 캡처로 재구현 + 드래그 재배치 추가):
 * 좌클릭(포인터 캡처 기반 클릭 판정, 위 LinkMarkerDot 주석 참고)은 곧바로
 * 이동한다(linkNavigationStore.navigateTo) — 원 스펙 "링크 클릭 시 이동"을 그대로.
 * 좌클릭 드래그는 마커를 놓은 자리로 그 anchor를 재배치한다(linkStore.updateAnchor).
 * 우클릭(onContextMenu)은 이동/재배치 없이 선택만 한다(interactionStore.fineSelection에
 * kind:'link'로 얹혀 PropertiesPanel의 "링크" 패널과 Delete 키 삭제가 바로 이어진다
 * — 다른 fine-selection과 완전히 같은 관례).
 *
 * 위치 계산(2026-09-12 수정): utils/linkAnchor.ts의 resolveAnchorPosition()에 위치
 * 계산을 위임한다 — objectId가 있으면 "클릭 당시 객체 안에서의 상대 위치"를 그대로
 * 보존해, 객체가 이동해도(요구사항: 객체 추적) 처음 클릭했던 자리를 계속 정확히
 * 가리킨다.
 */
export function LinkMarkersLayer() {
  const links = useLinkStore((s) => s.links);
  const objects = useObjectsStore((s) => s.objects);
  const currentPageId = useFileTreeStore((s) => s.currentPageId);
  const fineSelection = useInteractionStore((s) => s.fineSelection);
  // 요구사항(링크 생성 UX 개선, 2026-09-13): 🔗 도구로 첫 번째 지점을 클릭하면
  // linkDraftStore.pending에 그 anchor가 잠깐 담긴다(canvas/interaction/useLinkTool.ts) —
  // 이 Page가 그 지점이면 두 번째 클릭을 기다리는 동안 강조된 임시 마커를 보여준다.
  const pendingDraft = useLinkDraftStore((s) => s.pending);

  if (!currentPageId) return null;

  const entries: Array<{ key: string; link: LinkRecord; side: 'source' | 'target'; anchor: LinkAnchor; other: LinkAnchor }> = [];
  for (const link of Object.values(links)) {
    if (link.source.surface === 'page' && link.source.pageId === currentPageId) {
      entries.push({ key: `${link.id}:source`, link, side: 'source', anchor: link.source, other: link.target });
    }
    if (link.target.surface === 'page' && link.target.pageId === currentPageId) {
      entries.push({ key: `${link.id}:target`, link, side: 'target', anchor: link.target, other: link.source });
    }
  }

  const showDraft = pendingDraft?.surface === 'page' && pendingDraft.pageId === currentPageId;
  if (entries.length === 0 && !showDraft) return null;

  return (
    <>
      {entries.map(({ key, link, side, anchor, other }) => {
        const obj = anchor.objectId ? objects[anchor.objectId] : undefined;
        const pos = resolveAnchorPosition(anchor, obj);
        const isSelected = fineSelection?.kind === 'link' && fineSelection.linkId === link.id;

        return (
          <LinkMarkerDot
            key={key}
            anchorX={pos.x}
            anchorY={pos.y}
            pageId={anchor.pageId}
            isSelected={isSelected}
            onNavigate={(clientX, clientY) =>
              void useLinkNavigationStore.getState().navigateTo(other, { x: clientX, y: clientY })
            }
            onSelect={() => useInteractionStore.getState().selectFine({ kind: 'link', linkId: link.id, id: link.id })}
            onReposition={(newAnchor) => void useLinkStore.getState().updateAnchor(link.id, side, newAnchor)}
          />
        );
      })}
      {showDraft && (() => {
        const obj = pendingDraft.objectId ? objects[pendingDraft.objectId] : undefined;
        const pos = resolveAnchorPosition(pendingDraft, obj);
        return <LinkDraftMarker anchorX={pos.x} anchorY={pos.y} />;
      })()}
    </>
  );
}

/**
 * 요구사항(링크 생성 UX 개선, 2026-09-13): "첫 번째 지점 클릭 시 해당 위치에 임시
 * 링크 아이콘을 즉시 생성하고 테두리로 강조" — 실제 LinkMarkerDot과 달리 클릭/드래그에
 * 전혀 반응하지 않는 순수 표시용이다(아직 링크가 아니라 linkDraftStore.pending 하나뿐이라
 * 이동/재배치/선택할 대상 자체가 없다). 크기 계산은 LinkMarkerDot과 동일(MARKER_SIZE를
 * 그대로 world 크기로 — 위 상수 주석 참고) — 실제 마커와 시각적으로 같은 크기로
 * 보여야 하므로.
 */
function LinkDraftMarker({ anchorX, anchorY }: { anchorX: number; anchorY: number }) {
  const sizeWorld = MARKER_SIZE;
  return (
    <div
      className="link-marker is-draft"
      style={{
        position: 'absolute',
        left: anchorX - sizeWorld / 2,
        top: anchorY - sizeWorld / 2,
        width: sizeWorld,
        height: sizeWorld,
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    >
      <LinkIcon size={sizeWorld} />
    </div>
  );
}
