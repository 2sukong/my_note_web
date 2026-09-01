import { create } from 'zustand';
import { produceWithPatches, applyPatches } from 'immer';
import type { Patch } from 'immer';
import type { ImageHighlight } from '../types/object';
import type { OverlayObject, PdfPageOverlay } from '../types/pdf';
import type { TextAnnotation, TextLine } from '../objects/text/indentation/types';
import {
  createRangeId,
  eraseHighlightsInRange,
  paintOverHighlights,
  remapHighlightsForEdit,
} from '../objects/text/highlightModel';
import { usePdfOverlayHistoryStore } from './pdfOverlayHistoryStore';
import { releaseImage } from '../objects/image/imageStore';
import { loadPageOverlay, removePageOverlay, savePageOverlay } from './pdfLibraryStore';

/**
 * PDF 페이지 위 필기 오버레이 전용 store(Phase 6, v3 §2-7 B안: 메인 Canvas의
 * objectsStore/historyStore와 완전히 분리된 병렬 구현). "Page → PDF → PDF Page →
 * Overlay Objects" 구조에서 맨 아래 계층 — 지금 Viewer에 열려 있는 딱 한 PDF 페이지의
 * 필기 상태만 메모리에 들고 있는다(Library가 Page 단위 스코프인 것과 같은 이유로,
 * 모든 페이지의 오버레이를 미리 다 들고 있을 필요가 없다).
 *
 * objectsStore.ts의 mutate() 패턴을 그대로 따른다: 모든 변형은 produceWithPatches로
 * patches/inversePatches를 만들고, 실제 변경이 있을 때만 상태를 갱신하며
 * pdfOverlayHistoryStore에 기록한다. 다른 점은 대상 상태가 { objects, pageHighlights }
 * 묶음이라는 것과, 변형마다 IndexedDB 자동저장을 예약한다는 것(메인 앱처럼 store
 * 구독을 통한 별도 배선 없이 mutate() 안에서 직접 스케줄한다 — 오버레이는 상대적으로
 * 저장 규모가 작아 이 정도 단순화로 충분하다고 판단).
 *
 * Phase 6(텍스트/주석, 2026-08): objectsStore.ts의 setTextLines/addAnnotation 등
 * text·annotation 관련 액션들을 그대로 이식했다 — 대상 컬렉션이 Record<string,
 * CanvasObject>에서 Record<string, OverlayObject>로 바뀐 것 말고는 로직이 100%
 * 동일하다(TextObject/TextLine/TextAnnotation은 types/pdf.ts가 그대로 재사용하는
 * 같은 타입이므로 새로 만들 필요가 없다 — types/pdf.ts 파일 상단 주석 참고). 이 덕분에
 * 주석(annotation)이 "자동으로 딸려온다"는 확정 요구사항이 별도 구현 없이 성립한다.
 */
interface PdfOverlayCore {
  objects: Record<string, OverlayObject>;
  pageHighlights: ImageHighlight[];
}

interface PdfOverlayState extends PdfOverlayCore {
  pdfId: string | null;
  pageIndex: number | null;
  /** 지금 pdfId/pageIndex의 데이터를 IndexedDB에서 다 불러왔는지 — 로딩 중 잠깐
   * 빈 상태로 보이는 것과 "진짜 필기가 없는 페이지"를 구분하려면 필요할 수 있어
   * 남겨둔다(현재 렌더링에서 필수로 쓰지는 않지만, Phase 7/8에서 로딩 표시에 쓸 수 있음). */
  loaded: boolean;

  /** Viewer가 보여줄 페이지가 바뀔 때마다(다른 PDF를 열거나, 페이지를 넘기거나) 호출.
   * 이전 페이지에 저장 대기 중이던 변경을 먼저 flush한 뒤, 새 페이지의 저장된 오버레이를
   * 불러온다. undo/redo 스택도 페이지 단위로 독립적이어야 하므로 여기서 reset한다. */
  loadForPage: (pdfId: string, pageIndex: number) => Promise<void>;
  /** Viewer를 닫을 때 호출 — 대기 중인 저장을 flush하고 메모리 상태/undo 스택을 비운다. */
  closeOverlay: () => Promise<void>;

