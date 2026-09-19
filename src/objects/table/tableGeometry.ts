import { createPlainLine, lineText } from '../text/indentation/types';
import type { TextLine } from '../text/indentation/types';
import type { TableCell, TableObject } from '../../types/object';

/**
 * 표(Table) 객체의 순수 기하/구조 함수 모음. DOM/React와 완전히 분리되어 있어
 * Vitest로 단위 테스트가 가능하다(shapeGeometry.ts/smartGuides.ts와 같은 관례).
 *
 * 데이터 모델: HTML table의 rowspan/colspan과 동일한 개념이다.
 *  - rowSizes/colSizes: "세부 행/열"(atomic row/col) 각각의 world px 크기. 합이
 *    table.width/height와 항상 같다.
 *  - cells: 세부 격자 전체를 빈틈/중복 없이 정확히 한 번씩 덮는 사각형들. 각 cell은
 *    (row, col)을 좌상단으로 하는 (rowSpan x colSpan) 크기의 세부 셀 묶음이다.
 *
 * 이 모델은 항상 "모든 셀이 사각형"이라는 불변식을 유지한다 — 지우개로 두 셀을
 * 병합할 때 그 결과가 사각형이 되지 않는 경우(계단 모양 경계)는 애초에 병합 대상
 * (mergeableBorders)에 포함되지 않는다. Excel/한글도 실제로 이런 "계단 경계"는
 * 병합을 허용하지 않는다.
 */

export const MIN_ROW_SIZE = 20; // world px. 이보다 작아지면 편집/선택이 어려워진다.
export const MIN_COL_SIZE = 32;

export function prefixSums(sizes: number[]): number[] {
  const out: number[] = [0];
  for (const s of sizes) out.push(out[out.length - 1] + s);
  return out;
}

/** 세부 행/열 index가 몇 world px 지점에서 시작하는지. prefixSums(sizes)[index]와 동일하지만
 * 호출부 가독성을 위해 이름을 붙여 둔다. */
export function boundaryOffset(sizes: number[], index: number): number {
  let sum = 0;
  for (let i = 0; i < index; i++) sum += sizes[i];
  return sum;
}

export interface CellRect {
  cell: TableCell;
  x: number; // table 좌상단 기준 로컬 좌표
  y: number;
  width: number;
  height: number;
}

/** 모든 셀의 로컬(테이블 좌상단 기준) 사각형을 계산한다. */
export function computeCellRects(table: Pick<TableObject, 'rowSizes' | 'colSizes' | 'cells'>): CellRect[] {
  const rowOffsets = prefixSums(table.rowSizes);
  const colOffsets = prefixSums(table.colSizes);
  return table.cells.map((cell) => ({
    cell,
    x: colOffsets[cell.col],
    y: rowOffsets[cell.row],
    width: colOffsets[cell.col + cell.colSpan] - colOffsets[cell.col],
    height: rowOffsets[cell.row + cell.rowSpan] - rowOffsets[cell.row],
  }));
}

/** 로컬 좌표 (localX, localY)를 담고 있는 셀을 찾는다(없으면 null — 표 바깥). */
export function findCellAt(table: Pick<TableObject, 'rowSizes' | 'colSizes' | 'cells'>, localX: number, localY: number): TableCell | null {
  for (const rect of computeCellRects(table)) {
    if (localX >= rect.x && localX < rect.x + rect.width && localY >= rect.y && localY < rect.y + rect.height) {
      return rect.cell;
    }
  }
  return null;
}

function atomicIndexAt(sizes: number[], local: number): number {
  const offsets = prefixSums(sizes);
  for (let i = 0; i < sizes.length; i++) {
    if (local >= offsets[i] && local < offsets[i + 1]) return i;
  }
  return sizes.length - 1;
}

export function createInitialCells(rows: number, cols: number): TableCell[] {
  const cells: TableCell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({ id: crypto.randomUUID(), row: r, col: c, rowSpan: 1, colSpan: 1, lines: [createPlainLine('')] });
    }
  }
  return cells;
}

