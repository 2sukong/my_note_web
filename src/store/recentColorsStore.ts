import { create } from 'zustand';

export type RecentColorCategory = 'text' | 'highlight' | 'annotation' | 'shape';

const STORAGE_PREFIX = 'my-note-web:recent-colors:';
const MAX_RECENT = 8;
const CATEGORIES: RecentColorCategory[] = ['text', 'highlight', 'annotation', 'shape'];

/**
 * 요구사항: 텍스트/형광펜/주석 각각의 "자주 사용하는 색상"은 서로 독립적으로
 * 관리된다. 카테고리마다 별도의 localStorage 키를 쓰고(recentColors.ts 시절의
 * 단일 키 방식에서 확장), zustand 스토어로 감싸서 상단 툴바(Toolbar.tsx)와
 * 사이드바(PropertiesPanel.tsx/ColorPickerPopover.tsx)가 서로 다른 컴포넌트 트리에
 * 있어도 색을 고르는 즉시 양쪽 다 반응하게 한다(예전 recentColors.ts의 순수
 * localStorage 함수는 컴포넌트별 로컬 state에만 반영돼서 다른 곳에 자동 전파되지
 * 않았다 — "선택하면 상단 메뉴에 자동 추가"라는 요구사항을 만족하려면 반응형
 * 스토어가 필요하다).
 *
 * 프라이빗 브라우징 등으로 localStorage 접근이 막혀 있어도 조용히 무시하고
 * 메모리상 목록만으로 동작한다(색 선택 기능 자체는 항상 정상 동작).
 */
function storageKey(category: RecentColorCategory): string {
  return `${STORAGE_PREFIX}${category}`;
}

function loadFromStorage(category: RecentColorCategory): string[] {
  try {
    const raw = localStorage.getItem(storageKey(category));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c): c is string => typeof c === 'string').slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function saveToStorage(category: RecentColorCategory, colors: string[]): void {
  try {
    localStorage.setItem(storageKey(category), JSON.stringify(colors));
  } catch {
    // 조용히 무시 — 다음 세션에 목록이 안 남을 뿐, 지금 선택한 색 자체는 이미 적용됨.
  }
}

interface RecentColorsState {
  byCategory: Record<RecentColorCategory, string[]>;
  /** 새 색을 맨 앞에 놓는다(이미 있었으면 중복 제거 후 앞으로), MAX_RECENT개까지만 유지. */
  addRecentColor: (category: RecentColorCategory, color: string) => void;
  /** 사용자가 명시적으로 목록에서 지운다(요구사항: 저장된 색은 직접 삭제할 수 있어야 함). */
  removeRecentColor: (category: RecentColorCategory, color: string) => void;
}

export const useRecentColorsStore = create<RecentColorsState>((set, get) => ({
  byCategory: Object.fromEntries(CATEGORIES.map((c) => [c, loadFromStorage(c)])) as Record<
    RecentColorCategory,
    string[]
  >,

  addRecentColor: (category, color) => {
    if (!color) return;
    const current = get().byCategory[category] ?? [];
    const withoutDup = current.filter((c) => c.toLowerCase() !== color.toLowerCase());
    const next = [color, ...withoutDup].slice(0, MAX_RECENT);
    saveToStorage(category, next);
    set((state) => ({ byCategory: { ...state.byCategory, [category]: next } }));
  },

  removeRecentColor: (category, color) => {
    const current = get().byCategory[category] ?? [];
    const next = current.filter((c) => c.toLowerCase() !== color.toLowerCase());
    saveToStorage(category, next);
    set((state) => ({ byCategory: { ...state.byCategory, [category]: next } }));
  },
}));
