import { create } from 'zustand';
import type { LinkAnchor } from '../types/link';

/**
 * 🔗 도구로 링크를 만드는 "클릭 두 번" 제스처(Phase 9)의 중간 상태 — 첫 번째 클릭에서
 * 잡은 출발지(source) anchor를 두 번째 클릭 전까지 잠깐 들고 있는다. canvas/interaction/
 * useLinkTool.ts(메인 캔버스)와 canvas/pdf/useOverlayLinkTool.ts(PDF)가 이 store
 * 하나를 공유한다 — 그래야 "메인 캔버스에서 첫 클릭 → PDF 안에서 두 번째 클릭"처럼
 * 서로 다른 surface를 잇는 링크도 자연스럽게 만들어진다(요구사항의 PDF↔Page 케이스).
 *
 * historyStore(undo/redo)와 무관한 순수 UI 상태라 저장/영속화하지 않는다 — 도구를
 * 벗어나거나(다른 도구를 고르거나) 링크 생성이 완료되면 즉시 비운다.
 */
interface LinkDraftState {
  pending: LinkAnchor | null;
  setPending: (anchor: LinkAnchor) => void;
  clear: () => void;
}

export const useLinkDraftStore = create<LinkDraftState>((set) => ({
  pending: null,
  setPending: (anchor) => set({ pending: anchor }),
  clear: () => set({ pending: null }),
}));