/**
 * localY 위치에 새 가로 경계선을 만든다. 이미 그 위치에 세부 행 경계가 있으면(어느
 * 셀이든 그 지점에서 나뉜 적이 있으면) 아무 것도 새로 추가하지 않고 그 atomic index를
 * 그대로 반환한다 — 그래야 여러 번 나눠 그린 표에서 다른 열의 기존 경계와 자연스럽게
 * 이어진다.
 */
export function ensureRowBoundary(rowSizes: number[], localY: number): { rowSizes: number[]; index: number } {
  const offsets = prefixSums(rowSizes);
  for (let i = 0; i <= rowSizes.length; i++) {
    if (Math.abs(offsets[i] - localY) < 0.5) return { rowSizes, index: i };
  }
  const idx = atomicIndexAt(rowSizes, localY);
  const rowStart = offsets[idx];
  const topSize = localY - rowStart;
  const bottomSize = rowSizes[idx] - topSize;
  const next = [...rowSizes.slice(0, idx), topSize, bottomSize, ...rowSizes.slice(idx + 1)];
  return { rowSizes: next, index: idx + 1 };
}

export function ensureColBoundary(colSizes: number[], localX: number): { colSizes: number[]; index: number } {
  const offsets = prefixSums(colSizes);
  for (let i = 0; i <= colSizes.length; i++) {
    if (Math.abs(offsets[i] - localX) < 0.5) return { colSizes, index: i };
  }
  const idx = atomicIndexAt(colSizes, localX);
  const colStart = offsets[idx];
  const leftSize = localX - colStart;
  const rightSize = colSizes[idx] - leftSize;
  const next = [...colSizes.slice(0, idx), leftSize, rightSize, ...colSizes.slice(idx + 1)];
  return { colSizes: next, index: idx + 1 };
}

/**
 * ensureRowBoundary가 세부 행을 하나 늘렸을 때(splitIndex에서 갈라짐), 기존
 * cells의 row/rowSpan을 새 atomic index 체계에 맞게 보정한다. splitIndex 자체는
 * "새로 생긴 경계의 atomic index"(늘어난 뒤 기준) — 이 경계를 가로질러 걸쳐 있던
 * 셀은 rowSpan만 1 늘어나고(화면상 안 갈라짐), splitIndex보다 완전히 아래에 있던
 * 셀은 row가 1 늘어난다. 이미 그 자리에 경계가 있었던 경우(ensureRowBoundary가
 * grew=false를 반환)는 이 함수를 호출하지 않는다.
 */
export function remapCellsAfterRowInsert(cells: TableCell[], splitIndex: number): TableCell[] {
  return cells.map((cell) => {
    if (cell.row >= splitIndex) return { ...cell, row: cell.row + 1 };
    // 버그 수정(표 그리기 시 표 전체가 분리되던 문제): 정확히 쪼개진 세부 행 하나만
    // 차지하던(가장 흔한 rowSpan===1) 셀은 `cell.row + cell.rowSpan`이 splitIndex와
    // "같아진다" — `>`(strictly greater)로는 이 경우를 못 잡아서 그 셀이 새로 생긴
    // 세부 행을 흡수하지 못하고 빈 공간(또는 반대로 분할 대상 열이 제대로 안 나뉘는
    // 문제)이 생겼다. `>=`여야 "이 셀 내부에서 경계가 갈라졌다"를 올바르게 판정한다.
    if (cell.row + cell.rowSpan >= splitIndex) return { ...cell, rowSpan: cell.rowSpan + 1 };
    return cell;
  });
}

export function remapCellsAfterColInsert(cells: TableCell[], splitIndex: number): TableCell[] {
  return cells.map((cell) => {
    if (cell.col >= splitIndex) return { ...cell, col: cell.col + 1 };
    // remapCellsAfterRowInsert와 동일한 off-by-one 수정(위 주석 참고) — 세로 방향
    // 표 그리기(splitTableCol)에서도 같은 원인으로 같은 버그가 났다.
    if (cell.col + cell.colSpan >= splitIndex) return { ...cell, colSpan: cell.colSpan + 1 };
    return cell;
  });
}

