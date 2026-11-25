// Label sheet geometry (ADR-010). Values from Avery's published A4 templates; check on 3 printers before launch.
export const mm = (v: number): number => (v * 72) / 25.4; // millimetres to PDF points

export interface Sheet {
  name: string;
  cols: number; rows: number;
  labelW: number; labelH: number; // mm
  top: number; left: number;      // mm, page edge to first label
  pitchX: number; pitchY: number; // mm, label origin to next label origin
}

export const SHEETS = {
  L7165: { name: 'Avery L7165 (8 per sheet, 99.1 × 67.7 mm)', cols: 2, rows: 4, labelW: 99.1, labelH: 67.7, top: 13.1, left: 4.65, pitchX: 101.6, pitchY: 67.7 },
  L7163: { name: 'Avery L7163 (14 per sheet, 99.1 × 38.1 mm)', cols: 2, rows: 7, labelW: 99.1, labelH: 38.1, top: 15.15, left: 4.65, pitchX: 101.6, pitchY: 38.1 },
} as const satisfies Record<string, Sheet>;
export type SheetId = keyof typeof SHEETS;

export const PAGE = { w: mm(210), h: mm(297) };

export interface Rect { x: number; y: number; w: number; h: number }

/** Cells in reading order (left to right, top to bottom), in PDF points with a bottom-left origin. */
export function cellRects(s: Sheet): Rect[] {
  const out: Rect[] = [];
  for (let r = 0; r < s.rows; r++) {
    for (let c = 0; c < s.cols; c++) {
      const x = mm(s.left + c * s.pitchX);
      const topY = mm(s.top + r * s.pitchY);
      out.push({ x, y: PAGE.h - topY - mm(s.labelH), w: mm(s.labelW), h: mm(s.labelH) });
    }
  }
  return out;
}
