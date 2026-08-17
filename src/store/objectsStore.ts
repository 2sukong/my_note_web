import { create } from 'zustand';
import { produceWithPatches } from 'immer';
import type { CanvasObject, TextObject } from '../types/object';
import { createPlainLine } from '../objects/text/indentation/types';
import type { TextAnnotation, TextLine } from '../objects/text/indentation/types';
import {
  createRangeId,
  eraseHighlightsInRange,
  normalizeOverlappingHighlights,
  paintOverHighlights,
  remapHighlightsForEdit,
} from '../objects/text/highlightModel';
import { DEFAULT_FRAME_HEIGHT, DEFAULT_FRAME_WIDTH } from '../objects/frame/frameDefaults';
import { releaseImage } from '../objects/image/imageStore';
import { useHistoryStore } from './historyStore';

function createId(): string {
  return crypto.randomUUID();
}

function now(): number {
  return Date.now();
}

/** frameId를 가질 수 있는 객체 타입인지(Frame 자신은 제외). moveObjectTo/removeObject(s)의
 * cascade에서 공통으로 쓴다. */
function hasFrameId(obj: CanvasObject): obj is CanvasObject & { frameId?: string | null } {
  return obj.type === 'text' || obj.type === 'image' || obj.type === 'arrow' || obj.type === 'rectangle';
}

/** addHighlightSegments/eraseHighlightSegments가 공유하는 그룹핑: "여러 줄에 걸친
 * 세그먼트 배열"을 objectId → (lineId → 그 줄의 세그먼트들) 구조로 정리한다. */
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

/**
 * 버그 수정(새로고침 시 형광펜이 더 커 보임): loadObjects(파일/페이지를 열 때)가
 * 호출한다 — paintOverHighlights를 도입하기 전에 만들어져 저장된 파일에는 겹치는
 * 하이라이트가 남아있을 수 있으므로, 열 때마다 한 번 정리한다. 겹침이 하나도
 * 없으면(대부분의 경우) line/annotation/object 참조를 그대로 유지해서 불필요한
 * 재렌더링이 생기지 않는다.
 */
function normalizeLoadedObjects(objects: Record<string, CanvasObject>): Record<string, CanvasObject> {
  let anyObjectChanged = false;
  const next: Record<string, CanvasObject> = { ...objects };
  for (const id of Object.keys(objects)) {
    const obj = objects[id];
    if (obj.type !== 'text') continue;
    let anyLineChanged = false;
    const nextLines = obj.lines.map((line) => {
      const nextHighlights = normalizeOverlappingHighlights(line.highlights);
      let anyAnnotationChanged = false;
      const nextAnnotations = line.annotations?.map((a) => {
        const nextAHighlights = normalizeOverlappingHighlights(a.highlights);
        if (nextAHighlights === a.highlights) return a;
        anyAnnotationChanged = true;
        return { ...a, highlights: nextAHighlights };
      });
      if (nextHighlights === line.highlights && !anyAnnotationChanged) return line;
      anyLineChanged = true;
      return { ...line, highlights: nextHighlights, annotations: anyAnnotationChanged ? nextAnnotations : line.annotations };
    });
    if (!anyLineChanged) continue;
    anyObjectChanged = true;
    next[id] = { ...obj, lines: nextLines };
  }
  return anyObjectChanged ? next : objects;
}

/**
 * removeAnnotation/updateAnnotationText 등이 공유하는 작은 헬퍼: 특정 TextObject의
 * 특정 줄 하나만 updater로 갱신한다. produceWithPatches의 draft 위에서 직접 mutate하는
 * 형태로 바뀌었다(Phase 7 이전엔 새 객체를 반환하는 형태였다) — 대상이 TextObject가
 * 아니거나 그 줄이 없으면 아무것도 바꾸지 않는다(no-op, patches 없음).
 */
