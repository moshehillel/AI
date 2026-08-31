/** Planning chat file attachments — allowlist, size, and safe excerpts. */

export const PLANNING_FILE_MAX_BYTES = 2 * 1024 * 1024; // 2 MiB
export const PLANNING_ATTACHMENT_EXCERPT_MAX = 12_000;
/** Cursor Cloud Agents API allows at most 5 images per prompt. */
export const PLANNING_AGENT_MAX_IMAGES = 5;

const EXT_MIME: Record<string, string[]> = {
  ".txt": ["text/plain"],
  ".md": ["text/markdown", "text/plain"],
  ".markdown": ["text/markdown", "text/plain"],
  ".json": ["application/json", "text/json", "text/plain"],
  ".yaml": ["application/yaml", "text/yaml", "text/plain"],
  ".yml": ["application/yaml", "text/yaml", "text/plain"],
  ".csv": ["text/csv", "application/csv", "text/plain", "application/vnd.ms-excel"],
  ".tsv": ["text/tab-separated-values", "text/plain"],
  ".xml": ["application/xml", "text/xml"],
  ".html": ["text/html"],
  ".htm": ["text/html"],
  ".pdf": ["application/pdf"],
  ".xlsx": [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream",
  ],
  ".xls": ["application/vnd.ms-excel", "application/octet-stream"],
  ".ts": ["text/plain", "text/typescript", "application/typescript"],
  ".js": ["text/javascript", "application/javascript", "text/plain"],
  ".py": ["text/x-python", "application/x-python", "text/plain"],
};

/** Value for `<input type="file" accept=…>` — extensions + MIME types. */
export const PLANNING_FILE_ACCEPT = [
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".yaml",
  ".yml",
  ".csv",
  ".tsv",
  ".xml",
  ".html",
  ".htm",
  ".pdf",
  ".xlsx",
  ".xls",
  ".ts",
  ".js",
  ".py",
  "text/plain",
  "text/csv",
  "application/csv",
  "application/pdf",
  "application/json",
  "text/markdown",
  "text/html",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
].join(",");

export type PlanningFileKind =
  | "pdf"
  | "csv"
  | "excel"
  | "text"
  | "unsupported";

export type AgentAttachmentImage = {
  data: string; // base64
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
};

/** Payload stored for the Cursor agent (not dumped into chat Goal). */
export type PlanningAgentFilePayload = {
  fileName: string;
  kind: Exclude<PlanningFileKind, "unsupported">;
  mimeType: string;
  /** Short note for the agent prompt (paths, sheet names, page counts). */
  agentNote: string;
  /** Structured text for the agent (CSV sheets, text excerpt). */
  agentText?: string;
  /**
   * Cursor SDK / Cloud Agents API only accepts raster images on `prompt.images`.
   * PDF pages are rendered to PNG so layout is visible to the model.
   */
  images?: AgentAttachmentImage[];
  /** Original file bytes (base64) — for audit / reprocess; not pasted into Goal. */
  originalBase64?: string;
};

export function extensionOf(fileName: string): string {
  const base = fileName.trim().toLowerCase();
  const i = base.lastIndexOf(".");
  return i >= 0 ? base.slice(i) : "";
}

export function classifyPlanningFile(opts: {
  fileName: string;
  mimeType?: string | null;
}): PlanningFileKind {
  const ext = extensionOf(opts.fileName);
  const mime = (opts.mimeType ?? "").toLowerCase().split(";")[0]?.trim() ?? "";

  if (ext === ".pdf" || mime === "application/pdf") return "pdf";
  if (
    ext === ".xlsx" ||
    mime ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return "excel";
  }
  if (
    ext === ".xls" ||
    (mime === "application/vnd.ms-excel" &&
      ext !== ".csv" &&
      ext !== ".tsv")
  ) {
    return "excel";
  }
  if (
    ext === ".csv" ||
    ext === ".tsv" ||
    mime === "text/csv" ||
    mime === "application/csv" ||
    mime === "text/tab-separated-values" ||
    (mime === "application/vnd.ms-excel" && (ext === ".csv" || ext === ".tsv"))
  ) {
    return "csv";
  }
  if (ext && EXT_MIME[ext]) return "text";
  if (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/yaml"
  ) {
    return "text";
  }
  return "unsupported";
}

export function validatePlanningFileSize(sizeBytes: number): string | null {
  if (sizeBytes <= 0) return "That file looks empty.";
  if (sizeBytes > PLANNING_FILE_MAX_BYTES) {
    const mb = (PLANNING_FILE_MAX_BYTES / (1024 * 1024)).toFixed(0);
    return `File is too large. Max size is ${mb} MB.`;
  }
  return null;
}

/** Detect binary / PDF bytes mis-read as UTF-8 text. */
export function looksLikeBinaryText(sample: string): boolean {
  const s = sample.slice(0, 8000);
  if (!s) return false;
  if (s.includes("\u0000")) return true;
  if (s.startsWith("%PDF-")) return true;
  if (s.startsWith("PK\u0003\u0004") || s.charCodeAt(0) === 0xd0) {
    return true;
  }
  let weird = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 9 || (c > 13 && c < 32) || c === 0xfffd) weird++;
  }
  return weird / s.length > 0.25;
}

