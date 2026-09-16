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

/** 요구사항(2026-09-15, 드래그 고스트 그라데이션 제거): 브라우저가 기본으로 만드는
 * 드래그 미리보기 이미지는 OS/브라우저마다 반투명 처리에 그림자·블러가 섞여
 * 카드 테두리가 흐릿하고 형태가 불분명하게 보인다(사용자 피드백). 대신 실제 행을
 * 그대로 복제해서 균일한 opacity만 적용한(그림자/블러 없음) 이미지를 직접
 * setDragImage로 지정한다 — 투명도는 유지하되 테두리는 항상 또렷하다.
 *
 * 요구사항(2026-09-15, 후속): 두 가지 버그가 더 있었다.
 * 1) 글자 크기가 커 보임 — 이 복제본은 document.body에 바로 붙기 때문에, 실제
 *    글자 크기(13px)를 정의하는 조상인 .file-tree-panel(font-size: var(--font-size-md))
 *    에서 물려받던 상속이 끊겨 브라우저 기본값(16px)으로 튀었다. 행 자체는
 *    font-size를 직접 정의하지 않고 조상으로부터 상속만 받는 구조라, 복제 시점에
 *    실제 계산된 값(computed style)을 인라인으로 그대로 박아 넣어 고정한다.
 * 2) 배경이 안 보임 — 배경을 흰색(--color-surface)으로 쓰고 있어서, 흰색 캔버스
 *    위에서는 opacity를 줘도 거의 안 보였다(사용자 피드백: "E9E9E9 배경색이 안
 *    보임" — 원래 의도한 색은 실제 사이드바의 .is-drag-source와 같은 톤인
 *    --color-fill-hover(#E9E9E9)였는데 여기 적용이 안 돼 있었다). 사이드바 안에서
 *    보이는 드래그 소스 표시와 같은 색으로 바꾸고, 또렷한 실선 테두리를 추가해
 *    카드 형태(노션 참고 스크린샷처럼)가 항상 분명히 보이도록 한다 — 배경/테두리
 *    모두 단일 색(그라데이션 없음)이고 opacity는 엘리먼트 전체에 한 번만 적용되므로
 *    내부가 균일하게 유지된다. */
