import { describe, expect, it } from 'vitest';
import { createPlainLine, lineText } from '../text/indentation/types';
import {
  atomicRangeFor,
  borderSegments,
  cellsInRange,
  computeCellRects,
  createInitialCells,
  ensureColBoundary,
  ensureRowBoundary,
  equalizeRange,
  expandRangeToCoverCells,
  findCellAt,
  hitTestBorder,
  mergeCellContents,
  mergeCells,
  mergeableBorders,
  prefixSums,
  remapCellsAfterColInsert,
  remapCellsAfterRowInsert,
  splitCellsAtCol,
  splitCellsAtRow,
} from './tableGeometry';

describe('prefixSums', () => {
  it('누적합을 0부터 시작해서 계산한다', () => {
    expect(prefixSums([10, 20, 30])).toEqual([0, 10, 30, 60]);
    expect(prefixSums([])).toEqual([0]);
  });
});

describe('createInitialCells + computeCellRects', () => {
  it('3x3 표는 rowSpan/colSpan이 모두 1인 9개의 셀로 시작한다', () => {
    const cells = createInitialCells(3, 3);
    expect(cells).toHaveLength(9);
    expect(cells.every((c) => c.rowSpan === 1 && c.colSpan === 1)).toBe(true);
  });

  it('셀 사각형은 빈틈/중복 없이 전체 표 영역을 덮는다', () => {
    const rowSizes = [20, 30, 40];
    const colSizes = [50, 60];
    const cells = createInitialCells(3, 2);
    const rects = computeCellRects({ rowSizes, colSizes, cells });
    const totalArea = rects.reduce((sum, r) => sum + r.width * r.height, 0);
    expect(totalArea).toBeCloseTo(sum(rowSizes) * sum(colSizes));
  });
});

describe('findCellAt', () => {
  it('로컬 좌표가 속한 셀을 찾는다', () => {
    const rowSizes = [20, 20];
    const colSizes = [30, 30];
    const cells = createInitialCells(2, 2);
    const cell = findCellAt({ rowSizes, colSizes, cells }, 35, 25);
    expect(cell?.row).toBe(1);
    expect(cell?.col).toBe(1);
  });

  it('표 바깥 좌표는 null을 반환한다', () => {
    const rowSizes = [20];
    const colSizes = [30];
    const cells = createInitialCells(1, 1);
    expect(findCellAt({ rowSizes, colSizes, cells }, 999, 999)).toBeNull();
  });
});

describe('ensureRowBoundary / ensureColBoundary', () => {
  it('기존에 없던 위치면 세부 행을 하나 더 만들고 그 index를 반환한다', () => {
    const { rowSizes, index } = ensureRowBoundary([40], 15);
    expect(rowSizes).toEqual([15, 25]);
    expect(index).toBe(1);
  });

  it('이미 그 위치에 경계가 있으면(허용오차 0.5px 안) 아무것도 새로 만들지 않는다', () => {
    const { rowSizes, index } = ensureRowBoundary([20, 20], 20);
    expect(rowSizes).toEqual([20, 20]); // 같은 배열 참조 그대로
    expect(index).toBe(1);
  });

  it('열도 동일하게 동작한다', () => {
    const { colSizes, index } = ensureColBoundary([50], 20);
    expect(colSizes).toEqual([20, 30]);
    expect(index).toBe(1);
  });
});

