import type { LinkAnchor, LinkRecord } from '../types/link';
import { useFileTreeStore } from '../storage/fileTreeStore';

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

/**
 * 요구사항(2026-09-16, "링크 아이콘 클릭 시 오른쪽 사이드바에 현재 페이지의 모든
 * 링크 목록 표시"): LinkAnchor 하나가 "어디로 연결되는지"를 사람이 읽을 수 있는
 * 문자열로 바꾼다 — canvas/PropertiesPanel.tsx의 LinkSection이 link.target 하나에
 * 대해서만 인라인으로 하던 계산을 임의의 anchor를 받도록 일반화했다. 이 파일(순수
 * 로직만 두는 곳 — 위 resolveAnchorPosition과 같은 이유)에 두는 이유는
 * canvas/PropertiesPanel.tsx가 컴포넌트 파일이라 순수 함수를 직접 export하면
 * oxlint의 react-refresh/only-export-components 경고가 나기 때문(objects/text/
 * annotationLayout.ts를 분리한 것과 동일한 이유).
 */
export function linkDestinationLabel(anchor: LinkAnchor): string {
  const pageName = useFileTreeStore.getState().pages[anchor.pageId]?.name ?? '(삭제된 페이지)';
  return anchor.surface === 'pdf' ? `${pageName} · PDF ${(anchor.pageIndex ?? 0) + 1}페이지` : pageName;
}

/** LinkAnchor가 "이 위치"(page surface면 pageId 일치 / pdf surface면 pdfId+pageIndex
 * 일치)를 가리키는지 — canvas/LinkMarkersLayer.tsx·canvas/pdf/PdfOverlayLinkMarkersLayer.tsx의
 * 필터링 규칙과 반드시 같아야 "마커가 보이는 페이지"와 "목록에 뜨는 링크"가 어긋나지
 * 않는다. `here.pdfId`가 있으면 PDF 오버레이 기준, 없으면 메인 캔버스(pageId) 기준으로
 * 판정한다 — 두 호출부(메인 캔버스/PDF 오버레이 PropertiesPanel)가 각자의 기준으로
 * 재사용한다. */
function matchesHere(anchor: LinkAnchor, here: { pageId?: string; pdfId?: string; pageIndex?: number }): boolean {
  if (here.pdfId !== undefined) {
    return anchor.surface === 'pdf' && anchor.pdfId === here.pdfId && anchor.pageIndex === here.pageIndex;
  }
  return anchor.surface === 'page' && anchor.pageId === here.pageId;
}

/** links(전체 레코드)에서 "이 위치"에 걸린 링크만 골라, 목록에 뿌릴 { id, label } 형태로
 * 정리한다 — 한 링크가 양쪽 anchor 모두 "이 위치"를 가리키면(같은 페이지/PDF 페이지
 * 안의 두 지점을 잇는 링크) target 쪽을 대표로 보여준다(기존 LinkSection이 어느 쪽을
 * 선택했든 항상 link.target만 보여주던 것과 같은 관례). */
export function collectPageLinkEntries(
  links: Record<string, LinkRecord>,
  here: { pageId?: string; pdfId?: string; pageIndex?: number },
): Array<{ id: string; label: string }> {
  const entries: Array<{ id: string; label: string }> = [];
  for (const link of Object.values(links)) {
    const sourceHere = matchesHere(link.source, here);
    const targetHere = matchesHere(link.target, here);
    if (!sourceHere && !targetHere) continue;
    const other = targetHere && !sourceHere ? link.source : link.target;
    entries.push({ id: link.id, label: linkDestinationLabel(other) });
  }
  return entries;
}
