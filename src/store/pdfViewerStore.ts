import { create } from 'zustand';

/**
 * PDF Reference Viewer의 열림/닫힘 + 크기 상태 — Phase 4(좌측 Library 레일)와 Phase 5
 * (실제 Viewer 패널) 사이의 접점. v2/v3에서 확정한 대로 Viewer는 한 번에 하나만 연다
 * (동시에 여러 PDF를 열지 않음 — 그래서 "열려 있는 pdfId 하나"만 있으면 충분하고,
 * 목록이 아니다).
 *
 * currentPageIndex(지금 뷰어에 표시 중인 페이지)도 여기서 같이 관리한다 — Phase 5의 좌우
 * 페이지 이동/필름스트립 UI와, "마지막으로 본 페이지 복원"(PdfLibraryRecord.
 * lastViewedPageIndex, pdfLibraryStore.setLastViewedPageIndex로 씀)이 이 store 하나만
 * 보면 되게 하기 위해서다.
 *
 * Canvas의 world 좌표/줌과는 완전히 무관하다 — 이 store는 화면 고정 UI 상태일 뿐이다.
 */
const WIDTH_STORAGE_KEY = 'my-note-web:pdf-viewer-width';
export const PDF_VIEWER_DEFAULT_WIDTH = 420;
export const PDF_VIEWER_MIN_WIDTH = 320;
/** 화면폭의 65% — Canvas가 완전히 안 보이게 되는 상황 방지(v3 §1-3). */
export function pdfViewerMaxWidth(): number {
  return Math.round(window.innerWidth * 0.65);
}

function readInitialWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_STORAGE_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed)) return clampWidth(parsed);
  } catch {
    // localStorage 접근 불가(프라이빗 모드 등) — 기본값으로 진행.
  }
  return PDF_VIEWER_DEFAULT_WIDTH;
}

function clampWidth(width: number): number {
  return Math.min(pdfViewerMaxWidth(), Math.max(PDF_VIEWER_MIN_WIDTH, width));
}

/**
 * 요구사항(2026-09, "PDF 위에서 Ctrl+스크롤로 확대"): Viewer 패널 폭(width)과는 별개로,
 * 페이지 자체를 확대해서 보는 배율. 1이 기본(패널에 맞춰 꽉 차는 크기, 기존 동작과
 * 100% 동일)이고, 그보다 작게는 못 내려간다 — 이미 "패널에 맞춰 최대로 채운" 상태가
 * 1이라 그 밑으로 줄이면 빈 여백만 늘어나 쓸모가 없다고 판단했다. usePdfViewerZoom.ts가
 * Ctrl+휠로 이 값을 바꾸고, PdfViewerPanel.tsx가 `.pdf-viewer-page`에
 * `transform: scale(pageZoom)`으로 반영한다 — getBoundingClientRect()로 실측하는
 * displayScale(PdfOverlayObjectsLayer.tsx)이 transform 이후 크기를 그대로 읽으므로,
 * 확대할수록 그 안의 글자/오버레이 객체도 자연스럽게 같이 커진다(추가 보정 코드 불필요).
 */
export const PDF_PAGE_ZOOM_MIN = 1;
export const PDF_PAGE_ZOOM_MAX = 4;
function clampPageZoom(zoom: number): number {
  return Math.min(PDF_PAGE_ZOOM_MAX, Math.max(PDF_PAGE_ZOOM_MIN, zoom));
}

/**
 * 요구사항(2026-09-16, "PDF 이동을 SPACE+드래그로"): panX/panY는 확대된 페이지를
 * 화면 안에서 얼마나 옮겨 보고 있는지(screen px 단위, transform:translate로 적용)를
 * 담는다. 메인 캔버스의 viewportStore.panBy와 같은 "화면 px 델타를 그대로 더한다"
 * 방식이라 별도 클램프가 없다 — 대신 페이지/PDF를 바꾸거나(openViewer/closeViewer/
 * setCurrentPageIndex) 배율이 최소(1배, 패널에 꼭 맞는 크기)로 돌아가면 0,0으로
 * 되돌려서 "옮길 이유가 없는 상태"에서 페이지가 화면 밖으로 사라진 채 남지 않게 한다
 * (canvas/pdf/usePdfViewerPan.ts가 이 값을 갱신한다).
 */

