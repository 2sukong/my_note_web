import { create } from 'zustand';

/**
 * 요구사항(텍스트 스타일 저장, 2026-09 확장): 원래는 사이드바에서 정한 텍스트
 * 기본값(글꼴/크기/색상/굵기/테두리/줄간격)을 "제목"/"본문" 두 자리에만 수동으로
 * 저장했지만, 이제 사용자가 이름을 직접 입력해 원하는 만큼("제목", "본문", "중요"
 * 등) 저장할 수 있는 목록 구조로 확장한다. 상단 툴바의 '텍스트' 버튼에 마우스를
 * 올렸을 때 뜨는 작은 메뉴(canvas/Toolbar.tsx)에서 이 목록을 그대로 보여주고,
 * 클릭하면 바로 그 값으로 새 텍스트를 만든다. fontStore.hiddenBuiltinIds와 같은
 * 이유로 localStorage에 저장해 새로고침/다음 세션에도 유지한다.
 *
 * [마이그레이션] 예전 형식은 `{ title: Preset|null, body: Preset|null }` 고정 객체였다.
 * 기존 사용자가 저장해 둔 값을 잃지 않도록, 처음 불러올 때 이 옛 형식을 감지하면
 * title→"제목", body→"본문" 이름의 목록 항목으로 변환해 그대로 이어서 쓴다.
 */
export interface TextDefaultPreset {
  color: string;
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  borderEnabled: boolean;
  lineHeight: number;
}

export interface TextStylePreset {
  id: string;
  name: string;
  preset: TextDefaultPreset;
}

const STORAGE_KEY = 'my-note-web:text-default-presets';

function isValidPreset(v: unknown): v is TextDefaultPreset {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.color === 'string' &&
    typeof p.fontFamily === 'string' &&
    typeof p.fontSize === 'number' &&
    typeof p.bold === 'boolean' &&
    typeof p.borderEnabled === 'boolean' &&
    typeof p.lineHeight === 'number'
  );
}

function isValidStylePreset(v: unknown): v is TextStylePreset {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return typeof p.id === 'string' && typeof p.name === 'string' && isValidPreset(p.preset);
}

function makeId(): string {
  return `style-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 예전 `{ title, body }` 고정 형식을 새 목록 형식으로 변환한다. */
function migrateLegacyShape(record: Record<string, unknown>): TextStylePreset[] {
  const migrated: TextStylePreset[] = [];
  if (isValidPreset(record.title)) {
    migrated.push({ id: makeId(), name: '제목', preset: record.title });
  }
  if (isValidPreset(record.body)) {
    migrated.push({ id: makeId(), name: '본문', preset: record.body });
  }
  return migrated;
}

function loadPresets(): TextStylePreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(isValidStylePreset);
    }
    if (parsed && typeof parsed === 'object') {
      return migrateLegacyShape(parsed as Record<string, unknown>);
    }
    return [];
  } catch {
    return [];
  }
}

function savePresetsToStorage(presets: TextStylePreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // 조용히 무시 — 다음 세션에 저장이 안 남아있을 뿐, 지금 화면엔 이미 반영됨.
  }
}

interface TextDefaultPresetsState {
  presets: TextStylePreset[];
  /** 같은 이름이 이미 있으면 그 값을 덮어쓰고(갱신), 없으면 새 항목으로 추가한다. */
  savePreset: (name: string, preset: TextDefaultPreset) => void;
  removePreset: (id: string) => void;
}

export const useTextDefaultPresetsStore = create<TextDefaultPresetsState>((set, get) => ({
  presets: loadPresets(),
  savePreset: (name, preset) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const current = get().presets;
    const existingIndex = current.findIndex((p) => p.name === trimmed);
    const next =
      existingIndex >= 0
        ? current.map((p, i) => (i === existingIndex ? { ...p, preset } : p))
        : [...current, { id: makeId(), name: trimmed, preset }];
    savePresetsToStorage(next);
    set({ presets: next });
  },
  removePreset: (id) => {
    const next = get().presets.filter((p) => p.id !== id);
    savePresetsToStorage(next);
    set({ presets: next });
  },
}));