  addObject: (obj: OverlayObject) => void;
  updateObject: (id: string, patch: Partial<OverlayObject> & Record<string, unknown>, coalesceKey?: string) => void;
  removeObject: (id: string) => void;
  /** objectsStore.ts의 nextZIndex()와 동일 — 새 오버레이 객체를 항상 맨 앞에 놓기 위해
   * useDrawOverlayTextTool.ts가 addObject 직전에 부른다. */
  nextZIndex: () => number;

  /** objectsStore.ts의 addImageHighlight와 같은 인자 구성(0~1 비율 좌표 + thicknessRatio도
   * 비율) — id는 이 액션이 내부에서 생성한다(호출부가 직접 만들지 않음). */
  addPageHighlight: (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    thicknessRatio: number,
  ) => void;
  removePageHighlights: (ids: string[]) => void;

  /** TextObject 전용: lines 배열을 통째로 교체한다(Enter/Backspace/타이핑 등 — v3 §2-9
   * 확정대로 Text를 오버레이에 올리면 objectsStore.ts와 완전히 같은 데이터 계약을 쓴다). */
  setTextLines: (id: string, lines: TextLine[]) => void;

  /** 드래그로 선택된 텍스트 구간(들)에 하이라이트를 추가한다 — objectsStore.ts와
   * 완전히 같은 시그니처(하나의 드래그가 여러 줄에 걸칠 수 있어 세그먼트 배열을 받는다). */
  addHighlightSegments: (
    segments: Array<{ objectId: string; lineId: string; start: number; end: number }>,
    color: string,
  ) => void;
  /** 지우개 모드: 드래그로 선택된 구간(들)과 겹치는 하이라이트만 트리밍/삭제한다. */
  eraseHighlightSegments: (segments: Array<{ objectId: string; lineId: string; start: number; end: number }>) => void;
  removeHighlight: (objectId: string, lineId: string, highlightId: string) => void;
  updateHighlightColor: (objectId: string, lineId: string, highlightId: string, color: string) => void;

  /** 드래그로 선택한 텍스트 구간을 anchor로 삼아 새 Annotation을 만든다. 생성된 id를
   * 반환해서, 호출부가 바로 편집 상태로 진입시킬 수 있게 한다. */
  addAnnotation: (
    objectId: string,
    lineId: string,
    start: number,
    end: number,
    color?: string,
    fontFamily?: string,
    fontSize?: number,
  ) => string;
  updateAnnotationText: (objectId: string, lineId: string, annotationId: string, text: string) => void;
  updateAnnotationColor: (objectId: string, lineId: string, annotationId: string, color: string) => void;
  updateAnnotationFontFamily: (objectId: string, lineId: string, annotationId: string, fontFamily: string) => void;
  updateAnnotationFontSize: (objectId: string, lineId: string, annotationId: string, fontSize: number) => void;
  /** Annotation을 드래그해서 옮길 때 offsetX만 갱신한다(anchor/start/end는 그대로 —
   * 본문 Text와의 연결 유지). */
  updateAnnotationOffset: (objectId: string, lineId: string, annotationId: string, offsetX: number) => void;
  removeAnnotation: (objectId: string, lineId: string, annotationId: string) => void;
  /** 주석 자기 자신의 텍스트 일부에 형광펜을 추가한다(본문 addHighlightSegments와 같은
   * 원리, 대상만 annotation.text). */
  addAnnotationHighlight: (
    objectId: string,
    lineId: string,
    annotationId: string,
    start: number,
    end: number,
    color: string,
  ) => void;
  removeAnnotationHighlight: (objectId: string, lineId: string, annotationId: string, highlightId: string) => void;
  eraseAnnotationHighlightRange: (objectId: string, lineId: string, annotationId: string, start: number, end: number) => void;

