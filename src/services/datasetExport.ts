import { IOzCliService, OzRunResult, OzRunStatus } from '../types/index.js';

/** Single normalised row produced by {@link DatasetExportService}. */
export interface DatasetRow {
  runId: string;
  status: OzRunStatus;
  durationMs: number;
  exitCode: number;
  /** First 4 KB of the run output, line-trimmed. */
  outputExcerpt: string;
}

/** Supported export formats. */
export type DatasetFormat = 'jsonl' | 'csv';

export interface DatasetExportOptions {
  format: DatasetFormat;
  /** Maximum number of runs to include (default: 200). */
  limit?: number;
  /**
   * When true, only `SUCCEEDED` and `FAILED` runs are exported. Defaults
   * to `true` so transient `INPROGRESS` rows do not pollute the dataset.
   */
  terminalOnly?: boolean;
  /** Per-row output cap in chars (default: 4000). */
  maxOutputChars?: number;
}

export interface IDatasetExportService {
  /** Builds and returns the formatted dataset as a single string. */
  export(options: DatasetExportOptions): Promise<string>;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/** Quotes a value for CSV — RFC 4180 conformant. */
export function csvQuote(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Serialises rows to RFC 4180 CSV with a header row. */
export function toCsv(rows: ReadonlyArray<DatasetRow>): string {
  const header = ['runId', 'status', 'durationMs', 'exitCode', 'outputExcerpt'].join(',');
  const body = rows
    .map((r) => [r.runId, r.status, r.durationMs, r.exitCode, r.outputExcerpt].map(csvQuote).join(','))
    .join('\n');
  return rows.length === 0 ? `${header}\n` : `${header}\n${body}\n`;
}

/** Serialises rows to JSON Lines — one record per line, no trailing newline. */
export function toJsonl(rows: ReadonlyArray<DatasetRow>): string {
  return rows.map((r) => JSON.stringify(r)).join('\n');
}

/** Truncates `text` to `maxChars`, breaking at a line boundary when possible. */
export function truncateOutput(text: string, maxChars: number): string {
  if (!text || maxChars <= 0) {
    return '';
  }
  if (text.length <= maxChars) {
    return text;
  }
  const sliced = text.slice(0, maxChars);
  const lastNl = sliced.lastIndexOf('\n');
  return lastNl > 0 ? sliced.slice(0, lastNl) : sliced;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 200;
const DEFAULT_MAX_OUTPUT_CHARS = 4000;
const TERMINAL: ReadonlySet<OzRunStatus> = new Set(['SUCCEEDED', 'FAILED']);

/** Default {@link IDatasetExportService}. */
export class DatasetExportService implements IDatasetExportService {
  constructor(private readonly cli: IOzCliService) {}

  async export(options: DatasetExportOptions): Promise<string> {
    const limit = options.limit ?? DEFAULT_LIMIT;
    const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
    const terminalOnly = options.terminalOnly !== false;

    if (limit <= 0) {
      throw new Error(`limit must be positive, got ${limit}`);
    }

    const list = await this.cli.runList();
    const candidates = terminalOnly
      ? list.items.filter((it) => TERMINAL.has(it.status))
      : list.items;
    const slice = candidates.slice(0, limit);

    const rows: DatasetRow[] = [];
    for (const item of slice) {
      const detail = await this.cli.runGet(item.id);
      rows.push(this.normalize(item.id, detail, maxOutputChars));
    }

    return options.format === 'csv' ? toCsv(rows) : toJsonl(rows);
  }

  private normalize(runId: string, detail: OzRunResult, maxOutputChars: number): DatasetRow {
    return {
      runId,
      status: detail.status,
      durationMs: Number.isFinite(detail.durationMs) ? detail.durationMs : 0,
      exitCode: Number.isFinite(detail.exitCode) ? detail.exitCode : -1,
      outputExcerpt: truncateOutput(detail.output ?? '', maxOutputChars),
    };
  }
}
