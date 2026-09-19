import { create } from 'zustand';
import { produceWithPatches } from 'immer';
import type { CanvasObject, ImageHighlight, TableCell, TextObject } from '../types/object';
import {
  atomicRangeFor,
  ensureColBoundary,
  ensureRowBoundary,
  equalizeRange,
  hitTestBorder,
  mergeCells,
  remapCellsAfterColInsert,
  remapCellsAfterRowInsert,
  splitCellsAtCol,
  splitCellsAtRow,
} from '../objects/table/tableGeometry';
import type { TextAnnotation, TextHighlight, TextLine } from '../objects/text/indentation/types';
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
  return obj.type === 'text' || obj.type === 'image' || obj.type === 'arrow' || obj.type === 'rectangle' || obj.type === 'table';
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
  if (!existing) return;
  if (existing.type === 'text') {
    const idx = existing.lines.findIndex((l) => l.id === lineId);
    if (idx === -1) return;
    existing.lines[idx] = updater(existing.lines[idx]);
    existing.updatedAt = now();
    return;
  }
  // 요구사항(표 셀 형광펜/주석): TableObject는 자기 lines를 직접 갖지 않고 각
  // cell.lines에 나눠 들고 있다 — 어느 cell에 속한 줄인지 찾아서 그 cell 안에서만
  // 교체한다. text 객체와 갈라둔 이유: TableCell은 TextLine과 달리 그 자체로
  // draft에서 바로 찾을 수 있는 최상위 배열이 아니라 cells[] 안에 중첩돼 있기
  // 때문 — 나머지(줄 하나를 새 값으로 교체)는 완전히 같은 원리다.
  if (existing.type === 'table') {
    for (const cell of existing.cells) {
      const idx = cell.lines.findIndex((l) => l.id === lineId);
      if (idx !== -1) {
        cell.lines[idx] = updater(cell.lines[idx]);
        existing.updatedAt = now();
        return;
      }
    }
  }
}

/**
 * addHighlightSegments/eraseHighlightSegments가 공유하는 순회 헬퍼: text 객체(최상위
 * lines)와 table 객체(각 cell.lines) 모두를 아우른다 — fn이 각 줄을 검사해서 바뀐
 * 줄이 있으면 set()으로 그 자리에 바로 반영한다(draft 위 직접 mutate). 이 함수
 * 하나만 두 타입을 알면, 호출부(addHighlightSegments 등)는 "이 objectId가 가진
 * 모든 줄"이라는 개념만 다루면 되고 text/table 분기를 반복하지 않아도 된다.
 */
