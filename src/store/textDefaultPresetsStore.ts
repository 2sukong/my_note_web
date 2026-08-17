import { create } from 'zustand';

/**
 * 요구사항(텍스트 기본값 저장): 사이드바에서 정한 텍스트 기본값(글꼴/크기/색상/굵기/
 * 테두리/줄간격)을 "제목"/"본문" 두 자리에 수동으로 저장해두고, 상단 툴바의 '텍스트'
 * 버튼에 마우스를 올렸을 때 뜨는 작은 메뉴에서 골라 바로 그 값으로 새 텍스트를 만들
 * 수 있게 한다. fontStore.hiddenBuiltinIds와 같은 이유로 localStorage에 저장해
 * 새로고침/다음 세션에도 유지한다.
 */
export type TextPresetKind = 'title' | 'body';

export interface TextDefaultPreset {
  color: string;
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  borderEnabled: boolean;
  lineHeight: number;
}

type PresetMap = Record<TextPresetKind, TextDefaultPreset | null>;

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

function loadPresets(): PresetMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { title: null, body: null };
    const parsed: unknown = JSON.parse(raw);
    const record = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    return {
      title: isValidPreset(record.title) ? record.title : null,
      body: isValidPreset(record.body) ? record.body : null,
    };
  } catch {
    return { title: null, body: null };
  }
}

function savePresetsToStorage(presets: PresetMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // 조용히 무시 — 다음 세션에 저장이 안 남아있을 뿐, 지금 화면엔 이미 반영됨.
  }
}

interface TextDefaultPresetsState {
  presets: PresetMap;
  savePreset: (kind: TextPresetKind, preset: TextDefaultPreset) => void;
}

export const useTextDefaultPresetsStore = create<TextDefaultPresetsState>((set, get) => ({
  presets: loadPresets(),
  savePreset: (kind, preset) => {
    const next = { ...get().presets, [kind]: preset };
    savePresetsToStorage(next);
    set({ presets: next });
  },
}));
