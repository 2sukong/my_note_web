import { useEffect, useRef, useState } from 'react';
import { useFileTreeStore } from '../../storage/fileTreeStore';
import { useFileTreeUiStore } from './fileTreeUiStore';
import { exportBackup, importBackup } from '../../storage/backup';
import { fileSubtreeMatchesQuery } from '../../storage/fileTreeLogic';
import { SaveStatusIndicator } from '../SaveStatusIndicator';
import { TrashPanel } from './TrashPanel';
import {
  CaretIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  DownloadIcon,
  FolderIcon,
  PageIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
  UploadIcon,
} from '../../icons/Icons';
import './FileTreePanel.css';

/** 드래그 중인 항목을 dataTransfer에 담을 때 쓰는 커스텀 MIME 타입. */
const DND_MIME = 'application/x-my-note-web-tree-item';

interface DragPayload {
  kind: 'file' | 'page';
  id: string;
}

function readDragPayload(e: React.DragEvent): DragPayload | null {
  const raw = e.dataTransfer.getData(DND_MIME);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DragPayload;
  } catch {
    return null;
  }
}

/**
 * 지금 드래그 중인 항목의 kind. dragover 시점엔 브라우저 보안 정책상 dataTransfer.getData()를
 * 읽을 수 없어(drop에서만 실제 값을 읽을 수 있음, dragover에선 .types만 확인 가능) 드롭
 * 미리보기(끼워넣기 표시선/영역)를 올바른 kind에 대해서만 보여주려면 dragstart 시점에
 * 별도로 기억해둬야 한다. 이 파일 안의 드래그 상호작용에서만 쓰는 일시적 상태라 zustand
 * store가 아니라 모듈 전역 변수로 충분하다.
 */
let draggingKind: DragPayload['kind'] | null = null;

/** 형제 목록에서 targetId 바로 다음 항목의 id를 찾는다("이 항목 다음에 끼워 넣기"용). */
function siblingIdAfter(siblings: string[], targetId: string): string | undefined {
  const idx = siblings.indexOf(targetId);
  return idx === -1 ? undefined : siblings[idx + 1];
}

/** File/Page 이름을 인라인으로 편집하는 입력창. Enter/blur로 확정, Escape로 취소. */
function InlineNameInput({ initial, onCommit, onCancel }: { initial: string; onCommit: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <input
      ref={inputRef}
      className="file-tree-rename-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          const trimmed = value.trim();
          onCommit(trimmed.length > 0 ? trimmed : initial);
        } else if (e.key === 'Escape') {
          onCancel();
        }
      }}
      onBlur={() => {
        const trimmed = value.trim();
        onCommit(trimmed.length > 0 ? trimmed : initial);
      }}
    />
  );
}