function forEachLineMut(
  existing: CanvasObject,
  fn: (line: TextLine, set: (next: TextLine) => void) => void,
): void {
  if (existing.type === 'text') {
    for (let i = 0; i < existing.lines.length; i++) {
      const idx = i;
      fn(existing.lines[idx], (next) => {
        existing.lines[idx] = next;
      });
    }
  } else if (existing.type === 'table') {
    for (const cell of existing.cells) {
      for (let i = 0; i < cell.lines.length; i++) {
        const idx = i;
        fn(cell.lines[idx], (next) => {
          cell.lines[idx] = next;
        });
      }
    }
  }
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
  /** ImageObject 전용: resizeObjectTo와 같은 원리로 box(x/y/width/height)를 갱신하면서,
   * 동시에 자연 픽셀 기준 크롭 영역(cropX/Y/Width/Height)도 함께 갱신한다
   * (canvas/interaction/useImageCrop.ts, cropMath.ts 참고). */
  cropObjectTo: (
    id: string,
    box: { x: number; y: number; width: number; height: number },
    crop: { cropX: number; cropY: number; cropWidth: number; cropHeight: number },
  ) => void;
  /** TextObject 전용: lines 배열을 통째로 교체한다 (Enter/Backspace/anchor 갱신 등). */
  setTextLines: (id: string, lines: TextLine[]) => void;

  /**
   * 표(Table) 전용 mutator들. 좌표는 모두 "이 표의 좌상단 기준 로컬 world px"로
   * 받는다(호출부인 canvas/interaction/useTableDrawTool.ts 등이 world→local 변환을
   * 담당) — objects/table/tableGeometry.ts의 순수 함수를 그대로 감싼다.
   */
  splitTableRow: (id: string, localY: number, colFromLocal: number, colToLocal: number) => void;
  splitTableCol: (id: string, localX: number, rowFromLocal: number, rowToLocal: number) => void;
  /** 정확히 그 위치(localX, localY, tolerance 안)에 지울 수 있는 경계가 있으면 병합하고
   * true를 반환한다. 없으면 아무것도 하지 않고 false(요구사항: "선 위일 때만" 지워짐 —
   * 가장 가까운 선으로 스냅하지 않음). */
  mergeTableBorder: (id: string, localX: number, localY: number, tolerance: number) => boolean;
  equalizeTableRows: (id: string, fromLocal: number, toLocal: number) => void;
  equalizeTableCols: (id: string, fromLocal: number, toLocal: number) => void;
  updateTableCellLines: (id: string, cellId: string, lines: TextLine[]) => void;
  /** 요구사항(표 텍스트 글꼴/크기/색상/굵기): cellIds에 담긴 셀들에만 균일하게
   * patch를 적용한다 — PropertiesPanel.tsx의 TableSection이 '범위 선택돼 있으면
   * 그 셀들만, 없으면 표 전체 셀'로 cellIds를 골라 넘긴다. */
  updateTableCellsStyle: (
    id: string,
    cellIds: string[],
    patch: Partial<Pick<TableCell, 'fontFamily' | 'fontSize' | 'color' | 'bold'>>,
  ) => void;

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
  /**
   * 요구사항(2026-09-15, 주석 하나만 복사/붙여넣기): 이미 존재하는 주석 하나의
   * 텍스트/색/글꼴/크기/형광펜을 annotationClipboardStore에 복사해둔 내용으로 통째로
   * 덮어쓴다 — 새 주석을 만드는 게 아니라 "지금 편집 중인(방금 클릭으로 만든 빈)
   * 주석"에 그대로 적용하는 용도(AnnotationBubble.tsx의 onPaste → TextObjectView.tsx의
   * onPasteAnnotation 참고). updateAnnotationColor/FontFamily/FontSize/Text를 각각
   * 따로 호출하면 undo 단계가 그만큼 쪼개지므로, 붙여넣기 한 번 = undo 한 단계가
   * 되도록 단일 mutate 호출로 처리한다.
   */
  applyAnnotationClipboard: (
    objectId: string,
    lineId: string,
    annotationId: string,
    content: { text: string; color?: string; fontFamily?: string; fontSize?: number; highlights?: TextHighlight[] },
  ) => void;
  /** Phase 8(스타일 패널): 이미 만들어진 주석 하나의 색만 바꾼다 — updateHighlightColor와 동일한 원리. */
  updateAnnotationColor: (objectId: string, lineId: string, annotationId: string, color: string) => void;
  /** 요구사항(폰트 목록 통합): 이미 만들어진 주석 하나의 글꼴만 바꾼다 — updateAnnotationColor와 동일한 원리. */
  updateAnnotationFontFamily: (objectId: string, lineId: string, annotationId: string, fontFamily: string) => void;
  /** 요구사항(주석 크기 조절): 이미 만들어진 주석 하나의 글자 크기만 바꾼다 — updateAnnotationFontFamily와 동일한 원리. */
  updateAnnotationFontSize: (objectId: string, lineId: string, annotationId: string, fontSize: number) => void;
  /** Annotation을 드래그해서 옮길 때 offsetX/offsetY를 갱신한다(anchor/start/end는 그대로
   * — target Text와의 연결 유지). 요구사항(2026-09-09, 주석 아래 배치): 가로 드래그와
   * 세로 드래그가 동시에 진행될 수 있어(AnnotationBubble.tsx의 pointermove가 dx/dy를
   * 함께 계산) 두 값을 항상 같이 반영한다. */
  updateAnnotationOffset: (objectId: string, lineId: string, annotationId: string, offsetX: number, offsetY: number) => void;
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
   * 요구사항(이미지 전용 직선 형광펜): x1/y1/x2/y2는 모두 해당 ImageObject의
   * width/height에 대한 비율(0~1) — useImageHighlightTool.ts가 드래그 시작/끝점을
   * 그 시점의 object.width/height로 나눠서 넘긴다. thicknessRatio도 같은 이유로
   * 절대 px가 아니라 비율(objects/image/imageHighlightGeometry.ts의 thicknessRatioFor).
   */
  addImageHighlight: (
    objectId: string,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    thicknessRatio: number,
  ) => void;
  /** 요구사항(이미지 형광펜 지우개): id로 콕 집어 여러 개를 한 번에 제거한다
   * (useImageHighlightTool.ts가 드래그 선분과 겹치는 하이라이트들을 미리 골라 넘긴다). */
  removeImageHighlights: (objectId: string, highlightIds: string[]) => void;

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

  /** 요구사항(객체 잠금): 켜면 이동/크기조절/삭제/내용 편집을 막는다(선택/우클릭은 계속 가능). */
  setLocked: (id: string, locked: boolean) => void;

  /**
   * 요구사항(Ctrl+G 그룹화): 넘어온 id들에 새 groupId를 부여해 "가벼운 그룹"으로
   * 묶는다. 2개 미만이면 묶을 의미가 없으므로 호출부(useGroupShortcut)가 미리
   * 걸러야 하지만, 여기서도 방어적으로 무시한다. 반환값은 새로 만든 groupId.
   */
  groupObjects: (ids: string[]) => string | null;
  /**
   * 넘어온 id들이 속한 그룹(들)을 완전히 해제한다 — 그 그룹에 속한 모든 멤버의
   * groupId를 지운다(넘어온 id가 아니라 "그 그룹 전체"가 대상 — Figma 등과 동일한 관례).
   */
  ungroupObjects: (ids: string[]) => void;
  /** id가 속한 그룹의 전체 멤버 id 목록을 반환한다(그룹이 없으면 [id] 하나만).
   * useObjectDrag/useObjectDeleteShortcut이 "그룹째 함께 이동/삭제"할 때 쓴다. */
  getGroupMemberIds: (id: string) => string[];
  /**
   * 요구사항(Frame 이동 시 모든 자식 함께 선택): frameId가 이 Frame을 가리키는
   * 모든 객체의 id를 타입 무관(Text/Image/Arrow/Rectangle 전부, hasFrameId 기준)하게
   * 반환한다. frameId가 이 Frame과 실제로 일치하는 객체만 대상이라, 시각적으로
   * Frame 위에 놓여 있어도 frameId가 다르거나 없으면(자유 배치) 포함되지 않는다 —
   * 이 프로젝트는 "자유 배치형" 캔버스라 위치가 아니라 논리적 소속(frameId)만을
   * 기준으로 삼는다(FrameObjectView.tsx/moveObjectTo cascade와 동일한 기준).
   * useObjectDrag.ts가 Frame 드래그가 실제로 시작되는 시점에 이 목록을 selectedIds에
   * 합쳐서 "함께 선택됨"으로 보이게 한다.
   */
  getFrameChildIds: (frameId: string) => string[];

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
        // 버그 수정(리사이즈 직후 F5 하면 텍스트 상자가 내용 크기로 다시 커짐):
        // 세로 크기가 실제로 바뀌는 리사이즈라면(타입/사이즈 무관하게 x/y/width만
        // 바뀌는 리사이즈는 해당 없음) TextObject에 한해 "사용자가 높이를 직접
        // 정했다"고 기록해둔다 — objects/text/TextObjectView.tsx의 자동 높이
        // 로직이 이 플래그를 보고 더 이상 개입하지 않는다(types/object.ts의
        // TextObject.manualHeight 주석 참고).
        if (target.type === 'text' && target.height !== box.height) {
          target.manualHeight = true;
        }
        // 요구사항(표 리사이즈): 8방향 핸들로 표 전체 크기를 바꾸면 세부 행/열
        // 크기가 비율대로 함께 늘어나거나 줄어든다(엑셀/한글과 동일한 관례).
        if (target.type === 'table') {
          const scaleX = target.width > 0 ? box.width / target.width : 1;
          const scaleY = target.height > 0 ? box.height / target.height : 1;
          target.colSizes = target.colSizes.map((w) => w * scaleX);
          target.rowSizes = target.rowSizes.map((h) => h * scaleY);
        }
        target.x = box.x;
        target.y = box.y;
        target.width = box.width;
        target.height = box.height;
        target.updatedAt = now();
      }, `resize:${id}`),

    cropObjectTo: (id, box, crop) =>
      mutate((draft) => {
        const target = draft[id];
        if (!target || target.type !== 'image') return;
        target.x = box.x;
        target.y = box.y;
        target.width = box.width;
        target.height = box.height;
        target.cropX = crop.cropX;
        target.cropY = crop.cropY;
        target.cropWidth = crop.cropWidth;
        target.cropHeight = crop.cropHeight;
        target.updatedAt = now();
      }, `crop:${id}`),

    setTextLines: (id, lines) =>
      mutate((draft) => {
        const existing = draft[id];
        if (!existing || existing.type !== 'text') return;
        (existing as TextObject).lines = lines;
        existing.updatedAt = now();
      }, `text:${id}`),

    splitTableRow: (id, localY, colFromLocal, colToLocal) =>
      mutate((draft) => {
        const target = draft[id];
        if (!target || target.type !== 'table') return;
        const before = target.rowSizes;
        const { rowSizes, index } = ensureRowBoundary(target.rowSizes, localY);
        let cells: TableCell[] = target.cells;
        if (rowSizes !== before) cells = remapCellsAfterRowInsert(cells, index);
        const { from, to } = atomicRangeFor(target.colSizes, colFromLocal, colToLocal);
        target.rowSizes = rowSizes;
        target.cells = splitCellsAtRow(cells, index, from, to + 1);
        target.updatedAt = now();
      }, `table-split-row:${id}`),

    splitTableCol: (id, localX, rowFromLocal, rowToLocal) =>
      mutate((draft) => {
        const target = draft[id];
        if (!target || target.type !== 'table') return;
        const before = target.colSizes;
        const { colSizes, index } = ensureColBoundary(target.colSizes, localX);
        let cells: TableCell[] = target.cells;
        if (colSizes !== before) cells = remapCellsAfterColInsert(cells, index);
        const { from, to } = atomicRangeFor(target.rowSizes, rowFromLocal, rowToLocal);
        target.colSizes = colSizes;
        target.cells = splitCellsAtCol(cells, index, from, to + 1);
        target.updatedAt = now();
      }, `table-split-col:${id}`),

    mergeTableBorder: (id, localX, localY, tolerance) => {
      const target = get().objects[id];
      if (!target || target.type !== 'table') return false;
      const border = hitTestBorder(target, localX, localY, tolerance);
      if (!border) return false;
      mutate((draft) => {
        const t = draft[id];
        if (!t || t.type !== 'table') return;
        t.cells = mergeCells(t.cells, border);
        t.updatedAt = now();
      });
      return true;
    },

    equalizeTableRows: (id, fromLocal, toLocal) =>
      mutate((draft) => {
        const target = draft[id];
        if (!target || target.type !== 'table') return;
        const { from, to } = atomicRangeFor(target.rowSizes, fromLocal, toLocal);
        target.rowSizes = equalizeRange(target.rowSizes, from, to);
        target.updatedAt = now();
      }, `table-eq-row:${id}`),

    equalizeTableCols: (id, fromLocal, toLocal) =>
      mutate((draft) => {
        const target = draft[id];
        if (!target || target.type !== 'table') return;
        const { from, to } = atomicRangeFor(target.colSizes, fromLocal, toLocal);
        target.colSizes = equalizeRange(target.colSizes, from, to);
        target.updatedAt = now();
      }, `table-eq-col:${id}`),

    updateTableCellLines: (id, cellId, lines) =>
      mutate((draft) => {
        const target = draft[id];
        if (!target || target.type !== 'table') return;
        const cell = target.cells.find((c) => c.id === cellId);
        if (!cell) return;
        cell.lines = lines;
        target.updatedAt = now();
      }, `table-cell:${id}:${cellId}`),

    updateTableCellsStyle: (id, cellIds, patch) =>
      mutate((draft) => {
        const target = draft[id];
        if (!target || target.type !== 'table') return;
        const idSet = new Set(cellIds);
        for (const cell of target.cells) {
          if (idSet.has(cell.id)) Object.assign(cell, patch);
        }
        target.updatedAt = now();
      }, `table-cell-style:${id}`),

    addHighlightSegments: (segments, color) =>
      mutate((draft) => {
        for (const [objectId, segsByLine] of groupSegmentsByObjectAndLine(segments)) {
          const existing = draft[objectId];
          if (!existing || (existing.type !== 'text' && existing.type !== 'table')) continue;
          let anyChanged = false;
          forEachLineMut(existing, (line, set) => {
            const lineSegs = segsByLine.get(line.id);
            if (!lineSegs) return;
            // 버그 수정: 겹치는/같은 구간을 실수로 다시 드래그해도 하이라이트가
            // 중복 누적되지 않도록, 그냥 추가하는 대신 "새로 칠한 색이 기존 색 위를
            // 덮는다"(paintOverHighlights)로 반영한다.
            let nextHighlights = line.highlights ?? [];
            for (const s of lineSegs) {
              nextHighlights = paintOverHighlights(nextHighlights, s.start, s.end, color);
            }
            set({ ...line, highlights: nextHighlights });
            anyChanged = true;
          });
          if (anyChanged) existing.updatedAt = now();
        }
      }),

    eraseHighlightSegments: (segments) =>
      mutate((draft) => {
        for (const [objectId, segsByLine] of groupSegmentsByObjectAndLine(segments)) {
          const existing = draft[objectId];
          if (!existing || (existing.type !== 'text' && existing.type !== 'table')) continue;
          let anyChanged = false;
          forEachLineMut(existing, (line, set) => {
            const lineSegs = segsByLine.get(line.id);
            if (!lineSegs) return;
            let nextHighlights = line.highlights ?? [];
            for (const s of lineSegs) {
              nextHighlights = eraseHighlightsInRange(nextHighlights, s.start, s.end);
            }
            set({ ...line, highlights: nextHighlights });
            anyChanged = true;
          });
          if (anyChanged) existing.updatedAt = now();
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
            {
              id,
              start,
              end,
              text: '',
              color,
              fontFamily,
              fontSize,
            } as TextAnnotation,
          ],
        })),
      );
      return id;
    },

    // 요구사항(2026-09-15, 주석 하나만 복사/붙여넣기): interface 선언부(위쪽) 주석 참고 —
    // 편집 중인 빈 주석 하나를 복사해둔 내용으로 통째로 덮어쓴다. 단일 mutate 호출이라
    // undo 한 단계로 묶인다.
    applyAnnotationClipboard: (objectId, lineId, annotationId, content) =>
      mutate((draft) =>
        updateLineIn(draft, objectId, lineId, (line) => ({
          ...line,
          annotations: (line.annotations ?? []).map((a) =>
            a.id === annotationId
              ? {
                  ...a,
                  text: content.text,
                  color: content.color ?? a.color,
                  fontFamily: content.fontFamily ?? a.fontFamily,
                  fontSize: content.fontSize ?? a.fontSize,
                  highlights: content.highlights,
                }
              : a,
          ),
        })),
      ),

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

    updateAnnotationOffset: (objectId, lineId, annotationId, offsetX, offsetY) =>
      mutate((draft) =>
        updateLineIn(draft, objectId, lineId, (line) => ({
          ...line,
          annotations: (line.annotations ?? []).map((a) => (a.id === annotationId ? { ...a, offsetX, offsetY } : a)),
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

    addImageHighlight: (objectId, x1, y1, x2, y2, color, thicknessRatio) =>
      mutate((draft) => {
        const existing = draft[objectId];
        if (existing?.type !== 'image') return;
        const highlight: ImageHighlight = { id: createId(), x1, y1, x2, y2, color, thicknessRatio };
        existing.highlights = [...(existing.highlights ?? []), highlight];
        existing.updatedAt = now();
      }),

    removeImageHighlights: (objectId, highlightIds) =>
      mutate((draft) => {
        const existing = draft[objectId];
        if (existing?.type !== 'image' || !existing.highlights?.length) return;
        const idSet = new Set(highlightIds);
        existing.highlights = existing.highlights.filter((h) => !idSet.has(h.id));
        existing.updatedAt = now();
      }),

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

    setLocked: (id, locked) =>
      mutate((draft) => {
        const target = draft[id];
        if (!target || (target.locked ?? false) === locked) return;
        target.locked = locked;
        target.updatedAt = now();
      }),

    groupObjects: (ids) => {
      const uniqueIds = Array.from(new Set(ids));
      if (uniqueIds.length < 2) return null;
      const groupId = createId();
      mutate((draft) => {
        for (const id of uniqueIds) {
          const target = draft[id];
          if (!target) continue;
          target.groupId = groupId;
          target.updatedAt = now();
        }
      });
      return groupId;
    },

    ungroupObjects: (ids) => {
      const objects = get().objects;
      const groupIds = new Set(
        ids.map((id) => objects[id]?.groupId).filter((g): g is string => !!g),
      );
      if (groupIds.size === 0) return;
      mutate((draft) => {
        for (const obj of Object.values(draft)) {
          if (obj.groupId && groupIds.has(obj.groupId)) {
            obj.groupId = null;
            obj.updatedAt = now();
          }
        }
      });
    },

    getGroupMemberIds: (id) => {
      const objects = get().objects;
      const groupId = objects[id]?.groupId;
      if (!groupId) return [id];
      return Object.values(objects)
        .filter((o) => o.groupId === groupId)
        .map((o) => o.id);
    },

    getFrameChildIds: (frameId) => {
      const objects = get().objects;
      return Object.values(objects)
        .filter((o) => hasFrameId(o) && o.frameId === frameId)
        .map((o) => o.id);
    },
  };
});