describe('remapCellsAfterRowInsert / remapCellsAfterColInsert', () => {
  it('새 경계보다 완전히 아래에 있던 셀은 row가 1 늘어난다', () => {
    // 2행 1열: row0(atomic row0 하나만 차지), row1(atomic row1 하나만 차지) —
    // ensureRowBoundary가 atomic row0 "내부"를 쪼개 splitIndex=1을 반환했다고 가정
    // (ensureRowBoundary는 이미 있는 경계 위에서는 절대 호출되지 않으므로, remap이
    // 호출됐다는 것 자체가 "쪼개진 그 atomic row를 덮던 모든 셀"이 있다는 뜻이다).
    // row1은 쪼개진 지점보다 완전히 아래([1,2)) — 그대로 밀려 row=2가 된다.
    const cells = [
      { id: 'a', row: 0, col: 0, rowSpan: 1, colSpan: 1, lines: [] },
      { id: 'b', row: 1, col: 0, rowSpan: 1, colSpan: 1, lines: [] },
    ];
    const next = remapCellsAfterRowInsert(cells, 1);
    // 버그 수정(표 그리기 시 표가 위아래로 분리되며 빈 공간이 생기던 문제의 근본 원인):
    // 'a'는 쪼개진 atomic row0을 "정확히 하나만" 차지하던 셀이다 — 화면상 아무 변화가
    // 없으려면 새로 생긴 atomic row까지 rowSpan으로 흡수해서 {row:0, rowSpan:2}가 돼야
    // 한다. 예전엔 `cell.row + cell.rowSpan > splitIndex`(1+1>1 → false)라는 off-by-one
    // 때문에 이 흔한 case(쪼개진 행을 정확히 하나만 차지하는 rowSpan===1 셀)를 놓쳐서
    // 'a'가 그대로 남았고, 그 결과 새로 생긴 세부 행을 아무도 덮지 않는 빈 공간이 됐다.
    expect(next.find((c) => c.id === 'a')).toMatchObject({ row: 0, rowSpan: 2 });
    expect(next.find((c) => c.id === 'b')).toMatchObject({ row: 2, rowSpan: 1 });
  });

  it('경계를 가로지르는 셀(rowSpan>1)은 그 자리에서 안 갈라지고 rowSpan만 늘어난다', () => {
    const cells = [{ id: 'a', row: 0, col: 0, rowSpan: 2, colSpan: 1, lines: [] }];
    const next = remapCellsAfterRowInsert(cells, 1);
    expect(next).toEqual([{ id: 'a', row: 0, col: 0, rowSpan: 3, colSpan: 1, lines: [] }]);
  });

  it('열 방향도 동일하게 동작한다(경계를 가로지르는 셀)', () => {
    const cells = [{ id: 'a', row: 0, col: 0, rowSpan: 1, colSpan: 2, lines: [] }];
    const next = remapCellsAfterColInsert(cells, 1);
    expect(next).toEqual([{ id: 'a', row: 0, col: 0, rowSpan: 1, colSpan: 3, lines: [] }]);
  });

  it('열 방향도 동일하게 동작한다(쪼개진 열을 정확히 하나만 차지하던 셀)', () => {
    // 행 방향과 대칭인 off-by-one 회귀 테스트 — colSpan===1인 흔한 셀이 쪼개진 그
    // atomic col을 정확히 하나만 차지했을 때도 colSpan===2로 흡수돼야 한다.
    const cells = [
      { id: 'a', row: 0, col: 0, rowSpan: 1, colSpan: 1, lines: [] },
      { id: 'b', row: 0, col: 1, rowSpan: 1, colSpan: 1, lines: [] },
    ];
    const next = remapCellsAfterColInsert(cells, 1);
    expect(next.find((c) => c.id === 'a')).toMatchObject({ col: 0, colSpan: 2 });
    expect(next.find((c) => c.id === 'b')).toMatchObject({ col: 2, colSpan: 1 });
  });
});