/** index.css의 --pdf-rail-offset(58px)과 같은 값 — PdfLibraryRail 오른쪽에서 Viewer
 * 패널이 시작되기까지의 고정 여백. CSS 변수를 JS에서 매번 getComputedStyle로 읽어오는
 * 대신 상수로 들고 있다(단순함 우선) — index.css 쪽 값을 바꾸면 이 값도 같이 맞출 것. */
const PDF_VIEWER_RAIL_OFFSET = 58;
/** Viewer 패널 오른쪽과 Canvas 사이에 남겨두는 여백. */
const PDF_VIEWER_CANVAS_GAP = 12;

/** canvas-root(Canvas.css)가 `left: calc(var(--file-tree-width) + var(--pdf-viewer-shift))`로
 * 이 값을 그대로 읽는다 — fileTreeUiStore.ts의 --file-tree-width와 완전히 같은 관례
 * (열려 있지 않을 땐 0으로 되돌려, Canvas 가시 영역이 원래대로 돌아오게 한다). Viewer
 * 패널 자신의 화면 위치(PdfViewerPanel.css)는 이 값과 무관하게 --pdf-rail-offset 기준의
 * 고정 left를 쓴다 — 여기서 계산하는 건 "Canvas가 얼마나 밀려나야 하는지"뿐이다. */
function applyShiftCssVar(isOpen: boolean, width: number) {
  const shift = isOpen ? PDF_VIEWER_RAIL_OFFSET + width + PDF_VIEWER_CANVAS_GAP : 0;
  document.documentElement.style.setProperty('--pdf-viewer-shift', `${shift}px`);
}

/**
 * 요구사항(내부 하이퍼링크, Phase 9): Page→PDF 링크로 이동하면 store/linkNavigationStore.ts가
 * fileTreeStore.openPage(다른 Page)를 부른 직후 이 store의 openViewer를 부른다. 그런데
 * canvas/pdf/PdfLibraryRail.tsx는 "currentPageId가 바뀌면 그 Page엔 아직 없을 수도 있는
 * 이전 Viewer를 닫는다"는 별개의 기존 규칙을 갖고 있어서(PdfLibraryRail.tsx의 currentPageId
 * effect 참고), 두 로직이 겹치면 방금 연 Viewer가 그 effect에 의해 곧바로 닫혀버리는
 * 경쟁 상태가 생긴다. storage/fileTreeStore.ts의 suppressAutosave와 같은 "모듈 전역
 * 1회성 플래그" 패턴으로 해결한다 — openPage를 부르기 직전에 켜두면, 뒤이어 실제로
 * 발동하는 PdfLibraryRail의 effect가 자기 차례에 딱 한 번만 건너뛰고 스스로 끈다(아래
 * consumeSuppressNextAutoClose). effect가 아예 발동하지 않는 경우(같은 Page 안에서
 * PDF만 바꾸는 등 currentPageId 자체가 안 바뀌는 경우)에도 다음 진짜 Page 전환 때
 * 엉뚱하게 소비되지 않도록, 호출부(linkNavigationStore.ts)는 실제로 Page가 바뀔 때만
 * 이 함수를 부른다.
 */
let suppressNextAutoClose = false;
export function markSuppressNextAutoClose(): void {
  suppressNextAutoClose = true;
}
/** PdfLibraryRail.tsx 전용 — 플래그를 읽고 그 자리에서 바로 꺼서(1회성) 매번 새로
 * 소비된다. */
export function consumeSuppressNextAutoClose(): boolean {
  const value = suppressNextAutoClose;
  suppressNextAutoClose = false;
  return value;
}

