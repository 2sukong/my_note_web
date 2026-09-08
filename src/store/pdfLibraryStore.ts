import { create } from 'zustand';
import {
  deleteAllOverlaysForPdf,
  deleteLibraryRecord,
  deleteOverlay,
  deleteRasterCache,
  deleteRasterCacheForPdf,
  getLibraryRecordsForPage,
  getOverlay,
  getOverlayPageIndexesForPdf as dbGetOverlayPageIndexesForPdf,
  getRasterCache,
  putLibraryRecord,
  putOverlay,
  putRasterCache,
} from '../storage/pdfLibraryDb';
import { openPdfDocument, renderPdfPage } from '../objects/pdf/pdfRaster';
import type { PdfLibraryRecord, PdfPageOverlay } from '../types/pdf';
import type { PDFDocumentProxy } from 'pdfjs-dist';

/**
 * PDF Library — 좌측 레일이 읽는 상태. v3 §1-1 확정대로 **Page 단위 스코프**다: 이
 * store는 "지금 열려 있는 Page의 PDF 목록"만 메모리에 들고 있고, Page를 전환하면
 * `loadForPage`를 다시 불러 갈아끼운다(File 트리 전체를 미리 다 읽어두지 않음 — Page가
 * 많아져도 이 store의 메모리 사용량은 늘지 않는다).
 *
 * 여기 없는 것들(의도적으로 분리):
 * - overlay(페이지 위 필기) 편집 상태 — Phase 6의 `pdfOverlayStore.ts`가 별도로 담당한다.
 *   이 store는 overlay를 "통째로 읽고 쓰는" 낮은 수준의 함수(loadPageOverlay/
 *   savePageOverlay, 아래)만 제공한다.
 * - 페이지 래스터의 object URL 캐시(§ rasterUrlCache, 아래) — 컴포넌트 상태가 아니라
 *   모듈 전역 Map이다. imageStore.ts와 같은 이유(object URL 생성 자체가 페이지 전환마다
 *   반복되면 낭비)이지만, refCount는 두지 않는다 — Library PDF의 래스터는 CanvasObject가
 *   참조하는 게 아니라 Viewer가 "지금 보여줄 필요가 있을 때"만 쓰는 것이라 그 생명주기가
 *   다르다(Viewer가 닫히거나 다른 페이지로 넘어가면 `releaseRasterUrlsForPdf`로 명시적으로
 *   정리한다).
 */
interface PdfLibraryState {
  /** 마지막으로 loadForPage를 호출한 pageId. */
  loadedPageId: string | null;
  entries: PdfLibraryRecord[];
  isLoading: boolean;

  loadForPage: (pageId: string) => Promise<void>;
  importPdf: (pageId: string, file: File) => Promise<PdfLibraryRecord>;
  renamePdf: (id: string, name: string) => Promise<void>;
  removePdf: (id: string) => Promise<void>;
  setLastViewedPageIndex: (id: string, pageIndex: number) => Promise<void>;
}

/** loadForPage가 비동기로 기다리는 동안 사용자가 이미 다른 Page로 넘어갔을 수 있다 —
 * 그 사이 도착한 결과를 그냥 덮어쓰면 "방금 막 떠난 Page의 목록"이 화면에 잘못 남는
 * 경쟁 상태가 생긴다. 매 호출마다 토큰을 새로 발급하고, await 이후 그 토큰이 여전히
 * 최신일 때만 반영한다(CanvasSearch.tsx가 currentPageId 변경 시 검색창을 닫는 것과
 * 같은 종류의 "Page 전환 시 이전 비동기 결과 무시" 패턴). */
let loadRequestToken = 0;

