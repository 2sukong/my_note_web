import { create } from 'zustand';
import type { SelectionSegment } from '../objects/text/selectionCapture';

interface TextRangeState {
  /** 현재 "부분 서식" 대상인 네이티브 텍스트 선택. 비어 있으면(대부분의 경우) 전체
   * 객체 대상 스타일 편집을 뜻한다. objectId가 같은 세그먼트만 유효하다고 간주한다
   * (한 번에 텍스트 객체 하나만 편집할 수 있으므로). */
  segments: SelectionSegment[];
  setSegments: (segments: SelectionSegment[]) => void;
  clear: () => void;
}

/**
 * Phase 8(부분 서식): PropertiesPanel(오른쪽 사이드바)이 "지금 드래그로 선택된 텍스트
 * 구간이 있는가"를 알아야 색상/글꼴/크기/굵기 변경을 객체 전체가 아니라 그 구간에만
 * 적용할 수 있다. TextObjectView는 편집 모드일 때 이 store에 선택 구간을 채워 넣고,
 * PropertiesPanel은 이 값을 구독해서 있으면 구간 대상, 없으면 객체 전체 대상으로
 * 동작을 바꾼다. 두 컴포넌트가 형제라 store를 거쳐야 한다(canvas/PropertiesPanel.tsx
 * 참고).
 */
export const useTextRangeStore = create<TextRangeState>((set) => ({
  segments: [],
  setSegments: (segments) => set({ segments }),
  clear: () => set({ segments: [] }),
}));
