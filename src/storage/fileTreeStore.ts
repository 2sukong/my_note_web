import { create } from 'zustand';
import { getDB } from './db';
import type { FileRecord, PageRecord } from './db';
import { savePageObjects, loadPageObjects, deletePageObjects } from './pagePersistence';
import { isDescendantOrSelf, collectFileSubtreeIds, findFirstPageId, cloneObjectsWithNewIds } from './fileTreeLogic';
import { useObjectsStore, createDemoObjects } from '../store/objectsStore';
import { useViewportStore } from '../store/viewportStore';
import { useHistoryStore } from '../store/historyStore';
import { useSaveStatusStore } from './saveStatusStore';
import { retainImage, releaseImage } from '../objects/image/imageStore';
import { DEFAULT_VIEWPORT } from '../types/viewport';
import type { CanvasObject } from '../types/object';

/**
 * Phase 8: File(무제한 중첩되는 폴더) + Page(독립 캔버스) 트리 전체를 메모리에 미러링하고,
 * 모든 변경을 IndexedDB에 즉시 반영한다(트리 구조 자체는 자주 바뀌지 않으므로 objects
 * 자동저장과 달리 디바운스하지 않는다). 현재 열려 있는 Page(currentPageId) 전환도
 * 이 스토어가 오케스트레이션한다 — objectsStore/viewportStore/historyStore/이미지
 * refCount를 모두 여기서 조율해야 어느 한쪽만 먼저 바뀌는 일이 없다.
 */

const AUTOSAVE_DEBOUNCE_MS = 500;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let suppressAutosave = false;
let autosaveWatchStarted = false;
/** React 18 StrictMode는 개발 모드에서 effect를 두 번 실행한다 — App.tsx의 init() 호출이
 * 마운트당 두 번 일어나도 최초 실행(기본 File/Page 생성)이 중복되지 않도록 같은
 * in-flight promise를 공유한다(fontStore.loadPersistedFonts와 동일한 관례). */
let initPromise: Promise<void> | null = null;