/**
 * atomic row index `atRow`를 가로지르는 셀들 중, 세부 열 범위가 [colFrom, colTo)와
 * 겹치는 셀만 위/아래 둘로 쪼갠다(표 그리기 — 부분 선). 내용은 위쪽 조각이 그대로
 * 갖고, 아래쪽 새 조각은 빈 채로 시작한다.
 */
export function splitCellsAtRow(cells: TableCell[], atRow: number, colFrom: number, colTo: number): TableCell[] {
  const result: TableCell[] = [];
  for (const cell of cells) {
    const crosses = cell.row < atRow && cell.row + cell.rowSpan > atRow;
    const overlapsCols = cell.col < colTo && cell.col + cell.colSpan > colFrom;
    if (!crosses || !overlapsCols) {
      result.push(cell);
      continue;
    }
    const topSpan = atRow - cell.row;
    const bottomSpan = cell.rowSpan - topSpan;
    result.push({ ...cell, rowSpan: topSpan });
    // 버그 수정(표에 선을 그으면 글꼴이 바뀜): 새로 생기는 아래쪽 조각도 나뉘기 전
    // 셀의 글꼴/크기/색상/굵기를 그대로 물려받는다(원래는 이 필드들이 통째로
    // 빠져 있어서 기본값으로 보였다).
    result.push({
      id: crypto.randomUUID(),
      row: atRow,
      col: cell.col,
      rowSpan: bottomSpan,
      colSpan: cell.colSpan,
      lines: [createPlainLine('')],
      fontFamily: cell.fontFamily,
      fontSize: cell.fontSize,
      color: cell.color,
      bold: cell.bold,
    });
  }
  return result;
}

export function splitCellsAtCol(cells: TableCell[], atCol: number, rowFrom: number, rowTo: number): TableCell[] {
  const result: TableCell[] = [];
  for (const cell of cells) {
    const crosses = cell.col < atCol && cell.col + cell.colSpan > atCol;
    const overlapsRows = cell.row < rowTo && cell.row + cell.rowSpan > rowFrom;
    if (!crosses || !overlapsRows) {
      result.push(cell);
      continue;
    }
    const leftSpan = atCol - cell.col;
    const rightSpan = cell.colSpan - leftSpan;
    result.push({ ...cell, colSpan: leftSpan });
    result.push({
      id: crypto.randomUUID(),
      row: cell.row,
      col: atCol,
      rowSpan: cell.rowSpan,
      colSpan: rightSpan,
      lines: [createPlainLine('')],
      fontFamily: cell.fontFamily,
      fontSize: cell.fontSize,
      color: cell.color,
      bold: cell.bold,
    });
  }
  return result;
}

export interface MergeableBorder {
  a: TableCell;
  b: TableCell;
  orientation: 'horizontal' | 'vertical'; // 지워질 경계선의 방향
  x1: number; y1: number; x2: number; y2: number; // 로컬 좌표 기준 경계 선분
}

/** 지금 지울 수 있는(=병합해도 항상 사각형이 되는) 모든 경계선을 계산한다. */
export function mergeableBorders(table: Pick<TableObject, 'rowSizes' | 'colSizes' | 'cells'>): MergeableBorder[] {
  const rects = computeCellRects(table);
  const borders: MergeableBorder[] = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const A = rects[i];
      const B = rects[j];
      // 가로 경계(A가 위, B가 아래): 열 범위가 정확히 같아야 병합해도 사각형.
      if (A.cell.col === B.cell.col && A.cell.colSpan === B.cell.colSpan) {
        if (Math.abs(A.y + A.height - B.y) < 0.5) {
          borders.push({ a: A.cell, b: B.cell, orientation: 'horizontal', x1: A.x, y1: A.y + A.height, x2: A.x + A.width, y2: A.y + A.height });
        } else if (Math.abs(B.y + B.height - A.y) < 0.5) {
          borders.push({ a: B.cell, b: A.cell, orientation: 'horizontal', x1: B.x, y1: B.y + B.height, x2: B.x + B.width, y2: B.y + B.height });
        }
      }
      // 세로 경계(A가 왼쪽, B가 오른쪽): 행 범위가 정확히 같아야 병합해도 사각형.
      if (A.cell.row === B.cell.row && A.cell.rowSpan === B.cell.rowSpan) {
        if (Math.abs(A.x + A.width - B.x) < 0.5) {
          borders.push({ a: A.cell, b: B.cell, orientation: 'vertical', x1: A.x + A.width, y1: A.y, x2: A.x + A.width, y2: A.y + A.height });
        } else if (Math.abs(B.x + B.width - A.x) < 0.5) {
          borders.push({ a: B.cell, b: A.cell, orientation: 'vertical', x1: B.x + B.width, y1: B.y, x2: B.x + B.width, y2: B.y + B.height });
        }
      }
    }
  }
  return borders;
}

