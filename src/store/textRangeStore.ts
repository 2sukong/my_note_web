import { create } from 'zustand';
import type { SelectionSegment } from '../objects/text/selectionCapture';

interface TextRangeState {
  /** 지금 브라우저 네이티브 선택이 실시간으로 보여주는 구간(드래그 중이거나 방금 끝난 것).
   * 비어 있으면(대부분의 경우) 전체 객체 대상 스타일 편집을 뜻한다. objectId가 같은
   * 세그먼트만 유효하다고 간주한다(한 번에 텍스트 객체 하나만 편집할 수 있으므로). */
  liveSegments: SelectionSegment[];
  /**
   * 요구사항(Ctrl+드래그로 비연속 다중 구간 선택): Ctrl을 누른 채 새 드래그를 시작하면
   * 그 시점의 liveSegments가 여기로 "커밋"되어 남는다 — 브라우저 네이티브 선택(Chrome은
   * range를 하나만 지원)과 별개로 이 store가 직접 여러 구간을 기억한다. PropertiesPanel은
   * committedSegments + liveSegments를 합쳐서 "지금 스타일을 적용할 전체 구간"으로 쓴다.
   */
  committedSegments: SelectionSegment[];
  setLiveSegments: (segments: SelectionSegment[]) => void;
  /** 지금 liveSegments를 committedSegments 뒤에 이어붙인다(liveSegments 자체는 비우지
   * 않는다 — 뒤이어 오는 selectionchange가 다시 채운다). liveSegments가 비어 있으면 아무것도 하지 않는다. */
  commitLive: () => void;
  clear: () => void;
}

export const useTextRangeStore = create<TextRangeState>((set, get) => ({
  liveSegments: [],
  committedSegments: [],
  setLiveSegments: (segments) => set({ liveSegments: segments }),
  commitLive: () => {
    const { liveSegments, committedSegments } = get();
    if (liveSegments.length === 0) return;
    set({ committedSegments: [...committedSegments, ...liveSegments] });
  },
  clear: () => set({ liveSegments: [], committedSegments: [] }),
}));