function ContextMenu() {
  const menu = useFileTreeUiStore((s) => s.contextMenu);
  const closeContextMenu = useFileTreeUiStore((s) => s.closeContextMenu);
  const startRenaming = useFileTreeUiStore((s) => s.startRenaming);
  const expand = useFileTreeUiStore((s) => s.expand);
  const createFile = useFileTreeStore((s) => s.createFile);
  const createPage = useFileTreeStore((s) => s.createPage);
  const deleteFile = useFileTreeStore((s) => s.deleteFile);
  const deletePage = useFileTreeStore((s) => s.deletePage);
  const duplicateFile = useFileTreeStore((s) => s.duplicateFile);
  const duplicatePage = useFileTreeStore((s) => s.duplicatePage);
  const openPage = useFileTreeStore((s) => s.openPage);

  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeContextMenu();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [menu, closeContextMenu]);

  if (!menu) return null;

  const items: Array<{ label: string; onClick: () => void; danger?: boolean }> = [];

  if (menu.kind === 'file') {
    items.push({
      label: '새 하위 파일',
      onClick: () => {
        void createFile(menu.id).then((id) => {
          expand(menu.id);
          startRenaming(id);
        });
      },
    });
    items.push({
      label: '새 페이지',
      onClick: () => {
        void createPage(menu.id).then((id) => {
          expand(menu.id);
          startRenaming(id);
        });
      },
    });
    items.push({ label: '이름 바꾸기', onClick: () => startRenaming(menu.id) });
    items.push({ label: '복제', onClick: () => void duplicateFile(menu.id) });
    items.push({
      // 요구사항(휴지통): 더 이상 즉시 영구 삭제가 아니라 휴지통으로 이동(복구 가능)이라
      // 확인 대화상자 없이 바로 처리한다 — 실수로 지워도 휴지통 패널에서 복원할 수 있다.
      label: '삭제(휴지통으로 이동)',
      danger: true,
      onClick: () => void deleteFile(menu.id),
    });
  } else {
    items.push({ label: '열기', onClick: () => void openPage(menu.id) });
    items.push({ label: '이름 바꾸기', onClick: () => startRenaming(menu.id) });
    items.push({ label: '복제', onClick: () => void duplicatePage(menu.id) });
    items.push({
      label: '삭제(휴지통으로 이동)',
      danger: true,
      onClick: () => void deletePage(menu.id),
    });
  }

  return (
    <div ref={ref} className="file-tree-context-menu" style={{ left: menu.x, top: menu.y }}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          className={item.danger ? 'is-danger' : undefined}
          onClick={() => {
            item.onClick();
            closeContextMenu();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function PageRow({ id, depth }: { id: string; depth: number }) {
  const page = useFileTreeStore((s) => s.pages[id]);
  const isActive = useFileTreeStore((s) => s.currentPageId === id);
  // 요구사항(휴지통): 부모(FileNode)가 이미 pageIds를 필터링해서 넘기지만, 방어적으로
  const openPage = useFileTreeStore((s) => s.openPage);
  const renamePage = useFileTreeStore((s) => s.renamePage);
  const movePage = useFileTreeStore((s) => s.movePage);
  const renamingId = useFileTreeUiStore((s) => s.renamingId);
  const stopRenaming = useFileTreeUiStore((s) => s.stopRenaming);
  const openContextMenu = useFileTreeUiStore((s) => s.openContextMenu);
  const [dropEdge, setDropEdge] = useState<'before' | 'after' | null>(null);

  // 요구사항(휴지통): 부모(FileNode)가 이미 pageIds를 필터링해서 넘기지만, 방어적으로
  // 한 번 더 확인한다 — 트래시된 Page는 어떤 경로로도 트리에 보이면 안 된다.
  if (!page || page.deletedAt) return null;
  const isRenaming = renamingId === id;

  return (
    <div
      className={`file-tree-row file-tree-page-row${isActive ? ' is-active' : ''}${
        dropEdge === 'before' ? ' is-drop-before' : dropEdge === 'after' ? ' is-drop-after' : ''
      }`}
      style={{ paddingLeft: 16 + depth * 16 }}
      draggable={!isRenaming}
      onDragStart={(e) => {
        draggingKind = 'page';
        e.dataTransfer.setData(DND_MIME, JSON.stringify({ kind: 'page', id } satisfies DragPayload));
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => {
        draggingKind = null;
      }}
      onDragOver={(e) => {
        // 페이지는 페이지끼리만 순서를 바꿀 수 있다(파일과 섞인 순서 자체가 없음) —
        // 파일이 드래그 중이면 이 행 위/아래에 끼워 넣을 수 없다는 뜻으로 아예 무시한다.
        if (draggingKind !== 'page' || !e.dataTransfer.types.includes(DND_MIME)) return;
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        setDropEdge(e.clientY < rect.top + rect.height / 2 ? 'before' : 'after');
      }}
      onDragLeave={() => setDropEdge(null)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const edge = dropEdge;
        setDropEdge(null);
        const payload = readDragPayload(e);
        if (!payload || payload.kind !== 'page' || payload.id === id) return;
        if (edge === 'before') {
          void movePage(payload.id, page.fileId, id);
        } else {
          const siblings = useFileTreeStore.getState().files[page.fileId]?.pageIds ?? [];
          const nextId = siblingIdAfter(siblings, id);
          if (nextId === payload.id) return; // 이미 그 위치에 있음 — no-op
          void movePage(payload.id, page.fileId, nextId);
        }
      }}
      onClick={() => {
        if (!isRenaming) void openPage(id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        openContextMenu('page', id, e.clientX, e.clientY);
      }}
    >
      <span className="file-tree-row-icon" aria-hidden>
        <PageIcon />
      </span>
      {isRenaming ? (
        <InlineNameInput
          initial={page.name}
          onCommit={(name) => {
            void renamePage(id, name);
            stopRenaming();
          }}
          onCancel={stopRenaming}
        />
      ) : (
        <span className="file-tree-row-name">{page.name}</span>
      )}
    </div>
  );
}

function FileNode({ id, depth }: { id: string; depth: number }) {
  const file = useFileTreeStore((s) => s.files[id]);
  const filesRecord = useFileTreeStore((s) => s.files);
  const pagesRecord = useFileTreeStore((s) => s.pages);
  const moveFile = useFileTreeStore((s) => s.moveFile);
  const movePage = useFileTreeStore((s) => s.movePage);
  const renameFile = useFileTreeStore((s) => s.renameFile);
  const expandedFileIds = useFileTreeUiStore((s) => s.expandedFileIds);
  const toggleExpanded = useFileTreeUiStore((s) => s.toggleExpanded);
  const renamingId = useFileTreeUiStore((s) => s.renamingId);
  const stopRenaming = useFileTreeUiStore((s) => s.stopRenaming);
  const openContextMenu = useFileTreeUiStore((s) => s.openContextMenu);
  const searchQuery = useFileTreeUiStore((s) => s.searchQuery);
  // 'into'는 기존처럼 "이 폴더 안으로"(파일이든 페이지든), 'before'/'after'는 이 파일과
  // 같은 위치의 형제 파일들 사이에 끼워 넣는 순서 변경이다(행 위쪽/아래쪽 25% 영역).
  const [dropZone, setDropZone] = useState<'before' | 'into' | 'after' | null>(null);

  // 요구사항(휴지통): 트래시된 File은 트리에 전혀 나타나지 않는다(휴지통 패널 전용).
  if (!file || file.deletedAt) return null;

  // 요구사항(찾기): 검색어가 있으면 이름이나 하위 트리에 매치가 없는 File은 아예
  // 그리지 않는다 — 매치가 하위에만 있으면 자동으로 펼쳐서 보여준다(수동으로
  // 펼치고/접은 상태는 검색어를 지우면 그대로 돌아온다).
  const lowerQuery = searchQuery.trim().toLowerCase();
  const isSearching = lowerQuery.length > 0;
  if (isSearching && !fileSubtreeMatchesQuery(id, lowerQuery, filesRecord, pagesRecord)) return null;

  const visibleChildFileIds = file.childFileIds.filter((cid) => {
    const child = filesRecord[cid];
    if (!child || child.deletedAt) return false;
    return !isSearching || fileSubtreeMatchesQuery(cid, lowerQuery, filesRecord, pagesRecord);
  });
  const visiblePageIds = file.pageIds.filter((pid) => {
    const page = pagesRecord[pid];
    if (!page || page.deletedAt) return false;
    return !isSearching || page.name.toLowerCase().includes(lowerQuery);
  });

  const isExpanded = isSearching || expandedFileIds.has(id);
  const isRenaming = renamingId === id;
  const hasChildren = visibleChildFileIds.length > 0 || visiblePageIds.length > 0;

  return (
    <div>
      <div
        className={`file-tree-row file-tree-file-row${dropZone === 'into' ? ' is-drop-target' : ''}${
          dropZone === 'before' ? ' is-drop-before' : dropZone === 'after' ? ' is-drop-after' : ''
        }`}
        style={{ paddingLeft: depth * 16 }}
        draggable={!isRenaming}
        onDragStart={(e) => {
          draggingKind = 'file';
          e.dataTransfer.setData(DND_MIME, JSON.stringify({ kind: 'file', id } satisfies DragPayload));
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => {
          draggingKind = null;
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DND_MIME)) return;
          e.preventDefault();
          // 페이지는 파일 사이 순서에 끼어들 수 없다 — 항상 "이 폴더 안으로"만 허용.
          if (draggingKind === 'page') {
            setDropZone('into');
            return;
          }
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientY - rect.top) / rect.height;
          setDropZone(ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'into');
        }}
        onDragLeave={() => setDropZone(null)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const zone = dropZone;
          setDropZone(null);
          const payload = readDragPayload(e);
          if (!payload || payload.id === id) return;
          if (payload.kind === 'page') {
            void movePage(payload.id, id);
            return;
          }
          if (zone === 'before') {
            void moveFile(payload.id, file.parentId, id);
          } else if (zone === 'after') {
            const siblings = file.parentId
              ? (useFileTreeStore.getState().files[file.parentId]?.childFileIds ?? [])
              : useFileTreeStore.getState().rootFileIds;
            const nextId = siblingIdAfter(siblings, id);
            if (nextId === payload.id) return; // 이미 그 위치에 있음 — no-op
            void moveFile(payload.id, file.parentId, nextId);
          } else {
            void moveFile(payload.id, id);
          }
        }}
        onClick={() => {
          if (!isRenaming) toggleExpanded(id);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          openContextMenu('file', id, e.clientX, e.clientY);
        }}
      >
        <span className={`file-tree-row-caret${isExpanded ? ' is-expanded' : ''}`} aria-hidden>
          {hasChildren ? <CaretIcon size={11} /> : null}
        </span>
        <span className="file-tree-row-icon" aria-hidden>
          <FolderIcon />
        </span>
        {isRenaming ? (
          <InlineNameInput
            initial={file.name}
            onCommit={(name) => {
              void renameFile(id, name);
              stopRenaming();
            }}
            onCancel={stopRenaming}
          />
        ) : (
          <span className="file-tree-row-name">{file.name}</span>
        )}
      </div>
      {isExpanded && (
        <div>
          {visibleChildFileIds.map((childId) => (
            <FileNode key={childId} id={childId} depth={depth + 1} />
          ))}
          {visiblePageIds.map((pageId) => (
            <PageRow key={pageId} id={pageId} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTreePanel() {
  const rootFileIds = useFileTreeStore((s) => s.rootFileIds);
  const filesRecord = useFileTreeStore((s) => s.files);
  const pagesRecord = useFileTreeStore((s) => s.pages);
  const createFile = useFileTreeStore((s) => s.createFile);
  const moveFile = useFileTreeStore((s) => s.moveFile);
  const startRenaming = useFileTreeUiStore((s) => s.startRenaming);
  const isCollapsed = useFileTreeUiStore((s) => s.isCollapsed);
  const toggleCollapsed = useFileTreeUiStore((s) => s.toggleCollapsed);
  const searchQuery = useFileTreeUiStore((s) => s.searchQuery);
  const setSearchQuery = useFileTreeUiStore((s) => s.setSearchQuery);
  const isTrashOpen = useFileTreeUiStore((s) => s.isTrashOpen);
  const openTrash = useFileTreeUiStore((s) => s.openTrash);
  const [isRootDropTarget, setIsRootDropTarget] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  if (isCollapsed) {
    return (
      <div className="file-tree-panel is-collapsed">
        <button
          type="button"
          className="file-tree-expand-tab"
          onClick={toggleCollapsed}
          title="파일 목록 펼치기"
          aria-label="파일 목록 펼치기"
        >
          <ChevronRightIcon size={13} />
        </button>
      </div>
    );
  }

  const handleExport = async () => {
    const blob = await exportBackup();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `my-note-web-backup-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!window.confirm('백업 파일을 불러오면 지금 저장된 모든 내용이 이 파일의 내용으로 완전히 대체됩니다. 계속할까요?')) {
      return;
    }
    void importBackup(file).catch((err) => {
      window.alert(err instanceof Error ? err.message : '가져오기에 실패했습니다.');
    });
  };

  // 요구사항(찾기): 최상위 File도 FileNode와 동일한 규칙(트래시 숨김 + 검색 매치)으로
  // 걸러낸다 — 여기서 걸러야 FileNode 안 재귀 필터링과 일관되게 "매치되는 가지가
  // 하나도 없는 최상위 폴더"까지 완전히 사라진다.
  const lowerQuery = searchQuery.trim().toLowerCase();
  const isSearching = lowerQuery.length > 0;
  const visibleRootFileIds = rootFileIds.filter((id) => {
    const file = filesRecord[id];
    if (!file || file.deletedAt) return false;
    return !isSearching || fileSubtreeMatchesQuery(id, lowerQuery, filesRecord, pagesRecord);
  });

  return (
    <div className="file-tree-panel">
      <div className="file-tree-toolbar">
        <button
          type="button"
          onClick={() => {
            void createFile(null).then((id) => startRenaming(id));
          }}
        >
          새 파일
          <PlusIcon size={11} />
        </button>
        <button type="button" title="휴지통" aria-label="휴지통" onClick={openTrash}>
          휴지통
          <TrashIcon size={13} />
        </button>
        <div className="file-tree-toolbar-right">
          <SaveStatusIndicator />
          <button
            type="button"
            className="file-tree-icon-btn"
            onClick={toggleCollapsed}
            title="파일 목록 접기"
            aria-label="파일 목록 접기"
          >
            <ChevronLeftIcon size={13} />
          </button>
        </div>
      </div>

      <div className="file-tree-search-row">
        <span className="file-tree-search-icon" aria-hidden>
          <SearchIcon size={13} />
        </span>
        <input
          type="text"
          className="file-tree-search-input"
          placeholder="파일·페이지 이름 찾기"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button
            type="button"
            className="file-tree-search-clear"
            title="검색어 지우기"
            aria-label="검색어 지우기"
            onClick={() => setSearchQuery('')}
          >
            <CloseIcon size={11} />
          </button>
        )}
      </div>

      <div
        className={`file-tree-list${isRootDropTarget ? ' is-drop-target' : ''}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DND_MIME)) {
            e.preventDefault();
            setIsRootDropTarget(true);
          }
        }}
        onDragLeave={() => setIsRootDropTarget(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsRootDropTarget(false);
          const payload = readDragPayload(e);
          // 최상위(root)는 File만 놓을 수 있다 — Page는 항상 어떤 File에 속해야 한다.
          if (payload?.kind === 'file') void moveFile(payload.id, null);
        }}
      >
        {visibleRootFileIds.map((id) => (
          <FileNode key={id} id={id} depth={0} />
        ))}
        {isSearching && visibleRootFileIds.length === 0 && (
          <div className="file-tree-search-empty">검색 결과가 없습니다</div>
        )}
      </div>

      <div className="file-tree-backup-row">
        <button type="button" onClick={() => void handleExport()}>
          내보내기
          <DownloadIcon size={12} />
        </button>
        <button type="button" onClick={() => importInputRef.current?.click()}>
          가져오기
          <UploadIcon size={12} />
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json"
          style={{ display: 'none' }}
          onChange={handleImportFile}
        />
      </div>

      <ContextMenu />
      {isTrashOpen && <TrashPanel />}
    </div>
  );
}
