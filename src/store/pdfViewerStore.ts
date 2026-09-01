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

interface PdfViewerState {
  openPdfId: string | null;
  currentPageIndex: number;
  width: number;

  /** Library에서 PDF를 클릭했을 때 호출. pageIndex 생략 시 0페이지(첫 페이지)부터. */
  openViewer: (pdfId: string, pageIndex?: number) => void;
  closeViewer: () => void;
  setCurrentPageIndex: (pageIndex: number) => void;
  /** 리사이즈 중(매 pointermove)마다 호출 — localStorage에는 쓰지 않는다(너무 잦음). */
  setWidth: (width: number) => void;
  /** 리사이즈가 끝났을 때(pointerup) 한 번만 호출해 localStorage에 반영한다. */
  commitWidth: () => void;
}

const initialWidth = readInitialWidth();

export const usePdfViewerStore = create<PdfViewerState>((set, get) => ({
  openPdfId: null,
  currentPageIndex: 0,
  width: initialWidth,

  openViewer: (pdfId, pageIndex = 0) => {
    set({ openPdfId: pdfId, currentPageIndex: pageIndex });
    applyShiftCssVar(true, get().width);
  },
  closeViewer: () => {
    set({ openPdfId: null });
    applyShiftCssVar(false, get().width);
  },
  setCurrentPageIndex: (pageIndex) => set({ currentPageIndex: pageIndex }),
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
