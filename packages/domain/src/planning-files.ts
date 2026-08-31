/** Planning chat file attachments — allowlist, size, and safe excerpts. */

export const PLANNING_FILE_MAX_BYTES = 2 * 1024 * 1024; // 2 MiB
export const PLANNING_ATTACHMENT_EXCERPT_MAX = 12_000;

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
].join(",");

export type PlanningFileKind = "pdf" | "csv" | "text" | "unsupported";

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
    ext === ".csv" ||
    ext === ".tsv" ||
    mime === "text/csv" ||
    mime === "application/csv" ||
    mime === "text/tab-separated-values" ||
    // Excel often labels CSV exports as this:
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

/** Summarize plain text / docs: filename + capped excerpt. */
export function summarizeTextForPlanning(opts: {
  fileName: string;
  raw: string;
  kind?: PlanningFileKind;
  maxChars?: number;
}): string {
  const max = opts.maxChars ?? PLANNING_ATTACHMENT_EXCERPT_MAX;
  const kind = opts.kind ?? "text";
  if (kind === "csv") return summarizeCsvForPlanning({ fileName: opts.fileName, raw: opts.raw, maxChars: max });

  const cleaned = opts.raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const label = kind === "pdf" ? "PDF" : "document";
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
    return `Unsupported file type for “${opts.fileName}”. Upload PDF, CSV, or a text/docs file (.txt, .md, .json, .html, …).`;
  }
  return `Could not use “${opts.fileName}”.`;
}
