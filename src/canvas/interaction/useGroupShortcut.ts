import { useEffect } from 'react';
import { useInteractionStore } from '../../store/interactionStore';
import { useObjectsStore } from '../../store/objectsStore';

/**
 * 요구사항(그룹화): Ctrl/Cmd+G로 선택된 객체들을 "가벼운 그룹"으로 묶고,
 * Ctrl/Cmd+Shift+G로 그 그룹을 해제한다. 실제 그룹 데이터(groupId)와 동작
 * (드래그/삭제 시 그룹 전체가 함께 움직이거나 지워짐, 클릭하면 개별 선택 가능)은
 * objectsStore.ts(groupObjects/ungroupObjects/getGroupMemberIds)와
 * useObjectDrag.ts/useObjectDeleteShortcut.ts에 있다 — 이 훅은 단축키 입력만 담당한다.
 *
 * useObjectDeleteShortcut.ts와 동일한 이유로 사이드바 입력창 등에 포커스가 있을 때는
 * 개입하지 않는다(그 필드 안에서의 일반 텍스트 편집으로 취급). mode==='text-edit'일
 * 때도 마찬가지로 개입하지 않는다 — 텍스트 내용 편집 중의 Ctrl+G는 이 단축키의
 * 대상이 아니다.
 */
export function useGroupShortcut() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod || e.key.toLowerCase() !== 'g') return;

      const active = document.activeElement;
      const isEditableTarget =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable);
      if (isEditableTarget) return;

      const { mode, selectedIds } = useInteractionStore.getState();
      if (mode === 'text-edit') return;
      if (selectedIds.length === 0) return;

      // 브라우저 기본 Ctrl+G(찾기 다음 항목)와 겹치므로, 우리가 처리할 수 있는
      // 상황(선택된 객체가 있음)에서는 항상 preventDefault한다.
      e.preventDefault();

      if (e.shiftKey) {
        useObjectsStore.getState().ungroupObjects(selectedIds);
      } else {
        useObjectsStore.getState().groupObjects(selectedIds);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