function truncate(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: text.slice(0, max).trimEnd(), truncated: true };
}

/** Summarize CSV/TSV: headers, row count, first rows — not the whole file. */
export function summarizeCsvForPlanning(opts: {
  fileName: string;
  raw: string;
  maxChars?: number;
}): string {
  const max = opts.maxChars ?? PLANNING_ATTACHMENT_EXCERPT_MAX;
  const normalized = opts.raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n").filter((l, idx, arr) => !(idx === arr.length - 1 && l === ""));
  const header = lines[0]?.trim() ?? "";
  const dataRows = lines.slice(1).filter((l) => l.trim().length > 0);
  const previewRows = dataRows.slice(0, 25);
  const colCount = header ? header.split(/,|\t/).length : 0;

  const parts = [
    `File: ${opts.fileName} (CSV/TSV)`,
    `Rows: ${dataRows.length}${header ? ` · Columns: ${colCount}` : ""}`,
  ];
  if (header) {
    parts.push(`Headers: ${header.slice(0, 500)}`);
  }
  parts.push("Excerpt (first rows):");
  const body = [header, ...previewRows].filter(Boolean).join("\n");
  const { text, truncated } = truncate(body, Math.max(500, max - parts.join("\n").length - 40));
  parts.push(text);
  if (truncated || dataRows.length > previewRows.length) {
    parts.push("…(truncated for planning — full file not pasted into the Goal)");
  }
  return parts.join("\n");
}

/** Short human-facing chat summary for Excel (not the full sheet dump). */
export function summarizeExcelForPlanning(opts: {
  fileName: string;
  sheetSummaries: Array<{
    name: string;
    rows: number;
    cols: number;
    headers: string[];
  }>;
}): string {
  const sheets = opts.sheetSummaries;
  const parts = [
    `File: ${opts.fileName} (Excel)`,
    `Sheets: ${sheets.length || 0}`,
  ];
  for (const s of sheets.slice(0, 8)) {
    const headers = s.headers.slice(0, 12).join(", ");
    parts.push(
      `- ${s.name}: ${s.rows} rows × ${s.cols} cols${headers ? ` · ${headers}` : ""}`,
    );
  }
  if (sheets.length > 8) {
    parts.push(`…(+${sheets.length - 8} more sheets)`);
  }
  parts.push(
    "Full sheet data is sent to Koda as structured CSV (Cursor API does not accept .xlsx natively).",
  );
  return parts.join("\n");
}

/** Short chat line when PDF layout images are attached for the agent. */
export function summarizePdfChatForPlanning(opts: {
  fileName: string;
  pageCount: number;
  imagesAttached: number;
  textExcerpt?: string;
}): string {
  const parts = [
    `File: ${opts.fileName} (PDF)`,
    `Pages: ${opts.pageCount} · Layout images sent to Koda: ${opts.imagesAttached}`,
  ];
  if (opts.textExcerpt?.trim()) {
    const { text, truncated } = truncate(opts.textExcerpt.trim(), 800);
    parts.push("Text preview:", text);
    if (truncated) parts.push("…(truncated for chat — layout images carry the full pages)");
  }
  return parts.join("\n");
}

/** Summarize plain text / docs: filename + capped excerpt. */
export function summarizeTextForPlanning(opts: {
  fileName: string;
  raw: string;
  kind?: PlanningFileKind;
  maxChars?: number;
}): string {
  const max = opts.maxChars ?? PLANNING_ATTACHMENT_EXCERPT_MAX;
  const kind = opts.kind ?? "text";
  if (kind === "csv") {
    return summarizeCsvForPlanning({
      fileName: opts.fileName,
      raw: opts.raw,
      maxChars: max,
    });
  }

  const cleaned = opts.raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const label =
    kind === "pdf" ? "PDF" : kind === "excel" ? "Excel" : "document";
  const { text, truncated } = truncate(cleaned, max);
  const parts = [
    `File: ${opts.fileName} (${label})`,
    "Extracted text for planning:",
    text || "(no extractable text)",
  ];
  if (truncated) {
    parts.push("…(truncated for planning — full file not pasted into the Goal)");
  }
  return parts.join("\n");
}

export function formatPlanningFileRejection(opts: {
  fileName: string;
  mimeType?: string | null;
}): string {
  const kind = classifyPlanningFile(opts);
  if (kind === "unsupported") {
    return `Unsupported file type for “${opts.fileName}”. Upload PDF, Excel (.xlsx/.xls), CSV, or a text/docs file (.txt, .md, .json, .html, …).`;
  }
  return `Could not use “${opts.fileName}”.`;
}

/** Build the agent-facing prompt addendum from a stored payload. */
export function formatAgentFilePromptSection(
  payload: PlanningAgentFilePayload,
): string {
  const parts = [
    `[Attached file for layout/structure analysis: ${payload.fileName} (${payload.kind})]`,
    payload.agentNote,
  ];
  if (payload.images?.length) {
    parts.push(
      `${payload.images.length} page image(s) are attached to this message via the Cursor images API so you can see layout/tables visually.`,
    );
  }
  if (payload.agentText?.trim()) {
    parts.push("Structured content:", payload.agentText.trim());
  }
  return parts.join("\n\n");
}