function updateLineIn(
  draft: Record<string, CanvasObject>,
  objectId: string,
  lineId: string,
  updater: (line: TextLine) => TextLine,
): void {
  const existing = draft[objectId];
  if (!existing || existing.type !== 'text') return;
  const idx = existing.lines.findIndex((l) => l.id === lineId);
  if (idx === -1) return;
  existing.lines[idx] = updater(existing.lines[idx]);
  existing.updatedAt = now();
}

/**
 * Phase 8: 더 이상 objectsStore의 기본 상태로 쓰이지 않는다 — 실제 초기 상태는
 * storage/fileTreeStore.ts가 IndexedDB에서 불러온 현재 Page의 objects로 채운다.
 * 대신 "이 세상에 Page가 하나도 없던 최초 실행" 순간에만 fileTreeStore가 이 함수를
 * 호출해 기본 Page의 데모 콘텐츠로 심는다(온보딩 경험 유지 목적).
 */
export function createDemoObjects(): Record<string, CanvasObject> {
  const t = now();
  const seed: CanvasObject[] = [
    {
      id: createId(),
      type: 'text',
      x: 100,
      y: 100,
      width: 260,
      height: 110,
      rotation: 0,
      zIndex: 1,
      createdAt: t,
      updatedAt: t,
      lines: [
        createPlainLine('필로폰 : 각성제 ex) 히로뽕, 메스암페타민'),
        createPlainLine('더블클릭해서 편집해보세요'),
      ],
      baseFontSize: 16,
      color: '#222222',
    },
    {
      id: createId(),
      type: 'image',
      x: 420,
      y: 260,
      width: 140,
      height: 140,
      rotation: 0,
      zIndex: 2,
      createdAt: t,
      updatedAt: t,
      imageId: '',
      naturalWidth: 140,
      naturalHeight: 140,
      aspectRatioLocked: true,
    },
    {
      id: createId(),
      type: 'frame',
      x: 700,
      y: 80,
      width: DEFAULT_FRAME_WIDTH,
      height: DEFAULT_FRAME_HEIGHT,
      rotation: 0,
      zIndex: -1,
      createdAt: t,
      updatedAt: t,
      label: 'Frame',
    },
  ];

  return Object.fromEntries(seed.map((obj) => [obj.id, obj]));
}

interface ObjectsState {
  objects: Record<string, CanvasObject>;

  addObject: (obj: CanvasObject) => void;
  /** Phase 7: 붙여넣기처럼 여러 객체를 한 번에 추가하되 undo 한 단계로 묶는다. */
  addObjects: (objs: CanvasObject[]) => void;
  removeObject: (id: string) => void;
  /** Phase 7: 다중 선택 삭제/잘라내기용 — 여러 객체를 지워도 undo 한 단계로 묶는다. */
  removeObjects: (ids: string[]) => void;
  /**
   * 부분 업데이트. 타입 공통 필드(x/y/width/height 등)를 갱신하는 용도가 기본이며,
   * text 전용(content 등) 갱신처럼 타입별 필드를 다룰 때는 호출부에서 as로 좁혀 쓴다.
   *
   * Phase 8(스타일 패널): coalesceKey를 넘기면 800ms 안의 연속 호출이 undo 한 단계로
   * 합쳐진다 — 색상 피커를 드래그하거나 투명도 슬라이더를 드래그하는 동안 매
   * onChange마다 undo 단계가 따로 쌓이는 걸 막기 위함(PropertiesPanel.tsx). 화살촉/
   * 모서리 모양처럼 한 번 클릭으로 끝나는 변경은 넘기지 않아서(undefined) 항상
   * 독립된 undo 단계로 남는다.
   */
  updateObject: (
    id: string,
    patch: Partial<CanvasObject> & Record<string, unknown>,
    coalesceKey?: string,
  ) => void;
  moveObjectTo: (id: string, x: number, y: number) => void;
  resizeObjectTo: (id: string, box: { x: number; y: number; width: number; height: number }) => void;
  /** TextObject 전용: lines 배열을 통째로 교체한다 (Enter/Backspace/anchor 갱신 등). */
  setTextLines: (id: string, lines: TextLine[]) => void;

