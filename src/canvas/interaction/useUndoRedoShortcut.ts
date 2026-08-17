import { useEffect } from 'react';
import { useHistoryStore } from '../../store/historyStore';

/**
 * Phase 7: Ctrl/Cmd+Z(undo), Ctrl/Cmd+Shift+Z 또는 Ctrl/Cmd+Y(redo).
 *
 * mode(select/text-edit 등)로 가드하지 않고 항상 동작한다 — Backspace/Delete
 * 전역 단축키(useObjectDeleteShortcut)와 달리, TextObjectView/AnnotationBubble
 * 어느 쪽도 Ctrl+Z 자체를 가로채 자기 로직으로 처리하지 않으므로 충돌이 없다.
 * 대신 항상 preventDefault해서 contentEditable의 브라우저 네이티브 undo가
 * (store와 무관하게) DOM 텍스트만 되돌려 store와 어긋나는 사고를 막는다 — 되돌린
 * 뒤 store가 바뀌면 TextObjectView의 기존 "DOM이 store와 다를 때만 다시 쓰기"
 * 로직이 알아서 화면을 다시 동기화한다(Enter/Backspace와 같은 패턴).
 */
export function useUndoRedoShortcut() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod || e.key.toLowerCase() !== 'z') {
        if (isMod && e.key.toLowerCase() === 'y') {
          e.preventDefault();
          useHistoryStore.getState().redo();
        }
        return;
      }
      e.preventDefault();
      if (e.shiftKey) {
        useHistoryStore.getState().redo();
      } else {
        useHistoryStore.getState().undo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
