import { create } from 'zustand';
import { deleteFontRecord, loadAllFontRecords, saveFontRecord } from './fontPersistence';
import { clearFontHeightScaleCache } from '../objects/text/fontMetrics';

export interface CustomFont {
  id: string;
  /** 파일명에서 확장자를 뗀 표시용 이름(드롭다운에 보이는 라벨). */
  label: string;
  /** 실제 CSS font-family 값으로 쓰는 고유 이름 — TextObject.fontFamily에 이 값
   * 그대로 저장된다(objects/text/fontOptions.ts의 제네릭 키워드와 같은 자리). */
  family: string;
  /** document.fonts에서 실제로 등록을 해제(delete)할 때 필요한 참조. 삭제 기능
   * (요구사항 3번) 추가 전에는 등록만 하고 해제할 일이 없어서 안 들고 있었다. */
  fontFace: FontFace;
}

const HIDDEN_BUILTIN_STORAGE_KEY = 'my-note-web:hidden-builtin-fonts';

function loadHiddenBuiltinIds(): string[] {
  try {
    const raw = localStorage.getItem(HIDDEN_BUILTIN_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function saveHiddenBuiltinIds(ids: string[]): void {
  try {
    localStorage.setItem(HIDDEN_BUILTIN_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // 조용히 무시 — 다음 세션에 지운 목록이 되살아날 뿐, 지금 삭제 자체는 이미 반영됨.
  }
}

interface FontState {
  customFonts: CustomFont[];
  /**
   * 요구사항 3번: "클로드가 기본적으로 설정한 글꼴들도 모두 삭제 가능하게" — 기본
   * 제공 폰트(objects/text/fontOptions.ts의 BUILTIN_FONT_OPTIONS)는 코드 자체를
   * 지울 수 없으므로, 사용자가 목록에서 숨긴 id만 기록해 드롭다운/관리 팝오버에서
   * 걸러낸다. 새로고침해도 유지되도록(구조적 설정이라 customFonts와 달리 세션에만
   * 있으면 안 됨) localStorage에 저장한다.
   */
  hiddenBuiltinIds: string[];
  /**
   * 사용자가 고른 폰트 파일(ttf/otf/woff/woff2)을 브라우저 FontFace API로 등록하고
   * 목록에 추가한다. 앱에 특정 폰트를 미리 포함하거나 원격에서 내려받지 않는다는
   * 요구사항 때문에, "사용자가 직접 파일을 넣어야만" 새 폰트가 생긴다.
   *
   * imageStore.ts의 이미지 Blob 처리와 같은 원리로 메모리에만 유지한다 — 새로고침하면
   * 사라지는 것이 Phase 8(IndexedDB) 이전까지는 의도된 동작이다.
   */
  registerFontFile: (file: File) => Promise<CustomFont>;
  /** 사용자가 업로드한 커스텀 폰트를 목록에서 지운다 — document.fonts에서도 실제로
   * 등록 해제한다(요구사항 3번). 이미 그 폰트를 쓰고 있는 객체의 fontFamily 문자열
   * 자체는 그대로 남지만(별도 객체 일괄 갱신은 범위 밖), 목록에는 더 이상 안 보인다. */
  removeCustomFont: (id: string) => void;
  /** 기본 제공 폰트를 목록에서 숨긴다(코드 자체는 지우지 않음 — 위 hiddenBuiltinIds 참고). */
  removeBuiltinFont: (id: string) => void;
  /**
   * 요구사항(폰트 목록 통합): 새로 추가한 폰트가 새로고침 후에도 유지되어야 한다.
   * 앱 시작 시 한 번(Canvas.tsx 마운트 훅) IndexedDB(store/fontPersistence.ts)에
   * 저장된 레코드를 모두 불러와 document.fonts에 다시 등록하고 customFonts에 채워
   * 넣는다. registerFontFile로 이미 이번 세션에 추가된 것과 id가 겹치면 건너뛴다.
   */
  loadPersistedFonts: () => Promise<void>;
}

/** FontFace의 family 이름은 CSS font-family로 그대로 쓰이므로, 파일명이 특수문자를
 * 포함해도 안전하도록 파일명과 무관한 고유 id 기반 이름을 쓴다(표시용 label과는 분리). */
function familyNameFor(id: string): string {
  return `user-font-${id}`;
}

/**
 * loadPersistedFonts를 호출한 진행 중인 Promise — 모듈 스코프에 딱 하나만 둔다.
 * React 18 StrictMode는 개발 모드에서 마운트 시 effect를 두 번 실행하는데(Canvas.tsx의
 * 폰트 로드 effect), 가드 없이 두 호출이 거의 동시에 시작되면 둘 다 아직 비어있는
 * customFonts를 기준으로 "이 레코드는 아직 안 불러왔다"고 판단해 같은 폰트 파일로
 * FontFace를 두 번 만들고 document.fonts에도 두 번 등록해버린다 — 실제로 이 경합이
 * "새로고침 후 폰트가 저장은 되어있는데 화면엔 적용이 안 되는" 버그의 원인이었다.
 * 두 번째 호출이 첫 번째가 끝나기 전에 들어오면 새로 작업을 시작하지 않고 같은
 * Promise를 그대로 돌려줘서, 실제 로딩 작업 자체는 항상 한 번만 일어나게 한다.
 */
let loadPersistedFontsPromise: Promise<void> | null = null;

export const useFontStore = create<FontState>((set, get) => ({
  customFonts: [],
  hiddenBuiltinIds: loadHiddenBuiltinIds(),

  registerFontFile: async (file) => {
    const id = crypto.randomUUID();
    const family = familyNameFor(id);
    const buffer = await file.arrayBuffer();
    const fontFace = new FontFace(family, buffer);
    await fontFace.load(); // 실제로 파싱 가능한 폰트 파일인지 여기서 검증됨(실패 시 reject)
    document.fonts.add(fontFace);
    clearFontHeightScaleCache(); // fontMetrics.ts 참고 — 이 family로 잘못 캐시된 측정값이 있으면 버린다.

    const label = file.name.replace(/\.[^./\\]+$/, '').trim().slice(0, 40) || '업로드한 폰트';
    const entry: CustomFont = { id, label, family, fontFace };
    set({ customFonts: [...get().customFonts, entry] });
    // 요구사항: 새로고침 후에도 유지되도록 원본 바이트를 IndexedDB에도 저장해둔다.
    void saveFontRecord({ id, label, family, data: buffer });
    return entry;
  },

  removeCustomFont: (id) => {
    const target = get().customFonts.find((f) => f.id === id);
    if (!target) return;
    document.fonts.delete(target.fontFace);
    set({ customFonts: get().customFonts.filter((f) => f.id !== id) });
    void deleteFontRecord(id);
  },

  removeBuiltinFont: (id) => {
    if (get().hiddenBuiltinIds.includes(id)) return;
    const next = [...get().hiddenBuiltinIds, id];
    saveHiddenBuiltinIds(next);
    set({ hiddenBuiltinIds: next });
  },

  loadPersistedFonts: () => {
    if (loadPersistedFontsPromise) return loadPersistedFontsPromise;
    loadPersistedFontsPromise = (async () => {
      const records = await loadAllFontRecords();
      if (records.length === 0) return;
      const existingIds = new Set(get().customFonts.map((f) => f.id));
      const loaded: CustomFont[] = [];
      for (const record of records) {
        if (existingIds.has(record.id)) continue;
        try {
          const fontFace = new FontFace(record.family, record.data);
          await fontFace.load();
          document.fonts.add(fontFace);
          loaded.push({ id: record.id, label: record.label, family: record.family, fontFace });
        } catch {
          // 이 폰트 레코드 하나만 건너뛴다(깨진 데이터가 나머지 복원을 막지 않도록).
        }
      }
      if (loaded.length === 0) return;
      clearFontHeightScaleCache(); // fontMetrics.ts 참고 — 새로고침 직후 폴백 글꼴로 잘못 측정됐을 수 있는 캐시를 버린다.
      set({ customFonts: [...get().customFonts, ...loaded] });
    })();
    return loadPersistedFontsPromise;
  },
}));