function keyBy<T extends { id: string }>(items: T[]): Record<string, T> {
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

/** 현재 Page의 objects에서 이미지 참조 개수만큼 retain/release한다 — Page를 열고 닫을
 * 때 imageStore.ts의 refCount가 항상 "지금 화면에 실제로 걸려있는 참조 수"를 반영하게
 * 한다(위 파일에서 releaseImage가 하는 일: object URL 캐시만 해제, Blob은 보존). */
function adjustImageRefs(objects: CanvasObject[], direction: 1 | -1) {
  for (const obj of objects) {
    if (obj.type === 'image' && obj.imageId) {
      if (direction === 1) retainImage(obj.imageId);
      else releaseImage(obj.imageId);
    }
  }
}

interface FileTreeState {
  loaded: boolean;
  files: Record<string, FileRecord>;
  pages: Record<string, PageRecord>;
  rootFileIds: string[];
  currentPageId: string | null;

  init: () => Promise<void>;
  openPage: (pageId: string) => Promise<void>;

  createFile: (parentId: string | null, name?: string) => Promise<string>;
  renameFile: (id: string, name: string) => Promise<void>;
  /** 요구사항(휴지통): 더 이상 즉시 영구 삭제하지 않는다 — deletedAt만 찍어 트리
   * 렌더링에서 숨기고(복구 가능), 실제 IndexedDB 삭제는 permanentlyDeleteFile이 한다. */
  deleteFile: (id: string) => Promise<void>;
  /** 이 File(과 트래시된 조상들)을 원래 위치로 복원한다. */
  restoreFile: (id: string) => Promise<void>;
  /** 휴지통에서 완전히 삭제한다(복구 불가) — 기존 deleteFile의 cascade 삭제 로직. */
  permanentlyDeleteFile: (id: string) => Promise<void>;
  /** newParentId 아래로 옮긴다. beforeId를 주면 그 형제 파일 바로 앞에 끼워 넣고
   * (같은 부모 안에서 순서만 바꾸는 드래그 재정렬도 이 경로로 처리된다), 생략하면
   * 끝에 추가한다. */
  moveFile: (id: string, newParentId: string | null, beforeId?: string | null) => Promise<void>;
  duplicateFile: (id: string) => Promise<string>;

  createPage: (fileId: string, name?: string) => Promise<string>;
  renamePage: (id: string, name: string) => Promise<void>;
  /** 요구사항(휴지통): deleteFile과 동일하게 소프트 삭제(트래시로 이동)로 바뀌었다. */
  deletePage: (id: string) => Promise<void>;
  restorePage: (id: string) => Promise<void>;
  permanentlyDeletePage: (id: string) => Promise<void>;
  /** 지금 휴지통에 있는 모든 File/Page를 한 번에 영구 삭제한다. */
  emptyTrash: () => Promise<void>;
  /** newFileId 아래로 옮긴다. beforeId를 주면 그 형제 페이지 바로 앞에 끼워 넣는다
   * (moveFile과 동일한 규칙). */
  movePage: (id: string, newFileId: string, beforeId?: string | null) => Promise<void>;
  duplicatePage: (id: string) => Promise<string>;
}

export const useFileTreeStore = create<FileTreeState>((set, get) => {
  /** 지금 열려 있는 Page의 objects/viewport를 즉시(디바운스 없이) IndexedDB에 쓴다.
   * Page 전환/삭제/앱 종료 직전처럼 "지금 당장 정확한 상태가 필요한" 시점에 쓴다. */
  async function flushActivePage(): Promise<void> {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    const pageId = get().currentPageId;
    if (!pageId) return;
    const objects = Object.values(useObjectsStore.getState().objects);
    const vp = useViewportStore.getState();
    const viewport = { zoom: vp.zoom, panX: vp.panX, panY: vp.panY };
    try {
      useSaveStatusStore.getState().setStatus('saving');
      await savePageObjects(pageId, objects);
      const page = get().pages[pageId];
      if (page) {
        const updated = { ...page, viewport, updatedAt: Date.now() };
        set((state) => ({ pages: { ...state.pages, [pageId]: updated } }));
        const db = await getDB();
        await db.put('pages', updated);
      }
      useSaveStatusStore.getState().setStatus('saved');
    } catch (e) {
      console.error('[my-note-web] 자동저장 실패', e);
      useSaveStatusStore.getState().setStatus('error');
    }
  }

  function scheduleSave() {
    if (suppressAutosave) return;
    if (!get().currentPageId) return;
    useSaveStatusStore.getState().setStatus('saving');
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void flushActivePage();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  function beginAutosaveWatch() {
    if (autosaveWatchStarted) return;
    autosaveWatchStarted = true;
    useObjectsStore.subscribe(scheduleSave);
    useViewportStore.subscribe(scheduleSave);
  }

  async function persistFile(file: FileRecord) {
    const db = await getDB();
    await db.put('files', file);
  }

  async function persistPage(page: PageRecord) {
    const db = await getDB();
    await db.put('pages', page);
  }

  async function persistRootFileIds(ids: string[]) {
    const db = await getDB();
    await db.put('meta', ids, 'rootFileIds');
  }

  async function persistLastOpenPageId(pageId: string) {
    const db = await getDB();
    await db.put('meta', pageId, 'lastOpenPageId');
  }

  /** 부모(File 또는 root)의 자식 목록에서 id를 제거한다. 메모리 상태와 IndexedDB 둘 다 반영. */
  async function detachFromParent(id: string, parentId: string | null, kind: 'file' | 'page') {
    if (parentId) {
      const parent = get().files[parentId];
      if (!parent) return;
      const key = kind === 'file' ? 'childFileIds' : 'pageIds';
      const updated = { ...parent, [key]: parent[key].filter((x) => x !== id), updatedAt: Date.now() };
      set((state) => ({ files: { ...state.files, [parentId]: updated } }));
      await persistFile(updated);
    } else {
      const nextRoots = get().rootFileIds.filter((x) => x !== id);
      set({ rootFileIds: nextRoots });
      await persistRootFileIds(nextRoots);
    }
  }

  /** 부모(File 또는 root)의 자식 목록에 id를 추가한다. beforeId를 주면 그 형제 바로
   * 앞에 끼워 넣고(형제가 이미 그 목록에 없으면 끝에), 생략하면 항상 끝에 추가한다
   * (기존 동작 — 컨텍스트 메뉴로 새로 만들기/복제 등 순서를 신경 쓰지 않는 호출부는
   * beforeId 없이 그대로 쓴다). */
  async function attachToParent(id: string, parentId: string | null, kind: 'file' | 'page', beforeId?: string | null) {
    if (parentId) {
      const parent = get().files[parentId];
      if (!parent) return;
      const key = kind === 'file' ? 'childFileIds' : 'pageIds';
      const arr = parent[key];
      const idx = beforeId ? arr.indexOf(beforeId) : -1;
      const nextArr = idx === -1 ? [...arr, id] : [...arr.slice(0, idx), id, ...arr.slice(idx)];
      const updated = { ...parent, [key]: nextArr, updatedAt: Date.now() };
      set((state) => ({ files: { ...state.files, [parentId]: updated } }));
      await persistFile(updated);
    } else {
      const arr = get().rootFileIds;
      const idx = beforeId ? arr.indexOf(beforeId) : -1;
      const nextRoots = idx === -1 ? [...arr, id] : [...arr.slice(0, idx), id, ...arr.slice(idx)];
      set({ rootFileIds: nextRoots });
      await persistRootFileIds(nextRoots);
    }
  }

  async function runInit(): Promise<void> {
    const db = await getDB();
    const [fileList, pageList, rootFileIdsMeta] = await Promise.all([
      db.getAll('files'),
      db.getAll('pages'),
      db.get('meta', 'rootFileIds'),
    ]);

    let files = keyBy(fileList);
    let pages = keyBy(pageList);
    let rootFileIds = (rootFileIdsMeta as string[] | undefined) ?? [];

    if (rootFileIds.length === 0 && Object.keys(files).length === 0) {
      // 최초 실행: 기본 File 1개 + 기본 Page 1개를 만들고, 기존 온보딩 데모 콘텐츠로 심는다.
      const t = Date.now();
      const fileId = crypto.randomUUID();
      const pageId = crypto.randomUUID();
      const file: FileRecord = {
        id: fileId,
        name: '내 캔버스',
        parentId: null,
        childFileIds: [],
        pageIds: [pageId],
        createdAt: t,
        updatedAt: t,
      };
      const page: PageRecord = {
        id: pageId,
        fileId,
        name: 'Page 1',
        viewport: DEFAULT_VIEWPORT,
        createdAt: t,
        updatedAt: t,
      };
      files = { [fileId]: file };
      pages = { [pageId]: page };
      rootFileIds = [fileId];
      await Promise.all([
        persistFile(file),
        persistPage(page),
        persistRootFileIds(rootFileIds),
        savePageObjects(pageId, Object.values(createDemoObjects())),
      ]);
    }

    set({ files, pages, rootFileIds, loaded: true });
    beginAutosaveWatch();

    const lastOpenPageId = (await db.get('meta', 'lastOpenPageId')) as string | undefined;
    const targetPageId =
      lastOpenPageId && pages[lastOpenPageId] && !pages[lastOpenPageId].deletedAt
        ? lastOpenPageId
        : findFirstPageId(rootFileIds, files, pages);

    if (targetPageId) {
      await get().openPage(targetPageId);
    }
  }

  return {
    loaded: false,
    files: {},
    pages: {},
    rootFileIds: [],
    currentPageId: null,

    init: () => {
      if (!initPromise) initPromise = runInit();
      return initPromise;
    },

    openPage: async (pageId) => {
      const target = get().pages[pageId];
      if (!target) return;
      if (get().currentPageId === pageId) return;

      suppressAutosave = true;
      try {
        await flushActivePage();

        const oldObjects = Object.values(useObjectsStore.getState().objects);
        adjustImageRefs(oldObjects, -1);
        useHistoryStore.getState().reset();

        const objects = await loadPageObjects(pageId);
        adjustImageRefs(objects, 1);
        useObjectsStore.getState().loadObjects(keyBy(objects));
        useViewportStore.getState().setViewport(target.viewport ?? DEFAULT_VIEWPORT);

        set({ currentPageId: pageId });
        void persistLastOpenPageId(pageId);
        useSaveStatusStore.getState().setStatus('idle');
      } finally {
        suppressAutosave = false;
      }
    },

    createFile: async (parentId, name = '새 파일') => {
      const t = Date.now();
      const id = crypto.randomUUID();
      const file: FileRecord = { id, name, parentId, childFileIds: [], pageIds: [], createdAt: t, updatedAt: t };
      set((state) => ({ files: { ...state.files, [id]: file } }));
      await persistFile(file);
      await attachToParent(id, parentId, 'file');
      return id;
    },

    renameFile: async (id, name) => {
      const file = get().files[id];
      if (!file) return;
      const updated = { ...file, name, updatedAt: Date.now() };
      set((state) => ({ files: { ...state.files, [id]: updated } }));
      await persistFile(updated);
    },

    deleteFile: async (id) => {
      const state = get();
      const file = state.files[id];
      if (!file || file.deletedAt) return;

      // 이 File 하위(자기 자신 포함)에 있는 모든 Page가 트래시 대상이다 — 지금 열려
      // 있는 Page가 여기 포함되면, 트래시로 보내기 전에 다른(트래시되지 않은) Page로
      // 옮겨가야 한다(영구 삭제였던 기존 로직과 동일한 원칙, cascade만 없을 뿐).
      const subtreeFileIds = collectFileSubtreeIds(state.files, id);
      const subtreeFileIdSet = new Set(subtreeFileIds);
      const affectedPageIds = subtreeFileIds.flatMap((fid) => state.files[fid]?.pageIds ?? []);
      const affectedPageIdSet = new Set(affectedPageIds);

      if (state.currentPageId && affectedPageIdSet.has(state.currentPageId)) {
        const fallback = findFallbackPageId(get(), subtreeFileIdSet, affectedPageIdSet);
        if (fallback) {
          await get().openPage(fallback);
        } else {
          const newFileId = await get().createFile(null, '내 캔버스');
          const newPageId = await get().createPage(newFileId, 'Page 1');
          await get().openPage(newPageId);
        }
      }

      // 트리 구조(부모의 childFileIds 등)는 그대로 둔다 — deletedAt만 찍어서 렌더링에서
      // 숨기면, restoreFile이 그 값만 지워서 원래 자리로 되돌릴 수 있다.
      const updated: FileRecord = { ...file, deletedAt: Date.now() };
      set((s) => ({ files: { ...s.files, [id]: updated } }));
      await persistFile(updated);
    },

    restoreFile: async (id) => {
      const state = get();
      if (!state.files[id]) return;
      // 이 File 자신 + 트래시된 상위 조상들을 전부 복원한다 — 그렇지 않으면 이 File만
      // 복원돼도 여전히 트래시된 부모 폴더 밑에 있어서 트리에서 보이지 않는다.
      const chain: string[] = [id];
      let cursor = state.files[id].parentId;
      while (cursor) {
        const f = state.files[cursor];
        if (!f || !f.deletedAt) break;
        chain.push(cursor);
        cursor = f.parentId;
      }
      for (const fid of chain) {
        const f = get().files[fid];
        if (!f || !f.deletedAt) continue;
        const updated: FileRecord = { ...f, deletedAt: undefined, updatedAt: Date.now() };
        set((s) => ({ files: { ...s.files, [fid]: updated } }));
        await persistFile(updated);
      }
    },

    permanentlyDeleteFile: async (id) => {
      const state = get();
      const file = state.files[id];
      if (!file) return;

      const subtreeFileIds = collectFileSubtreeIds(state.files, id);
      const subtreeFileIdSet = new Set(subtreeFileIds);
      const affectedPageIds = subtreeFileIds.flatMap((fid) => state.files[fid]?.pageIds ?? []);
      const affectedPageIdSet = new Set(affectedPageIds);

      // 방어적 처리: 보통 트래시에 있는(=현재 열린 Page일 수 없는) 항목에만 호출되지만,
      // 혹시 모를 경우를 대비해 기존 deleteFile과 동일한 대체 Page 로직을 유지한다.
      if (state.currentPageId && affectedPageIdSet.has(state.currentPageId)) {
        const fallback = findFallbackPageId(get(), subtreeFileIdSet, affectedPageIdSet);
        if (fallback) {
          await get().openPage(fallback);
        } else {
          const newFileId = await get().createFile(null, '내 캔버스');
          const newPageId = await get().createPage(newFileId, 'Page 1');
          await get().openPage(newPageId);
        }
      }

      await detachFromParent(id, file.parentId, 'file');

      const db = await getDB();
      for (const pageId of affectedPageIds) {
        await Promise.all([db.delete('pages', pageId), deletePageObjects(pageId)]);
      }
      for (const fid of subtreeFileIds) {
        await db.delete('files', fid);
      }

      set((s) => {
        const files = { ...s.files };
        for (const fid of subtreeFileIds) delete files[fid];
        const pages = { ...s.pages };
        for (const pid of affectedPageIds) delete pages[pid];
        return { files, pages };
      });
    },

    moveFile: async (id, newParentId, beforeId) => {
      const state = get();
      const file = state.files[id];
      if (!file) return;
      if (newParentId === id) return; // 자기 자신에게는 못 옮김
      if (id === beforeId) return; // 자기 자신 바로 앞에 끼워넣기 = no-op
      if (newParentId && isDescendantOrSelf(state.files, id, newParentId)) return; // 순환 참조 방지
      // 같은 부모 안에서 beforeId 없이 호출된 경우(순서를 신경 쓰지 않는 기존 호출부)만
      // "이미 거기 있음"으로 보고 무시한다. beforeId가 있으면 같은 부모 안에서 순서만
      // 바꾸는 드래그 재정렬이므로 계속 진행해야 한다.
      if (file.parentId === newParentId && !beforeId) return;

      await detachFromParent(id, file.parentId, 'file');
      const updated = { ...get().files[id], parentId: newParentId, updatedAt: Date.now() };
      set((s) => ({ files: { ...s.files, [id]: updated } }));
      await persistFile(updated);
      await attachToParent(id, newParentId, 'file', beforeId);
    },

    duplicateFile: async (id) => {
      await flushActivePage();
      const state = get();
      const source = state.files[id];
      if (!source) throw new Error('복제할 파일을 찾을 수 없습니다.');

      const db = await getDB();
      const t = Date.now();

      async function cloneFile(oldFileId: string, newParentId: string | null, isTop: boolean): Promise<FileRecord> {
        const old = state.files[oldFileId];
        const newId = crypto.randomUUID();
        const newPageIds: string[] = [];

        for (const oldPageId of old.pageIds) {
          const oldPage = state.pages[oldPageId];
          const objects = await loadPageObjects(oldPageId);
          const clonedObjects = cloneObjectsWithNewIds(objects);
          const newPageId = crypto.randomUUID();
          const newPage: PageRecord = {
            id: newPageId,
            fileId: newId,
            name: oldPage.name,
            viewport: oldPage.viewport,
            createdAt: t,
            updatedAt: t,
          };
          await Promise.all([db.put('pages', newPage), savePageObjects(newPageId, clonedObjects)]);
          set((s) => ({ pages: { ...s.pages, [newPageId]: newPage } }));
          newPageIds.push(newPageId);
        }

        const newChildFileIds: string[] = [];
        for (const childId of old.childFileIds) {
          const clonedChild = await cloneFile(childId, newId, false);
          newChildFileIds.push(clonedChild.id);
        }

        const newFile: FileRecord = {
          id: newId,
          name: isTop ? `${old.name} 복사본` : old.name,
          parentId: newParentId,
          childFileIds: newChildFileIds,
          pageIds: newPageIds,
          createdAt: t,
          updatedAt: t,
        };
        await db.put('files', newFile);
        set((s) => ({ files: { ...s.files, [newId]: newFile } }));
        return newFile;
      }

      const cloned = await cloneFile(id, source.parentId, true);
      await attachToParent(cloned.id, source.parentId, 'file');
      return cloned.id;
    },

    createPage: async (fileId, name = '새 페이지') => {
      const t = Date.now();
      const id = crypto.randomUUID();
      const page: PageRecord = { id, fileId, name, viewport: DEFAULT_VIEWPORT, createdAt: t, updatedAt: t };
      set((state) => ({ pages: { ...state.pages, [id]: page } }));
      await Promise.all([persistPage(page), savePageObjects(id, [])]);
      await attachToParent(id, fileId, 'page');
      return id;
    },

    renamePage: async (id, name) => {
      const page = get().pages[id];
      if (!page) return;
      const updated = { ...page, name, updatedAt: Date.now() };
      set((state) => ({ pages: { ...state.pages, [id]: updated } }));
      await persistPage(updated);
    },

    deletePage: async (id) => {
      const state = get();
      const page = state.pages[id];
      if (!page || page.deletedAt) return;

      if (state.currentPageId === id) {
        const remaining = findFallbackPageId(get(), new Set(), new Set([id]));
        if (remaining) {
          await get().openPage(remaining);
        } else {
          const newFileId = await get().createFile(null, '내 캔버스');
          const newPageId = await get().createPage(newFileId, 'Page 1');
          await get().openPage(newPageId);
        }
      }

      const updated: PageRecord = { ...page, deletedAt: Date.now() };
      set((s) => ({ pages: { ...s.pages, [id]: updated } }));
      await persistPage(updated);
    },

    restorePage: async (id) => {
      const state = get();
      const page = state.pages[id];
      if (!page) return;

      if (page.deletedAt) {
        const updated: PageRecord = { ...page, deletedAt: undefined, updatedAt: Date.now() };
        set((s) => ({ pages: { ...s.pages, [id]: updated } }));
        await persistPage(updated);
      }

      // 이 Page가 속한 File 조상 중 트래시된 게 있으면 함께 복원해야 트리에서 보인다
      // (restoreFile과 동일한 원리 — 여기서는 Page 자신부터가 아니라 fileId부터 시작).
      const chain: string[] = [];
      let cursor: string | null = page.fileId;
      while (cursor) {
        const ancestor: FileRecord | undefined = get().files[cursor];
        if (!ancestor || !ancestor.deletedAt) break;
        chain.push(cursor);
        cursor = ancestor.parentId;
      }
      for (const fid of chain) {
        const f = get().files[fid];
        if (!f || !f.deletedAt) continue;
        const updated: FileRecord = { ...f, deletedAt: undefined, updatedAt: Date.now() };
        set((s) => ({ files: { ...s.files, [fid]: updated } }));
        await persistFile(updated);
      }
    },

    permanentlyDeletePage: async (id) => {
      const state = get();
      const page = state.pages[id];
      if (!page) return;

      if (state.currentPageId === id) {
        const remaining = findFallbackPageId(get(), new Set(), new Set([id]));
        if (remaining) {
          await get().openPage(remaining);
        } else {
          const newFileId = await get().createFile(null, '내 캔버스');
          const newPageId = await get().createPage(newFileId, 'Page 1');
          await get().openPage(newPageId);
        }
      }

      await detachFromParent(id, page.fileId, 'page');
      const db = await getDB();
      await Promise.all([db.delete('pages', id), deletePageObjects(id)]);
      set((s) => {
        const pages = { ...s.pages };
        delete pages[id];
        return { pages };
      });
    },

    emptyTrash: async () => {
      // 두 목록 모두 "자기 자신이 직접 트래시된" 최상위 항목만 담는다 — 트래시된
      // 폴더 안에 있는 Page/하위 File은 자기 deletedAt이 없으므로(조상만 트래시됨)
      // 여기 안 잡히고, 그 폴더를 permanentlyDeleteFile할 때 cascade로 함께 지워진다.
      const trashedFileIds = Object.values(get().files)
        .filter((f) => f.deletedAt)
        .map((f) => f.id);
      const trashedPageIds = Object.values(get().pages)
        .filter((p) => p.deletedAt)
        .map((p) => p.id);

      for (const fid of trashedFileIds) {
        if (get().files[fid]) await get().permanentlyDeleteFile(fid);
      }
      for (const pid of trashedPageIds) {
        if (get().pages[pid]) await get().permanentlyDeletePage(pid);
      }
    },

    movePage: async (id, newFileId, beforeId) => {
      const state = get();
      const page = state.pages[id];
      if (!page) return;
      if (id === beforeId) return; // 자기 자신 바로 앞에 끼워넣기 = no-op
      if (!state.files[newFileId]) return;
      // moveFile과 동일한 이유로, 같은 File 안에서 beforeId 없이 호출된 경우만 무시한다.
      if (page.fileId === newFileId && !beforeId) return;

      await detachFromParent(id, page.fileId, 'page');
      const updated = { ...get().pages[id], fileId: newFileId, updatedAt: Date.now() };
      set((s) => ({ pages: { ...s.pages, [id]: updated } }));
      await persistPage(updated);
      await attachToParent(id, newFileId, 'page', beforeId);
    },

    duplicatePage: async (id) => {
      if (get().currentPageId === id) await flushActivePage();
      const state = get();
      const source = state.pages[id];
      if (!source) throw new Error('복제할 페이지를 찾을 수 없습니다.');

      const objects = await loadPageObjects(id);
      const clonedObjects = cloneObjectsWithNewIds(objects);
      const t = Date.now();
      const newId = crypto.randomUUID();
      const newPage: PageRecord = {
        id: newId,
        fileId: source.fileId,
        name: `${source.name} 복사본`,
        viewport: source.viewport,
        createdAt: t,
        updatedAt: t,
      };
      set((s) => ({ pages: { ...s.pages, [newId]: newPage } }));
      await Promise.all([persistPage(newPage), savePageObjects(newId, clonedObjects)]);
      await attachToParent(newId, source.fileId, 'page');
      return newId;
    },
  };
});

/** 삭제(또는 트래시) 대상 집합(subtreeFileIdSet/affectedPageIdSet)을 제외하고, 트리에
 * 남는(그리고 트래시되지 않은) 첫 Page를 찾는다 — findFirstPageId 자체가 이미
 * deletedAt이 있는 File/Page를 건너뛰므로, 여기서는 "지금 막 트래시/삭제하려는"
 * 항목만 추가로 걸러내면 된다. */
function findFallbackPageId(
  state: FileTreeState,
  excludeFileIds: Set<string>,
  excludePageIds: Set<string>,
): string | null {
  const remainingRoots = state.rootFileIds.filter((fid) => !excludeFileIds.has(fid));
  const filteredFiles: Record<string, FileRecord> = {};
  for (const [fid, f] of Object.entries(state.files)) {
    if (excludeFileIds.has(fid)) continue;
    filteredFiles[fid] = { ...f, pageIds: f.pageIds.filter((pid) => !excludePageIds.has(pid)) };
  }
  return findFirstPageId(remainingRoots, filteredFiles, state.pages);
}