  /**
   * Phase 4: 드래그로 선택된 텍스트 구간(들)에 하이라이트를 추가한다.
   * 하나의 마우스 드래그가 여러 줄에 걸칠 수 있으므로 세그먼트 배열을 받는다.
   * 같은 objectId의 여러 세그먼트를 한 번의 store 업데이트로 반영한다.
   */
  addHighlightSegments: (
    segments: Array<{ objectId: string; lineId: string; start: number; end: number }>,
    color: string,
  ) => void;
  /**
   * 요구사항(형광펜 지우개): 드래그로 선택된 구간(들)과 겹치는 하이라이트만
   * 트리밍/삭제한다 — addHighlightSegments와 세그먼트 형태는 같지만 색을 받지
   * 않는다(새로 칠하는 게 아니라 지우기만 하므로). 텍스트/주석 등 다른 데이터는
   * 건드리지 않는다.
   */
  eraseHighlightSegments: (segments: Array<{ objectId: string; lineId: string; start: number; end: number }>) => void;
  /** 하이라이트 하나만 콕 집어 제거한다(fineSelection으로 선택된 하이라이트의 Backspace 삭제용). */
  removeHighlight: (objectId: string, lineId: string, highlightId: string) => void;
  /**
   * Phase 8(스타일 패널): 이미 만들어진 하이라이트 하나의 색만 바꾼다(fineSelection 대상).
   * ColorPickerPopover가 자유 hex를 넘길 수 있어 color는 HighlightColorId 프리셋으로
   * 좁히지 않고 string으로 받는다(TextHighlight.color와 동일한 이유).
   */
  updateHighlightColor: (objectId: string, lineId: string, highlightId: string, color: string) => void;

  /**
   * Phase 4(2차): 드래그로 선택한 텍스트 구간을 anchor로 삼아 새 Annotation을 만든다.
   * 생성된 id를 반환해서, 호출부(useTextSelectionTools)가 바로 편집 모드로 진입시킬 수 있게 한다.
   */
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
  /** Phase 8(스타일 패널): 이미 만들어진 주석 하나의 색만 바꾼다 — updateHighlightColor와 동일한 원리. */
  updateAnnotationColor: (objectId: string, lineId: string, annotationId: string, color: string) => void;
  /** 요구사항(폰트 목록 통합): 이미 만들어진 주석 하나의 글꼴만 바꾼다 — updateAnnotationColor와 동일한 원리. */
  updateAnnotationFontFamily: (objectId: string, lineId: string, annotationId: string, fontFamily: string) => void;
  /** 요구사항(주석 크기 조절): 이미 만들어진 주석 하나의 글자 크기만 바꾼다 — updateAnnotationFontFamily와 동일한 원리. */
  updateAnnotationFontSize: (objectId: string, lineId: string, annotationId: string, fontSize: number) => void;
  /** Annotation을 드래그해서 옮길 때 offsetX만 갱신한다(anchor/start/end는 그대로 — target Text와의 연결 유지). */
  updateAnnotationOffset: (objectId: string, lineId: string, annotationId: string, offsetX: number) => void;
  removeAnnotation: (objectId: string, lineId: string, annotationId: string) => void;
  /** 주석 자기 자신의 텍스트 일부에 형광펜을 추가한다(본문 addHighlightSegments와 같은 원리, 대상만 annotation.text). */
  addAnnotationHighlight: (
    objectId: string,
    lineId: string,
    annotationId: string,
    start: number,
    end: number,
    color: string,
  ) => void;
  removeAnnotationHighlight: (objectId: string, lineId: string, annotationId: string, highlightId: string) => void;
  /** 요구사항(형광펜 지우개): eraseHighlightSegments의 annotation 버전 — annotation.text
   * 안에서 드래그로 선택한 구간과 겹치는 하이라이트만 트리밍/삭제한다. */
  eraseAnnotationHighlightRange: (objectId: string, lineId: string, annotationId: string, start: number, end: number) => void;

