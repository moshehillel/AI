import * as XLSX from "xlsx";
import {
  PLANNING_ATTACHMENT_EXCERPT_MAX,
  summarizeCsvForPlanning,
  summarizeExcelForPlanning,
  type PlanningAgentFilePayload,
} from "./planning-files.js";

export type ExcelSheetSummary = {
  name: string;
  rows: number;
  cols: number;
  headers: string[];
  csv: string;
};

/** Parse .xlsx / .xls into per-sheet CSV + chat-safe summary. */
export function excelBufferToSheets(buffer: Uint8Array): ExcelSheetSummary[] {
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: true,
    dense: false,
  });
  const sheets: ExcelSheetSummary[] = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<Array<unknown>>(sheet, {
      header: 1,
      defval: "",
      raw: false,
    }) as unknown[][];
    const dataRows = rows.filter((r) =>
      Array.isArray(r) ? r.some((c) => String(c ?? "").trim() !== "") : false,
    );
    const headerRow = (dataRows[0] ?? []).map((c) => String(c ?? "").trim());
    const cols = Math.max(0, ...dataRows.map((r) => (Array.isArray(r) ? r.length : 0)));
    const csv = XLSX.utils.sheet_to_csv(sheet, { FS: ",", RS: "\n" });
    sheets.push({
      name,
      rows: Math.max(0, dataRows.length - (headerRow.some(Boolean) ? 1 : 0)),
      cols,
      headers: headerRow.filter(Boolean).slice(0, 40),
      csv,
    });
  }
  return sheets;
}

export function buildExcelAgentPayload(opts: {
  fileName: string;
  mimeType: string;
  buffer: Uint8Array;
  includeOriginal?: boolean;
}): {
  chatSummary: string;
  payload: PlanningAgentFilePayload;
} {
  const sheets = excelBufferToSheets(opts.buffer);
  if (!sheets.length) {
    throw new Error("That Excel file has no readable sheets.");
  }

  const chatSummary = summarizeExcelForPlanning({
    fileName: opts.fileName,
    sheetSummaries: sheets.map((s) => ({
      name: s.name,
      rows: s.rows,
      cols: s.cols,
      headers: s.headers,
    })),
  });

  const maxAgentChars = PLANNING_ATTACHMENT_EXCERPT_MAX * 3;
  const chunks: string[] = [];
  let used = 0;
  for (const s of sheets) {
    const block = `### Sheet: ${s.name}\n${s.csv.trim()}\n`;
    if (used + block.length > maxAgentChars) {
      const remaining = maxAgentChars - used;
      if (remaining > 200) {
        chunks.push(
          `### Sheet: ${s.name}\n${s.csv.trim().slice(0, remaining)}\n…(truncated)`,
        );
      } else {
        chunks.push(`…(remaining sheets truncated for size)`);
      }
      break;
    }
    chunks.push(block);
    used += block.length;
  }

  const preview =
    sheets[0] &&
    summarizeCsvForPlanning({
      fileName: `${opts.fileName} / ${sheets[0].name}`,
      raw: sheets[0].csv,
      maxChars: 2000,
    });

  const payload: PlanningAgentFilePayload = {
    fileName: opts.fileName,
    kind: "excel",
    mimeType:
      opts.mimeType ||
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    agentNote: [
      "Cursor Cloud Agents API does not accept .xlsx/.xls as native attachments.",
      "This workbook was converted to structured CSV (one section per sheet) so columns/rows are preserved.",
      `Sheets: ${sheets.map((s) => s.name).join(", ")}`,
      preview ? `Preview of first sheet:\n${preview}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    agentText: chunks.join("\n"),
    originalBase64: opts.includeOriginal
      ? Buffer.from(opts.buffer).toString("base64")
      : undefined,
  };

  return { chatSummary, payload };
}
