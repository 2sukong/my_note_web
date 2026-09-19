import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { TableObject } from '../../types/object';
import { createPlainLine, lineText } from '../text/indentation/types';
import type { TextAnnotation, TextLine } from '../text/indentation/types';
import { useViewportStore } from '../../store/viewportStore';
import { useInteractionStore } from '../../store/interactionStore';
import { useObjectsStore } from '../../store/objectsStore';
import { useTableEditStore } from '../../store/tableEditStore';
import type { TableCellRangeSelection } from '../../store/tableEditStore';
import { useToolStore } from '../../store/toolStore';
import { strokeColorValueFor } from '../shapes/strokeColors';
import { DEFAULT_FONT_FAMILY } from '../text/fontOptions';
import { atomicRangeFor, borderSegments, computeCellRects, expandRangeToCoverCells, findCellAt, prefixSums } from './tableGeometry';
import type { CellRect } from './tableGeometry';
import { DEFAULT_TABLE_TEXT_COLOR, DEFAULT_TABLE_TEXT_FONT_SIZE, TABLE_ERASER_HIT_SCREEN_TOLERANCE } from './tableDefaults';
import { focusLineAt, getCaretOffset, mergeClientRectsByLine, rangeForOffsets } from '../text/domCaret';
import { mergeHighlightsForLineJoin, remapHighlightsForEdit, splitHighlightsAtOffset } from '../text/highlightModel';
import { highlightBackgroundFor } from '../text/highlightColors';
import { fontHeightScaleFor } from '../text/fontMetrics';
import { AnnotationBubble, DEFAULT_ANNOTATION_OFFSET_X_BASE } from '../text/AnnotationBubble';
import type { CopiedAnnotationPayload } from '../../store/annotationClipboardStore';

/** world px. 이보다 짧게 움직이면(사실상 클릭) 그리기/범위선택을 취소한다 —
 * canvas/actions.ts의 MIN_DRAW_DISTANCE와 같은 관례. */
const MIN_DRAW_DISTANCE = 4;

/** AnnotationBubble.tsx/TextObjectView.tsx와 같은 값 — "텍스트 크기 16px일 때"
 * 보기 좋게 튜닝된 fontScale 기준값. 셀마다 글자 크기가 다를 수 있으므로 이 기준
 * 대비 배율을 셀별로 계산해 AnnotationBubble에 그대로 넘긴다(같은 이름 상수를
 * TextObjectView.tsx가 export하지 않아 값만 그대로 복제 — 의미상 공유 상수). */
const REFERENCE_FONT_SIZE = 16;

interface DrawDragState {
  pointerId: number;
  start: { x: number; y: number };
}

interface RangeDragState {
  start: { x: number; y: number };
}

/** 표 셀 안 형광펜 구간 하나를 화면에 그리기 위한 사각형(표 root 기준 local 좌표,
 * TextObjectView.tsx의 HighlightRect와 같은 원리 — 여러 셀/줄에 걸쳐 있을 수 있어
 * 표 컴포넌트 하나가 전체를 모아서 그린다). */
interface CellHighlightRect {
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
  color: string;
}

/** 표 셀 안 주석 하나를 AnnotationBubble로 그리기 위해 필요한 위치 정보 —
 * TextObjectView.tsx의 AnnotationAnchor와 같은 필드를 쓰되, 그 주석이 어느
 * 셀(cellId)에 속하는지만 추가로 들고 있다(콜백에서 objectsStore 호출 시 필요 없고,
 * 표 자체는 필요 없지만 디버깅/향후 확장을 위해 유지). */
interface CellAnnotationAnchor {
  cellId: string;
  lineId: string;
  annotation: TextAnnotation;
  anchorLeft: number;
  top: number;
  height: number;
  left: number;
  maxWidth: number;
  fontScale: number;
}

/**
 * 표(Table) 렌더링 + 그리기/지우개/셀 범위선택 + 셀 텍스트의 형광펜/주석.
 *
 * 요구사항(표를 먼저 선택해야 그리기/지우개 가능, 확정): 상단 툴바의 activeTool과
 * 별개로, 이 표를 더블클릭해서 들어가는 "편집 모드"(tableEditStore.editingTableId)
 * 동안에만 그리기/지우개/셀 범위 드래그 선택이 활성화된다. 편집 모드가 아닐 때는
 * 다른 객체(Image/Shape)와 동일하게 objects/ObjectView.tsx의 공용 drag로 이동/리사이즈만
 * 가능하다(이 컴포넌트는 그냥 셀 내용을 읽기 전용으로 보여줌).
 *
 * 서브모드(tableEditStore.subMode, PropertiesPanel.tsx의 표 편집 섹션 토글로 전환):
 *  - null(기본): 엑셀처럼 셀을 클릭하면 그 칸에 바로 타이핑(contentEditable)할 수 있고,
 *    드래그하면 셀 범위를 선택한다(간격 통일 버튼의 대상 — cellRangeSelection).
 *  - 'draw': 펜으로 드래그한 방향(가로/세로 중 더 많이 움직인 쪽)에 따라 가로/세로
 *    선을 하나 추가한다(부분 선 포함 — objects/table/tableGeometry.ts splitCellsAtRow/Col).
 *  - 'erase': 드래그하는 동안 정확히 경계선 위(hitTestBorder의 tolerance 안)를 지나가면
 *    그 경계를 지우고 인접 셀을 병합한다(요구사항: 가장 가까운 선으로 스냅하지 않음).
 *
 * 요구사항(표 셀 안 형광펜/주석, 2026-09-18): 본문 TextObject와 같은 원리(TextLine의
 * highlights/annotations, useTextSelectionTools.ts의 전역 드래그 캡처, AnnotationBubble
 * 컴포넌트)를 그대로 재사용한다 — 다른 시스템을 새로 만들지 않는다. 다른 점은 셀 하나가
 * 이제 "진짜 여러 줄"(TextLine[])을 가질 수 있다는 것(Enter로 줄바꿈)과, 형광펜/주석
 * 드래그 선택은 한 셀 안으로만 제한된다는 것(useTextSelectionTools.ts의
 * restrictSegmentsToOneTableCell 참고) — 행 높이는 고정이라(요구사항) 줄이 늘어나도
 * 자동으로 커지지 않고 넘치는 내용은 그대로 잘린다(overflow: hidden, 기존과 동일).
 */
