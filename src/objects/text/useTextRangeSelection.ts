import { useEffect, useRef } from 'react';
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
 *
 * 요구사항(Ctrl+드래그로 비연속 다중 구간 선택): 브라우저(Chrome)는 네이티브 다중
 * range 선택을 지원하지 않아서, 새 드래그를 시작하면 이전 구간이 그냥 사라진다. 이를
 * 우회하려고 새 드래그가 시작되는 pointerdown 시점에 Ctrl/Cmd가 눌려 있으면 지금까지의
 * liveSegments를 committedSegments로 "커밋"해 남겨두고, 아니면 이전에 커밋된 구간을
 * 전부 지운다.
 *
 * 이 판정은 훅이 document에 직접 pointerdown 리스너를 붙이는 방식으로는 할 수 없다 —
 * TextObjectView.tsx의 각 줄 div는 isEditing일 때 자기 onPointerDown에서
 * e.stopPropagation()을 호출해(그래야 객체 드래그로 새지 않는다) 이벤트가 React
 * 트리 바깥(document)까지 올라가지 못하게 막아버린다. 그래서 그 판정 함수를
 * onLinePointerDown으로 반환해, TextObjectView.tsx가 자기 onPointerDown 안에서
 * (stopPropagation과 같은 시점에) 직접 호출하게 한다.
 *
 * ctrlGestureActiveRef는 그 커밋 직후 브라우저가 이전 네이티브 선택을 collapse시키며
 * 보내는 "구간 없음" selectionchange가 방금 커밋한 구간까지 지워버리지 않도록 막는 용도다.
 */
export function useTextRangeSelection(objectId: string, isEditing: boolean): { onLinePointerDown: (ctrlKey: boolean) => void } {
  const ctrlGestureActiveRef = useRef(false);

  useEffect(() => {
    if (!isEditing) {
      useTextRangeStore.getState().clear();
      return;
    }

    const handleSelectionChange = () => {
      if (useInteractionStore.getState().mode !== 'text-edit') return;
      const segments = captureSelectionSegments().filter((s) => s.objectId === objectId);
      if (segments.length > 0) {
        useTextRangeStore.getState().setLiveSegments(segments);
        return;
      }
      if (ctrlGestureActiveRef.current) {
        // 새 Ctrl+드래그가 시작되며 이전 네이티브 선택이 잠깐 collapse되는 중간 상태 —
        // liveSegments만 비우고 방금 커밋해둔 committedSegments는 그대로 둔다.
        useTextRangeStore.getState().setLiveSegments([]);
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

  const onLinePointerDown = (ctrlKey: boolean) => {
    if (ctrlKey) {
      useTextRangeStore.getState().commitLive();
      ctrlGestureActiveRef.current = true;
    } else {
      useTextRangeStore.getState().clear();
      ctrlGestureActiveRef.current = false;
    }
  };

  return { onLinePointerDown };
}
