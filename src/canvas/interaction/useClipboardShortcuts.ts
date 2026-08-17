import { useEffect } from 'react';
import type { CanvasObject } from '../../types/object';
import { useInteractionStore } from '../../store/interactionStore';
import { useObjectsStore } from '../../store/objectsStore';
import { useClipboardStore } from '../../store/clipboardStore';
import { pasteClipboardObjects } from '../actions';

/**
 * Phase 7: 선택된 캔버스 객체(Text/Image/Frame/Arrow/Rectangle)의 Ctrl/Cmd+C(복사)·
 * X(잘라내기)·V(붙여넣기). 내부 clipboardStore(canvas 객체 전용, OS 클립보드 아님)를 쓴다.
 *
 * mode === 'text-edit'일 때는 전혀 관여하지 않는다(useImagePaste.ts와 동일한 관례) —
 * 그 안에서의 Ctrl+C/V는 브라우저 contentEditable의 기본 텍스트 복사/붙여넣기여야 한다.
 * 'select'/'idle' 등 그 외 모드에서만 동작하므로, 객체를 선택했다가 캔버스 빈 곳을
 * 클릭해 선택을 해제한(mode='idle') 뒤에도 여전히 붙여넣기는 가능하다.
 *
 * Ctrl+V는 clipboardStore가 비어 있으면(캔버스 객체를 한 번도 복사한 적 없으면)
 * preventDefault조차 하지 않고 그대로 흘려보낸다 — 그래야 OS 클립보드의 이미지를
 * 붙여넣는 useImagePaste.ts의 전역 'paste' 이벤트가 정상적으로 계속 발생한다
 * (keydown에서 preventDefault하면 브라우저가 뒤이어 합성하는 paste 이벤트 자체가
 * 발생하지 않는다 — 그래서 "정말 우리가 처리할 붙여넣기일 때만" preventDefault한다).
 */
export function useClipboardShortcuts() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod) return;
      const key = e.key.toLowerCase();
      if (key !== 'c' && key !== 'x' && key !== 'v') return;

      if (useInteractionStore.getState().mode === 'text-edit') return;

      if (key === 'v') {
        if (useClipboardStore.getState().objects.length === 0) return;
        e.preventDefault();
        pasteClipboardObjects();
        return;
      }

      // c 또는 x: 선택된 객체가 없으면 아무 것도 하지 않는다(네이티브 동작에 영향 없음).
      const { selectedIds } = useInteractionStore.getState();
      if (selectedIds.length === 0) return;
      e.preventDefault();

      const objects = useObjectsStore.getState().objects;
      const toCopy = selectedIds
        .map((id) => objects[id])
        .filter((o): o is CanvasObject => o !== undefined)
        .map((o) => structuredClone(o));
      if (toCopy.length === 0) return;

      useClipboardStore.getState().copy(toCopy);

      if (key === 'x') {
        useObjectsStore.getState().removeObjects(selectedIds);
        useInteractionStore.getState().deselect();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
