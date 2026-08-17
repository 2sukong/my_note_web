import { create } from 'zustand';

/**
 * Phase 8: 트리 펼침/접힘 상태와 "지금 이름 편집 중인 id" 같은 순수 UI 상태.
 * IndexedDB에 저장하지 않는다 — 새로고침하면 전부 펼쳐진 상태로 돌아가도
 * 개인용 필기 앱에서 크게 불편하지 않고, 영속시킬 만큼 중요한 상태도 아니다.
 *
 * isCollapsed(사이드바 자체를 접었는지)만 예외로 localStorage에 저장한다 — 화면을
 * 넓게 쓰려고 접어둔 사용자가 새로고침할 때마다 다시 펴야 한다면 그 자체로 불편하기
 * 때문이다(반면 어떤 폴더가 펼쳐져 있었는지는 매번 달라도 무방).
 */
const COLLAPSED_STORAGE_KEY = 'my-note-web:file-tree-collapsed';
/** FileTreePanel.css/Canvas.css/App.tsx가 전부 이 두 값을 CSS 변수(--file-tree-width)
 * 하나로 공유한다 — 예전엔 240px이 세 곳에 따로 하드코딩돼 있었다. */
export const FILE_TREE_EXPANDED_WIDTH = 240;
export const FILE_TREE_COLLAPSED_WIDTH = 28;

function readInitialCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function applyWidthCssVar(collapsed: boolean) {
  document.documentElement.style.setProperty(
    '--file-tree-width',
    `${collapsed ? FILE_TREE_COLLAPSED_WIDTH : FILE_TREE_EXPANDED_WIDTH}px`,
  );
}

const initialCollapsed = readInitialCollapsed();
applyWidthCssVar(initialCollapsed);

interface FileTreeUiState {
  expandedFileIds: Set<string>;
  toggleExpanded: (fileId: string) => void;
  expand: (fileId: string) => void;

  renamingId: string | null;
  startRenaming: (id: string) => void;
  stopRenaming: () => void;

  contextMenu: { kind: 'file' | 'page'; id: string; x: number; y: number } | null;
  openContextMenu: (kind: 'file' | 'page', id: string, x: number, y: number) => void;
  closeContextMenu: () => void;

  isCollapsed: boolean;
  toggleCollapsed: () => void;
}

export const useFileTreeUiStore = create<FileTreeUiState>((set, get) => ({
  expandedFileIds: new Set(),
  toggleExpanded: (fileId) => {
    const next = new Set(get().expandedFileIds);
    if (next.has(fileId)) next.delete(fileId);
    else next.add(fileId);
    set({ expandedFileIds: next });
  },
  expand: (fileId) => {
    if (get().expandedFileIds.has(fileId)) return;
    const next = new Set(get().expandedFileIds);
    next.add(fileId);
    set({ expandedFileIds: next });
  },

  renamingId: null,
  startRenaming: (id) => set({ renamingId: id, contextMenu: null }),
  stopRenaming: () => set({ renamingId: null }),

  contextMenu: null,
  openContextMenu: (kind, id, x, y) => set({ contextMenu: { kind, id, x, y } }),
  closeContextMenu: () => set({ contextMenu: null }),

  isCollapsed: initialCollapsed,
  toggleCollapsed: () => {
    const next = !get().isCollapsed;
    set({ isCollapsed: next });
    applyWidthCssVar(next);
    try {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, next ? '1' : '0');
    } catch {
      // localStorage를 쓸 수 없는 환경(프라이빗 모드 등) — 이번 세션에서만 상태가
      // 유지되는 것으로 조용히 넘어간다(치명적이지 않음).
    }
  },
}));