/** 로컬 좌표 (localX, localY)에서 tolerance(world px) 안에 있는 지울 수 있는 경계선 하나를
 * 찾는다. 요구사항(표 지우개는 정확히 선 위에서만 동작): tolerance는 작은 고정값이어야
 * 하고, "가장 가까운 선"으로 무한정 스냅하면 안 된다. */
export function hitTestBorder(
  table: Pick<TableObject, 'rowSizes' | 'colSizes' | 'cells'>,
  localX: number,
  localY: number,
  tolerance: number,
): MergeableBorder | null {
  let best: MergeableBorder | null = null;
  let bestDist = tolerance;
  for (const border of mergeableBorders(table)) {
    if (border.orientation === 'horizontal') {
      if (localX < border.x1 - tolerance || localX > border.x2 + tolerance) continue;
      const dist = Math.abs(localY - border.y1);
      if (dist <= bestDist) {
        best = border;
        bestDist = dist;
      }
    } else {
      if (localY < border.y1 - tolerance || localY > border.y2 + tolerance) continue;
      const dist = Math.abs(localX - border.x1);
      if (dist <= bestDist) {
        best = border;
        bestDist = dist;
      }
    }
  }
  return best;
}

function isBlankLines(lines: TextLine[]): boolean {
  return lines.length === 0 || (lines.length === 1 && lines[0].runs.every((r) => r.text.length === 0));
}

/** 요구사항(병합 시 내용): 두 셀에 모두 내용이 있으면 이어붙인다. */
export function mergeCellContents(a: TextLine[], b: TextLine[]): TextLine[] {
  const aBlank = isBlankLines(a);
  const bBlank = isBlankLines(b);
  if (aBlank && bBlank) return a;
  if (aBlank) return b;
  if (bBlank) return a;
  // 버그 수정(지우개로 병합하면 한쪽 텍스트가 화면에서 사라짐): 표 셀은 실제로는
  // cell.lines[0] 하나만 화면에 그려지는 한 줄짜리 모델이다(TableObjectView.tsx의
  // TableCellText). 예전엔 여기서 [...a, ...b]로 TextLine을 2개 만들어서 b의
  // 내용이 lines[1]에 store엔 남지만 화면엔 다시는 안 나타났다 — 항상 하나의 줄로
  // 합쳐서 둘 다 보이게 한다.
  return [createPlainLine(`${lineText(a[0] ?? createPlainLine(''))} ${lineText(b[0] ?? createPlainLine(''))}`.trim())];
}

/** border를 지우고 두 셀을 하나로 합친 새 cells 배열을 반환한다. */
export function mergeCells(cells: TableCell[], border: MergeableBorder): TableCell[] {
  const { a, b, orientation } = border;
  // 버그 수정(표 지우개로 경계를 지우면 글꼴이 기본값으로 바뀜): 예전엔 여기서
  // { id, row, col, rowSpan, colSpan, lines }만 있는 새 리터럴을 만들어서 a가
  // 갖고 있던 fontFamily/fontSize/color/bold가 전부 사라졌다. 살아남는 셀은
  // a이므로 a를 그대로 spread해 스타일을 유지하고 rowSpan/colSpan/lines만
  // 덮어쓴다(id/row/col은 이미 a와 같으므로 spread만으로 충분).
  const merged: TableCell =
    orientation === 'horizontal'
      ? { ...a, rowSpan: a.rowSpan + b.rowSpan, lines: mergeCellContents(a.lines, b.lines) }
      : { ...a, colSpan: a.colSpan + b.colSpan, lines: mergeCellContents(a.lines, b.lines) };
  return cells.filter((c) => c.id !== a.id && c.id !== b.id).concat(merged);
}

