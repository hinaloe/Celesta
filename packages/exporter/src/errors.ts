import type { ExportErrorReport, ExportIssue, ExportReport } from './types.js';

/**
 * A failed export. `code`, `message` and `hint` are the exporter's `--json`
 * error; this package adds `exporter_not_found` and `exporter_failed` for an
 * exporter that could not start or ended without a report, and `cancelled`
 * when it had to be stopped.
 */
export class CelestaExportError extends Error {
  readonly code: string;
  readonly hint?: string;
  readonly issues: ExportIssue[];
  /** The exporter's whole report, when it printed one. */
  readonly report?: ExportReport;
  /** What the exporter wrote to stderr, when it ended without a report. */
  readonly stderr?: string;

  constructor(
    error: ExportErrorReport,
    details: { report?: ExportReport; stderr?: string } = {},
  ) {
    super(error.message);
    this.name = 'CelestaExportError';
    this.code = error.code;
    if (error.hint !== undefined) this.hint = error.hint;
    this.issues = error.issues ?? [];
    if (details.report !== undefined) this.report = details.report;
    if (details.stderr !== undefined) this.stderr = details.stderr;
  }
}

export function usage(message: string): CelestaExportError {
  return new CelestaExportError({ code: 'usage', message });
}