describe('표 그리기 통합 시나리오 (ensureRowBoundary + remapCellsAfterRowInsert + splitCellsAtRow)', () => {
  it('여러 열 중 한 열에만 부분 가로선을 그으면, 그 열만 나뉘고 다른 열은 빈 공간 없이 그대로 유지된다', () => {
    // 실제 버그 재현 시나리오: 3행 5열 표, 마지막 열(col4)의 가운데 행(row1) 안에서만
    // 가로선을 긋는다. 이전 버그에서는 (1) col4만 나뉘어야 하는데 5열 전체가 영향을
    // 받았고, (2) 나머지 열들이 나뉜 행의 세부 행 하나를 흡수하지 못해 표 전체 폭에
    // 걸친 빈 공간이 생겼다.
    const rowSizes = [40, 40, 40];
    const colSizes = [30, 30, 30, 30, 30];
    let cells = createInitialCells(3, 5);

    const localY = 40 + 25; // row1(40..80) 내부의 한 지점(가운데보다 아래쪽)
    const { rowSizes: nextRowSizes, index } = ensureRowBoundary(rowSizes, localY);
    cells = remapCellsAfterRowInsert(cells, index);
    // col4(마지막 열)만 대상으로 나눈다 — colFrom/colTo는 atomic col index 기준.
    cells = splitCellsAtRow(cells, index, 4, 5);

    // (a) 전체 높이 합은 원래와 같아야 한다(세부 행 하나가 늘었을 뿐 총합은 불변).
    expect(nextRowSizes.reduce((s, v) => s + v, 0)).toBeCloseTo(120);

    // (b) 빈 공간 없이 표 전체 영역을 정확히 덮어야 한다(모든 atomic 위치가 셀 하나로
    // 덮여야 하고, 겹치거나 비어서는 안 된다) — computeCellRects의 면적 합이
    // rowSizes×colSizes 총합과 정확히 같은지로 검증한다.
    const rects = computeCellRects({ rowSizes: nextRowSizes, colSizes, cells });
    const totalArea = rects.reduce((sum, r) => sum + r.width * r.height, 0);
    expect(totalArea).toBeCloseTo(120 * 150);

    // (c) col4를 제외한 나머지 4개 열은 여전히 "안 나뉜 하나의 셀"이어야 한다(부분
    // 선이 다른 열까지 넓게 적용되던 버그의 반대 검증).
    for (let c = 0; c < 4; c++) {
      const colCells = cells.filter((cell) => cell.col === c);
      expect(colCells).toHaveLength(3); // row0/row1/row2, 각 1개씩 — 추가로 안 나뉨
    }

    // (d) col4만 row1 안에서 위/아래로 나뉘어야 한다(부분 선이 실제로 적용됨).
    const col4Cells = cells.filter((cell) => cell.col === 4);
    expect(col4Cells).toHaveLength(4); // row0, row1-top, row1-bottom, row2
  });
});

describe('splitCellsAtRow / splitCellsAtCol (부분 선)', () => {
  it('지정한 열 범위와 겹치는 셀만 위/아래로 나뉘고, 나머지 열은 그대로 남는다', () => {
    // 2행 2열, row0의 두 셀(col0, col1)을 atRow=1에서 나누되 col0(=colFrom0~colTo1)만 대상으로.
    const cells = createInitialCells(2, 2).map((c) =>
      c.row === 0 ? { ...c, rowSpan: 2 } : c,
    ).filter((c) => c.row === 0); // row0 두 셀만 남기고 각각 rowSpan=2로 표시(가상 시나리오)
    // col0 셀만 atRow=1에서 나눈다(colFrom=0, colTo=1 → col1은 겹치지 않음)
    const next = splitCellsAtRow(cells, 1, 0, 1);
    const col0Pieces = next.filter((c) => c.col === 0);
    const col1Pieces = next.filter((c) => c.col === 1);
    expect(col0Pieces).toHaveLength(2); // 위/아래로 나뉨
    expect(col1Pieces).toHaveLength(1); // 손대지 않음(부분 선 — 다른 셀 크기는 그대로)
    expect(col1Pieces[0].rowSpan).toBe(2);
  });

  it('나뉜 아래쪽 조각은 빈 내용으로 시작하고, 위쪽 조각은 원래 내용을 유지한다', () => {
    const original = { id: 'a', row: 0, col: 0, rowSpan: 2, colSpan: 1, lines: [createPlainLine('hello')] };
    const next = splitCellsAtRow([original], 1, 0, 1);
    expect(next).toHaveLength(2);
    const top = next.find((c) => c.rowSpan === 1 && c.row === 0)!;
    const bottom = next.find((c) => c.row === 1)!;
    expect(lineText(top.lines[0])).toBe('hello');
    expect(lineText(bottom.lines[0])).toBe('');
  });

  it('열 방향(splitCellsAtCol)도 대칭으로 동작한다', () => {
    const original = { id: 'a', row: 0, col: 0, rowSpan: 1, colSpan: 2, lines: [createPlainLine('x')] };
    const next = splitCellsAtCol([original], 1, 0, 1);
    expect(next).toHaveLength(2);
    expect(next.find((c) => c.colSpan === 1 && c.col === 0)).toBeTruthy();
    expect(next.find((c) => c.col === 1)).toBeTruthy();
  });

  it('버그 수정: 선을 그어 나뉜 두 조각 모두 원래 셀의 글꼴/크기/색상/굵기를 물려받는다', () => {
    const original = {
      id: 'a',
      row: 0,
      col: 0,
      rowSpan: 2,
      colSpan: 1,
      lines: [createPlainLine('hello')],
      fontFamily: 'Georgia',
      fontSize: 20,
      color: '#ff0000',
      bold: true,
    };
    const rowSplit = splitCellsAtRow([original], 1, 0, 1);
    for (const piece of rowSplit) {
      expect(piece.fontFamily).toBe('Georgia');
      expect(piece.fontSize).toBe(20);
      expect(piece.color).toBe('#ff0000');
      expect(piece.bold).toBe(true);
    }

    const colOriginal = { ...original, row: 0, col: 0, rowSpan: 1, colSpan: 2 };
    const colSplit = splitCellsAtCol([colOriginal], 1, 0, 1);
    for (const piece of colSplit) {
      expect(piece.fontFamily).toBe('Georgia');
      expect(piece.fontSize).toBe(20);
      expect(piece.color).toBe('#ff0000');
      expect(piece.bold).toBe(true);
    }
  });
});