/** [from, to] 구간(atomic index, inclusive)의 크기를 모두 같게(합은 유지) 만든다. */
export function equalizeRange(sizes: number[], from: number, to: number): number[] {
  const lo = Math.max(0, Math.min(from, to));
  const hi = Math.min(sizes.length - 1, Math.max(from, to));
  if (hi <= lo) return sizes;
  let sum = 0;
  for (let i = lo; i <= hi; i++) sum += sizes[i];
  const even = sum / (hi - lo + 1);
  const next = [...sizes];
  for (let i = lo; i <= hi; i++) next[i] = even;
  return next;
}

/** 세부 행/열 범위를 world 좌표 사각형(드래그로 선택한 셀 범위)으로부터 계산한다. */
export function atomicRangeFor(sizes: number[], localFrom: number, localTo: number): { from: number; to: number } {
  const from = atomicIndexAt(sizes, Math.min(localFrom, localTo));
  const to = atomicIndexAt(sizes, Math.max(localFrom, localTo));
  return { from, to };
}

/** atomic (row, col) 위치를 덮고 있는 셀을 찾는다(findCellAt의 픽셀 좌표 버전과
 * 달리 세부 행/열 index로 직접 찾는다) — borderSegments가 두 이웃 셀이 같은
 * 셀(병합됨)인지 판정하는 데 쓴다. */
function cellAtAtomic(cells: TableCell[], row: number, col: number): TableCell | undefined {
  return cells.find((c) => row >= c.row && row < c.row + c.rowSpan && col >= c.col && col < c.col + c.colSpan);
}

export interface BorderSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * 요구사항(겉 테두리와 내부 선의 굵기를 동일하게): 셀마다 자기 사각형(4변)을 각각
 * 그리면(예전 방식) 이웃한 두 셀이 공유하는 내부 경계가 두 번 겹쳐 그려진다 — 완전히
 * 같은 좌표라도 SVG가 안티앨리어싱된 가장자리를 두 번 합성하면서 내부 선이 겉
 * 테두리(한 번만 그려짐)보다 진하고 두껍게 보이는 문제가 있었다. 이 함수는 표의
 * 실제 격자선을 "절대 겹치지 않는" 유일한 선분들로 계산해서 각 선을 정확히 한 번만
 * 그리게 한다.
 *
 * atomic(세부 행/열) 단위로 필요 여부를 판정한 뒤 연속 구간을 하나의 선분으로 이어
 * 붙인다 — 그래서 크기가 다른 두 셀이 만나는 부분 선(partial line) 경계에서도 항상
 * 정확하다(그 경계의 한쪽만 필요하고 다른 쪽은 셀 내부일 수 있는 경우까지 올바르게
 * 처리됨). 표 바깥 테두리(첫/마지막 행·열 경계)는 이웃 셀 유무와 무관하게 항상 그린다.
 */
export function borderSegments(table: Pick<TableObject, 'rowSizes' | 'colSizes' | 'cells'>): BorderSegment[] {
  const { rowSizes, colSizes, cells } = table;
  const rowOffsets = prefixSums(rowSizes);
  const colOffsets = prefixSums(colSizes);
  const segments: BorderSegment[] = [];

  // 세로선: 각 열 경계(c=0..colSizes.length)마다, 그 경계를 가로지르는 연속된
  // 세부 행 구간을 하나의 선분으로 합친다.
  for (let c = 0; c <= colSizes.length; c++) {
    let runStart: number | null = null;
    for (let r = 0; r <= rowSizes.length; r++) {
      const needs =
        r < rowSizes.length &&
        (c === 0 || c === colSizes.length || cellAtAtomic(cells, r, c - 1)?.id !== cellAtAtomic(cells, r, c)?.id);
      if (needs && runStart === null) runStart = r;
      if (!needs && runStart !== null) {
        segments.push({ x1: colOffsets[c], y1: rowOffsets[runStart], x2: colOffsets[c], y2: rowOffsets[r] });
        runStart = null;
      }
    }
  }

  // 가로선: 세로선과 대칭.
  for (let r = 0; r <= rowSizes.length; r++) {
    let runStart: number | null = null;
    for (let c = 0; c <= colSizes.length; c++) {
      const needs =
        c < colSizes.length &&
        (r === 0 || r === rowSizes.length || cellAtAtomic(cells, r - 1, c)?.id !== cellAtAtomic(cells, r, c)?.id);
      if (needs && runStart === null) runStart = c;
      if (!needs && runStart !== null) {
        segments.push({ x1: colOffsets[runStart], y1: rowOffsets[r], x2: colOffsets[c], y2: rowOffsets[r] });
        runStart = null;
      }
    }
  }

  return segments;
}

