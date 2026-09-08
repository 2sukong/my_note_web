import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import type { PdfLibraryRecord, PdfPageOverlay, PdfPageRasterCache } from '../types/pdf';

/**
 * PDF Library/Viewer/Overlay 전용 독립 IndexedDB.
 *
 * 메인 `storage/db.ts`(files/pages/pageObjects/images)를 직접 확장하지 않는다 — 이
 * 프로젝트는 이미 완전히 독립적인 기능(커스텀 폰트, `store/fontPersistence.ts`)을 메인
 * db 대신 별도 IndexedDB 데이터베이스(`my-note-web-fonts`)로 분리해서 저장한 전례가
 * 있다. PDF Library도 같은 이유로 새 DB를 연다 — 메인 db의 `DB_VERSION` 마이그레이션을
 * 신경 쓸 필요가 전혀 없고, 두 기능이 완전히 독립적으로 진화할 수 있다.
 */

interface PdfLibraryDBSchema extends DBSchema {
  library: { key: string; value: PdfLibraryRecord; indexes: { pageId: string } };
  overlays: { key: string; value: PdfPageOverlay; indexes: { pdfId: string } };
  rasterCache: { key: string; value: PdfPageRasterCache; indexes: { pdfId: string } };
}

const DB_NAME = 'my-note-web-pdf-library';
const DB_VERSION = 2; // v2(2026-09): overlays 스토어에 pdfId 인덱스 추가(필름스트립 빨간
// 테두리 표시용 — 특정 PDF의 필기 있는 페이지 목록을 pageCount만큼 개별 get() 없이
// 인덱스 한 번으로 조회하기 위함, § getOverlayPageIndexesForPdf 참고).

let dbPromise: Promise<IDBPDatabase<PdfLibraryDBSchema>> | null = null;

function getDB(): Promise<IDBPDatabase<PdfLibraryDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<PdfLibraryDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, _oldVersion, _newVersion, transaction) {
        if (!db.objectStoreNames.contains('library')) {
          const store = db.createObjectStore('library', { keyPath: 'id' });
          store.createIndex('pageId', 'pageId');
        }
        // v1→v2: 이미 'overlays' 스토어가 있는 기존 사용자 DB에는 새 인덱스만 추가하고,
        // 완전히 새로 만드는 경우엔 스토어 생성과 동시에 인덱스를 건다 — 둘 다
        // PdfPageOverlay.pdfId 필드(스토어 생성 이후로 스키마 변경 없음)를 그대로 인덱싱하므로
        // 기존 레코드에 대한 별도 마이그레이션(데이터 백필)이 필요 없다.
        const overlaysStore = db.objectStoreNames.contains('overlays')
          ? transaction.objectStore('overlays')
          : db.createObjectStore('overlays', { keyPath: 'id' });
        if (!overlaysStore.indexNames.contains('pdfId')) {
          overlaysStore.createIndex('pdfId', 'pdfId');
        }
        if (!db.objectStoreNames.contains('rasterCache')) {
          const store = db.createObjectStore('rasterCache', { keyPath: 'id' });
          store.createIndex('pdfId', 'pdfId');
        }
      },
    });
  }
  return dbPromise;
}

// ── library ──────────────────────────────────────────────────────────────

export async function putLibraryRecord(record: PdfLibraryRecord): Promise<void> {
  const db = await getDB();
  await db.put('library', record);
}

export async function getLibraryRecordsForPage(pageId: string): Promise<PdfLibraryRecord[]> {
  const db = await getDB();
  return db.getAllFromIndex('library', 'pageId', pageId);
}

export async function deleteLibraryRecord(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('library', id);
}

// ── overlays ─────────────────────────────────────────────────────────────

export async function getOverlay(overlayId: string): Promise<PdfPageOverlay | undefined> {
  const db = await getDB();
  return db.get('overlays', overlayId);
}

export async function putOverlay(overlay: PdfPageOverlay): Promise<void> {
  const db = await getDB();
  await db.put('overlays', overlay);
}

export async function deleteOverlay(overlayId: string): Promise<void> {
  const db = await getDB();
  await db.delete('overlays', overlayId);
}

/** PDF 자체를 삭제할 때(Library에서 "삭제") 그 PDF에 속한 모든 페이지의 overlay를
 * 한 번에 정리하기 위한 함수. overlay id는 항상 `${pdfId}:${pageIndex}` 형태라
 * pageCount만큼 순회하며 지운다(존재하지 않는 id를 delete해도 idb는 에러를 던지지
 * 않으므로 실제로 필기가 있었는지 미리 확인할 필요가 없다). */
export async function deleteAllOverlaysForPdf(pdfId: string, pageCount: number): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('overlays', 'readwrite');
  await Promise.all(
    Array.from({ length: pageCount }, (_, pageIndex) => tx.store.delete(`${pdfId}:${pageIndex}`)),
  );
  await tx.done;
}

/** 요구사항(2026-09, 필름스트립 빨간 테두리): 이 pdfId에 속한 페이지 중 실제로 필기
 * 레코드가 있는 페이지 인덱스만 뽑아온다. overlay id가 항상 `${pdfId}:${pageIndex}`
 * 형태(위 deleteAllOverlaysForPdf와 동일 전제)이므로, pdfId 인덱스로 해당하는 기본 키만
 * 가져와(getAllKeysFromIndex — 값 전체가 아니라 키만 읽으므로 objects/pageHighlights
 * payload를 불필요하게 불러오지 않는다) ':' 뒤의 pageIndex만 파싱한다. */
export async function getOverlayPageIndexesForPdf(pdfId: string): Promise<number[]> {
  const db = await getDB();
  const keys = await db.getAllKeysFromIndex('overlays', 'pdfId', pdfId);
  return keys
    .map((key) => Number(String(key).slice(pdfId.length + 1)))
    .filter((n) => Number.isInteger(n) && n >= 0);
}

// ── raster cache (파생 데이터 — v3 §1-4, 전체가 아니라 소수 페이지만 캐싱) ──────

export async function getRasterCache(id: string): Promise<PdfPageRasterCache | undefined> {
  const db = await getDB();
  return db.get('rasterCache', id);
}

export async function putRasterCache(entry: PdfPageRasterCache): Promise<void> {
  const db = await getDB();
  await db.put('rasterCache', entry);
}

export async function deleteRasterCache(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('rasterCache', id);
}

export async function deleteRasterCacheForPdf(pdfId: string): Promise<void> {
  const db = await getDB();
  const keys = await db.getAllKeysFromIndex('rasterCache', 'pdfId', pdfId);
  const tx = db.transaction('rasterCache', 'readwrite');
  await Promise.all(keys.map((key) => tx.store.delete(key)));
  await tx.done;
}
