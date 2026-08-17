import { create } from 'zustand';
import type { CanvasObject } from '../types/object';

interface ClipboardState {
  /** 마지막 Ctrl+C/X 시점의 스냅샷(깊은 복사, 원본과 완전히 독립적). */
  objects: CanvasObject[];
  /** 같은 복사본을 몇 번째 붙여넣는지 — 매번 조금씩 어긋난 위치에 놓기 위해 쓴다.
   * 새로 copy()하면 0으로 리셋된다. */
  pasteCount: number;
  copy: (objects: CanvasObject[]) => void;
  /** 붙여넣기 직전에 호출해서 이번이 몇 번째인지(1부터) 받아온다. */
  bumpPasteCount: () => number;
}

/**
 * Phase 7: 캔버스 객체(Text/Image/Frame/Arrow/Rectangle) 전용 내부 클립보드.
 * 브라우저 시스템 클립보드(navigator.clipboard)는 쓰지 않는다 — 이 앱의 객체는
 * OS 클립보드 포맷(텍스트/이미지)으로 표현할 수 없는 구조화된 데이터라서, 굳이
 * 시스템 클립보드 권한을 요청할 이유가 없다(요구사항: 외부 API/서비스 의존 금지와도
 * 방향이 같다). 이미지 붙여넣기(Ctrl+V로 OS 클립보드의 이미지 파일을 넣는 것,
 * useImagePaste.ts)는 이 store와 별개의 완전히 다른 기능이다 — 헷갈리지 말 것.
 */
export const useClipboardStore = create<ClipboardState>((set, get) => ({
  objects: [],
  pasteCount: 0,
  copy: (objects) => set({ objects, pasteCount: 0 }),
  bumpPasteCount: () => {
    const next = get().pasteCount + 1;
    set({ pasteCount: next });
    return next;
  },
}));
