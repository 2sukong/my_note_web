import { useEffect } from 'react';
import { useInteractionStore } from '../../store/interactionStore';
import { useViewportStore } from '../../store/viewportStore';
import { spawnImageAt, findFrameAt } from '../actions';

/**
 * Phase 5: Ctrl+V(또는 Cmd+V)로 클립보드의 이미지를 캔버스에 붙여넣는다.
 *
 * mode === 'text-edit'(본문/주석을 타이핑 중)일 때는 절대 가로채지 않는다 —
 * 그 안에서의 붙여넣기는 브라우저 contentEditable의 기본 텍스트 붙여넣기여야
 * 한다. 편집 중이 아닐 때만 전역 paste 이벤트를 가로채, 현재 화면 중앙의
 * world 좌표에 이미지를 만든다(어디를 클릭했는지 알 수 없는 키보드 동작이라
 * '화면 중앙'을 합리적인 기본 위치로 삼았다). 그 위치가 Frame 위라면
 * 같은 Frame에 논리적으로 소속시킨다(드래그 앤 드롭과 동일한 규칙).
 */
export function useImagePaste() {
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (useInteractionStore.getState().mode === 'text-edit') return;

      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((f): f is File => f !== null);
      if (files.length === 0) return;

      e.preventDefault();

      const { zoom, panX, panY } = useViewportStore.getState();
      const centerWorld = {
        x: (window.innerWidth / 2 - panX) / zoom,
        y: (window.innerHeight / 2 - panY) / zoom,
      };
      const frameId = findFrameAt(centerWorld.x, centerWorld.y);

      files.forEach((file, i) => {
        // 여러 장을 한 번에 붙여넣으면 완전히 겹치지 않도록 살짝씩 어긋나게 놓는다.
        void spawnImageAt(centerWorld.x + i * 24, centerWorld.y + i * 24, file, frameId);
      });
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);
}