describe('mergeableBorders + hitTestBorder (지우개는 정확히 선 위에서만)', () => {
  it('2x2 표는 가로 경계 2개 + 세로 경계 2개, 총 4개의 병합 가능한 경계를 갖는다', () => {
    const rowSizes = [20, 20];
    const colSizes = [30, 30];
    const cells = createInitialCells(2, 2);
    const borders = mergeableBorders({ rowSizes, colSizes, cells });
    expect(borders).toHaveLength(4);
  });

  it('경계선 정확히 위(tolerance 안)에서만 찾아지고, 조금만 벗어나면(tolerance 밖) null이다', () => {
    const rowSizes = [20, 20];
    const colSizes = [30, 30];
    const cells = createInitialCells(2, 2);
    const table = { rowSizes, colSizes, cells };
    // 세로 경계는 x=30 위치(행 범위 0~40)에 있다.
    expect(hitTestBorder(table, 30, 10, 3)).not.toBeNull();
    expect(hitTestBorder(table, 30 + 2.9, 10, 3)).not.toBeNull(); // tolerance 안
    expect(hitTestBorder(table, 30 + 5, 10, 3)).toBeNull(); // tolerance 밖 — "가장 가까운 선"으로 스냅하지 않음
  });

  it('rowSpan/colSpan이 달라서 병합하면 계단 모양이 되는 경계는 mergeableBorders에서 제외된다', () => {
    // row0: col0(span1) + col1(span1). row1: col0~1을 합친 colSpan=2 셀 하나.
    // row0/row1 사이 경계는 열 범위가 안 맞아(위쪽 2칸 vs 아래쪽 1칸) 병합 대상이 아니다.
    const rowSizes = [20, 20];
    const colSizes = [30, 30];
    const cells = [
      { id: 'a', row: 0, col: 0, rowSpan: 1, colSpan: 1, lines: [] },
      { id: 'b', row: 0, col: 1, rowSpan: 1, colSpan: 1, lines: [] },
      { id: 'c', row: 1, col: 0, rowSpan: 1, colSpan: 2, lines: [] },
    ];
    const borders = mergeableBorders({ rowSizes, colSizes, cells });
    // a-b 사이 세로 경계 하나만 남고, a-c/b-c 가로 경계는 없어야 한다.
    expect(borders).toHaveLength(1);
    expect(borders[0].orientation).toBe('vertical');
  });
});

