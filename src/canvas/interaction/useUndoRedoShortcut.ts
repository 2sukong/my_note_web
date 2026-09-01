import { useEffect } from 'react';
import { useHistoryStore } from '../../store/historyStore';
import { usePdfViewerStore } from '../../store/pdfViewerStore';
import { usePdfOverlayHistoryStore } from '../../store/pdfOverlayHistoryStore';

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
 *
 * 버그 수정(Phase 6/PDF, 2026-08): PDF Reference Viewer가 열려 있는 동안은 지금 보고
 * 있는 PDF 페이지의 오버레이 필기 history(usePdfOverlayHistoryStore)가 완전히 독립된
 * 병렬 undo/redo 스택이다(v3 §2-7) — 이걸 고려하지 않고 항상 메인 캔버스의
 * useHistoryStore만 부르면, PDF 페이지에 형광펜을 그은 뒤 Ctrl+Z를 눌러도 반응이
 * 없었다.
 *
 * 처음엔 "Viewer가 열려 있으면 무조건 오버레이 history"로 라우팅했는데, 그러면 Viewer를
 * 연 채로(패널은 화면에 그대로 떠 있는 채로) 메인 캔버스 쪽을 편집하고 Ctrl+Z를 누르는
 * 아주 흔한 경우에 엉뚱하게 오버레이 쪽(비어 있거나 무관한 history)을 되돌리려다 실패해
 * "메인 캔버스에서도 Ctrl+Z가 안 먹힌다"는 결과가 됐다 — Viewer가 열려 있다는 것과
 * "지금 사용자가 어디를 편집 중인가"는 다른 문제였다. 그래서 "열려 있나"가 아니라
 * "마지막으로 포인터가 눌렸던 곳이 PDF Viewer 패널 안이었나"로 판단을 바꿨다 — 캡처
 * 단계 pointerdown을 전역으로 지켜보며 어느 쪽에서 마지막으로 조작이 있었는지만
 * 기억한다(objectsStore.ts 등 기존 메인 캔버스 코드는 전혀 건드리지 않고 판단할 수 있는
 * 유일한 지점이라 여기서 추적한다). Viewer 자체가 닫혀 있으면(openPdfId===null) 이
 * 추적값과 무관하게 항상 메인 history로 되돌아간다(패널이 이미 닫혔는데 그 전 클릭
 * 기록 때문에 계속 오버레이로 라우팅되는 사고를 막기 위함).
 */
let lastPointerSurface: 'main' | 'pdf' = 'main';

export function useUndoRedoShortcut() {
  useEffect(() => {
    const handlePointerDownCapture = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      lastPointerSurface = target?.closest('.pdf-viewer-panel') ? 'pdf' : 'main';
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (!isMod || (key !== 'z' && key !== 'y')) return;
      e.preventDefault();

      const overlayActive = lastPointerSurface === 'pdf' && usePdfViewerStore.getState().openPdfId !== null;
      const history = overlayActive ? usePdfOverlayHistoryStore.getState() : useHistoryStore.getState();
      const isRedo = key === 'y' || (key === 'z' && e.shiftKey);
      if (isRedo) {
        history.redo();
      } else {
        history.undo();
      }
    };

    // capture:true — 안쪽 요소가 나중에 stopPropagation을 해도 "어디서 눌렸는지"만은
    // 항상 먼저 기록해두기 위함(실제로 지금 그런 핸들러는 없지만, 앞으로 생겨도 이
    // 추적이 깨지지 않도록 방어적으로 캡처 단계에 둔다).
    window.addEventListener('pointerdown', handlePointerDownCapture, { capture: true });
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDownCapture, { capture: true });
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);
}