export function TableObjectView({ object }: { object: TableObject }) {
  const zoom = useViewportStore((s) => s.zoom);
  const selectedIds = useInteractionStore((s) => s.selectedIds);
  const fineSelection = useInteractionStore((s) => s.fineSelection);
  const mode = useInteractionStore((s) => s.mode);
  const editingTableId = useTableEditStore((s) => s.editingTableId);
  const subMode = useTableEditStore((s) => s.subMode);
  const cellRangeSelection = useTableEditStore((s) => s.cellRangeSelection);
  const enterEditMode = useTableEditStore((s) => s.enterEditMode);
  const exitEditMode = useTableEditStore((s) => s.exitEditMode);
  const setCellRangeSelection = useTableEditStore((s) => s.setCellRangeSelection);

  const isEditing = editingTableId === object.id;
  const rootRef = useRef<HTMLDivElement>(null);
  const drawRef = useRef<DrawDragState | null>(null);
  const rangeDragRef = useRef<RangeDragState | null>(null);
  // 요구사항(셀 내부를 더블클릭하면 바로 그 칸에 타이핑 시작): 더블클릭 시점에
  // 어떤 셀을 눌렀는지 기록해뒀다가, enterEditMode로 편집 모드에 들어가 그 셀이
  // 실제로 editable해진 다음(아래 useEffect, isEditing이 true로 바뀐 뒤) 그 셀의
  // 마지막 줄 DOM에 포커스 + 커서를 놓는다 — cellLineElsRef가 각 TableCellText의
  // 줄(line)별 DOM을 cellId → (lineId → element) 형태로 보관한다(셀 하나가 여러
  // 줄을 가질 수 있게 되면서 cellId 하나만으로는 어떤 DOM인지 정할 수 없어졌다).
  const cellLineElsRef = useRef<Map<string, Map<string, HTMLDivElement>>>(new Map());
  const pendingFocusCellIdRef = useRef<string | null>(null);
  // 요구사항(주석): "한 번도 내용을 친 적 없는 주석에서 다시 비우면 자동 삭제"
  // 판정에 쓰는 seasoned 기록 — TextObjectView.tsx의 annotationSeasonedRef와 같은
  // 원리. annotation.id는 항상 crypto.randomUUID()라 표 전체에서 하나의 Set을
  // 공유해도 셀끼리 서로 섞이지 않는다.
  const annotationSeasonedRef = useRef<Set<string>>(new Set());
  const [drawPreview, setDrawPreview] = useState<{
    orientation: 'horizontal' | 'vertical';
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
  const [highlightRects, setHighlightRects] = useState<CellHighlightRect[]>([]);
  const [annotationAnchors, setAnnotationAnchors] = useState<CellAnnotationAnchor[]>([]);

  const cellRects = computeCellRects(object);

  // 편집 모드 중 이 표가 선택 해제되면(다른 객체 선택, 빈 캔버스 클릭 등) 자동으로 나간다 —
  // 그래야 편집 모드가 남의 표나 선택되지 않은 상태에 계속 걸려있는 일이 없다.
  useEffect(() => {
    if (isEditing && !selectedIds.includes(object.id)) exitEditMode();
  }, [isEditing, selectedIds, object.id, exitEditMode]);

  useEffect(() => {
    if (!isEditing) return;
    const cellId = pendingFocusCellIdRef.current;
    pendingFocusCellIdRef.current = null;
    if (!cellId) return;
    const cell = object.cells.find((c) => c.id === cellId);
    const lastLine = cell?.lines[cell.lines.length - 1];
    if (!cell || !lastLine) return;
    const el = cellLineElsRef.current.get(cellId)?.get(lastLine.id);
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [isEditing, object.cells]);

  // Escape로 편집 모드만 빠져나온다(선택 자체는 유지 — 다른 객체의 Escape 처리와
  // 마찬가지로 "한 단계만" 취소하는 편이 자연스럽다).
  useEffect(() => {
    if (!isEditing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitEditMode();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isEditing, exitEditMode]);

  // 요구사항(표 셀 형광펜/주석): 커밋된 형광펜/주석의 실제 화면 위치를 매 렌더마다
  // 다시 측정한다 — TextObjectView.tsx의 같은 이름 effect와 정확히 같은 원리(줄 DOM의
  // getClientRects를 표 root 기준 local 좌표로 변환)다. 다른 점은 대상이 object.lines
  // 하나가 아니라 object.cells[].lines 전부라는 것뿐. 행 높이가 고정이라(요구사항)
  // 주석이 들어갈 자리를 미리 확보하는 로직(reservedSpaceForLine 등)은 필요 없다 —
  // 말풍선은 그냥 표 위에 자유롭게 겹쳐 그려진다(본문과 동일한 동작으로 확정됨).
  useLayoutEffect(() => {
    const rootEl = rootRef.current;
    if (!rootEl) {
      setHighlightRects((prev) => (prev.length === 0 ? prev : []));
      setAnnotationAnchors((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const containerRect = rootEl.getBoundingClientRect();
    const originLeft = containerRect.left + rootEl.clientLeft * zoom;
    const originTop = containerRect.top + rootEl.clientTop * zoom;
    const nextRects: CellHighlightRect[] = [];
    const nextAnchors: CellAnnotationAnchor[] = [];

    for (const rect of cellRects) {
      const cell = rect.cell;
      const lineMap = cellLineElsRef.current.get(cell.id);
      if (!lineMap) continue;
      for (const line of cell.lines) {
        const el = lineMap.get(line.id);
        if (!el) continue;
        const textLen = el.textContent?.length ?? 0;

        for (const h of line.highlights ?? []) {
          const start = Math.max(0, Math.min(h.start, textLen));
          const end = Math.max(0, Math.min(h.end, textLen));
          if (end <= start) continue;
          const range = rangeForOffsets(el, start, end);
          if (!range) continue;
          const rects = mergeClientRectsByLine(range.getClientRects());
          for (let i = 0; i < rects.length; i++) {
            const r = rects[i];
            if (r.width <= 0 || r.height <= 0) continue;
            nextRects.push({
              key: `${h.id}-${i}`,
              left: (r.left - originLeft) / zoom,
              top: (r.top - originTop) / zoom,
              width: r.width / zoom,
              height: r.height / zoom,
              color: h.color,
            });
          }
        }

        for (const a of line.annotations ?? []) {
          const start = Math.max(0, Math.min(a.start, textLen));
          const end = Math.max(0, Math.min(a.end, textLen));
          if (end <= start) continue;
          const range = rangeForOffsets(el, start, end);
          if (!range) continue;
          const r = range.getBoundingClientRect();
          if (r.width <= 0 && r.height <= 0) continue;
          const anchorLeft = (r.left - originLeft) / zoom;
          const top = (r.top - originTop) / zoom;
          const height = r.height / zoom;
          const rawLeft = anchorLeft + (a.offsetX ?? DEFAULT_ANNOTATION_OFFSET_X_BASE);
          // 요구사항(주석은 표 위/아래로 자유롭게 배치): 가로 위치만 이 셀의 가로
          // 범위 안으로 clamp한다(TextObjectView.tsx가 target Text 폭으로 clamp하는
          // 것과 같은 이유 — 말풍선이 옆 셀 너머로 한없이 밀려나지 않게). 세로는
          // 전혀 clamp하지 않는다 — 위/아래로 표를 벗어나 옆 행과 겹쳐도 그대로 둔다
          // (확정된 요구사항: 본문과 동일하게 자유 배치).
          const cellLeft = rect.x;
          const cellRight = rect.x + rect.width;
          const left = Math.max(cellLeft, Math.min(rawLeft, cellRight));
          const maxWidth = Math.max(40, cellRight - left);
          const fontScale =
            ((cell.fontSize ?? DEFAULT_TABLE_TEXT_FONT_SIZE) / REFERENCE_FONT_SIZE) *
            fontHeightScaleFor(cell.fontFamily || DEFAULT_FONT_FAMILY);
          nextAnchors.push({ cellId: cell.id, lineId: line.id, annotation: a, anchorLeft, top, height, left, maxWidth, fontScale });
        }
      }
    }

    setHighlightRects(nextRects);
    setAnnotationAnchors(nextAnchors);
    // 버그 수정(oxlint react-hooks/exhaustive-deps): deps 배열이 없으면 매 렌더마다
    // 다시 실행되고, setState가 매번 "내용은 같아도 참조는 새로운" 배열을 만들어
    // 넘기므로 매번 리렌더를 유발해 무한 루프가 된다. object.cells/rowSizes/colSizes/
    // zoom이 바뀔 때만(=실제로 형광펜/주석 위치가 달라질 수 있을 때만) 다시 계산한다 —
    // cellRects는 이 값들만으로 순수하게 계산되므로 deps에 따로 넣지 않아도 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [object.cells, object.rowSizes, object.colSizes, zoom]);

  const localFromClient = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom };
  };

  // 요구사항(표 안에서 셀 범위를 드래그로 선택, 엑셀처럼): subMode가 null(기본)일 때만
  // 활성화된다. 개별 셀의 contentEditable 위 pointerdown 자체는 막지 않아서(caret 배치를
  // 위한 기본 브라우저 동작이 그대로 동작) 클릭 한 번은 항상 타이핑 커서로 이어지고,
  // MIN_DRAW_DISTANCE 이상 움직여야만 범위 선택로 전환된다.
  useEffect(() => {
    if (!isEditing || subMode !== null) return;
    const onMove = (e: PointerEvent) => {
      const ref = rangeDragRef.current;
      if (!ref) return;
      const local = localFromClient(e.clientX, e.clientY);
      if (!local) return;
      const dx = local.x - ref.start.x;
      const dy = local.y - ref.start.y;
      if (Math.hypot(dx, dy) < MIN_DRAW_DISTANCE) return;
      // 드래그로 인정되는 순간부터는 브라우저 기본 텍스트 선택이 여러 셀에 걸쳐
      // 지저분하게 남는 것을 방지한다.
      window.getSelection()?.removeAllRanges();
      const rowRange = atomicRangeFor(object.rowSizes, ref.start.y, local.y);
      const colRange = atomicRangeFor(object.colSizes, ref.start.x, local.x);
      // 지우개로 병합된 셀 위를 드래그가 지나가면(rowSpan/colSpan > 1) 그 셀의
      // 일부 atomic 조각만이 아니라 셀 전체가 선택 범위에 포함되도록 넓힌다
      // (tableGeometry.ts의 expandRangeToCoverCells 주석 참고).
      const expanded = expandRangeToCoverCells(
        object.cells,
        rowRange.from,
        rowRange.to,
        colRange.from,
        colRange.to,
      );
      setCellRangeSelection({
        tableId: object.id,
        rowFrom: expanded.rowFrom,
        rowTo: expanded.rowTo,
        colFrom: expanded.colFrom,
        colTo: expanded.colTo,
      });
    };
    const onUp = () => {
      rangeDragRef.current = null;
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing, subMode, object.id, object.rowSizes, object.colSizes, zoom]);

  const handleDoubleClick = (e: ReactMouseEvent) => {
    if (isEditing) return;
    e.stopPropagation();
    const local = localFromClient(e.clientX, e.clientY);
    const cell = local ? findCellAt(object, local.x, local.y) : null;
    pendingFocusCellIdRef.current = cell?.id ?? null;
    useInteractionStore.getState().select(object.id);
    enterEditMode(object.id);
  };

  const handleCellPointerDown = (local: { x: number; y: number }) => {
    if (!isEditing || subMode !== null) return;
    rangeDragRef.current = { start: local };
    // 새 클릭/드래그가 시작되면 이전 범위 선택은 우선 지운다(엑셀과 동일 — 드래그가
    // 확정되면 위 pointermove 리스너가 곧바로 새 값으로 다시 채운다).
    setCellRangeSelection(null);
  };

  // 요구사항(표 그리기: 부분 선): 드래그 방향(더 많이 움직인 축)으로 가로/세로를
  // 정한다 — 가로로 더 움직였으면 가로선(행 경계), 세로로 더 움직였으면 세로선(열 경계).
  const handleDrawPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const local = localFromClient(e.clientX, e.clientY);
    if (!local) return;
    drawRef.current = { pointerId: e.pointerId, start: local };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrawPreview(null);
  };

  const handleDrawPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const ref = drawRef.current;
    if (!ref || ref.pointerId !== e.pointerId) return;
    const local = localFromClient(e.clientX, e.clientY);
    if (!local) return;
    const dx = local.x - ref.start.x;
    const dy = local.y - ref.start.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      const y = (ref.start.y + local.y) / 2;
      setDrawPreview({ orientation: 'horizontal', x1: Math.min(ref.start.x, local.x), y1: y, x2: Math.max(ref.start.x, local.x), y2: y });
    } else {
      const x = (ref.start.x + local.x) / 2;
      setDrawPreview({ orientation: 'vertical', x1: x, y1: Math.min(ref.start.y, local.y), x2: x, y2: Math.max(ref.start.y, local.y) });
    }
  };

  const handleDrawPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const ref = drawRef.current;
    setDrawPreview(null);
    if (!ref || ref.pointerId !== e.pointerId) return;
    drawRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const local = localFromClient(e.clientX, e.clientY);
    if (!local) return;
    const dx = local.x - ref.start.x;
    const dy = local.y - ref.start.y;
    if (Math.hypot(dx, dy) < MIN_DRAW_DISTANCE) return; // 사실상 클릭 — 무시
    const { splitTableRow, splitTableCol } = useObjectsStore.getState();
    if (Math.abs(dx) >= Math.abs(dy)) {
      const y = (ref.start.y + local.y) / 2;
      splitTableRow(object.id, y, Math.min(ref.start.x, local.x), Math.max(ref.start.x, local.x));
    } else {
      const x = (ref.start.x + local.x) / 2;
      splitTableCol(object.id, x, Math.min(ref.start.y, local.y), Math.max(ref.start.y, local.y));
    }
  };

  const eraseAt = (clientX: number, clientY: number) => {
    const local = localFromClient(clientX, clientY);
    if (!local) return;
    const tolerance = TABLE_ERASER_HIT_SCREEN_TOLERANCE / zoom;
    useObjectsStore.getState().mergeTableBorder(object.id, local.x, local.y, tolerance);
  };

  const handleErasePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    eraseAt(e.clientX, e.clientY);
  };

  const handleErasePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return; // 버튼을 누른 채 드래그할 때만
    eraseAt(e.clientX, e.clientY);
  };

  const handleErasePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const strokeColor = strokeColorValueFor(object.strokeColor);
  const rangeRect = rangeRectFor(object, cellRangeSelection);

  const registerLineRef = (cellId: string, lineId: string, el: HTMLDivElement | null) => {
    let map = cellLineElsRef.current.get(cellId);
    if (!map) {
      map = new Map();
      cellLineElsRef.current.set(cellId, map);
    }
    if (el) map.set(lineId, el);
    else map.delete(lineId);
  };

  return (
    <div
      ref={rootRef}
      onDoubleClick={handleDoubleClick}
      style={{ position: 'relative', width: '100%', height: '100%' }}
    >
      {/* 격자선: 요구사항(겉 테두리와 내부 선의 굵기를 동일하게) — borderSegments가
          계산한, 절대 겹치지 않는 유일한 선분들(tableGeometry.ts 참고)을 <line> 여러
          개가 아니라 <path> 하나로 그린다. 선분끼리는 겹치지 않아도, 가로선과 세로선이
          "교차"하는 지점은 필연적으로 겹치는데, 이걸 서로 다른 <line> 엘리먼트로
          그리면 그 교차점에서 각 엘리먼트의 안티앨리어싱이 다시 두 번 합성돼(교차점이
          훨씬 많은 내부 격자가 평균적으로 더 두껍게/진하게 보임) 겉 테두리(교차점이
          모서리 4개뿐)와 두께 차이가 생긴다. 모든 선분을 하나의 path로 합쳐 한 번만
          stroke하면 교차점에서도 두께가 균일하다. */}
      <svg
        width={object.width}
        height={object.height}
        style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible', pointerEvents: 'none' }}
      >
        <path
          d={borderSegments(object)
            .map((seg) => `M${seg.x1} ${seg.y1}L${seg.x2} ${seg.y2}`)
            .join('')}
          stroke={strokeColor}
          strokeWidth={object.strokeWidth}
          fill="none"
          shapeRendering="crispEdges"
        />
        {drawPreview ? (
          <line
            x1={drawPreview.x1}
            y1={drawPreview.y1}
            x2={drawPreview.x2}
            y2={drawPreview.y2}
            stroke="var(--color-accent, #3d7fff)"
            strokeWidth={Math.max(2, object.strokeWidth)}
            strokeDasharray="4 3"
          />
        ) : null}
      </svg>

      {/* 요구사항(표 셀 형광펜): 텍스트보다 뒤, 격자선보다 앞 — TextObjectView.tsx의
          Highlight layer와 같은 자리(글자 뒤에 색만 깔린다). pointer 이벤트를 받지
          않으므로 형광펜을 지우거나 다시 칠하는 클릭/드래그는 항상 그 위의 줄 DOM이
          받는다. */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {highlightRects.map((r) => (
          <div
            key={r.key}
            style={{
              position: 'absolute',
              left: r.left,
              top: r.top,
              width: r.width,
              height: r.height,
              background: highlightBackgroundFor(r.color),
              borderRadius: r.height / 2,
            }}
          />
        ))}
      </div>

      {cellRects.map((rect) => (
        <TableCellText
          key={rect.cell.id}
          tableId={object.id}
          rect={rect}
          editable={isEditing && subMode === null}
          onPointerDownAt={handleCellPointerDown}
          localFromClient={localFromClient}
          registerLineRef={(lineId, el) => registerLineRef(rect.cell.id, lineId, el)}
        />
      ))}

      {/* 요구사항(표 셀 주석): 말풍선+화살표는 TextObjectView.tsx와 완전히 같은
          AnnotationBubble 컴포넌트를 그대로 재사용한다 — objectId로 표 자신의 id를,
          lineId로 그 셀 안의 실제 줄 id를 넘기면 objectsStore의 관련 함수들(이미
          표 셀도 지원하도록 확장됨)이 알아서 올바른 셀의 줄을 찾아 갱신한다. */}
      {annotationAnchors.map(({ lineId, annotation, anchorLeft, top, height, left, maxWidth, fontScale }) => {
        const isSelected =
          fineSelection?.kind === 'annotation' && fineSelection.objectId === object.id && fineSelection.id === annotation.id;
        const isAnnotationEditing = isSelected && mode === 'text-edit';
        return (
          <AnnotationBubble
            key={annotation.id}
            objectId={object.id}
            lineId={lineId}
            annotation={annotation}
            anchor={{ left: anchorLeft, top, height }}
            left={left}
            maxWidth={maxWidth}
            fontScale={fontScale}
            isSelected={isSelected}
            isEditing={isAnnotationEditing}
            onSelect={() =>
              useInteractionStore.getState().selectFine({ kind: 'annotation', objectId: object.id, lineId, id: annotation.id })
            }
            onEnterEdit={() => {
              useInteractionStore.getState().selectFine({ kind: 'annotation', objectId: object.id, lineId, id: annotation.id });
              useInteractionStore.getState().setMode('text-edit');
            }}
            onDragOffsetChange={(offsetX, offsetY) => {
              useObjectsStore.getState().updateAnnotationOffset(object.id, lineId, annotation.id, offsetX, offsetY);
            }}
            // 요구사항: 행 높이가 고정이라(표 셀은 줄이 늘어나도 자동으로 커지지
            // 않기로 확정) 말풍선 높이에 맞춰 위쪽 여백을 확보하는 로직 자체가 필요
            // 없다 — TextObjectView.tsx와 달리 이 콜백은 아무 것도 하지 않는다.
            onHeightChange={() => {}}
            onTextChange={(text) => {
              if (text.trim() !== '') annotationSeasonedRef.current.add(annotation.id);
              if (text.trim() === '' && !annotationSeasonedRef.current.has(annotation.id)) {
                useObjectsStore.getState().removeAnnotation(object.id, lineId, annotation.id);
                useInteractionStore.getState().deselect();
                return;
              }
              useObjectsStore.getState().updateAnnotationText(object.id, lineId, annotation.id, text);
            }}
            onFinishEditing={(text) => {
              if (text.trim() === '' && !annotationSeasonedRef.current.has(annotation.id)) {
                useObjectsStore.getState().removeAnnotation(object.id, lineId, annotation.id);
                useInteractionStore.getState().deselect();
                return;
              }
              useObjectsStore.getState().updateAnnotationText(object.id, lineId, annotation.id, text);
              if (text.trim() !== '') annotationSeasonedRef.current.add(annotation.id);
              useInteractionStore.getState().setMode('select');
            }}
            onCancelEmpty={() => {
              if (annotationSeasonedRef.current.has(annotation.id)) return;
              useObjectsStore.getState().removeAnnotation(object.id, lineId, annotation.id);
              useInteractionStore.getState().deselect();
            }}
            onPasteAnnotation={(copied: CopiedAnnotationPayload) => {
              const highlights = copied.highlights?.map((h) => ({ ...h, id: crypto.randomUUID() }));
              useObjectsStore.getState().applyAnnotationClipboard(object.id, lineId, annotation.id, {
                text: copied.text,
                color: copied.color,
                fontFamily: copied.fontFamily,
                fontSize: copied.fontSize,
                highlights,
              });
              if (copied.text.trim() !== '') annotationSeasonedRef.current.add(annotation.id);
            }}
          />
        );
      })}

      {rangeRect ? (
        <div
          style={{
            position: 'absolute',
            left: rangeRect.x,
            top: rangeRect.y,
            width: rangeRect.width,
            height: rangeRect.height,
            background: 'var(--color-accent-soft)',
            opacity: 0.5,
            border: '1px solid var(--color-border-strong)',
            pointerEvents: 'none',
          }}
        />
      ) : null}

      {isEditing && (subMode === 'draw' || subMode === 'erase') ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            cursor: subMode === 'draw' ? 'crosshair' : 'cell',
            touchAction: 'none',
          }}
          onPointerDown={subMode === 'draw' ? handleDrawPointerDown : handleErasePointerDown}
          onPointerMove={subMode === 'draw' ? handleDrawPointerMove : handleErasePointerMove}
          onPointerUp={subMode === 'draw' ? handleDrawPointerUp : handleErasePointerUp}
          onPointerCancel={subMode === 'draw' ? handleDrawPointerUp : handleErasePointerUp}
        />
      ) : null}
    </div>
  );
}

