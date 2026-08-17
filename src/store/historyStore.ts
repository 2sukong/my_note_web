import { create } from 'zustand';
import { applyPatches, enablePatches } from 'immer';
import type { Patch } from 'immer';
import { useObjectsStore } from './objectsStore';

// Phase 7: objectsStore.ts의 모든 변형(mutate 헬퍼)이 immer produceWithPatches로
// patches/inversePatches를 만들어 여기 넘긴다. Undo/Redo는 그 patches를
// applyPatches로 objectsStore.objects에 되감거나 다시 감는 방식으로 동작한다
// (architecture_analysis.md에서 이미 승인된 "zustand + immer produceWithPatches"
// 방침을 그대로 구현한 것).
enablePatches();

/** 연속 타이핑처럼 "언제 끝날지" 명확한 이벤트가 없는 변경을 시간 창으로 묶는다.
 * 이 시간 안에 같은 coalesceKey로 또 변경이 들어오면 별도 undo 단계를 만들지 않고
 * 기존 항목에 patches를 이어붙인다 — 잠깐이라도 멈추지 않고 계속 친 글자는
 * Ctrl+Z 한 번에 통째로 되돌아간다(사용자 확인된 요구사항). */
const COALESCE_WINDOW_MS = 800;

/**
 * 버그 수정(드래그 중 "로딩 걸림" + 그 여파로 클릭 해제가 안 되는 문제): record()는
 * 드래그/리사이즈 같은 포인터 제스처 동안 pointermove마다(초당 수십~수백 번) 불릴 수
 * 있다. 예전엔 매 호출마다 inversePatches를 [...새 patches, ...기존 patches]로
 * "앞에 이어붙여서" 순서를 맞췄는데, 그러면 매 호출이 그때까지 쌓인 전체 배열을
 * 복사하는 셈이라 트랜잭션이 길어질수록(자식이 많은 Frame을 오래 드래그하는 등)
 * 호출 1번의 비용이 계속 커져 총 비용이 O(n^2)이 된다 — 이게 드래그 중 메인 스레드가
 * 몇 초씩 멈추던("로딩 걸림") 근본 원인이었다. 그 정지 때문에 pointerup이 씹히면
 * pointer capture가 풀리지 않고 남아, 그 다음 클릭이 화면상 배경이 아니라 멈춰버린
 * 그 객체에게로 계속 전달돼서("클릭 해제가 잘 안 됨") 마치 그 객체에 클릭이 고착된
 * 것처럼 보였다(useObjectDrag.ts의 e.buttons===0 안전장치와 함께 대응).
 *
 * 고친 방식: 매 호출은 새 patches를 그대로 이어붙이고(순서가 중요하지 않음, O(새
 * patch 수)), inversePatches는 "배치(batch)" 단위로만 통째로 뒤에 추가한다(역시
 * O(1)에 가까움) — 그 배치 안의 patch들끼리 순서는 절대 안 섞는다(같은 produce()
 * 호출에서 나온 patch들은 서로 순서가 중요할 수 있어서). "가장 최근 변경부터
 * 되돌려야 한다"는 undo 순서는 저장할 때가 아니라 실제로 undo()가 호출되는 순간에
 * 딱 한 번 배치 순서를 뒤집어서(flattenInverseBatches) 만든다 — Ctrl+Z는 드래그처럼
 * 초당 수백 번 눌리는 게 아니라 사용자가 키를 누를 때 한 번뿐이라 이 비용은 무시할
 * 만하다.
 */
function flattenInverseBatches(batches: Patch[][]): Patch[] {
  const result: Patch[] = [];
  for (let i = batches.length - 1; i >= 0; i--) {
    result.push(...batches[i]);
  }
  return result;
}

interface HistoryEntry {
  patches: Patch[];
  inverseBatches: Patch[][];
  /** 시간창 병합에 쓰이는 키. undefined면 항상 새 단계(never coalesce). */
  coalesceKey?: string;
  timestamp: number;
}

interface ActiveTransaction {
  key: string;
  patches: Patch[];
  inverseBatches: Patch[][];
}