/** 세부 행/열 atomic 범위(rowFrom..rowTo, colFrom..colTo, 순서/inclusive 무관)와
 * 겹치는 모든 셀을 반환한다 — 표 텍스트 스타일(글꼴/크기/색상/굵기)을 "드래그로
 * 선택한 범위의 셀에만" 적용할 때 대상을 고르는 데 쓴다(요구사항). */
export function cellsInRange(
  cells: TableCell[],
  rowFrom: number,
  rowTo: number,
  colFrom: number,
  colTo: number,
): TableCell[] {
  const rLo = Math.min(rowFrom, rowTo);
  const rHi = Math.max(rowFrom, rowTo);
  const cLo = Math.min(colFrom, colTo);
  const cHi = Math.max(colFrom, colTo);
  return cells.filter(
    (cell) => cell.row <= rHi && cell.row + cell.rowSpan - 1 >= rLo && cell.col <= cHi && cell.col + cell.colSpan - 1 >= cLo,
  );
}

/**
 * 요구사항(지우개로 병합한 셀 위에서 범위 드래그가 atomic 조각별로 따로 도는 버그
 * 수정): atomicRangeFor가 계산한 순수 세부 행/열 범위는 그 범위와 "겹치기만" 해도
 * 포함되는 실제 셀(rowSpan/colSpan으로 병합된 셀)의 나머지 부분은 무시한다 — 그래서
 * 드래그가 병합된 큰 셀의 일부만 지나가면 셀 전체가 아니라 지나간 부분(atomic 조각)만
 * 선택된 것처럼 보이는 버그가 있었다(선택 영역 사각형이 병합 셀 안쪽에서 끊겨 보임).
 * Excel처럼 "선택 범위가 병합 셀의 일부라도 걸치면 그 셀 전체를 포함하도록" 범위
 * 자체를 넓힌다 — 넓힌 뒤 새로 걸리는 셀이 생기면(그 셀도 더 큰 병합 셀일 수 있으므로)
 * 더 이상 안 늘어날 때까지 반복한다.
 */
export function expandRangeToCoverCells(
  cells: TableCell[],
  rowFrom: number,
  rowTo: number,
  colFrom: number,
  colTo: number,
): { rowFrom: number; rowTo: number; colFrom: number; colTo: number } {
  let rLo = Math.min(rowFrom, rowTo);
  let rHi = Math.max(rowFrom, rowTo);
  let cLo = Math.min(colFrom, colTo);
  let cHi = Math.max(colFrom, colTo);
  let changed = true;
  while (changed) {
    changed = false;
    for (const cell of cellsInRange(cells, rLo, rHi, cLo, cHi)) {
      const cellRowTo = cell.row + cell.rowSpan - 1;
      const cellColTo = cell.col + cell.colSpan - 1;
      if (cell.row < rLo) {
        rLo = cell.row;
        changed = true;
      }
      if (cellRowTo > rHi) {
        rHi = cellRowTo;
        changed = true;
      }
      if (cell.col < cLo) {
        cLo = cell.col;
        changed = true;
      }
      if (cellColTo > cHi) {
        cHi = cellColTo;
        changed = true;
      }
    }
  }
  return { rowFrom: rLo, rowTo: rHi, colFrom: cLo, colTo: cHi };
}
