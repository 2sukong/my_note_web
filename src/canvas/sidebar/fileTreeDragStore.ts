import { create } from 'zustand';

/**
 * 요구사항(2026-09-14, 파일/페이지 드래그 정렬 개선): 트리 안에서 지금 드래그 중인
 * 항목과 "지금 이대로 놓으면 어디로 가는지"를 하나의 전역 상태로 추적한다. 예전에는
 * 각 행(FileNode/PageRow)이 자기 자신의 dropZone/dropEdge를 로컬 state로만 들고
 * 있어서 (1) "미리보기가 가리키는 자리"와 "실제 드롭 결과"가 항상 정확히 같다는
 * 보장이 로직상 없었고, (2) 다른 행들이 자리를 비켜주는 미리보기를 구현할 방법이
 * 없었다(각 행이 서로의 상태를 모름). 이제 dragover가 계산한 목표를 여기 한 곳에만
 * 쓰고, 실제 drop도 이 store가 마지막으로 들고 있던 값을 그대로 실행해서 두 문제를
 * 한 번에 해결한다.
 *
 * kind별 의미:
 * - 'file-order' / 'page-order': 같은 목록(형제) 안에서 순서만 바꾼다. beforeId가
 *   특정 id면 "그 항목 바로 앞", null이면 "그 목록의 맨 끝"(moveFile/movePage의
 *   "beforeId 없음(undefined)=no-op 가드"와 구분하기 위해 명시적으로 null을 쓴다 —
 *   fileTreeStore.ts 참고).
 * - 'into-file': File(폴더) 안으로 재배치(중첩) — 순서는 신경 쓰지 않고 끝에 붙는다.
 * - 'into-file-pages': Page를 다른 File의 페이지 목록으로 재배치.
 */
export type FileTreeDropTarget =
  | { kind: 'file-order'; parentId: string | null; beforeId: string | null }
  | { kind: 'page-order'; fileId: string; beforeId: string | null }
  | { kind: 'into-file'; fileId: string }
  | { kind: 'into-file-pages'; fileId: string };

interface FileTreeDragState {
  draggingKind: 'file' | 'page' | null;
  draggingId: string | null;
  dropTarget: FileTreeDropTarget | null;
  startDrag: (kind: 'file' | 'page', id: string) => void;
  setDropTarget: (target: FileTreeDropTarget) => void;
  endDrag: () => void;
}

export const useFileTreeDragStore = create<FileTreeDragState>((set) => ({
  draggingKind: null,
  draggingId: null,
  dropTarget: null,
  startDrag: (kind, id) => set({ draggingKind: kind, draggingId: id, dropTarget: null }),
  setDropTarget: (target) => set({ dropTarget: target }),
  endDrag: () => set({ draggingKind: null, draggingId: null, dropTarget: null }),
}));
