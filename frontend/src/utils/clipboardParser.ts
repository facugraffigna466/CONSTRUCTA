// Parses TSV (tab-separated) text copied from Excel or MS Project
// and maps columns to Constructa task fields.

export interface ParsedRow {
  title: string;
  startDate: string | null;   // ISO YYYY-MM-DD or null
  dueDate: string | null;
  responsibleName: string | null;
  dependsOnRow: number | null; // 0-based index in the parsed rows array
}

export interface ColumnMap {
  title: number | null;
  startDate: number | null;
  dueDate: number | null;
  responsible: number | null;
  predecessors: number | null;
}

// Column name aliases — Spanish and English, case-insensitive
const TITLE_ALIASES      = ["nombre", "name", "task name", "tarea", "título", "titulo", "actividad"];
const START_ALIASES      = ["comienzo", "start", "inicio", "fecha inicio", "start date"];
const END_ALIASES        = ["fin", "finish", "vencimiento", "fecha fin", "end", "end date", "due date"];
const RESPONSIBLE_ALIASES = ["recursos", "resource names", "responsable", "asignado", "assigned to", "recurso"];
const PREDECESSOR_ALIASES = ["predecesoras", "predecessors", "dependencia", "depends on", "predecesora"];

export function parseTSV(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split("\t"));
}

export function detectColumns(headers: string[]): ColumnMap {
  const normalized = headers.map((h) => h.trim().toLowerCase());
  const find = (aliases: string[]) => {
    const idx = normalized.findIndex((h) => aliases.includes(h));
    return idx === -1 ? null : idx;
  };
  return {
    title:        find(TITLE_ALIASES),
    startDate:    find(START_ALIASES),
    dueDate:      find(END_ALIASES),
    responsible:  find(RESPONSIBLE_ALIASES),
    predecessors: find(PREDECESSOR_ALIASES),
  };
}

// Attempt to parse a date string in DD/MM/YYYY, MM/DD/YYYY, or ISO format.
// Returns ISO YYYY-MM-DD string or null.
function parseDate(raw: string): string | null {
  if (!raw || !raw.trim()) return null;
  const s = raw.trim();

  // ISO: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + "T00:00:00");
    return isNaN(d.getTime()) ? null : s;
  }

  // DD/MM/YYYY or MM/DD/YYYY — both are ambiguous, but Argentina uses DD/MM/YYYY
  const slashMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (slashMatch) {
    const day   = parseInt(slashMatch[1], 10);
    const month = parseInt(slashMatch[2], 10);
    const year  = parseInt(slashMatch[3], 10);
    // Assume DD/MM/YYYY (Argentina convention)
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const d = new Date(iso + "T00:00:00");
      return isNaN(d.getTime()) ? null : iso;
    }
  }

  return null;
}

// Parses a predecessor string like "3", "3,4", "3FS" (MS Project notation)
// Returns the first row index found (0-based, Project uses 1-based row IDs).
function parsePredecessorIndex(raw: string): number | null {
  if (!raw || !raw.trim()) return null;
  // Strip finish-to-start suffix like "3FS+1d" → keep "3"
  const match = raw.match(/\d+/);
  if (!match) return null;
  const rowNum = parseInt(match[0], 10);
  return isNaN(rowNum) ? null : rowNum - 1; // convert 1-based to 0-based
}

export function parseClipboardRows(text: string): {
  rows: ParsedRow[];
  columnMap: ColumnMap;
  hasHeader: boolean;
} {
  const grid = parseTSV(text);
  if (grid.length === 0) return { rows: [], columnMap: { title: null, startDate: null, dueDate: null, responsible: null, predecessors: null }, hasHeader: false };

  // Detect if first row is a header by checking for known column names
  const firstRow = grid[0];
  const candidateMap = detectColumns(firstRow);
  const hasHeader = candidateMap.title !== null || candidateMap.startDate !== null || candidateMap.dueDate !== null;

  const columnMap = hasHeader ? candidateMap : { title: 0, startDate: null, dueDate: null, responsible: null, predecessors: null };
  const dataRows  = hasHeader ? grid.slice(1) : grid;

  const rows: ParsedRow[] = dataRows
    .map((cells): ParsedRow | null => {
      const title = columnMap.title !== null ? cells[columnMap.title]?.trim() : cells[0]?.trim();
      if (!title) return null;

      return {
        title,
        startDate:       columnMap.startDate    !== null ? parseDate(cells[columnMap.startDate] ?? "")    : null,
        dueDate:         columnMap.dueDate       !== null ? parseDate(cells[columnMap.dueDate] ?? "")      : null,
        responsibleName: columnMap.responsible   !== null ? (cells[columnMap.responsible]?.trim() || null) : null,
        dependsOnRow:    columnMap.predecessors  !== null ? parsePredecessorIndex(cells[columnMap.predecessors] ?? "") : null,
      };
    })
    .filter((r): r is ParsedRow => r !== null);

  return { rows, columnMap, hasHeader };
}