function setPlainDragImage(e: React.DragEvent<HTMLElement>) {
  const source = e.currentTarget;
  const rect = source.getBoundingClientRect();
  const computed = window.getComputedStyle(source);
  const clone = source.cloneNode(true) as HTMLElement;
  clone.style.position = 'fixed';
  clone.style.top = '-9999px';
  clone.style.left = '-9999px';
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  clone.style.margin = '0';
  clone.style.boxSizing = 'border-box';
  // (1) 글자 크기·서체가 조상 상속에 의존하던 걸 인라인 값으로 고정.
  clone.style.fontFamily = computed.fontFamily;
  clone.style.fontSize = computed.fontSize;
  clone.style.fontWeight = computed.fontWeight;
  clone.style.lineHeight = computed.lineHeight;
  clone.style.letterSpacing = computed.letterSpacing;
  clone.style.color = computed.color;
  // (2) 흰 배경 대신 실제 드래그 소스와 같은 톤 + 또렷한 테두리.
  clone.style.background = 'var(--color-fill-hover)';
  clone.style.border = '1px solid var(--color-border-strong)';
  clone.style.borderRadius = computed.borderRadius;
  clone.style.opacity = '0.92';
  clone.style.boxShadow = 'none';
  clone.style.filter = 'none';
  clone.style.pointerEvents = 'none';
  document.body.appendChild(clone);
  e.dataTransfer.setDragImage(clone, e.clientX - rect.left, e.clientY - rect.top);
  // 브라우저가 드래그 이미지를 캡처하는 건 이 이벤트 핸들러가 끝난 직후이므로,
  // 다음 프레임에 지워도 미리보기 캡처에는 영향이 없다.
  requestAnimationFrame(() => {
    clone.parentNode?.removeChild(clone);
  });
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

function PageRow({ id, depth, isLastPage }: { id: string; depth: number; isLastPage: boolean }) {
  const page = useFileTreeStore((s) => s.pages[id]);
  const isActive = useFileTreeStore((s) => s.currentPageId === id);
  // 요구사항(휴지통): 부모(FileNode)가 이미 pageIds를 필터링해서 넘기지만, 방어적으로
  const openPage = useFileTreeStore((s) => s.openPage);
  const renamePage = useFileTreeStore((s) => s.renamePage);
  const renamingId = useFileTreeUiStore((s) => s.renamingId);
  const stopRenaming = useFileTreeUiStore((s) => s.stopRenaming);
  const openContextMenu = useFileTreeUiStore((s) => s.openContextMenu);
  // 요구사항(2026-09-15, 드래그 하이라이트를 목록 전체 → 드래그 중인 항목 자신으로):
  // 이 Page 자신이 지금 드래그되고 있는 원본이면 진하게 표시한다(아래 파일 카드 쪽
  // "넣으려는 공간" 강조보다 진한 톤 — CSS의 is-drag-source/is-drop-target 참고).
  const draggingKind = useFileTreeDragStore((s) => s.draggingKind);
  const draggingId = useFileTreeDragStore((s) => s.draggingId);
  const isDragSource = draggingKind === 'page' && draggingId === id;

  // 요구사항(휴지통): 부모(FileNode)가 이미 pageIds를 필터링해서 넘기지만, 방어적으로
  // 한 번 더 확인한다 — 트래시된 Page는 어떤 경로로도 트리에 보이면 안 된다.
  if (!page || page.deletedAt) return null;
  const isRenaming = renamingId === id;

  return (
    <div
      className={`file-tree-row file-tree-page-row${isActive ? ' is-active' : ''}${isDragSource ? ' is-drag-source' : ''}`}
      style={{ paddingLeft: 16 + depth * 16 }}
      draggable={!isRenaming}
      onDragStart={(e) => {
        useFileTreeDragStore.getState().startDrag('page', id);
        e.dataTransfer.setData(DND_MIME, JSON.stringify({ kind: 'page', id } satisfies DragPayload));
        e.dataTransfer.effectAllowed = 'move';
        setPlainDragImage(e);
      }}
      onDragEnd={() => {
        useFileTreeDragStore.getState().endDrag();
      }}
      onDragOver={(e) => {
        const drag = useFileTreeDragStore.getState();
        if (!e.dataTransfer.types.includes(DND_MIME)) return;
        if (drag.draggingKind === 'page') {
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
          return;
        }
        // 요구사항(2026-09-15, "폴더 끝까지 내려가야만 형제 순서 변경" 버그 수정):
        // File을 드래그하는 중에는 Page 행이 순서를 받아줄 수 없다(파일과 페이지는
        // 다른 목록이라서). 예전엔 여기서 아무 것도 안 하고 return만 해서(preventDefault
        // 조차 안 함) 이벤트가 그대로 바깥으로 새어나갔는데, 펼쳐진 폴더 안의 Page
        // 행들은 부모 컨테이너에 stopPropagation하는 곳이 없어서 결국 최상위
        // `.file-tree-list`까지 버블링되고, 거기서 "File 드래그 중 = 무조건 목록
        // 맨 끝"으로 즉시 덮어써버렸다 — 그래서 펼쳐진 폴더 안 아무 Page 위에만
        // 올라가도 그 폴더 바로 다음으로 순서가 바뀌는 버그가 났다.
        // 고침: 이 폴더의 "마지막으로 보이는 Page"(isLastPage)의 아래쪽 절반 위에
        // 있을 때만 "이 폴더 다음으로" 판정하고, 그 전까지(폴더 내부 다른 Page 위)는
        // preventDefault+stopPropagation만 해서 드롭 자체는 허용하되 목표는 새로
        // 갱신하지 않는다(sticky — 마지막으로 유효했던 목표가 그대로 유지된다).
        e.preventDefault();
        e.stopPropagation();
        if (!isLastPage) return;
        const rect = e.currentTarget.getBoundingClientRect();
        if (e.clientY - rect.top < rect.height / 2) return;
        const containingFile = useFileTreeStore.getState().files[page.fileId];
        if (!containingFile) return;
        const siblings = containingFile.parentId
          ? (useFileTreeStore.getState().files[containingFile.parentId]?.childFileIds ?? [])
          : useFileTreeStore.getState().rootFileIds;
        const nextId = siblingIdAfter(siblings, page.fileId);
        drag.setDropTarget({ kind: 'file-order', parentId: containingFile.parentId, beforeId: nextId ?? null });
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
  // 요구사항(2026-09-15, 드래그 하이라이트를 목록 전체 → 드래그 중인 항목 자신으로):
  // 이 File 자신이 지금 드래그되고 있는 원본이면 진하게 표시한다 — "넣으려는 공간"
  // (isIntoTarget, 옅은 톤)보다 진한 톤으로 구분한다(CSS의 is-drag-source 참고).
  const draggingKind = useFileTreeDragStore((s) => s.draggingKind);
  const draggingId = useFileTreeDragStore((s) => s.draggingId);
  const isDragSource = draggingKind === 'file' && draggingId === id;
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
        className={`file-tree-row file-tree-file-row${isIntoTarget ? ' is-drop-target' : ''}${isDragSource ? ' is-drag-source' : ''}`}
        style={{ paddingLeft: depth * 16 }}
        draggable={!isRenaming}
        onDragStart={(e) => {
          useFileTreeDragStore.getState().startDrag('file', id);
          e.dataTransfer.setData(DND_MIME, JSON.stringify({ kind: 'file', id } satisfies DragPayload));
          e.dataTransfer.effectAllowed = 'move';
          setPlainDragImage(e);
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
          // 요구사항(2026-09-14, 최상단/최하단 드롭 영역 확장; 2026-09-15, 위쪽
          // 영역 추가 확장): 같은 목록의 첫/마지막 File일 때는 위/아래 판정 존을
          // 넓혀서, 그 항목의 대부분 어디에 놓아도 "그 위로"/"그 아래로"가
          // 인식되게 한다. 위쪽은 0.5로는 아직도 좁다는 피드백으로 0.7까지 추가로
          // 넓혔다(맨 위로 옮기려 조금만 올려도 계속 금지 커서가 뜨는 문제 완화).
          // 단, 이 목록에 형제가 이 File 하나뿐이면(첫째이자 막내) 넓히지 않는다 —
          // 그러면 "폴더 안으로" 존이 완전히 사라져서 그 폴더 안에 아무것도 넣을 수
          // 없게 되기 때문이다.
          const onlyChild = isFirstSibling && isLastSibling;
          const topThreshold = isFirstSibling && !onlyChild ? 0.7 : 0.25;
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
          {visiblePageIds.map((pageId, index) => (
            <Fragment key={pageId}>
              {pageGap.isBefore(pageId) && <DropGapLine />}
              <PageRow id={pageId} depth={depth + 1} isLastPage={index === visiblePageIds.length - 1} />
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
        className="file-tree-list"
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
