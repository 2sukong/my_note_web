import { useEffect } from 'react';
import { useInteractionStore } from '../../store/interactionStore';
import { useTextRangeStore } from '../../store/textRangeStore';
import { captureSelectionSegments } from './selectionCapture';

/**
 * Phase 8(부분 서식): 이 텍스트 객체가 편집 모드일 때, 사용자가 드래그로 만든 네이티브
 * 선택 구간을 textRangeStore에 반영한다. PropertiesPanel(오른쪽 사이드바)이 이 값을
 * 구독해서 색상/글꼴/크기/굵기 변경을 객체 전체가 아니라 그 구간에만 적용하는 모드로
 * 전환한다(canvas/PropertiesPanel.tsx 참고).
 *
 * "sticky" 처리가 핵심이다: 색상 피커나 폰트 select를 클릭하려고 포커스가
 * PropertiesPanel로 옮겨가면 브라우저가 네이티브 선택을 collapse시켜 버리는데, 이
 * 순간 구간을 지워버리면 정작 패널을 조작하는 순간 대상 구간이 사라진다. 그래서
 * "선택이 비었다"는 이벤트가 오면, 포커스가 실제로 .properties-panel 안으로 옮겨간
 * 경우에는 무시(마지막 구간 유지)하고, 텍스트 안 다른 곳을 클릭해 캐럿만 옮긴
 * 경우(포커스가 패널 밖)에만 정리한다.
 */
export function useTextRangeSelection(objectId: string, isEditing: boolean): void {
  useEffect(() => {
    if (!isEditing) {
      useTextRangeStore.getState().clear();
      return;
    }

    const handleSelectionChange = () => {
      if (useInteractionStore.getState().mode !== 'text-edit') return;
      const segments = captureSelectionSegments().filter((s) => s.objectId === objectId);
      if (segments.length > 0) {
        useTextRangeStore.getState().setSegments(segments);
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest('.properties-panel')) return; // sticky: 패널 조작 중
      useTextRangeStore.getState().clear();
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      useTextRangeStore.getState().clear();
    };
  }, [objectId, isEditing]);
}