  /**
   * zIndex 오름차순으로 정렬된 객체 목록 (렌더 순서 = 쌓임 순서).
   * 호출할 때마다 새 배열을 만든다 — 즉 `useObjectsStore(s => s.getOrderedObjects())`처럼
   * React 컴포넌트의 셀렉터로 직접 쓰면 안 된다. useSyncExternalStore가 매번 다른 참조를
   * 받고 "무한 루프"로 판단해 즉시 에러를 던진다("getSnapshot should be cached").
   * 이벤트 핸들러 등 구독이 아닌 일회성 조회(`useObjectsStore.getState().getOrderedObjects()`)에서만 쓸 것.
   * 렌더링에 필요하면 `s.objects`(record, 참조 안정적)를 구독하고 컴포넌트에서 useMemo로 정렬하라.
   */
  getOrderedObjects: () => CanvasObject[];
  /** 다음에 쓸 zIndex(현재 최댓값+1). 새 객체 생성/붙여넣기가 항상 맨 위에 오도록. */
  nextZIndex: () => number;

  /**
   * 요구사항(우클릭 쌓임 순서 메뉴): 맨 앞/맨 뒤로는 nextZIndex()와 같은 방식으로
   * 전체 최댓값+1(또는 최솟값-1)을 부여한다. 한 단계 앞/뒤로는 바로 인접한(zIndex가
   * 그 다음/이전으로 가장 가까운) 객체 하나와 zIndex를 맞바꾼다 — 그 사이 다른
   * 객체들의 zIndex는 전혀 건드리지 않아도 상대 순서가 정확히 한 칸만 바뀐다.
   * 이미 맨 앞/맨 뒤라 옮길 대상이 없으면 아무 것도 하지 않는다(patches 없음 → undo
   * 단계도 안 쌓인다).
   */
  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;
  bringForward: (id: string) => void;
  sendBackward: (id: string) => void;

  /**
   * Phase 8: Page를 전환할 때 fileTreeStore가 호출한다. patches/undo 기록 없이
   * objects를 통째로 교체한다 — 이건 사용자의 편집이 아니라 "다른 Page를 불러오는"
   * 동작이라, historyStore에 남으면 안 되고(그 Page의 undo 스택과 섞여버림)
   * mutate() 헬퍼(immer produceWithPatches)를 거칠 필요도 없다.
   */
  loadObjects: (objects: Record<string, CanvasObject>) => void;
}