interface HistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
  activeTransaction: ActiveTransaction | null;

  /**
   * objectsStore.ts의 mutate() 헬퍼가 매 변형마다 호출한다.
   * 진행 중인 트랜잭션이 있으면(beginTransaction) 무조건 그 안으로 합쳐지고,
   * 없으면 coalesceKey+시간창 규칙에 따라 past의 마지막 항목과 합치거나 새로
   * 쌓는다. 어느 경우든 새 변경이 들어오면 future(redo 스택)는 비운다.
   */
  record: (patches: Patch[], inversePatches: Patch[], coalesceKey?: string) => void;

  /**
   * 포인터 제스처(드래그/리사이즈/주석 이동)처럼 시작·끝이 명확한 동작 전용.
   * 제스처가 진행되는 동안 여러 번 일어나는 record() 호출을 전부 하나의
   * undo 단계로 묶는다. 시간창 코얼레싱과 달리 "직전 항목과 같은 키인지"를
   * 따지지 않으므로, 아주 짧은 시간 안에 별개의 제스처가 두 번 일어나도
   * (예: 드래그→즉시 다시 드래그) 서로 다른 undo 단계로 남는다.
   */
  beginTransaction: (key: string) => void;
  endTransaction: () => void;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  /**
   * Phase 8: Page를 전환할 때 fileTreeStore가 호출한다. Undo/Redo 스택은 Page마다
   * 독립적이어야 한다 — 다른 Page의 patches를 지금 Page의 objects에 applyPatches하면
   * 완전히 엉뚱한 결과가 나온다. 가장 단순하고 안전한 방식으로 Page를 나갈 때 스택을
   * 통째로 비운다(요구사항 범위 밖: Page별 히스토리를 메모리에 유지하는 것도 가능하지만
   * 개인용 필기 앱에서 "다른 페이지 갔다가 돌아와서 Undo" 시나리오는 드물고, 굳이
   * 복잡도를 늘릴 이유가 없다).
   */
  reset: () => void;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  activeTransaction: null,

  record: (patches, inversePatches, coalesceKey) => {
    if (patches.length === 0) return;
    const state = get();

    if (state.activeTransaction) {
      // in-place push: 이 배열들은 endTransaction 전까지 store 밖에서 읽히지
      // 않으므로(위 주석 참고) 매번 새 배열을 만들 필요가 없다.
      state.activeTransaction.patches.push(...patches);
      state.activeTransaction.inverseBatches.push(inversePatches);
      set({ activeTransaction: { ...state.activeTransaction } });
      return;
    }

    const now = Date.now();
    const last = state.past[state.past.length - 1];
    if (coalesceKey && last?.coalesceKey === coalesceKey && now - last.timestamp < COALESCE_WINDOW_MS) {
      // 위와 같은 이유로 last.patches/inverseBatches 자체는 그대로 mutate하고,
      // past 배열(항목 수 = undo 단계 수, 포인터 이벤트 수가 아님)만 새로 감싼다.
      last.patches.push(...patches);
      last.inverseBatches.push(inversePatches);
      last.timestamp = now;
      set({ past: [...state.past.slice(0, -1), last] });
      return;
    }

    set({
      past: [...state.past, { patches, inverseBatches: [inversePatches], coalesceKey, timestamp: now }],
      future: [],
    });
  },

  beginTransaction: (key) => {
    // 이미 열린 트랜잭션이 있으면(호출부 실수) 덮어쓰지 않고 무시 — 중첩을 지원하지
    // 않으므로 항상 endTransaction으로 짝을 맞춰야 한다.
    if (get().activeTransaction) return;
    set({ activeTransaction: { key, patches: [], inverseBatches: [] } });
  },

  endTransaction: () => {
    const active = get().activeTransaction;
    if (!active) return;
    set({ activeTransaction: null });
    if (active.patches.length === 0) return; // 실제 이동/변형이 없었으면(클릭만) 기록하지 않는다.
    set((state) => ({
      past: [
        ...state.past,
        { patches: active.patches, inverseBatches: active.inverseBatches, timestamp: Date.now() },
      ],
      future: [],
    }));
  },

  undo: () => {
    const state = get();
    if (state.past.length === 0) return;
    const entry = state.past[state.past.length - 1];
    const current = useObjectsStore.getState().objects;
    const restored = applyPatches(current, flattenInverseBatches(entry.inverseBatches));
    useObjectsStore.setState({ objects: restored });
    set({ past: state.past.slice(0, -1), future: [...state.future, entry] });
  },

  redo: () => {
    const state = get();
    if (state.future.length === 0) return;
    const entry = state.future[state.future.length - 1];
    const current = useObjectsStore.getState().objects;
    const restored = applyPatches(current, entry.patches);
    useObjectsStore.setState({ objects: restored });
    set({ future: state.future.slice(0, -1), past: [...state.past, entry] });
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  reset: () => set({ past: [], future: [], activeTransaction: null }),
}));