describe('mergeCellContents (병합 시 내용 처리)', () => {
  it('둘 다 내용이 있으면 한 줄로 이어붙인다(버그 수정: 예전엔 줄 2개로 나뉘어 표 셀에선 뒤쪽이 안 보였음)', () => {
    const a = [createPlainLine('foo')];
    const b = [createPlainLine('bar')];
    const merged = mergeCellContents(a, b);
    expect(merged).toHaveLength(1);
    expect(merged.map((l) => lineText(l))).toEqual(['foo bar']);
  });

  it('한쪽만 비어 있으면 내용 있는 쪽만 남는다', () => {
    const a = [createPlainLine('')];
    const b = [createPlainLine('bar')];
    expect(mergeCellContents(a, b).map((l) => lineText(l))).toEqual(['bar']);
    expect(mergeCellContents(b, a).map((l) => lineText(l))).toEqual(['bar']);
  });

  it('둘 다 비어 있으면 빈 내용 그대로다', () => {
    const a = [createPlainLine('')];
    const b = [createPlainLine('')];
    expect(mergeCellContents(a, b).map((l) => lineText(l))).toEqual(['']);
  });
});

describe('mergeCells', () => {
  it('가로 경계를 병합하면 rowSpan이 합쳐지고 내용도 합쳐진다', () => {
    const rowSizes = [20, 20];
    const colSizes = [30];
    const cells = [
      { id: 'a', row: 0, col: 0, rowSpan: 1, colSpan: 1, lines: [createPlainLine('top')] },
      { id: 'b', row: 1, col: 0, rowSpan: 1, colSpan: 1, lines: [createPlainLine('bottom')] },
    ];
    const border = mergeableBorders({ rowSizes, colSizes, cells })[0];
    const next = mergeCells(cells, border);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ row: 0, col: 0, rowSpan: 2, colSpan: 1 });
    // 버그 수정: 표 셀은 한 줄짜리 모델이라 두 셀 내용은 줄 하나로 합쳐져야 화면에도
    // 둘 다 보인다(예전엔 줄 2개로 나뉘어 뒤쪽이 화면에서 사라졌음).
    expect(next[0].lines.map((l) => lineText(l))).toEqual(['top bottom']);
  });

  it('버그 수정: 살아남는 셀(a)의 글꼴/크기/색상/굵기가 병합 후에도 유지된다', () => {
    const rowSizes = [20, 20];
    const colSizes = [30];
    const cells = [
      {
        id: 'a',
        row: 0,
        col: 0,
        rowSpan: 1,
        colSpan: 1,
        lines: [createPlainLine('top')],
        fontFamily: 'Georgia',
        fontSize: 20,
        color: '#ff0000',
        bold: true,
      },
      { id: 'b', row: 1, col: 0, rowSpan: 1, colSpan: 1, lines: [createPlainLine('bottom')] },
    ];
    const border = mergeableBorders({ rowSizes, colSizes, cells })[0];
    const next = mergeCells(cells, border);
    expect(next).toHaveLength(1);
    expect(next[0].fontFamily).toBe('Georgia');
    expect(next[0].fontSize).toBe(20);
    expect(next[0].color).toBe('#ff0000');
    expect(next[0].bold).toBe(true);
  });
});

describe('equalizeRange (간격 통일)', () => {
  it('선택 구간의 합은 유지한 채 모두 같은 크기로 만든다', () => {
    const next = equalizeRange([10, 50, 20, 40], 1, 2);
    expect(next[0]).toBe(10); // 범위 밖은 그대로
    expect(next[3]).toBe(40);
    expect(next[1]).toBe(35);
    expect(next[2]).toBe(35);
    expect(next[1] + next[2]).toBe(70);
  });

  it('범위가 뒤집혀 들어와도(from > to) 정상 동작한다', () => {
    const next = equalizeRange([10, 20, 30], 2, 0);
    expect(next.every((v) => v === 20)).toBe(true);
  });

  it('구간이 한 칸이면 아무것도 바꾸지 않는다', () => {
    const sizes = [10, 20, 30];
    expect(equalizeRange(sizes, 1, 1)).toBe(sizes);
  });
});