  /** pdfOverlayHistoryStore의 undo/redo가 호출하는 내부용 — 밖에서 직접 부를 일은 없다. */
  applyHistoryPatches: (patches: Patch[]) => void;
}

const SAVE_DEBOUNCE_MS = 500;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** loadForPage가 비동기로 대기하는 동안 사용자가 다른 페이지로 또 넘어갈 수 있다 —
 * pdfLibraryStore.ts의 loadRequestToken과 같은 이유로 토큰을 둔다. */
let loadToken = 0;

function now(): number {
  return Date.now();
}

/** objectsStore.ts의 updateLineIn과 완전히 같은 헬퍼 — 대상이 CanvasObject가 아니라
 * OverlayObject라는 점만 다르다. objectId가 TextObject가 아니거나 lineId를 못 찾으면
 * 조용히 아무 것도 하지 않는다(호출부가 이미 사라진 대상을 참조하는 경쟁 상태 방어). */
function updateLineIn(
  objects: Record<string, OverlayObject>,
  objectId: string,
  lineId: string,
  updater: (line: TextLine) => TextLine,
): void {
  const existing = objects[objectId];
  if (!existing || existing.type !== 'text') return;
  const idx = existing.lines.findIndex((l) => l.id === lineId);
  if (idx === -1) return;
  existing.lines[idx] = updater(existing.lines[idx]);
  existing.updatedAt = now();
}

/** addHighlightSegments/eraseHighlightSegments가 공유하는 그룹핑 헬퍼 — objectsStore.ts의
 * groupSegmentsByObjectAndLine과 동일하다("여러 줄에 걸친 세그먼트 배열"을 objectId →
 * (lineId → 그 줄의 세그먼트들) 구조로 정리). */
function groupSegmentsByObjectAndLine(
  segments: Array<{ objectId: string; lineId: string; start: number; end: number }>,
): Map<string, Map<string, Array<{ start: number; end: number }>>> {
  const byObject = new Map<string, Map<string, Array<{ start: number; end: number }>>>();
  for (const seg of segments) {
    if (seg.end <= seg.start) continue;
    const segsByLine = byObject.get(seg.objectId) ?? new Map<string, Array<{ start: number; end: number }>>();
    const list = segsByLine.get(seg.lineId) ?? [];
    list.push({ start: seg.start, end: seg.end });
    segsByLine.set(seg.lineId, list);
    byObject.set(seg.objectId, segsByLine);
  }
  return byObject;
}

