/**
 * 내부 하이퍼링크(Phase 9, 2026-09) — Page↔Page, Page↔PDF, PDF↔PDF를 잇는 링크 하나.
 *
 * source/target 둘 다 같은 모양(LinkAnchor)을 쓴다 — "어디서 어디로"가 대칭적인
 * 개념이라(링크를 되짚어 갈 일은 없지만 구조상 구분할 이유가 없다) 타입을 굳이
 * 나누지 않는다.
 *
 * 요구사항(2026-09, 확정): PDF 타겟은 이번 라운드엔 "페이지 단위"까지만 지원한다 —
 * pageIndex로 이동하고 나면 그걸로 끝, 그 페이지 안 특정 좌표까지 스크롤/포커스하지
 * 않는다. 다만 나중에 "PDF의 특정 좌표"까지 링크할 수 있도록 x/y 필드는 pdf
 * surface에도 이미 존재한다 — 지금은 채워 넣기만 하고(클릭한 자리를 기록해두는
 * 정도) 실제 내비게이션(useLinkNavigationStore.navigateTo)은 이 값을 읽지 않는다.
 * 나중에 좌표 단위로 확장할 때는 새 필드를 추가하지 않고 이 x/y를 그대로 쓰기만
 * 하면 된다.
 *
 * 버그 수정(2026-09-12): objectId가 있을 때 "그 객체의 지금 위치"를 어떻게 계산할지가
 * 문제였다 — 예전엔 객체의 오른쪽 위 모서리에 고정으로 얹었는데, 그러면 텍스트 상자
 * 안 특정 글자를 클릭해 링크를 걸어도(하나의 텍스트 객체 안에서는 어디를 클릭하든
 * 같은 objectId가 잡히므로) 마커가 항상 모서리에 나타나 클릭한 자리와 전혀 달라
 * 보였다. 그래서 anchorObjectX/anchorObjectY(링크를 만든 "그 순간"의 객체 좌표)를
 * 함께 저장해 두고, utils/linkAnchor.ts의 resolveAnchorPosition()이
 * "x/y - anchorObjectX/Y"로 클릭 지점의 객체-상대 오프셋을 구한 뒤 그 객체의 "지금"
 * x/y에 더하는 방식으로 바꿨다 — 이러면 항상 클릭한 정확한 자리를 가리키면서도(요구:
 * 위치 기반) 객체가 이동하면 그 상대 위치 그대로 따라간다(요구: 객체 이동 추적).
 */
export interface LinkAnchor {
  /** 이 anchor가 메인 캔버스(Page) 위에 있는지, PDF 오버레이 위에 있는지. */
  surface: 'page' | 'pdf';
  /** 항상 채워진다 — page surface면 그 Page 자신의 id, pdf surface면 그 PDF가
   * 속한(=PdfLibraryRecord.pageId와 같은) Page의 id다. PDF로 이동하려면 먼저 이
   * Page를 열어야 PdfLibraryRail.tsx의 Page-스코프 목록에 그 PDF가 나타난다. */
  pageId: string;
  /** surface==='pdf'일 때만 의미 있음. */
  pdfId?: string;
  /** surface==='pdf'일 때만 의미 있음 — 0-based 페이지 인덱스. */
  pageIndex?: number;
  /** 클릭한 자리에 필기 객체(Text/Image/Arrow/Rectangle/Frame, PDF 쪽은 Frame 제외)가
   * 있었으면 그 객체 id. 있으면 렌더링 시 이 객체의 "지금" 위치를 따라간다(objectId가
   * 가리키는 객체가 지워졌으면 아래 x/y로 폴백). 빈 공간을 클릭했으면 null. */
  objectId?: string | null;
  /** 클릭 시점의 좌표 — page surface면 world 좌표, pdf surface면 페이지-로컬 좌표
   * (PDF_PAGE_REFERENCE_SCALE 기준, PdfOverlayObjectsLayer.tsx와 동일한 좌표계).
   * objectId가 없으면 이 값이 유일한 위치 기준이다. objectId가 있으면 이 값에서
   * anchorObjectX/Y를 뺀 차이가 "그 객체 안에서 클릭한 상대 위치"가 된다
   * (utils/linkAnchor.ts의 resolveAnchorPosition 참고). */
  x: number;
  y: number;
  /** objectId가 있을 때만 채워진다 — 링크를 만든 시점의 그 객체 x/y(오브젝트
   * 원점). resolveAnchorPosition이 "지금" 위치를 계산할 때 x/y와 짝지어 상대
   * 오프셋을 구하는 데만 쓰인다. objectId가 없으면(빈 공간 클릭) 존재하지 않는다. */
  anchorObjectX?: number;
  anchorObjectY?: number;
}

export interface LinkRecord {
  id: string;
  source: LinkAnchor;
  target: LinkAnchor;
  createdAt: number;
}
