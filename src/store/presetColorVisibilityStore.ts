import { create } from 'zustand';
import type { RecentColorCategory } from './recentColorsStore';

const STORAGE_PREFIX = 'my-note-web:hidden-preset-colors:';
/** recentColorsStore.ts의 카테고리와 동일한 4개(text/highlight/annotation/shape) —
 * 각자 고정 프리셋 팔레트를 갖고 있어서(TEXT_COLORS/HIGHLIGHT_COLORS/
 * ANNOTATION_COLORS/STROKE_COLORS) 이 스토어가 "삭제(숨김)된 프리셋 id" 목록을
 * 카테고리별로 독립적으로 관리한다. */
const CATEGORIES: RecentColorCategory[] = ['text', 'highlight', 'annotation', 'shape'];

function storageKey(category: RecentColorCategory): string {
  return `${STORAGE_PREFIX}${category}`;
}

function loadFromStorage(category: RecentColorCategory): string[] {
  try {
    const raw = localStorage.getItem(storageKey(category));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function saveToStorage(category: RecentColorCategory, ids: string[]): void {
  try {
    localStorage.setItem(storageKey(category), JSON.stringify(ids));
  } catch {
    // 조용히 무시 — 다음 세션에 숨김 처리가 되살아날 뿐, 지금 삭제 자체는 이미 반영됨.
  }
}

interface PresetColorVisibilityState {
  hiddenByCategory: Record<RecentColorCategory, string[]>;
  /** 요구사항: 기본 제공되는 형광펜/주석/텍스트/사각형·화살표 색상도 삭제(=목록에서
   * 숨김)할 수 있어야 한다 — fontStore.ts의 hiddenBuiltinIds와 완전히 같은 패턴. */
  hidePreset: (category: RecentColorCategory, id: string) => void;
}

export const usePresetColorVisibilityStore = create<PresetColorVisibilityState>((set, get) => ({
  hiddenByCategory: Object.fromEntries(CATEGORIES.map((c) => [c, loadFromStorage(c)])) as Record<
    RecentColorCategory,
    string[]
  >,

  hidePreset: (category, id) => {
    const current = get().hiddenByCategory[category] ?? [];
    if (current.includes(id)) return;
    const next = [...current, id];
    saveToStorage(category, next);
    set((state) => ({ hiddenByCategory: { ...state.hiddenByCategory, [category]: next } }));
  },
}));