describe('atomicRangeFor', () => {
  it('로컬 좌표 범위를 세부 행/열 index 범위로 변환한다', () => {
    const sizes = [10, 10, 10, 10]; // offsets: 0,10,20,30,40
    expect(atomicRangeFor(sizes, 5, 25)).toEqual({ from: 0, to: 2 });
    expect(atomicRangeFor(sizes, 25, 5)).toEqual({ from: 0, to: 2 }); // 순서 무관
  });
});

describe('borderSegments (겉 테두리/내부 선이 겹쳐 그려지지 않아야 함)', () => {
  it('3x3 표는 세로선 4개 + 가로선 4개, 총 8개의 선분만 나온다(셀당 중복 없음)', () => {
    const rowSizes = [20, 20, 20];
    const colSizes = [30, 30, 30];
    const cells = createInitialCells(3, 3);
    const segments = borderSegments({ rowSizes, colSizes, cells });
    expect(segments).toHaveLength(8);
  });

  it('병합된 셀 내부의 지워진 경계는 다시 그리지 않는다', () => {
    const rowSizes = [20, 20];
    const colSizes = [30];
    const cells = [{ id: 'merged', row: 0, col: 0, rowSpan: 2, colSpan: 1, lines: [] }];
    const segments = borderSegments({ rowSizes, colSizes, cells });
    // 바깥 테두리(위/아래/좌/우) 4개만 있어야 하고, 중간(y=20) 가로선은 없어야 한다.
    expect(segments).toHaveLength(4);
    expect(segments.some((s) => s.y1 === 20 && s.y2 === 20)).toBe(false);
  });

  it('부분 선(한 열만 나뉘고 다른 열은 안 나뉜 경우)에서도 각 구간이 정확히 한 번만 나온다', () => {
    // 2행 2열, col0만 atRow=1에서 나뉘고 col1은 rowSpan=2로 그대로.
    const rowSizes = [20, 20];
    const colSizes = [30, 30];
    const cells = [
      { id: 'a', row: 0, col: 0, rowSpan: 1, colSpan: 1, lines: [] },
      { id: 'b', row: 1, col: 0, rowSpan: 1, colSpan: 1, lines: [] },
      { id: 'c', row: 0, col: 1, rowSpan: 2, colSpan: 1, lines: [] },
    ];
    const segments = borderSegments({ rowSizes, colSizes, cells });
    // 세로선: x=0(외곽, 1개), x=30(a/b와 c 사이 — 전체 높이, 1개), x=60(외곽, 1개) = 3개.
    // 가로선: y=0(외곽), y=40(외곽) 각 1개 + y=20에서 col0 구간(x:0~30)만 1개 = 3개.
    // 총 6개, 그리고 x=30 세로선은 반드시 "한 번에 이어진" 풀 높이 선분이어야 한다(겹쳐 그려지지 않음).
    const verticalAtSplit = segments.filter((s) => s.x1 === 30 && s.x2 === 30);
    expect(verticalAtSplit).toHaveLength(1);
    expect(verticalAtSplit[0]).toMatchObject({ y1: 0, y2: 40 });
    const horizontalAtMid = segments.filter((s) => s.y1 === 20 && s.y2 === 20);
    expect(horizontalAtMid).toHaveLength(1);
    expect(horizontalAtMid[0]).toMatchObject({ x1: 0, x2: 30 }); // col1 쪽(x:30~60)엔 없음
  });
});

