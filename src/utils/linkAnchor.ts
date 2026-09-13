import type { LinkAnchor } from '../types/link';

/**
 * LinkAnchor가 "지금" 가리키는 위치를 계산한다(2026-09-12 도입).
 *
 * objectId가 있고(anchor 생성 당시 필기 객체 위를 클릭) 그 객체가 아직 살아있으면,
 * anchor.x/y(클릭 시점의 절대 좌표)에서 anchor.anchorObjectX/Y(그 시점의 객체 원점)를
 * 뺀 차이 — 즉 "그 객체 안에서 클릭한 상대 위치" — 를 liveObject의 "지금" 원점에
 * 더해서 반환한다. 객체가 이동하면 이 상대 위치 그대로 함께 움직인다.
 *
 * objectId가 없거나(빈 공간 클릭) liveObject를 못 찾았으면(객체가 삭제됨) anchor에
 * 저장된 절대 좌표로 그대로 폴백한다.
 *
 * canvas/LinkMarkersLayer.tsx, canvas/pdf/PdfOverlayLinkMarkersLayer.tsx,
 * store/linkNavigationStore.ts 세 곳 모두 이 함수 하나로 "링크가 지금 어디를
 * 가리키는지"를 통일해서 계산한다 — 마커를 그리는 위치와 링크 클릭 시 이동해서
 * 화면 중앙에 맞출 위치가 서로 다른 계산식을 쓰면(예전엔 전자가 객체 모서리,
 * 후자가 객체 중심이었다) 어긋나기 쉽다.
 */
export function resolveAnchorPosition(
  anchor: LinkAnchor,
  liveObject: { x: number; y: number } | undefined
): { x: number; y: number } {
  if (liveObject && anchor.objectId && anchor.anchorObjectX !== undefined && anchor.anchorObjectY !== undefined) {
    return {
      x: liveObject.x + (anchor.x - anchor.anchorObjectX),
      y: liveObject.y + (anchor.y - anchor.anchorObjectY),
    };
  }
  return { x: anchor.x, y: anchor.y };
}
