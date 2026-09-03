import * as ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';

/**
 * 把 .xlsx 转成 Univer 只读渲染所需的最小 IWorkbookData 快照。
 * 只搬「值 + 合并单元格 + 列宽」，样式二期。
 * 磁盘上的 .xlsx 才是事实来源；此快照仅供前端查看和选区联动。
 */

const MAX_ROWS_PER_SHEET = 2000;
const MAX_COLS_PER_SHEET = 200;

// Univer CellValueType
const CELL_TYPE_STRING = 1;
const CELL_TYPE_NUMBER = 2;
const CELL_TYPE_BOOLEAN = 3;

export interface WorkbookSnapshot {
  id: string;
  name: string;
  sheetOrder: string[];
  sheets: Record<string, SheetSnapshot>;
  truncated: boolean;
}

interface SheetSnapshot {
  id: string;
  name: string;
  rowCount: number;
  columnCount: number;
  cellData: Record<number, Record<number, { v: string | number | boolean; t: number }>>;
  mergeData: Array<{ startRow: number; endRow: number; startColumn: number; endColumn: number }>;
  columnData?: Record<number, { w: number }>;
}

function cellToUniver(value: ExcelJS.CellValue): { v: string | number | boolean; t: number } | null {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number') return { v: value, t: CELL_TYPE_NUMBER };
  if (typeof value === 'boolean') return { v: value, t: CELL_TYPE_BOOLEAN };
  if (typeof value === 'string') return { v: value, t: CELL_TYPE_STRING };
  if (value instanceof Date) return { v: value.toISOString().slice(0, 19).replace('T', ' '), t: CELL_TYPE_STRING };

  // Rich object cell values
  const obj = value as unknown as Record<string, unknown>;
  if ('result' in obj && obj.result !== undefined && obj.result !== null) {
    return cellToUniver(obj.result as ExcelJS.CellValue);
  }
  if ('text' in obj && typeof obj.text === 'string') {
    return { v: obj.text, t: CELL_TYPE_STRING };
  }
  if ('richText' in obj && Array.isArray(obj.richText)) {
    const text = (obj.richText as Array<{ text?: string }>).map((part) => part.text ?? '').join('');
    return text ? { v: text, t: CELL_TYPE_STRING } : null;
  }
  if ('formula' in obj) {
    return { v: `=${String(obj.formula)}`, t: CELL_TYPE_STRING };
  }
  if ('error' in obj) {
    return { v: String(obj.error), t: CELL_TYPE_STRING };
  }
  return { v: String(value), t: CELL_TYPE_STRING };
}

function columnLetterToIndex(letters: string): number {
  let index = 0;
  for (const char of letters.toUpperCase()) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

/** "A1:B3" → 0-based Univer range. */
function parseMerge(ref: string): { startRow: number; endRow: number; startColumn: number; endColumn: number } | null {
  const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref.toUpperCase());
  if (!match) return null;
  return {
    startColumn: columnLetterToIndex(match[1]),
    startRow: Number(match[2]) - 1,
    endColumn: columnLetterToIndex(match[3]),
    endRow: Number(match[4]) - 1,
  };
}

export async function xlsxToSnapshot(absPath: string, workbookName: string): Promise<WorkbookSnapshot> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(absPath);

  const sheetOrder: string[] = [];
  const sheets: Record<string, SheetSnapshot> = {};
  let truncated = false;

  workbook.eachSheet((worksheet) => {
    const sheetId = `sheet-${randomUUID().slice(0, 8)}`;
    sheetOrder.push(sheetId);

    const rawRows = worksheet.actualRowCount || worksheet.rowCount || 0;
    const rawCols = worksheet.actualColumnCount || worksheet.columnCount || 0;
    const rowLimit = Math.min(rawRows, MAX_ROWS_PER_SHEET);
    const colLimit = Math.min(Math.max(rawCols, 1), MAX_COLS_PER_SHEET);
    if (rawRows > rowLimit || rawCols > colLimit) truncated = true;

    const cellData: SheetSnapshot['cellData'] = {};
    for (let r = 1; r <= rowLimit; r += 1) {
      const row = worksheet.getRow(r);
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (colNumber > colLimit) return;
        const converted = cellToUniver(cell.value);
        if (!converted) return;
        (cellData[r - 1] ??= {})[colNumber - 1] = converted;
      });
    }

    const mergeData: SheetSnapshot['mergeData'] = [];
    const merges = (worksheet.model as { merges?: string[] }).merges ?? [];
    for (const ref of merges) {
      const parsed = parseMerge(ref);
      if (parsed && parsed.startRow < rowLimit && parsed.startColumn < colLimit) mergeData.push(parsed);
    }

    const columnData: Record<number, { w: number }> = {};
    worksheet.columns?.forEach((column, index) => {
      if (index >= colLimit) return;
      if (typeof column.width === 'number' && column.width > 0) {
        columnData[index] = { w: Math.round(column.width * 7 + 5) };
      }
    });

    sheets[sheetId] = {
      id: sheetId,
      name: worksheet.name,
      rowCount: Math.max(rowLimit, 50),
      columnCount: Math.max(colLimit, 20),
      cellData,
      mergeData,
      ...(Object.keys(columnData).length ? { columnData } : {}),
    };
  });

  return {
    id: `wb-${randomUUID().slice(0, 8)}`,
    name: workbookName,
    sheetOrder,
    sheets,
    truncated,
  };
}
