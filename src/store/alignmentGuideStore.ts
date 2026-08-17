import { create } from 'zustand';
import type { GuideLine } from '../objects/align/smartGuides';

/**
 * 요구사항(정렬 가이드): 지금 화면에 표시 중인 스마트 가이드선(objects/align/
 * smartGuides.ts가 계산). useObjectDrag.ts(이동)/useDrawShapeTool.ts·
 * useDrawTextTool.ts(생성)가 매 pointermove마다 setLines로 갱신하고, 정렬이
 * 풀리면(빈 배열) 즉시 사라진다 — 드래그가 끝나거나 취소돼도 반드시 clear()를
 * 호출해 남아있지 않게 한다.
 */
interface AlignmentGuideState {
  lines: GuideLine[];
  setLines: (lines: GuideLine[]) => void;
  clear: () => void;
}

export const useAlignmentGuideStore = create<AlignmentGuideState>((set, get) => ({
  lines: [],
  setLines: (lines) => set({ lines }),
  clear: () => {
    if (get().lines.length > 0) set({ lines: [] });
  },
}));
