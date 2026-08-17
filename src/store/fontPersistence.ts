import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';

/**
 * 요구사항(폰트 목록 통합): 새로 추가한 폰트가 새로고침 후에도 유지되어야 한다.
 * fontStore.customFonts는 지금까지 세션 메모리(document.fonts에 등록된 FontFace
 * 참조)에만 있었다 — FontFace 객체 자체는 직렬화할 수 없으므로, 실제로 저장하는
 * 것은 "복원에 필요한 원본 바이트 + 메타데이터"(id/label/family)이고, 불러올 때
 * 그 바이트로 FontFace를 다시 만들어 document.fonts에 등록한다.
 *
 * 외부 API/서비스에 의존하지 않고 로컬에만 저장한다는 프로젝트 원칙에 따라
 * IndexedDB(브라우저 로컬 저장소)를 쓴다 — localStorage는 문자열만 다룰 수 있어
 * 바이너리 폰트 파일에는 맞지 않는다(이미 설치돼 있던 idb 래퍼 라이브러리를 그대로
 * 사용, 새 외부 의존성 추가 아님).
 */
interface FontRecord {
  id: string;
  label: string;
  /** 이 레코드로 되살릴 때도 항상 같은 family 이름을 써야 한다 — 이미 저장된
   * TextObject.fontFamily/TextAnnotation.fontFamily 문자열이 이 값을 그대로
   * 참조하고 있기 때문이다(fontStore.ts의 familyNameFor로 생성된, id 기반 고유 이름). */
  family: string;
  data: ArrayBuffer;
}

interface FontDBSchema extends DBSchema {
  fonts: {
    key: string;
    value: FontRecord;
  };
}

const DB_NAME = 'my-note-web-fonts';
const DB_VERSION = 1;
const STORE_NAME = 'fonts';

let dbPromise: Promise<IDBPDatabase<FontDBSchema>> | null = null;

function getDB(): Promise<IDBPDatabase<FontDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<FontDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

/** 새 커스텀 폰트를 등록할 때(registerFontFile) 호출 — 실패해도(사파일 프라이빗
 * 모드 등 IndexedDB를 못 쓰는 환경) 이번 세션 안에서는 폰트가 정상 동작하고,
 * 다음 새로고침 때만 사라질 뿐이라 조용히 무시한다. */
export async function saveFontRecord(record: FontRecord): Promise<void> {
  try {
    const db = await getDB();
    await db.put(STORE_NAME, record);
  } catch {
    // 무시 — 위 주석 참고.
  }
}

/** 앱 시작 시 한 번 불러와서 document.fonts에 다시 등록한다(fontStore.loadPersistedFonts). */
export async function loadAllFontRecords(): Promise<FontRecord[]> {
  try {
    const db = await getDB();
    return await db.getAll(STORE_NAME);
  } catch {
    return [];
  }
}

/** 사용자가 커스텀 폰트를 삭제할 때(removeCustomFont) 호출 — 실패해도 무시(최악의
 * 경우 다음 새로고침 때 되살아날 뿐, 지금 삭제 자체는 이미 화면/document.fonts에 반영됨). */
export async function deleteFontRecord(id: string): Promise<void> {
  try {
    const db = await getDB();
    await db.delete(STORE_NAME, id);
  } catch {
    // 무시 — 위 주석 참고.
  }
}

export type { FontRecord };
