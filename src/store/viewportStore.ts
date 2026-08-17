import { create } from 'zustand';
import type { Point, Viewport } from '../types/viewport';
import { DEFAULT_VIEWPORT } from '../types/viewport';
import { panBy as panByUtil, zoomAtPoint as zoomAtPointUtil } from '../utils/coords';

interface ViewportState extends Viewport {
  /** screenPoint를 중심으로 zoom을 nextZoom으로 변경 */
  zoomAt: (screenPoint: Point, nextZoom: number) => void;
  /** screen px 단위로 캔버스를 이동 */
  panBy: (deltaX: number, deltaY: number) => void;
  /** 뷰포트를 초기 상태로 리셋 */
  reset: () => void;
  /** 저장된 값 등으로 뷰포트를 통째로 교체 */
  setViewport: (viewport: Viewport) => void;
}

export const useViewportStore = create<ViewportState>((set, get) => ({
  ...DEFAULT_VIEWPORT,

  zoomAt: (screenPoint, nextZoom) => {
    const current = get();
    const next = zoomAtPointUtil(current, screenPoint, nextZoom);
    set(next);
  },

  panBy: (deltaX, deltaY) => {
    const current = get();
    const next = panByUtil(current, deltaX, deltaY);
    set(next);
  },

  reset: () => set(DEFAULT_VIEWPORT),

  setViewport: (viewport) => set(viewport),
}));
