import { useEffect, useRef } from 'react';
import { LocaleType, mergeLocales, createUniver } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import UniverPresetSheetsCoreZhCN from '@univerjs/preset-sheets-core/locales/zh-CN';
import '@univerjs/preset-sheets-core/lib/index.css';
import type { WorkbookSnapshot } from '../lib/api';

export type SheetSelection = { sheet: string; range: string };

type Props = {
  /** 后端 exceljs 转换出的 Univer 快照。null 时显示空态。 */
  workbook: WorkbookSnapshot | null;
  onSelectionChange?: (selection: SheetSelection | null) => void;
};

type UniverHandle = {
  univer: { dispose: () => void };
  univerAPI: {
    createWorkbook: (data: unknown) => {
      setEditable?: (value: boolean) => void;
      dispose?: () => void;
    };
    addEvent: (event: string, handler: (params: unknown) => void) => { dispose: () => void };
    Event: Record<string, string>;
  };
};

function rangeToA1(range: { startRow: number; endRow: number; startColumn: number; endColumn: number }): string {
  const col = (index: number): string => {
    let n = index + 1;
    let s = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  };
  const first = `${col(range.startColumn)}${range.startRow + 1}`;
  const last = `${col(range.endColumn)}${range.endRow + 1}`;
  return first === last ? first : `${first}:${last}`;
}

export function UniverViewer({ workbook, onSelectionChange }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<UniverHandle | null>(null);
  const currentWorkbookRef = useRef<{ dispose?: () => void } | null>(null);
  const selectionCbRef = useRef(onSelectionChange);
  useEffect(() => { selectionCbRef.current = onSelectionChange; });

  // Create the Univer instance once.
  useEffect(() => {
    if (!containerRef.current) return;
    const { univer, univerAPI } = createUniver({
      locale: LocaleType.ZH_CN,
      locales: { [LocaleType.ZH_CN]: mergeLocales(UniverPresetSheetsCoreZhCN) },
      presets: [
        UniverSheetsCorePreset({
          container: containerRef.current,
          header: false,
          footer: { sheetBar: true, statisticBar: true, menus: false, zoomSlider: false },
          formulaBar: false,
          contextMenu: false,
        }),
      ],
    }) as unknown as UniverHandle;
    handleRef.current = { univer, univerAPI };

    let disposable: { dispose: () => void } | null = null;
    try {
      disposable = univerAPI.addEvent(univerAPI.Event.SelectionChanged, (params) => {
        const cb = selectionCbRef.current;
        if (!cb) return;
        const p = params as { worksheet?: { getSheetName?: () => string }; selections?: Array<{ startRow: number; endRow: number; startColumn: number; endColumn: number }> };
        const first = p.selections?.[0];
        const sheet = p.worksheet?.getSheetName?.() ?? '';
        if (!first) { cb(null); return; }
        cb({ sheet, range: rangeToA1(first) });
      });
    } catch {
      // Selection events are best-effort; the viewer still works without them.
    }

    return () => {
      disposable?.dispose();
      currentWorkbookRef.current?.dispose?.();
      currentWorkbookRef.current = null;
      handleRef.current = null;
      univer.dispose();
    };
  }, []);

  // Load / swap the workbook data.
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle || !workbook) return;
    currentWorkbookRef.current?.dispose?.();
    try {
      const fWorkbook = handle.univerAPI.createWorkbook(workbook);
      fWorkbook.setEditable?.(false);
      currentWorkbookRef.current = fWorkbook;
    } catch (cause) {
      console.error('[univer] createWorkbook failed', cause);
    }
    selectionCbRef.current?.(null);
  }, [workbook]);

  return <div ref={containerRef} className="univer-viewer" />;
}