describe('cellsInRange', () => {
  it('atomic 행/열 범위와 겹치는 셀만 반환한다', () => {
    const cells = createInitialCells(3, 3); // 9 cells, row/col 0..2
    const inRange = cellsInRange(cells, 0, 1, 0, 1);
    expect(inRange).toHaveLength(4); // (0,0)(0,1)(1,0)(1,1)
  });

  it('범위를 가로지르는(걸쳐 있는) 병합 셀도 포함한다', () => {
    const cells = [{ id: 'a', row: 0, col: 0, rowSpan: 2, colSpan: 2, lines: [] }];
    expect(cellsInRange(cells, 1, 1, 1, 1)).toHaveLength(1); // (1,1)만 골라도 이 셀과 겹침
    expect(cellsInRange(cells, 5, 6, 5, 6)).toHaveLength(0); // 완전히 범위 밖
  });

  it('from/to가 뒤집혀 있어도(to < from) 정상 동작한다', () => {
    const cells = createInitialCells(2, 2);
    expect(cellsInRange(cells, 1, 0, 1, 0)).toHaveLength(4);
  });
});

describe('expandRangeToCoverCells', () => {
  it('병합되지 않은 표에서는 범위를 그대로 반환한다', () => {
    const cells = createInitialCells(3, 3);
    expect(expandRangeToCoverCells(cells, 1, 1, 1, 1)).toEqual({ rowFrom: 1, rowTo: 1, colFrom: 1, colTo: 1 });
  });

  it('드래그가 병합된 셀의 일부만 지나가도 그 셀 전체를 포함하도록 범위를 넓힌다', () => {
    // 지우개로 (0,0)~(1,1) 4개 atomic 조각이 하나의 큰 셀로 병합된 3x3 표를 흉내낸다.
    const cells = [
      { id: 'merged', row: 0, col: 0, rowSpan: 2, colSpan: 2, lines: [] },
      { id: 'r0c2', row: 0, col: 2, rowSpan: 1, colSpan: 1, lines: [] },
      { id: 'r1c2', row: 1, col: 2, rowSpan: 1, colSpan: 1, lines: [] },
      { id: 'r2c0', row: 2, col: 0, rowSpan: 1, colSpan: 1, lines: [] },
      { id: 'r2c1', row: 2, col: 1, rowSpan: 1, colSpan: 1, lines: [] },
      { id: 'r2c2', row: 2, col: 2, rowSpan: 1, colSpan: 1, lines: [] },
    ];
    // 드래그가 atomic (1,1) 한 조각만 지나갔더라도(병합 셀의 우하단 모서리) 병합 셀
    // 전체((0,0)~(1,1))가 선택 범위에 포함돼야 한다.
    expect(expandRangeToCoverCells(cells, 1, 1, 1, 1)).toEqual({ rowFrom: 0, rowTo: 1, colFrom: 0, colTo: 1 });
  });

  it('병합 셀에서 시작해 바깥의 일반 셀까지 드래그하면 둘 다 포함하도록 넓힌다', () => {
    const cells = [
      { id: 'merged', row: 0, col: 0, rowSpan: 2, colSpan: 2, lines: [] },
      { id: 'r0c2', row: 0, col: 2, rowSpan: 1, colSpan: 1, lines: [] },
      { id: 'r1c2', row: 1, col: 2, rowSpan: 1, colSpan: 1, lines: [] },
      { id: 'r2c0', row: 2, col: 0, rowSpan: 1, colSpan: 1, lines: [] },
      { id: 'r2c1', row: 2, col: 1, rowSpan: 1, colSpan: 1, lines: [] },
      { id: 'r2c2', row: 2, col: 2, rowSpan: 1, colSpan: 1, lines: [] },
    ];
    // atomic (0,0)에서 (1,2)까지 드래그 — 병합 셀 모서리 한 조각 + 옆의 일반 셀 두 개.
    expect(expandRangeToCoverCells(cells, 0, 1, 0, 2)).toEqual({ rowFrom: 0, rowTo: 1, colFrom: 0, colTo: 2 });
  });

  it('from/to가 뒤집혀 있어도 정상 동작한다', () => {
    const cells = [{ id: 'merged', row: 0, col: 0, rowSpan: 2, colSpan: 2, lines: [] }];
    expect(expandRangeToCoverCells(cells, 1, 0, 1, 0)).toEqual({ rowFrom: 0, rowTo: 1, colFrom: 0, colTo: 1 });
  });
});

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