export const usePdfLibraryStore = create<PdfLibraryState>((set, get) => ({
  loadedPageId: null,
  entries: [],
  isLoading: false,

  loadForPage: async (pageId) => {
    const token = ++loadRequestToken;
    set({ isLoading: true });
    const entries = await getLibraryRecordsForPage(pageId);
    if (token !== loadRequestToken) return; // 그 사이 다른 Page로 전환됨 — 이 결과는 버린다
    set({ entries, loadedPageId: pageId, isLoading: false });
  },

  importPdf: async (pageId, file) => {
    const sourceBytes = await file.arrayBuffer();
    // pdfjs가 내부에서 이 버퍼를 detach할 수 있으므로, DB에 저장할 원본은 별도 복사본을
    // 쓴다(아래 openPdfDocument에 넘기는 것과 저장하는 것을 같은 참조로 공유하지 않음).
    const doc = await openPdfDocument(sourceBytes.slice(0));
    const now = Date.now();
    const record: PdfLibraryRecord = {
      id: crypto.randomUUID(),
      pageId,
      name: file.name.replace(/\.pdf$/i, ''),
      pageCount: doc.numPages,
      createdAt: now,
      updatedAt: now,
      sourceBytes,
    };
    await putLibraryRecord(record);
    if (get().loadedPageId === pageId) {
      set({ entries: [...get().entries, record] });
    }
    return record;
  },

  renamePdf: async (id, name) => {
    const existing = get().entries.find((e) => e.id === id);
    if (!existing) return;
    const updated: PdfLibraryRecord = { ...existing, name, updatedAt: Date.now() };
    await putLibraryRecord(updated);
    set({ entries: get().entries.map((e) => (e.id === id ? updated : e)) });
  },

  removePdf: async (id) => {
    const existing = get().entries.find((e) => e.id === id);
    set({ entries: get().entries.filter((e) => e.id !== id) });
    await deleteLibraryRecord(id);
    releaseRasterUrlsForPdf(id);
    await deleteRasterCacheForPdf(id);
    if (existing) await deleteAllOverlaysForPdf(id, existing.pageCount);
  },

  setLastViewedPageIndex: async (id, pageIndex) => {
    const existing = get().entries.find((e) => e.id === id);
    if (!existing) return;
    // 버그 수정(2026-08, 중대): 값이 실제로 안 바뀌었어도 매번 새 객체(스프레드)를 만들어
    // entries를 통째로 교체하고 있었다 — PdfViewerPanel.tsx의 `record = entries.find(...)`가
    // 그래서 값은 같아도 매 호출마다 "다른 참조"가 되고, `useEffect(..., [record, ...])`로
    // 걸려 있는 다른 effect(특히 Phase 6의 pdfOverlayStore.loadForPage)가 매번 다시
    // 실행됐다 — 그 effect는 이 컴포넌트가 currentPageIndex를 볼 때마다 다시 부르는데,
    // 여기서 부르는 setLastViewedPageIndex 자신도 매번 이 함수를 다시 트리거하므로
    // (같은 id/pageIndex로 계속) 사실상 무한 루프가 됐다. loadForPage가 이 루프에 걸려
    // 반복 호출될 때마다 undo/redo 스택을 초기화하고 IndexedDB의 저장된 상태로 덮어써서,
    // "형광펜이 랜덤하게 사라짐"과 "Ctrl+Z가 안 먹힘" 둘 다의 실제 원인이었다. 값이 같으면
    // 아예 아무 것도 하지 않도록 막아 참조 안정성을 되찾는다.
    if (existing.lastViewedPageIndex === pageIndex) return;
    const updated: PdfLibraryRecord = { ...existing, lastViewedPageIndex: pageIndex };
    await putLibraryRecord(updated);
    set({ entries: get().entries.map((e) => (e.id === id ? updated : e)) });
  },
}));

// ── 페이지 래스터: 온디맨드 렌더링 + 소규모 object URL 캐시(v3 §1-4) ────────────

/** pdfId별로 한 번 연 PDFDocumentProxy를 재사용한다(같은 PDF의 페이지를 여러 장 볼 때마다
 * 매번 원본 바이트를 새로 파싱하지 않도록). Viewer가 닫히면 releaseRasterUrlsForPdf가
 * 이것도 함께 정리한다. */
const openDocCache = new Map<string, Promise<PDFDocumentProxy>>();
/** `${pdfId}:${pageIndex}` → object URL(+치수). IndexedDB의 rasterCache와는 별개로,
 * 이번 세션에서 실제로 렌더링해서 화면에 보여준 페이지만 메모리에 들고 있는다 — url과
 * width/height를 같이 두어서, 이미 떠 있는 페이지를 다시 요청할 때 IndexedDB를 또 읽지
 * 않아도 되게 한다. */
const rasterUrlCache = new Map<string, { url: string; width: number; height: number }>();
/** IndexedDB에 영구 캐싱해두는 페이지 수 — "최근 본 1~2페이지 정도"라는 v3 §1-4 결정을
 * pdfId당 최근 2개로 구체화했다. 그 이상은 캐시하지 않고(용량), 필요하면 그때그때 다시
 * pdfRaster.ts로 렌더링한다(원본은 항상 있으므로 언제든 재현 가능). */
const MAX_PERSISTED_RASTER_PAGES_PER_PDF = 2;
const recentlyPersistedPages = new Map<string, string[]>(); // pdfId → 최근 캐싱한 rasterCache id(오래된 것부터)

function openDocCached(record: PdfLibraryRecord): Promise<PDFDocumentProxy> {
  const cached = openDocCache.get(record.id);
  if (cached) return cached;
  const promise = openPdfDocument(record.sourceBytes.slice(0));
  openDocCache.set(record.id, promise);
  return promise;
}

