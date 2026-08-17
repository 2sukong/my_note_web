import { useEffect } from 'react';
import { useInteractionStore } from '../../store/interactionStore';
import { useViewportStore } from '../../store/viewportStore';
import { spawnTextFromClipboard, findFrameAt } from '../actions';

/**
 * Phase 7: Ctrl+V(또는 Cmd+V)로 OS 클립보드의 순수 텍스트를 캔버스에 붙여넣는다.
 * useImagePaste.ts와 완전히 같은 구조/관례를 따른다 — '텍스트' 도구로 빈 상자를
 * 먼저 만들지 않아도, 어딘가에서 텍스트를 Ctrl+C한 뒤 캔버스에 바로 Ctrl+V하면
 * 그 내용을 담은 새 Text 객체가 즉시 생긴다.
 *
 * mode === 'text-edit'일 때는 절대 가로채지 않는다 — 그 안에서의 붙여넣기는
 * 브라우저 contentEditable의 기본 텍스트 붙여넣기여야 한다. 클립보드에 이미지
 * 파일이 들어있으면(useImagePaste.ts가 처리할 몫) 이 핸들러는 관여하지 않는다 —
 * 두 훅 모두 같은 전역 'paste' 이벤트를 구독하지만 서로 겹치지 않는 조건으로
 * 나뉘어 있다. useClipboardShortcuts.ts의 내부 객체 클립보드(캔버스 객체 자체를
 * 복사·붙여넣기)가 비어 있을 때만(keydown에서 preventDefault하지 않을 때만) 이
 * 전역 paste 이벤트가 실제로 발생한다는 점도 동일하다.
 */
export function useTextPaste() {
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (useInteractionStore.getState().mode === 'text-edit') return;

      const hasImageFile = Array.from(e.clipboardData?.items ?? []).some(
        (item) => item.kind === 'file' && item.type.startsWith('image/'),
      );
      if (hasImageFile) return; // useImagePaste.ts의 몫

      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (text.trim() === '') return;

      e.preventDefault();

      const { zoom, panX, panY } = useViewportStore.getState();
      const centerWorld = {
        x: (window.innerWidth / 2 - panX) / zoom,
        y: (window.innerHeight / 2 - panY) / zoom,
      };
      const frameId = findFrameAt(centerWorld.x, centerWorld.y);
      spawnTextFromClipboard(centerWorld.x, centerWorld.y, text, frameId);
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);
}
