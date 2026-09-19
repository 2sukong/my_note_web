import { create } from 'zustand';

/**
 * 표(Table) 편집 모드 상태. 요구사항(표 그리기/지우개는 표를 먼저 선택해야만
 * 쓸 수 있는 서브모드): 상단 툴바의 activeTool(toolStore)과 별개로, 표 객체를
 * 더블클릭해서 들어가는 "편집 모드" 동안에만 그리기/지우개/셀 범위 드래그
 * 선택이 활성화된다(objects/table/TableObjectView.tsx). 다른 객체를 선택하거나
 * 캔버스 빈 곳을 클릭하거나 Escape를 누르면 편집 모드를 나간다.
 */
export type TableEditSubMode = 'draw' | 'erase' | null;

/** 표 편집 모드에서 엑셀처럼 드래그로 고른 셀 범위. from/to는 세부 행/열
 * (atomic row/col) index — cellRangeSelection이 있으면 canvas/PropertiesPanel.tsx의
 * "간격 통일" 버튼이 이 범위만 대상으로 하고, 없으면 표 전체를 대상으로 한다. */
export interface TableCellRangeSelection {
  tableId: string;
  rowFrom: number;
  rowTo: number;
  colFrom: number;
  colTo: number;
}

interface TableEditState {
  editingTableId: string | null;
  subMode: TableEditSubMode;
  cellRangeSelection: TableCellRangeSelection | null;
  enterEditMode: (tableId: string) => void;
  exitEditMode: () => void;
  setSubMode: (mode: TableEditSubMode) => void;
  setCellRangeSelection: (selection: TableCellRangeSelection | null) => void;
}

export const useTableEditStore = create<TableEditState>((set) => ({
  editingTableId: null,
  subMode: null,
  cellRangeSelection: null,
  enterEditMode: (tableId) => set({ editingTableId: tableId, subMode: null, cellRangeSelection: null }),
  exitEditMode: () => set({ editingTableId: null, subMode: null, cellRangeSelection: null }),
  setSubMode: (mode) => set({ subMode: mode }),
  setCellRangeSelection: (selection) => set({ cellRangeSelection: selection }),
}));