export const useObjectsStore = create<ObjectsState>((set, get) => {
  /**
   * Phase 7: 모든 변형은 이 헬퍼를 통해서만 이뤄진다. immer produceWithPatches로
   * (다음 objects, 정방향 patches, 역방향 inversePatches)를 만들고, 실제로 뭔가
   * 바뀌었을 때만(patches.length>0) state를 갱신하고 historyStore에 기록한다.
   * coalesceKey는 historyStore.record가 "진행 중인 트랜잭션이 없을 때, 짧은 시간
   * 안에 같은 키로 또 호출되면 직전 undo 단계에 합친다"는 용도로만 쓴다 — 드래그/
   * 리사이즈처럼 시작·끝이 명확한 제스처는 각 훅이 beginTransaction/endTransaction으로
   * 감싸므로 이 키는 사실상 폴백일 뿐이다(트랜잭션이 열려 있으면 항상 그쪽이 우선).
   */
  function mutate(recipe: (draft: Record<string, CanvasObject>) => void, coalesceKey?: string) {
    const [nextObjects, patches, inversePatches] = produceWithPatches(get().objects, recipe);
    if (patches.length === 0) return;
    set({ objects: nextObjects });
    useHistoryStore.getState().record(patches, inversePatches, coalesceKey);
  }

  return {
    // Phase 8: 빈 상태로 시작 — fileTreeStore.init()이 현재 Page의 저장된 objects로
    // 채워줄 때까지의 짧은 순간이며, App.tsx는 그 로딩이 끝나기 전까지 Canvas를
    // 렌더링하지 않는다(빈 화면이 사용자에게 보이지 않음).
    objects: {},

    loadObjects: (objects) => set({ objects: normalizeLoadedObjects(objects) }),

    addObject: (obj) => mutate((draft) => { draft[obj.id] = obj; }),

    addObjects: (objs) =>
      mutate((draft) => {
        for (const obj of objs) draft[obj.id] = obj;
      }),

    removeObject: (id) => {
      const removed = get().objects[id];
      if (!removed) return;
      mutate((draft) => {
        delete draft[id];
        // Frame 삭제는 안의 Text/Image/Arrow/Rectangle까지 연쇄 삭제하지 않는다
        // (요구사항 명시) — 다만 존재하지 않는 frameId를 그대로 들고 있으면 혼란스러우니 정리만 해준다.
        if (removed.type === 'frame') {
          for (const obj of Object.values(draft)) {
            if (hasFrameId(obj) && obj.frameId === id) obj.frameId = null;
          }
        }
      });

      // Phase 5: Image 객체를 지우면 메모리에 떠 있는 Blob URL도 같이 해제한다.
      // 이 부수효과는 의도적으로 patches/undo 밖에 있다 — Blob URL 해제를 되돌릴 수 없어서,
      // 이미지 삭제를 Undo하면 객체는 복원되지만 이미지가 깨져 보일 수 있다(알려진 한계,
      // Phase 8에서 이미지가 IndexedDB로 옮겨가면 자연히 해결됨). 시드 데이터처럼
      // imageId가 빈 문자열이면 no-op.
      if (removed.type === 'image' && removed.imageId) {
        releaseImage(removed.imageId);
      }
    },

    removeObjects: (ids) => {
      const objects = get().objects;
      const removedList = ids.map((id) => objects[id]).filter((o): o is CanvasObject => !!o);
      if (removedList.length === 0) return;
      const removedIds = new Set(removedList.map((o) => o.id));
      const removedFrameIds = new Set(removedList.filter((o) => o.type === 'frame').map((o) => o.id));

      mutate((draft) => {
        for (const id of removedIds) delete draft[id];
        if (removedFrameIds.size > 0) {
          for (const obj of Object.values(draft)) {
            if (hasFrameId(obj) && obj.frameId && removedFrameIds.has(obj.frameId)) obj.frameId = null;
          }
        }
      });

      for (const removed of removedList) {
        if (removed.type === 'image' && removed.imageId) releaseImage(removed.imageId);
      }
    },

    updateObject: (id, patch, coalesceKey) =>
      mutate((draft) => {
        const existing = draft[id];
        if (!existing) return;
        Object.assign(existing, patch, { updatedAt: now() });
      }, coalesceKey),

    moveObjectTo: (id, x, y) =>
      mutate((draft) => {
        const target = draft[id];
        if (!target) return;
        const dx = x - target.x;
        const dy = y - target.y;
        target.x = x;
        target.y = y;
        target.updatedAt = now();

        // Phase 4(2차)/5/6: Frame을 이동하면 그 Frame에 속한(frameId가 같은) 객체들도
        // 같은 만큼 따라 이동한다. Frame은 이들의 DOM 부모가 아니라 순전히 논리적
        // 소속 관계이므로, 이동은 항상 delta를 그대로 전파하는 방식으로 처리한다.
        // (Annotation은 TextLine에 종속된 데이터라 텍스트 객체가 이동하면 자동으로
        // 함께 이동하고, 별도 처리가 필요 없다.)
        //
        // Phase 7 다중 선택 노트: useObjectDrag가 Frame과 그 자식을 동시에 선택해
        // 둘 다에 대해 moveObjectTo를 각각 호출하더라도 안전하다 — 여기서 계산하는
        // dx/dy는 "이번 호출 시작 시점의 draft.x" 기준 증분이라, 자식 쪽 직접 호출이
        // (드래그 시작점부터의 절대값으로) 먼저 정확한 위치로 옮겨놨어도 이 cascade가
        // 같은 값으로 다시 옮길 뿐 값이 어긋나지 않는다(둘 다 같은 목표값에 수렴).
        if (target.type === 'frame' && (dx !== 0 || dy !== 0)) {
          for (const obj of Object.values(draft)) {
            if (hasFrameId(obj) && obj.frameId === id) {
              obj.x += dx;
              obj.y += dy;
              obj.updatedAt = now();
            }
          }
        }
      }, `move:${id}`),

    resizeObjectTo: (id, box) =>
      mutate((draft) => {
        const target = draft[id];
        if (!target) return;
        target.x = box.x;
        target.y = box.y;
        target.width = box.width;
        target.height = box.height;
        target.updatedAt = now();
      }, `resize:${id}`),

    setTextLines: (id, lines) =>
      mutate((draft) => {
        const existing = draft[id];
        if (!existing || existing.type !== 'text') return;
        (existing as TextObject).lines = lines;
        existing.updatedAt = now();
      }, `text:${id}`),

    addHighlightSegments: (segments, color) =>
      mutate((draft) => {
        for (const [objectId, segsByLine] of groupSegmentsByObjectAndLine(segments)) {
          const existing = draft[objectId];
          if (!existing || existing.type !== 'text') continue;
          for (let i = 0; i < existing.lines.length; i++) {
            const line = existing.lines[i];
            const lineSegs = segsByLine.get(line.id);
            if (!lineSegs) continue;
            // 버그 수정: 겹치는/같은 구간을 실수로 다시 드래그해도 하이라이트가
            // 중복 누적되지 않도록, 그냥 추가하는 대신 "새로 칠한 색이 기존 색 위를
            // 덮는다"(paintOverHighlights)로 반영한다.
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
          const existing = draft[objectId];
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
        updateLineIn(draft, objectId, lineId, (line) => ({
          ...line,
          highlights: (line.highlights ?? []).filter((h) => h.id !== highlightId),
        })),
      ),

    updateHighlightColor: (objectId, lineId, highlightId, color) =>
      mutate((draft) =>
        updateLineIn(draft, objectId, lineId, (line) => ({
          ...line,
          highlights: (line.highlights ?? []).map((h) => (h.id === highlightId ? { ...h, color } : h)),
        })),
      ),

    addAnnotation: (objectId, lineId, start, end, color, fontFamily, fontSize) => {
      const id = createRangeId();
      mutate((draft) =>
        updateLineIn(draft, objectId, lineId, (line) => ({
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
        updateLineIn(draft, objectId, lineId, (line) => ({
          ...line,
          annotations: (line.annotations ?? []).map((a) => (a.id === annotationId ? { ...a, color } : a)),
        })),
      ),

    updateAnnotationFontFamily: (objectId, lineId, annotationId, fontFamily) =>
      mutate((draft) =>
        updateLineIn(draft, objectId, lineId, (line) => ({
          ...line,
          annotations: (line.annotations ?? []).map((a) => (a.id === annotationId ? { ...a, fontFamily } : a)),
        })),
      ),

    updateAnnotationFontSize: (objectId, lineId, annotationId, fontSize) =>
      mutate((draft) =>
        updateLineIn(draft, objectId, lineId, (line) => ({
          ...line,
          annotations: (line.annotations ?? []).map((a) => (a.id === annotationId ? { ...a, fontSize } : a)),
        })),
      ),

    updateAnnotationText: (objectId, lineId, annotationId, text) =>
      mutate((draft) =>
        updateLineIn(draft, objectId, lineId, (line) => ({
          ...line,
          annotations: (line.annotations ?? []).map((a) => {
            if (a.id !== annotationId) return a;
            // 본문 텍스트 편집과 동일한 원리: 텍스트가 바뀐 만큼 이 annotation 자신의
            // 형광펜 구간 오프셋도 remapHighlightsForEdit로 함께 보정한다(별도 시스템이
            // 아니라 highlightModel.ts의 같은 제네릭 함수를 그대로 재사용).
            const nextHighlights = remapHighlightsForEdit(a.highlights, a.text, text);
            return { ...a, text, highlights: nextHighlights };
          }),
        })), `annotation-text:${objectId}:${lineId}:${annotationId}`),

    updateAnnotationOffset: (objectId, lineId, annotationId, offsetX) =>
      mutate((draft) =>
        updateLineIn(draft, objectId, lineId, (line) => ({
          ...line,
          annotations: (line.annotations ?? []).map((a) => (a.id === annotationId ? { ...a, offsetX } : a)),
        })), `annotation-offset:${objectId}:${lineId}:${annotationId}`),

    addAnnotationHighlight: (objectId, lineId, annotationId, start, end, color) =>
      mutate((draft) =>
        updateLineIn(draft, objectId, lineId, (line) => ({
          ...line,
          annotations: (line.annotations ?? []).map((a) => {
            if (a.id !== annotationId || end <= start) return a;
            // 본문 addHighlightSegments와 동일한 이유로 paintOverHighlights를 쓴다.
            return { ...a, highlights: paintOverHighlights(a.highlights, start, end, color) };
          }),
        })),
      ),

    removeAnnotationHighlight: (objectId, lineId, annotationId, highlightId) =>
      mutate((draft) =>
        updateLineIn(draft, objectId, lineId, (line) => ({
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
        updateLineIn(draft, objectId, lineId, (line) => ({
          ...line,
          annotations: (line.annotations ?? []).map((a) => {
            if (a.id !== annotationId || end <= start) return a;
            return { ...a, highlights: eraseHighlightsInRange(a.highlights, start, end) };
          }),
        })),
      ),

    removeAnnotation: (objectId, lineId, annotationId) =>
      mutate((draft) =>
        updateLineIn(draft, objectId, lineId, (line) => ({
          ...line,
          annotations: (line.annotations ?? []).filter((a) => a.id !== annotationId),
        })),
      ),

    getOrderedObjects: () => Object.values(get().objects).sort((a, b) => a.zIndex - b.zIndex),

    nextZIndex: () => {
      const objects = Object.values(get().objects);
      return objects.reduce((max, o) => Math.max(max, o.zIndex), 0) + 1;
    },

    bringToFront: (id) =>
      mutate((draft) => {
        const target = draft[id];
        if (!target) return;
        const maxOther = Object.values(draft).reduce(
          (max, o) => (o.id === id ? max : Math.max(max, o.zIndex)),
          -Infinity,
        );
        if (target.zIndex > maxOther) return; // 이미 맨 앞
        target.zIndex = maxOther + 1;
        target.updatedAt = now();
      }, `zorder:${id}`),

    sendToBack: (id) =>
      mutate((draft) => {
        const target = draft[id];
        if (!target) return;
        const minOther = Object.values(draft).reduce(
          (min, o) => (o.id === id ? min : Math.min(min, o.zIndex)),
          Infinity,
        );
        if (target.zIndex < minOther) return; // 이미 맨 뒤
        target.zIndex = minOther - 1;
        target.updatedAt = now();
      }, `zorder:${id}`),

    bringForward: (id) =>
      mutate((draft) => {
        const target = draft[id];
        if (!target) return;
        let next: CanvasObject | null = null;
        for (const o of Object.values(draft)) {
          if (o.id === id) continue;
          if (o.zIndex > target.zIndex && (!next || o.zIndex < next.zIndex)) next = o;
        }
        if (!next) return; // 이미 맨 앞
        const swap = target.zIndex;
        target.zIndex = next.zIndex;
        next.zIndex = swap;
        target.updatedAt = now();
        next.updatedAt = now();
      }, `zorder:${id}`),

    sendBackward: (id) =>
      mutate((draft) => {
        const target = draft[id];
        if (!target) return;
        let prev: CanvasObject | null = null;
        for (const o of Object.values(draft)) {
          if (o.id === id) continue;
          if (o.zIndex < target.zIndex && (!prev || o.zIndex > prev.zIndex)) prev = o;
        }
        if (!prev) return; // 이미 맨 뒤
        const swap = target.zIndex;
        target.zIndex = prev.zIndex;
        prev.zIndex = swap;
        target.updatedAt = now();
        prev.updatedAt = now();
      }, `zorder:${id}`),
  };
});