function TableCellText({
  tableId,
  rect,
  editable,
  onPointerDownAt,
  localFromClient,
  registerLineRef,
}: {
  tableId: string;
  rect: CellRect;
  editable: boolean;
  onPointerDownAt: (local: { x: number; y: number }) => void;
  localFromClient: (clientX: number, clientY: number) => { x: number; y: number } | null;
  registerLineRef: (lineId: string, el: HTMLDivElement | null) => void;
}) {
  // 요구사항(표 셀 형광펜/주석): 형광펜/주석 도구가 켜져 있으면, 이 표가 "편집 모드"
  // (타이핑 가능한 상태)가 아니어도 이 셀의 텍스트를 드래그로 선택할 수 있어야 한다
  // (TextObjectView.tsx의 allowNativeTextSelect와 정확히 같은 원리 — 아무 표나 바로
  // 형광펜을 칠할 수 있어야지, 매번 먼저 더블클릭해서 편집 모드로 들어갈 필요는 없다).
  const activeTool = useToolStore((s) => s.activeTool);
  const allowNativeTextSelect = !editable && (activeTool === 'highlight' || activeTool === 'annotation');

  const lineElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const composingRef = useRef(false);
  const pendingFocusRef = useRef<{ lineId: string; offset: number } | null>(null);
  const lines = rect.cell.lines.length > 0 ? rect.cell.lines : [createPlainLine('')];

  // DOM↔store 동기화: 줄마다 독립적으로 비교/갱신한다(TextObjectView.tsx와 같은
  // 관례) — 이미 DOM 내용이 store와 같으면 손대지 않아 타이핑 중 커서 위치가
  // 보존되고, 조합(IME) 중에는 절대 건드리지 않는다. Enter/Backspace로 줄이
  // 나뉘거나 합쳐진 직후에는 pendingFocusRef에 남겨둔 줄/오프셋으로 캐럿을 옮긴다.
  useLayoutEffect(() => {
    for (const line of lines) {
      const el = lineElsRef.current.get(line.id);
      if (!el) continue;
      if (composingRef.current && document.activeElement === el) continue;
      const text = lineText(line);
      if (el.textContent !== text) el.textContent = text;
    }
    const req = pendingFocusRef.current;
    if (req) {
      pendingFocusRef.current = null;
      const el = lineElsRef.current.get(req.lineId);
      if (el) focusLineAt(el, req.offset);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);

  const commitLines = (nextLines: TextLine[]) => {
    useObjectsStore.getState().updateTableCellLines(tableId, rect.cell.id, nextLines);
  };

  const commitTyping = (lineIndex: number, lineEl: HTMLDivElement) => {
    const current = lines[lineIndex];
    const oldText = lineText(current);
    const newText = lineEl.textContent ?? '';
    if (oldText === newText) return;
    // 요구사항(형광펜/주석이 타이핑 중에도 어긋나지 않게): 본문과 같은 원리로
    // remapHighlightsForEdit이 바뀐 부분(diff)만큼 오프셋을 보정한다.
    const nextHighlights = remapHighlightsForEdit(current.highlights, oldText, newText);
    const nextAnnotations = remapHighlightsForEdit(current.annotations, oldText, newText);
    const next = [...lines];
    next[lineIndex] = {
      ...current,
      runs: newText ? [{ text: newText }] : [],
      highlights: nextHighlights,
      annotations: nextAnnotations,
    };
    commitLines(next);
  };

  const handleEnterKey = (lineIndex: number, lineEl: HTMLDivElement) => {
    const current = lines[lineIndex];
    const fullText = lineEl.textContent ?? '';
    const offset = getCaretOffset(lineEl);
    const beforeText = fullText.slice(0, offset);
    const afterText = fullText.slice(offset);
    // 요구사항(줄이 나뉠 때 형광펜/주석도 함께 나뉘어야 함): TextObjectView.tsx의
    // handleEnter와 같은 원리 — 커서 위치를 가로지르는 구간은 두 조각으로 쪼갠다.
    const { before: hlBefore, after: hlAfter } = splitHighlightsAtOffset(current.highlights, beforeText.length);
    const { before: anBefore, after: anAfter } = splitHighlightsAtOffset(current.annotations, beforeText.length);
    const updatedCurrent: TextLine = {
      ...current,
      runs: beforeText ? [{ text: beforeText }] : [],
      highlights: hlBefore.length ? hlBefore : undefined,
      annotations: anBefore.length ? anBefore : undefined,
    };
    const newLine: TextLine = {
      ...createPlainLine(afterText),
      highlights: hlAfter.length ? hlAfter : undefined,
      annotations: anAfter.length ? anAfter : undefined,
    };
    const next = [...lines];
    next[lineIndex] = updatedCurrent;
    next.splice(lineIndex + 1, 0, newLine);
    pendingFocusRef.current = { lineId: newLine.id, offset: 0 };
    commitLines(next);
  };

  const handleBackspaceAtStart = (lineIndex: number) => {
    if (lineIndex <= 0) return; // 셀의 첫 줄이면 합칠 윗 줄이 없다 — 아무 것도 하지 않는다.
    const prev = lines[lineIndex - 1];
    const current = lines[lineIndex];
    const prevText = lineText(prev);
    const currentText = lineText(current);
    const mergedHighlights = mergeHighlightsForLineJoin(prev.highlights, current.highlights, prevText.length);
    const mergedAnnotations = mergeHighlightsForLineJoin(prev.annotations, current.annotations, prevText.length);
    const mergedText = prevText + currentText;
    const next = [...lines];
    next.splice(lineIndex - 1, 2, {
      ...prev,
      runs: mergedText ? [{ text: mergedText }] : [],
      highlights: mergedHighlights.length ? mergedHighlights : undefined,
      annotations: mergedAnnotations.length ? mergedAnnotations : undefined,
    });
    pendingFocusRef.current = { lineId: prev.id, offset: prevText.length };
    commitLines(next);
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        padding: '2px 6px',
        boxSizing: 'border-box',
        // 요구사항(행 높이 고정 유지): 줄이 늘어나 셀 높이를 넘으면 자동으로 커지지
        // 않고 그대로 잘린다 — 표 전체 레이아웃(행 높이/리사이즈/간격 통일)을 전혀
        // 건드리지 않기 위한 확정된 절충.
        overflow: 'hidden',
        // 요구사항(모든 텍스트는 상자 정가운데, 최초 커서 위치 포함): 이 바깥
        // wrapper(비-편집 영역)만 flex로 상하/좌우 가운데를 잡는다 — flexDirection을
        // column으로 둬서 여러 줄(TextLine[])이 세로로 쌓이면서도 그룹 전체가
        // 가운데 정렬되게 한다(기존엔 줄이 하나뿐이라 필요 없었던 부분).
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: editable ? 'text' : allowNativeTextSelect ? 'text' : 'default',
        pointerEvents: editable || allowNativeTextSelect ? 'auto' : 'none',
      }}
      onPointerDown={(e) => {
        if (!editable) return;
        const local = localFromClient(e.clientX, e.clientY);
        if (local) onPointerDownAt(local);
        // 클릭이 실제 텍스트 블록(inner) 위가 아니라 그 주변 여백(이 wrapper 자신)
        // 에서 일어났으면 브라우저가 contentEditable에 자동으로 포커스를 주지
        // 않으므로 직접 마지막 줄에 포커스하고 caret을 텍스트 끝에 둔다.
        if (e.target === e.currentTarget) {
          const lastLine = lines[lines.length - 1];
          const el = lineElsRef.current.get(lastLine.id);
          if (el && document.activeElement !== el) {
            el.focus();
            const range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
          }
        }
      }}
    >
      {lines.map((line, lineIndex) => (
        <div
          key={line.id}
          ref={(el) => {
            if (el) lineElsRef.current.set(line.id, el);
            else lineElsRef.current.delete(line.id);
            registerLineRef(line.id, el);
          }}
          data-object-id={tableId}
          data-line-id={line.id}
          contentEditable={editable}
          suppressContentEditableWarning
          spellCheck={false}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(e) => {
            composingRef.current = false;
            commitTyping(lineIndex, e.currentTarget);
          }}
          onInput={(e) => {
            if (!composingRef.current) commitTyping(lineIndex, e.currentTarget);
          }}
          onKeyDown={(e) => {
            if (!editable) return;
            if (e.key === 'Enter') {
              e.preventDefault();
              handleEnterKey(lineIndex, e.currentTarget);
              return;
            }
            if (e.key === 'Backspace') {
              const offset = getCaretOffset(e.currentTarget);
              const selection = window.getSelection();
              const collapsed = selection ? selection.isCollapsed : true;
              if (collapsed && offset === 0 && lineIndex > 0) {
                e.preventDefault();
                handleBackspaceAtStart(lineIndex);
              }
              // offset > 0(일반 문자 삭제) 또는 첫 줄의 offset === 0(합칠 줄 없음)은
              // preventDefault하지 않고 브라우저 기본 동작에 맡긴다 — 지워진 결과는
              // 이어지는 onInput에서 store로 동기화된다.
              return;
            }
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              const dir = e.key === 'ArrowUp' ? -1 : 1;
              const target = lines[lineIndex + dir];
              if (target) {
                e.preventDefault();
                const offset = getCaretOffset(e.currentTarget);
                const targetEl = lineElsRef.current.get(target.id);
                if (targetEl) {
                  const maxOffset = targetEl.textContent?.length ?? 0;
                  focusLineAt(targetEl, Math.min(offset, maxOffset));
                }
              }
            }
          }}
          style={{
            width: '100%',
            outline: 'none',
            textAlign: 'center',
            fontSize: rect.cell.fontSize ?? DEFAULT_TABLE_TEXT_FONT_SIZE,
            fontFamily: rect.cell.fontFamily || DEFAULT_FONT_FAMILY,
            fontWeight: rect.cell.bold ? 700 : 400,
            lineHeight: 1.4,
            color: rect.cell.color || DEFAULT_TABLE_TEXT_COLOR,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            userSelect: editable ? 'text' : allowNativeTextSelect ? 'text' : 'none',
            WebkitUserSelect: editable ? 'text' : allowNativeTextSelect ? 'text' : 'none',
          }}
        />
      ))}
    </div>
  );
}

function rangeRectFor(
  object: TableObject,
  sel: TableCellRangeSelection | null,
): { x: number; y: number; width: number; height: number } | null {
  if (!sel || sel.tableId !== object.id) return null;
  const rowOffsets = prefixSums(object.rowSizes);
  const colOffsets = prefixSums(object.colSizes);
  const rowFrom = Math.max(0, Math.min(sel.rowFrom, sel.rowTo));
  const rowTo = Math.min(object.rowSizes.length - 1, Math.max(sel.rowFrom, sel.rowTo));
  const colFrom = Math.max(0, Math.min(sel.colFrom, sel.colTo));
  const colTo = Math.min(object.colSizes.length - 1, Math.max(sel.colFrom, sel.colTo));
  return {
    x: colOffsets[colFrom],
    y: rowOffsets[rowFrom],
    width: colOffsets[colTo + 1] - colOffsets[colFrom],
    height: rowOffsets[rowTo + 1] - rowOffsets[rowFrom],
  };
}
