import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import type { CanvasObject } from '../types/object';
import type { Viewport } from '../types/viewport';
import type { LinkRecord } from '../types/link';

/**
 * Phase 8: 파일 시스템 계층 + Page(독립 캔버스) + objects/이미지 영구 저장.
 *
 * 계층 구조: File은 무제한으로 중첩되는 "폴더"에 가깝다(사용자 요구사항이 "파일"이라고
 * 부르지만 실제 역할은 폴더 — 하위 File과 0개 이상의 Page를 담는 컨테이너). Page가
 * architecture_analysis.md에서 말하던 "독립된 캔버스" 그 자체다 — 자기만의 objects
 * 집합과 자기만의 viewport(zoom/pan)를 가지고, Page를 열면 화면 전체가 그 Page의
 * 내용으로 바뀐다. Frame(objects/frame)은 이것과 완전히 다른 개념 — 같은 Page 안에서
 * 자유 배치되는 "종이 한 장" 객체일 뿐이다(types/object.ts의 FrameObject 참고).
 *
 * pageObjects store 설계 참고: architecture_analysis.md 10절 원안은 objects를
 * pageId로 인덱싱된 개별 행으로 저장하는 방식이었다. Phase 8에서는 한 Page의
 * objects 전체를 하나의 배열로 직렬화해 pageId를 key로 통째로 읽고 쓰는 방식으로
 * 단순화했다 — 어차피 자동저장이 500ms 디바운스로 "현재 Page의 objects 전체
 * 스냅샷"을 쓰는 방식이라(store/objectsStore.ts는 이미 Record<id,obj> 전체를
 * 한 번에 교체하는 구조), 개별 객체 단위 CRUD가 필요 없다. 페이지 전환이 잦지
 * 않은 개인용 필기 앱에서는 이 편이 구현이 훨씬 단순하고 버그 여지도 적다.
 */

export interface FileRecord {
  id: string;
  name: string;
  /** null이면 최상위(=rootFileIds에 포함). */
  parentId: string | null;
  /** 하위 File들의 순서 있는 id 목록. */
  childFileIds: string[];
  /** 이 File에 직접 속한 Page들의 순서 있는 id 목록(0개 이상). */
  pageIds: string[];
  createdAt: number;
  updatedAt: number;
  /** 요구사항(휴지통): 값이 있으면 "휴지통에 있음"(삭제 시각). rootFileIds/childFileIds/
   * pageIds 등 트리 구조 자체는 그대로 두고(그래야 복원 시 원래 위치로 돌아간다) 이
   * 필드로만 숨김 여부를 표시한다 — undefined는 "휴지통에 없음"(기존 기본값)과 동일.
   * 하위 File/Page는 자기 자신의 deletedAt을 갖지 않는다(폴더를 휴지통으로 보내면
   * 트리 순회가 그 폴더를 건너뛰므로 안에 있는 것들도 자연히 안 보인다 —
   * storage/fileTreeStore.ts의 trashFile/restoreFile 참고). */
  deletedAt?: number;
}

export interface PageRecord {
  id: string;
  fileId: string;
  name: string;
  viewport: Viewport;
  createdAt: number;
  updatedAt: number;
  /** FileRecord.deletedAt과 같은 의미 — 이 Page 자신이 직접 휴지통으로 보내진 경우다. */
  deletedAt?: number;
}

export interface PageObjectsRecord {
  pageId: string;
  objects: CanvasObject[];
}

export interface ImageRecord {
  id: string;
  blob: Blob;
  mimeType: string;
}

interface MyNoteDBSchema extends DBSchema {
  files: { key: string; value: FileRecord };
  pages: { key: string; value: PageRecord; indexes: { fileId: string } };
  pageObjects: { key: string; value: PageObjectsRecord };
  images: { key: string; value: ImageRecord };
  /** 단순 키-값(예: rootFileIds, lastOpenPageId). keyPath 없이 out-of-line key로 관리. */
  meta: { key: string; value: unknown };
  /** Phase 9(내부 하이퍼링크): Page/PDF 어디에 있든 링크 전부를 이 하나의 스토어에
   * 평평하게 담는다 — source/target이 각각 page/pdf surface를 자유롭게 섞을 수
   * 있어서(PDF↔PDF, Page↔PDF 등) Page별/PDF별로 나눠 저장하면 오히려 "이 Page를
   * 가리키는 링크가 다른 어디에 있는지" 찾기 위해 전체를 훑어야 하는 처지가 같아진다
   * — store/linkStore.ts가 시작 시 전체를 한 번에 읽어 메모리에 올려두고 쓴다
   * (링크 개수가 objects만큼 많아질 일은 없다고 보고 pageObjects 같은 지연 로딩은
   * 두지 않았다). */
  links: { key: string; value: LinkRecord };
}

const DB_NAME = 'my-note-web';
/** Phase 9: links 스토어 추가로 1→2. idb의 upgrade()는 "이미 그 버전으로 열어본 적
 * 있는 기존 DB"에서는 버전이 실제로 올라갈 때만 다시 실행되므로(하단 각 스토어의
 * contains 가드는 다른 이유로 존재 — 이 파일 초반 히스토리 참고), links 스토어를
 * 실제로 새로 만들려면 이 숫자 자체를 반드시 올려야 한다. */
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<MyNoteDBSchema>> | null = null;

export function getDB(): Promise<IDBPDatabase<MyNoteDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<MyNoteDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('pages')) {
          const store = db.createObjectStore('pages', { keyPath: 'id' });
          store.createIndex('fileId', 'fileId');
        }
        if (!db.objectStoreNames.contains('pageObjects')) {
          db.createObjectStore('pageObjects', { keyPath: 'pageId' });
        }
        if (!db.objectStoreNames.contains('images')) {
          db.createObjectStore('images', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta');
        }
        if (!db.objectStoreNames.contains('links')) {
          db.createObjectStore('links', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}
