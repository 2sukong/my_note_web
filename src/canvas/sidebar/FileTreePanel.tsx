import { Fragment, useEffect, useRef, useState } from 'react';
import { useFileTreeStore } from '../../storage/fileTreeStore';
import { useFileTreeUiStore } from './fileTreeUiStore';
import { useFileTreeDragStore } from './fileTreeDragStore';
import { fileSubtreeMatchesQuery } from '../../storage/fileTreeLogic';
import { SaveStatusIndicator } from '../SaveStatusIndicator';
import { TrashPanel } from './TrashPanel';
import {
  CaretIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  FolderIcon,
  PageIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
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

/** 형제 목록에서 targetId 바로 다음 항목의 id를 찾는다("이 항목 다음에 끼워 넣기"용). */
function siblingIdAfter(siblings: string[], targetId: string): string | undefined {
  const idx = siblings.indexOf(targetId);
  return idx === -1 ? undefined : siblings[idx + 1];
}

/**
 * 요구사항(2026-09-14): 특정 형제 목록(group) 안에서 지금 드래그 중인 드롭 타깃이
 * "이 id 바로 앞"이거나 "이 목록의 맨 끝"인지를 판정한다 — File 목록은 groupId로
 * 부모 File의 id(최상위면 null)를, Page 목록은 groupId로 그 Page들이 속한 File의
 * id를 넘긴다. FileNode/FileTreePanel이 이 결과로 DropGapLine을 그 자리에 끼워
 * 넣는다(자리를 비켜주는 미리보기).
 */
function useDropGapMatcher(kind: 'file-order' | 'page-order', groupId: string | null) {
  const dropTarget = useFileTreeDragStore((s) => s.dropTarget);
  if (!dropTarget || dropTarget.kind !== kind) {
    return { isBefore: () => false, isAtEnd: false };
  }
  const matchesGroup = dropTarget.kind === 'file-order' ? dropTarget.parentId === groupId : dropTarget.fileId === groupId;
  if (!matchesGroup) return { isBefore: () => false, isAtEnd: false };
  const beforeId = dropTarget.beforeId;
  return { isBefore: (id: string) => beforeId === id, isAtEnd: beforeId === null };
}

/** 요구사항(가로선 디자인, 2026-09-14): 순서 변경 미리보기 — 실제로 목록 사이에 끼워
 * 넣는 엘리먼트라서(box-shadow가 아니라) 행의 둥근 모서리(border-radius)에 영향을
 * 전혀 받지 않고, 양 끝이 항상 완전한 직선으로 보인다. 높이가 있는 요소라 다른
 * 항목들이 실제로 자리를 비켜준다(레이아웃에 실제로 반영되는 진짜 "자리 예약"). */
function DropGapLine() {
  return (
    <div className="file-tree-drop-gap" aria-hidden>
      <div className="file-tree-drop-gap-line" />
    </div>
  );
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
      label: '삭제',
      danger: true,
      onClick: () => void deleteFile(menu.id),
    });
  } else {
    items.push({ label: '열기', onClick: () => void openPage(menu.id) });
    items.push({ label: '이름 바꾸기', onClick: () => startRenaming(menu.id) });
    items.push({ label: '복제', onClick: () => void duplicatePage(menu.id) });
    items.push({
      label: '삭제',
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
  const renamingId = useFileTreeUiStore((s) => s.renamingId);
  const stopRenaming = useFileTreeUiStore((s) => s.stopRenaming);
  const openContextMenu = useFileTreeUiStore((s) => s.openContextMenu);

  // 요구사항(휴지통): 부모(FileNode)가 이미 pageIds를 필터링해서 넘기지만, 방어적으로
  // 한 번 더 확인한다 — 트래시된 Page는 어떤 경로로도 트리에 보이면 안 된다.
  if (!page || page.deletedAt) return null;
  const isRenaming = renamingId === id;

  return (
    <div
      className={`file-tree-row file-tree-page-row${isActive ? ' is-active' : ''}`}
      style={{ paddingLeft: 16 + depth * 16 }}
      draggable={!isRenaming}
      onDragStart={(e) => {
        useFileTreeDragStore.getState().startDrag('page', id);
        e.dataTransfer.setData(DND_MIME, JSON.stringify({ kind: 'page', id } satisfies DragPayload));
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => {
        useFileTreeDragStore.getState().endDrag();
      }}
      onDragOver={(e) => {
        // 페이지는 페이지끼리만 순서를 바꿀 수 있다(파일과 섞인 순서 자체가 없음) —
        // 파일이 드래그 중이면 이 행 위/아래에 끼워 넣을 수 없다는 뜻으로 아예 무시한다.
        const drag = useFileTreeDragStore.getState();
        if (drag.draggingKind !== 'page' || !e.dataTransfer.types.includes(DND_MIME)) return;
        e.preventDefault();
        // 요구사항(다른 행 클로버시 목표를 덮어쓰지 않기): 순서 판정은 이 행에서 끝내고
        // 바깥(부모 목록/전체 리스트)으로 더는 안 번지게 한다 — 안 그러면 이 dragover
        // 직후에 바깥 컨테이너의 dragover가 다시 실행되며 방금 정한 목표를 덮어쓴다.
        e.stopPropagation();
        if (drag.draggingId === id) return; // 자기 자신 위에서는 갱신하지 않는다(그대로 두면 no-op).
        const rect = e.currentTarget.getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) {
          drag.setDropTarget({ kind: 'page-order', fileId: page.fileId, beforeId: id });
        } else {
          const siblings = useFileTreeStore.getState().files[page.fileId]?.pageIds ?? [];
          const nextId = siblingIdAfter(siblings, id);
          drag.setDropTarget({ kind: 'page-order', fileId: page.fileId, beforeId: nextId ?? null });
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

function FileNode({
  id,
  depth,
  isFirstSibling,
  isLastSibling,
}: {
  id: string;
  depth: number;
  isFirstSibling: boolean;
  isLastSibling: boolean;
}) {
  const file = useFileTreeStore((s) => s.files[id]);
  const filesRecord = useFileTreeStore((s) => s.files);
  const pagesRecord = useFileTreeStore((s) => s.pages);
  const renameFile = useFileTreeStore((s) => s.renameFile);
  const expandedFileIds = useFileTreeUiStore((s) => s.expandedFileIds);
  const toggleExpanded = useFileTreeUiStore((s) => s.toggleExpanded);
  const renamingId = useFileTreeUiStore((s) => s.renamingId);
  const stopRenaming = useFileTreeUiStore((s) => s.stopRenaming);
  const openContextMenu = useFileTreeUiStore((s) => s.openContextMenu);
  const searchQuery = useFileTreeUiStore((s) => s.searchQuery);
  // 요구사항(2026-09-14): 드롭 판정은 이제 이 행 로컬 state가 아니라 전역
  // fileTreeDragStore가 들고 있다 — 이 행이 지금 "폴더 안으로" 타깃인지만 여기서
  // 파생해서 점선 테두리 표시에 쓴다(순서 변경 표시는 DropGapLine이 별도로 그린다).
  const dropTarget = useFileTreeDragStore((s) => s.dropTarget);
  const isIntoTarget =
    (dropTarget?.kind === 'into-file' || dropTarget?.kind === 'into-file-pages') && dropTarget.fileId === id;
  // 요구사항(자리 예약 미리보기, 2026-09-14): 이 File의 자식 File 목록/Page 목록
  // 각각에서 지금 드롭하면 어디에 끼워지는지를 구해서, 그 자리에 DropGapLine을
  // 실제로 끼워 넣는다(다른 항목들이 진짜로 밀려나 자리를 만든다). rules-of-hooks
  // 때문에 아래의 조건부 return들보다 반드시 먼저 호출해야 한다.
  const childFileGap = useDropGapMatcher('file-order', id);
  const pageGap = useDropGapMatcher('page-order', id);

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
        className={`file-tree-row file-tree-file-row${isIntoTarget ? ' is-drop-target' : ''}`}
        style={{ paddingLeft: depth * 16 }}
        draggable={!isRenaming}
        onDragStart={(e) => {
          useFileTreeDragStore.getState().startDrag('file', id);
          e.dataTransfer.setData(DND_MIME, JSON.stringify({ kind: 'file', id } satisfies DragPayload));
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => {
          useFileTreeDragStore.getState().endDrag();
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DND_MIME)) return;
          e.preventDefault();
          e.stopPropagation();
          const drag = useFileTreeDragStore.getState();
          // 페이지는 파일 사이 순서에 끼어들 수 없다 — 항상 "이 폴더 안으로"만 허용.
          if (drag.draggingKind === 'page') {
            drag.setDropTarget({ kind: 'into-file-pages', fileId: id });
            return;
          }
          if (drag.draggingId === id) return; // 자기 자신 위에서는 갱신하지 않는다.
          // 요구사항(2026-09-14, 최상단/최하단 드롭 영역 확장): 같은 목록의 첫/마지막
          // File일 때는 위/아래 판정 존을 25%→50%로 넓혀서, 그 항목의 절반 어디에
          // 놓아도 "그 위로"/"그 아래로"가 인식되게 한다. 단, 이 목록에 형제가 이
          // File 하나뿐이면(첫째이자 막내) 넓히지 않는다 — 그러면 "폴더 안으로" 존이
          // 완전히 사라져서 그 폴더 안에 아무것도 넣을 수 없게 되기 때문이다.
          const onlyChild = isFirstSibling && isLastSibling;
          const topThreshold = isFirstSibling && !onlyChild ? 0.5 : 0.25;
          const bottomThreshold = isLastSibling && !onlyChild ? 0.5 : 0.75;
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientY - rect.top) / rect.height;
          if (ratio < topThreshold) {
            drag.setDropTarget({ kind: 'file-order', parentId: file.parentId, beforeId: id });
          } else if (ratio > bottomThreshold) {
            const siblings = file.parentId
              ? (useFileTreeStore.getState().files[file.parentId]?.childFileIds ?? [])
              : useFileTreeStore.getState().rootFileIds;
            const nextId = siblingIdAfter(siblings, id);
            drag.setDropTarget({ kind: 'file-order', parentId: file.parentId, beforeId: nextId ?? null });
          } else {
            drag.setDropTarget({ kind: 'into-file', fileId: id });
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
          {visibleChildFileIds.map((childId, index) => (
            <Fragment key={childId}>
              {childFileGap.isBefore(childId) && <DropGapLine />}
              <FileNode
                id={childId}
                depth={depth + 1}
                isFirstSibling={index === 0}
                isLastSibling={index === visibleChildFileIds.length - 1}
              />
            </Fragment>
          ))}
          {childFileGap.isAtEnd && <DropGapLine />}
          {visiblePageIds.map((pageId) => (
            <Fragment key={pageId}>
              {pageGap.isBefore(pageId) && <DropGapLine />}
              <PageRow id={pageId} depth={depth + 1} />
            </Fragment>
          ))}
          {pageGap.isAtEnd && <DropGapLine />}
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
  const movePage = useFileTreeStore((s) => s.movePage);
  const startRenaming = useFileTreeUiStore((s) => s.startRenaming);
  const isCollapsed = useFileTreeUiStore((s) => s.isCollapsed);
  const toggleCollapsed = useFileTreeUiStore((s) => s.toggleCollapsed);
  const searchQuery = useFileTreeUiStore((s) => s.searchQuery);
  const setSearchQuery = useFileTreeUiStore((s) => s.setSearchQuery);
  const isTrashOpen = useFileTreeUiStore((s) => s.isTrashOpen);
  const openTrash = useFileTreeUiStore((s) => s.openTrash);
  // 요구사항(2026-09-14): 예전에는 이 컨테이너 자신의 dragover에서만 로컬 state를
  // 켰다(자식 행들이 이벤트를 막지 않았기 때문에 사실상 트리 전체에서 드래그 중이면
  // 항상 켜졌다). 이제 자식 행들이 stopPropagation()으로 더 구체적인 타깃을
  // 확정하므로, 배경 강조는 "드래그가 진행 중인지"로 단순화한다.
  const draggingKind = useFileTreeDragStore((s) => s.draggingKind);
  const rootGap = useDropGapMatcher('file-order', null);

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
        className={`file-tree-list${draggingKind ? ' is-drop-target' : ''}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DND_MIME)) return;
          e.preventDefault();
          // 이 핸들러는 자식 행이 stopPropagation()하지 않은 경우에만 실행된다 — 즉
          // 목록의 어떤 특정 행 위도 아닌 "빈 공간"(스크롤 영역 하단의 남는 공간 등)
          // 위에 있다는 뜻이다. 요구사항(맨 위/아래로 이동, 2026-09-14): File을 끄는
          // 중이면 그 빈 공간을 "최상위 목록의 맨 끝"으로 해석해 즉시 타깃을 갱신한다.
          // Page를 끄는 중이면 최상위에는 Page를 놓을 자리가 아예 없으므로 여기서
          // 새로 타깃을 정하지 않고 그대로 둔다(sticky) — 예를 들어 어떤 File의
          // 마지막 Page 아래 빈 공간까지 끌고 내려와도, 그 직전 행 위에서 계산됐던
          // "그 File의 페이지 목록 맨 끝" 타깃이 그대로 살아있어 정확히 그 자리로
          // 이동한다(스크린샷 요구사항: 페이지를 맨 아래 빈 공간까지 끌어도 마지막
          // 페이지 다음에 정확히 들어간다).
          const drag = useFileTreeDragStore.getState();
          if (drag.draggingKind === 'file') {
            drag.setDropTarget({ kind: 'file-order', parentId: null, beforeId: null });
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          const payload = readDragPayload(e);
          const target = useFileTreeDragStore.getState().dropTarget;
          if (payload && target) {
            if (target.kind === 'file-order' && payload.kind === 'file') {
              void moveFile(payload.id, target.parentId, target.beforeId);
            } else if (target.kind === 'page-order' && payload.kind === 'page') {
              void movePage(payload.id, target.fileId, target.beforeId);
            } else if (target.kind === 'into-file' && payload.kind === 'file') {
              void moveFile(payload.id, target.fileId);
            } else if (target.kind === 'into-file-pages' && payload.kind === 'page') {
              void movePage(payload.id, target.fileId);
            }
          }
          useFileTreeDragStore.getState().endDrag();
        }}
      >
        {visibleRootFileIds.map((id, index) => (
          <Fragment key={id}>
            {rootGap.isBefore(id) && <DropGapLine />}
            <FileNode
              id={id}
              depth={0}
              isFirstSibling={index === 0}
              isLastSibling={index === visibleRootFileIds.length - 1}
            />
          </Fragment>
        ))}
        {rootGap.isAtEnd && <DropGapLine />}
        {isSearching && visibleRootFileIds.length === 0 && (
          <div className="file-tree-search-empty">검색 결과가 없습니다</div>
        )}
      </div>

      <ContextMenu />
      {isTrashOpen && <TrashPanel />}
    </div>
  );
}
