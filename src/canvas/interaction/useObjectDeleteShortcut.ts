import { useEffect } from 'react';
import { useInteractionStore } from '../../store/interactionStore';
import { useObjectsStore } from '../../store/objectsStore';

/**
 * Phase 4(2차): 선택된 객체(Text/Image/Frame 등)나 fine-selection된
 * 하이라이트/주석을 Backspace 또는 Delete로 지운다.
 *
 * mode === 'select'일 때만 동작한다 — 'text-edit'(텍스트/주석 내용을 타이핑 중)일 때는
 * 절대 개입하지 않아야 한글 IME 조합 중 Backspace, 일반 글자 삭제, 줄 병합/들여쓰기
 * 같은 TextObjectView 자체 Backspace 처리가 그대로 유지된다. 'drag'/'resize'/'pan'
 * 중에도 개입하지 않는다(제스처 도중 객체가 사라지는 예외적인 경우를 피하기 위함).
 *
 * Phase 7: 다중 선택(selectedIds)이면 removeObjects로 한 번에 지운다 — 개별
 * removeObject를 반복 호출하면 undo 단계가 객체 수만큼 쪼개져서, 여러 개를 한 번에
 * 지운 걸 되돌리려면 Ctrl+Z를 여러 번 눌러야 하는 불편함이 생긴다.
 */
export function useObjectDeleteShortcut() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;

      // 버그 수정: 사이드바 입력창(프레임 이름 등)에 포커스가 있을 때는 이 전역
      // 단축키가 개입하면 안 된다 — 그 필드 안에서의 일반적인 텍스트 편집으로 취급해야
      // 한다. 캔버스 자체의 Text/Annotation 편집(mode==='text-edit', contentEditable)은
      // 아래 mode 체크로 걸러지지만, PropertiesPanel의 <input>은 별도 모드 전환이 없어서
      // (선택된 객체는 여전히 mode==='select') 포커스된 엘리먼트를 직접 확인해야 한다.
      // 이게 없으면 프레임 이름을 지우다가(특히 마지막 글자를 지워 빈 문자열이 된 뒤)
      // Backspace 한 번에 이름이 아니라 프레임 객체 자체가 삭제돼버렸다.
      const active = document.activeElement;
      const isEditableTarget =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable);
      if (isEditableTarget) return;

      const { mode, selectedIds, fineSelection } = useInteractionStore.getState();
      if (mode !== 'select') return;

      if (fineSelection) {
        e.preventDefault();
        const { kind, objectId, lineId, id } = fineSelection;
        if (kind === 'highlight') {
          useObjectsStore.getState().removeHighlight(objectId, lineId, id);
        } else {
          useObjectsStore.getState().removeAnnotation(objectId, lineId, id);
        }
        useInteractionStore.getState().deselect();
        return;
      }

      if (selectedIds.length > 0) {
        e.preventDefault();
        useObjectsStore.getState().removeObjects(selectedIds);
        useInteractionStore.getState().deselect();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