/**
 * 페이지 하나를 화면에 보여줄 object URL을 반환한다. 순서: (1) 이번 세션 메모리 캐시,
 * (2) IndexedDB 영구 캐시(있으면), (3) 없으면 원본에서 즉석 렌더링 — 렌더링한 결과는
 * "최근 본 페이지"로 소규모 영구 캐시에 넣는다(오래된 것부터 밀어냄).
 */
export async function getPdfPageRasterUrl(
  record: PdfLibraryRecord,
  pageIndex: number,
): Promise<{ url: string; width: number; height: number }> {
  const key = `${record.id}:${pageIndex}`;

  const cached = rasterUrlCache.get(key);
  if (cached) return cached;

  const persisted = await getRasterCache(key);
  if (persisted) {
    const url = URL.createObjectURL(persisted.blob);
    const entry = { url, width: persisted.width, height: persisted.height };
    rasterUrlCache.set(key, entry);
    return entry;
  }

  const doc = await openDocCached(record);
  const rendered = await renderPdfPage(doc, pageIndex);
  const url = URL.createObjectURL(rendered.blob);
  const entry = { url, width: rendered.width, height: rendered.height };
  rasterUrlCache.set(key, entry);

  await putRasterCache({
    id: key,
    pdfId: record.id,
    pageIndex,
    blob: rendered.blob,
    width: rendered.width,
    height: rendered.height,
  });
  await trimPersistedRasterCache(record.id, key);

  return entry;
}

/** pdfId당 IndexedDB에 영구 캐싱해두는 페이지 수를 MAX_PERSISTED_RASTER_PAGES_PER_PDF로
 * 제한한다("최근 본 것부터" LRU) — rasterCache에서만 지우고, 이미 화면에 떠 있을 수 있는
 * object URL(rasterUrlCache)은 건드리지 않는다(Viewer가 닫힐 때 releaseRasterUrlsForPdf가
 * 한 번에 정리). 원본 PDF 바이트는 항상 남아있으므로 캐시에서 밀려난 페이지도 다음에
 * 다시 보면 즉석 재렌더링될 뿐 데이터가 사라지는 것은 아니다. */
async function trimPersistedRasterCache(pdfId: string, justAddedKey: string): Promise<void> {
  const list = recentlyPersistedPages.get(pdfId) ?? [];
  const next = [...list.filter((k) => k !== justAddedKey), justAddedKey];
  while (next.length > MAX_PERSISTED_RASTER_PAGES_PER_PDF) {
    const evicted = next.shift();
    if (!evicted) break;
    await deleteRasterCache(evicted);
  }
  recentlyPersistedPages.set(pdfId, next);
}

/** Viewer가 닫히거나 다른 PDF로 넘어갈 때 호출 — 이번 세션에서 만든 object URL을 전부
 * 해제하고(메모리 누수 방지), 열어뒀던 PDFDocumentProxy 참조도 비운다. IndexedDB에
 * 영구 캐싱된 최근 페이지(§ trimPersistedRasterCache)는 그대로 남아있어 다음에 다시
 * 열 때 즉시 보여줄 수 있다. */
export function releaseRasterUrlsForPdf(pdfId: string): void {
  for (const [key, entry] of rasterUrlCache) {
    if (key.startsWith(`${pdfId}:`)) {
      URL.revokeObjectURL(entry.url);
      rasterUrlCache.delete(key);
    }
  }
  openDocCache.delete(pdfId);
  recentlyPersistedPages.delete(pdfId);
}

// ── overlay(페이지 위 필기) — 낮은 수준의 읽기/쓰기만. 편집 상태는 Phase 6 담당 ──────

export function loadPageOverlay(pdfId: string, pageIndex: number): Promise<PdfPageOverlay | undefined> {
  return getOverlay(`${pdfId}:${pageIndex}`);
}

export function savePageOverlay(overlay: PdfPageOverlay): Promise<void> {
  return putOverlay(overlay);
}

export function removePageOverlay(pdfId: string, pageIndex: number): Promise<void> {
  return deleteOverlay(`${pdfId}:${pageIndex}`);
}

/** 요구사항(2026-09, 필름스트립 빨간 테두리): 이 pdfId에서 실제로 필기가 저장된
 * 페이지 인덱스 목록. storage/pdfLibraryDb.ts의 저수준 함수를 그대로 얇게 감싼다 —
 * 위 loadPageOverlay/savePageOverlay/removePageOverlay와 같은 계층(overlay를
 * "통째로 읽고 쓰는" 낮은 수준)에 둔다. */
export function getOverlayPageIndexesForPdf(pdfId: string): Promise<number[]> {
  return dbGetOverlayPageIndexesForPdf(pdfId);
}