interface PdfViewerState {
  openPdfId: string | null;
  currentPageIndex: number;
  width: number;
  /** 페이지 확대 배율(위 PDF_PAGE_ZOOM_MIN/MAX 설명 참고). PDF를 열거나 페이지를
   * 넘길 때마다 1로 되돌린다(아래 openViewer/closeViewer/setCurrentPageIndex). */
  pageZoom: number;
  /** 위 panX/panY 설명 참고 — screen px 단위 이동량. */
  panX: number;
  panY: number;
  /** canvas/pdf/usePdfViewerPan.ts가 window keydown/keyup으로 갱신 — 다른 PDF 오버레이
   * 포인터 도구들(형광펜/도형/텍스트/이미지 드래그 생성, 기존 객체 이동, 링크 마커
   * 드래그)이 "지금 스페이스로 화면을 옮기는 중인지"를 getState()로 바로 확인해서,
   * 자기 자신의 드래그/그리기를 시작하지 않게 한다(메인 캔버스 objects/ObjectView.tsx가
   * Canvas.tsx로부터 usePan()의 isSpacePressed를 prop으로 내려받는 것과 같은 목적을
   * store 하나로 대신한다 — PDF 쪽은 이 값을 필요로 하는 훅/컴포넌트가 여러 파일에
   * 흩어져 있어 prop 전달보다 전역 상태가 더 단순하다). */
  isSpacePressed: boolean;

  /** Library에서 PDF를 클릭했을 때 호출. pageIndex 생략 시 0페이지(첫 페이지)부터. */
  openViewer: (pdfId: string, pageIndex?: number) => void;
  closeViewer: () => void;
  setCurrentPageIndex: (pageIndex: number) => void;
  /** 리사이즈 중(매 pointermove)마다 호출 — localStorage에는 쓰지 않는다(너무 잦음). */
  setWidth: (width: number) => void;
  /** 리사이즈가 끝났을 때(pointerup) 한 번만 호출해 localStorage에 반영한다. */
  commitWidth: () => void;
  /** Ctrl+휠(usePdfViewerZoom.ts)마다 호출. */
  setPageZoom: (zoom: number) => void;
  /** Space+드래그(usePdfViewerPan.ts)/일반 휠(usePdfViewerZoom.ts) 둘 다 이 액션으로
   * 이동한다 — screen px 델타를 그대로 더한다(viewportStore.panBy와 같은 방식). */
  panBy: (dx: number, dy: number) => void;
  setSpacePressed: (pressed: boolean) => void;
}

const initialWidth = readInitialWidth();

export const usePdfViewerStore = create<PdfViewerState>((set, get) => ({
  openPdfId: null,
  currentPageIndex: 0,
  width: initialWidth,
  pageZoom: 1,
  panX: 0,
  panY: 0,
  isSpacePressed: false,

  openViewer: (pdfId, pageIndex = 0) => {
    set({ openPdfId: pdfId, currentPageIndex: pageIndex, pageZoom: 1, panX: 0, panY: 0 });
    applyShiftCssVar(true, get().width);
  },
  closeViewer: () => {
    set({ openPdfId: null, pageZoom: 1, panX: 0, panY: 0 });
    applyShiftCssVar(false, get().width);
  },
  setCurrentPageIndex: (pageIndex) => set({ currentPageIndex: pageIndex, pageZoom: 1, panX: 0, panY: 0 }),
  setPageZoom: (zoom) => {
    const clamped = clampPageZoom(zoom);
    // 배율이 최소(1배, 패널에 꼭 맞는 기본 크기)로 돌아가면 pan도 같이 0으로 되돌린다 —
    // 안 그러면 이전에 옮겨둔 위치가 남아 있어 "확대 안 한 페이지가 화면 밖으로 밀려나
    // 보이지 않는" 상태가 될 수 있다(위 panX/panY 주석 참고).
    if (clamped === PDF_PAGE_ZOOM_MIN) {
      set({ pageZoom: clamped, panX: 0, panY: 0 });
    } else {
      set({ pageZoom: clamped });
    }
  },
  panBy: (dx, dy) => set((s) => ({ panX: s.panX + dx, panY: s.panY + dy })),
  setSpacePressed: (pressed) => set({ isSpacePressed: pressed }),
  setWidth: (width) => {
    const clamped = clampWidth(width);
    set({ width: clamped });
    if (get().openPdfId) applyShiftCssVar(true, clamped);
  },
  commitWidth: () => {
    try {
      localStorage.setItem(WIDTH_STORAGE_KEY, String(get().width));
    } catch {
      // 저장 실패해도 이번 세션 동작에는 지장 없다 — 다음에 열 때 기본값으로 돌아갈 뿐.
    }
  },
}));