export const usePdfOverlayStore = create<PdfOverlayState>((set, get) => {
  function mutate(recipe: (draft: PdfOverlayCore) => void, coalesceKey?: string) {
    const state = get();
    const core: PdfOverlayCore = { objects: state.objects, pageHighlights: state.pageHighlights };
    const [nextCore, patches, inversePatches] = produceWithPatches(core, recipe);
    if (patches.length === 0) return;
    set({ objects: nextCore.objects, pageHighlights: nextCore.pageHighlights });
    usePdfOverlayHistoryStore.getState().record(patches, inversePatches, coalesceKey);
    scheduleSave();
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void performSave();
    }, SAVE_DEBOUNCE_MS);
  }

  async function performSave(): Promise<void> {
    const state = get();
    if (!state.pdfId || state.pageIndex === null) return;
    const objectsArray = Object.values(state.objects);
    // 실제로 필기가 있는 페이지만 레코드가 남는다(v3 §2-3) — 다 지워서 빈 상태로
    // 돌아갔으면 저장된 레코드 자체를 삭제해 불필요한 빈 껍데기가 쌓이지 않게 한다.
    if (objectsArray.length === 0 && state.pageHighlights.length === 0) {
      await removePageOverlay(state.pdfId, state.pageIndex);
      return;
    }
    const overlay: PdfPageOverlay = {
      id: `${state.pdfId}:${state.pageIndex}`,
      pdfId: state.pdfId,
      pageIndex: state.pageIndex,
      objects: objectsArray,
      pageHighlights: state.pageHighlights,
    };
    await savePageOverlay(overlay);
  }

  async function flushPendingSave(): Promise<void> {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    await performSave();
  }

  return {
    pdfId: null,
    pageIndex: null,
    loaded: false,
    objects: {},
    pageHighlights: [],

    loadForPage: async (pdfId, pageIndex) => {
      const token = ++loadToken;
      await flushPendingSave();
      const overlay = await loadPageOverlay(pdfId, pageIndex);
      if (token !== loadToken) return; // 그 사이 다른 페이지로 넘어감 — 이 결과는 버린다
      usePdfOverlayHistoryStore.getState().reset();
      set({
        pdfId,
        pageIndex,
        loaded: true,
        objects: overlay ? Object.fromEntries(overlay.objects.map((o) => [o.id, o])) : {},
        pageHighlights: overlay?.pageHighlights ?? [],
      });
    },

    closeOverlay: async () => {
      // loadForPage와 같은 토큰을 공유한다: PDF를 닫는 것과 동시에(같은 렌더에서) 다음
      // 페이지의 loadForPage가 걸릴 수 있는데(예: 다른 PDF로 즉시 전환), 그 경우 "가장
      // 나중에 시작된 쪽"만 최종 상태를 반영해야 한다 — 그렇지 않으면 이 close의 뒤늦은
      // set({...null})이 방금 로드된 새 PDF의 오버레이를 잘못 지워버릴 수 있다.
      const token = ++loadToken;
      await flushPendingSave();
      if (token !== loadToken) return; // 그 사이 loadForPage가 새로 시작됨 — 이 close는 버린다
      usePdfOverlayHistoryStore.getState().reset();
      set({ pdfId: null, pageIndex: null, loaded: false, objects: {}, pageHighlights: [] });
    },

    addObject: (obj) => mutate((draft) => { draft.objects[obj.id] = obj; }),

    updateObject: (id, patch, coalesceKey) =>
      mutate((draft) => {
        const existing = draft.objects[id];
        if (!existing) return;
        // 버그 수정(리사이즈 추가 Phase, 2026-09): objectsStore.ts의 updateObject와
        // 100% 같은 계약이어야 하는데(파일 상단 주석) updatedAt을 안 찍고 있었다 —
        // 지금까지는 이동(x/y)만 이 경로를 타서 눈에 띄는 문제가 없었지만, 텍스트
        // 리사이즈의 manualHeight 판정(usePdfOverlayObjectResize.ts →
        // PdfOverlayTextView.tsx의 자동 높이 effect)이 objectsStore.ts와 동일하게
        // "createdAt === updatedAt이면 진짜 새 객체"를 기준으로 첫 측정 시 줄어드는
        // 것도 허용하는데, updatedAt이 계속 createdAt과 같은 값으로 멈춰 있으면 이미
        // 사용자가 리사이즈해둔(manualHeight) 객체도 페이지를 다시 열 때마다 "진짜
        // 새 객체"로 오판돼 자동 높이가 그 리사이즈를 덮어써버린다.
        Object.assign(existing, patch, { updatedAt: now() });
      }, coalesceKey),

    removeObject: (id) => {
      // objectsStore.ts(메인 캔버스)의 removeObject와 같은 이유: 지워지는 객체가 이미지라면
      // object URL 캐시의 참조 카운트를 낮춘다(Blob 자체는 IndexedDB에 그대로 남는다 —
      // objects/image/imageStore.ts 상단 주석 참고). draft 안에서 지우기 전에 먼저
      // 현재 상태에서 읽어야 어떤 객체였는지 알 수 있다.
      const removed = get().objects[id];
      mutate((draft) => {
        delete draft.objects[id];
      });
      if (removed?.type === 'image' && removed.imageId) releaseImage(removed.imageId);
    },

    nextZIndex: () => {
      const objects = Object.values(get().objects);
      return objects.reduce((max, o) => Math.max(max, o.zIndex), 0) + 1;
    },

    addPageHighlight: (x1, y1, x2, y2, color, thicknessRatio) =>
      mutate((draft) => {
        const highlight: ImageHighlight = { id: crypto.randomUUID(), x1, y1, x2, y2, color, thicknessRatio };
        draft.pageHighlights.push(highlight);
      }),

    removePageHighlights: (ids) =>
      mutate((draft) => {
        const idSet = new Set(ids);
        draft.pageHighlights = draft.pageHighlights.filter((h) => !idSet.has(h.id));
      }),

    setTextLines: (id, lines) =>
      mutate((draft) => {
        const existing = draft.objects[id];
        if (!existing || existing.type !== 'text') return;
        existing.lines = lines;
        existing.updatedAt = now();
      }, `text:${id}`),

    addHighlightSegments: (segments, color) =>
      mutate((draft) => {
        for (const [objectId, segsByLine] of groupSegmentsByObjectAndLine(segments)) {
          const existing = draft.objects[objectId];
          if (!existing || existing.type !== 'text') continue;
          for (let i = 0; i < existing.lines.length; i++) {
            const line = existing.lines[i];
            const lineSegs = segsByLine.get(line.id);
            if (!lineSegs) continue;
            let nextHighlights = line.highlights ?? [];
            for (const s of lineSegs) {
              nextHighlights = paintOverHighlights(nextHighlights, s.start, s.end, color);
            }
            existing.lines[i] = { ...line, highlights: nextHighlights };
          }
          existing.updatedAt = now();
        }
      }),

    eraseHighlightSegments: (segments) =>
      mutate((draft) => {
        for (const [objectId, segsByLine] of groupSegmentsByObjectAndLine(segments)) {
          const existing = draft.objects[objectId];
          if (!existing || existing.type !== 'text') continue;
          for (let i = 0; i < existing.lines.length; i++) {
            const line = existing.lines[i];
            const lineSegs = segsByLine.get(line.id);
            if (!lineSegs) continue;
            let nextHighlights = line.highlights ?? [];
            for (const s of lineSegs) {
              nextHighlights = eraseHighlightsInRange(nextHighlights, s.start, s.end);
            }
            existing.lines[i] = { ...line, highlights: nextHighlights };
          }
          existing.updatedAt = now();
        }
      }),

    removeHighlight: (objectId, lineId, highlightId) =>
      mutate((draft) =>
        updateLineIn(draft.objects, objectId, lineId, (line) => ({
          ...line,
          highlights: (line.highlights ?? []).filter((h) => h.id !== highlightId),
        })),
      ),

    updateHighlightColor: (objectId, lineId, highlightId, color) =>
      mutate((draft) =>
        updateLineIn(draft.objects, objectId, lineId, (line) => ({
          ...line,
          highlights: (line.highlights ?? []).map((h) => (h.id === highlightId ? { ...h, color } : h)),
        })),
      ),

    addAnnotation: (objectId, lineId, start, end, color, fontFamily, fontSize) => {
      const id = createRangeId();
      mutate((draft) =>
        updateLineIn(draft.objects, objectId, lineId, (line) => ({
          ...line,
          annotations: [
            ...(line.annotations ?? []),
            { id, start, end, text: '', color, fontFamily, fontSize } as TextAnnotation,
          ],
        })),
      );
      return id;
    },

    updateAnnotationColor: (objectId, lineId, annotationId, color) =>
      mutate((draft) =>
        updateLineIn(draft.objects, objectId, lineId, (line) => ({
          ...line,
          annotations: (line.annotations ?? []).map((a) => (a.id === annotationId ? { ...a, color } : a)),
        })),
      ),

    updateAnnotationFontFamily: (objectId, lineId, annotationId, fontFamily) =>
      mutate((draft) =>
        updateLineIn(draft.objects, objectId, lineId, (line) => ({
          ...line,
          annotations: (line.annotations ?? []).map((a) => (a.id === annotationId ? { ...a, fontFamily } : a)),
        })),
      ),

    updateAnnotationFontSize: (objectId, lineId, annotationId, fontSize) =>
      mutate((draft) =>
        updateLineIn(draft.objects, objectId, lineId, (line) => ({
          ...line,
          annotations: (line.annotations ?? []).map((a) => (a.id === annotationId ? { ...a, fontSize } : a)),
        })),
      ),

    updateAnnotationText: (objectId, lineId, annotationId, text) =>
      mutate((draft) =>
        updateLineIn(draft.objects, objectId, lineId, (line) => ({
          ...line,
          annotations: (line.annotations ?? []).map((a) => {
            if (a.id !== annotationId) return a;
            // 본문 텍스트 편집과 동일한 원리: 텍스트가 바뀐 만큼 이 annotation 자신의
            // 형광펜 구간 오프셋도 remapHighlightsForEdit로 함께 보정한다.
            const nextHighlights = remapHighlightsForEdit(a.highlights, a.text, text);
            return { ...a, text, highlights: nextHighlights };
          }),
        })), `annotation-text:${objectId}:${lineId}:${annotationId}`),

    updateAnnotationOffset: (objectId, lineId, annotationId, offsetX) =>
      mutate((draft) =>
        updateLineIn(draft.objects, objectId, lineId, (line) => ({
          ...line,
          annotations: (line.annotations ?? []).map((a) => (a.id === annotationId ? { ...a, offsetX } : a)),
        })), `annotation-offset:${objectId}:${lineId}:${annotationId}`),

    addAnnotationHighlight: (objectId, lineId, annotationId, start, end, color) =>
      mutate((draft) =>
        updateLineIn(draft.objects, objectId, lineId, (line) => ({
          ...line,
          annotations: (line.annotations ?? []).map((a) => {
            if (a.id !== annotationId || end <= start) return a;
            return { ...a, highlights: paintOverHighlights(a.highlights, start, end, color) };
          }),
        })),
      ),

    removeAnnotationHighlight: (objectId, lineId, annotationId, highlightId) =>
      mutate((draft) =>
        updateLineIn(draft.objects, objectId, lineId, (line) => ({
          ...line,
          annotations: (line.annotations ?? []).map((a) =>
            a.id === annotationId
              ? { ...a, highlights: (a.highlights ?? []).filter((h) => h.id !== highlightId) }
              : a,
          ),
        })),
      ),

    eraseAnnotationHighlightRange: (objectId, lineId, annotationId, start, end) =>
      mutate((draft) =>
        updateLineIn(draft.objects, objectId, lineId, (line) => ({
          ...line,
          annotations: (line.annotations ?? []).map((a) => {
            if (a.id !== annotationId || end <= start) return a;
            return { ...a, highlights: eraseHighlightsInRange(a.highlights, start, end) };
          }),
        })),
      ),

    removeAnnotation: (objectId, lineId, annotationId) =>
      mutate((draft) =>
        updateLineIn(draft.objects, objectId, lineId, (line) => ({
          ...line,
          annotations: (line.annotations ?? []).filter((a) => a.id !== annotationId),
        })),
      ),

    applyHistoryPatches: (patches) => {
      const state = get();
      const core: PdfOverlayCore = { objects: state.objects, pageHighlights: state.pageHighlights };
      const next = applyPatches(core, patches);
      set({ objects: next.objects, pageHighlights: next.pageHighlights });
      scheduleSave();
    },
  };
});
