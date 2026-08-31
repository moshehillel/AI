import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PLANNING_FILE_ACCEPT,
  PLANNING_FILE_MAX_BYTES,
  classifyPlanningFile,
  formatAgentFilePromptSection,
  looksLikeBinaryText,
  summarizeCsvForPlanning,
  summarizeExcelForPlanning,
  summarizePdfChatForPlanning,
  summarizeTextForPlanning,
  validatePlanningFileSize,
} from "./planning-files.js";

describe("planning file attachments", () => {
  it("classifies pdf, csv, and excel by extension and mime", () => {
    assert.equal(classifyPlanningFile({ fileName: "a.pdf" }), "pdf");
    assert.equal(
      classifyPlanningFile({ fileName: "x", mimeType: "application/pdf" }),
      "pdf",
    );
    assert.equal(classifyPlanningFile({ fileName: "data.CSV" }), "csv");
    assert.equal(
      classifyPlanningFile({
        fileName: "export.csv",
        mimeType: "application/vnd.ms-excel",
      }),
      "csv",
    );
    assert.equal(classifyPlanningFile({ fileName: "book.xlsx" }), "excel");
    assert.equal(classifyPlanningFile({ fileName: "legacy.xls" }), "excel");
    assert.equal(
      classifyPlanningFile({
        fileName: "book.xlsx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      "excel",
    );
    assert.equal(classifyPlanningFile({ fileName: "notes.md" }), "text");
    assert.equal(classifyPlanningFile({ fileName: "photo.png" }), "unsupported");
  });

  it("includes excel extensions in the file picker accept list", () => {
    assert.match(PLANNING_FILE_ACCEPT, /\.xlsx/);
    assert.match(PLANNING_FILE_ACCEPT, /\.xls/);
    assert.match(PLANNING_FILE_ACCEPT, /spreadsheetml\.sheet/);
  });

  it("rejects oversized and empty files", () => {
    assert.match(validatePlanningFileSize(0) ?? "", /empty/i);
    assert.match(
      validatePlanningFileSize(PLANNING_FILE_MAX_BYTES + 1) ?? "",
      /too large/i,
    );
    assert.equal(validatePlanningFileSize(100), null);
  });

  it("summarizes csv with headers and row count without dumping everything", () => {
    const rows = [
      "date,amount,vendor",
      ...Array.from({ length: 80 }, (_, i) => `2024-01-01,${i},Acme`),
    ];
    const summary = summarizeCsvForPlanning({
      fileName: "invoices.csv",
      raw: rows.join("\n"),
      maxChars: 2000,
    });
    assert.match(summary, /invoices\.csv/);
    assert.match(summary, /Rows: 80/);
    assert.match(summary, /Headers: date,amount,vendor/);
    assert.match(summary, /truncated for planning/i);
    assert.ok(summary.length < 2500);
  });

  it("summarizes excel sheets without dumping cell values into chat summary", () => {
    const summary = summarizeExcelForPlanning({
      fileName: "ops.xlsx",
      sheetSummaries: [
        {
          name: "Invoices",
          rows: 120,
          cols: 4,
          headers: ["date", "amount", "vendor", "status"],
        },
        { name: "Vendors", rows: 10, cols: 2, headers: ["id", "name"] },
      ],
    });
    assert.match(summary, /ops\.xlsx \(Excel\)/);
    assert.match(summary, /Invoices/);
    assert.match(summary, /structured CSV/i);
    assert.ok(!summary.includes("2024-01-01"));
  });

  it("summarizes pdf chat with layout image counts", () => {
    const summary = summarizePdfChatForPlanning({
      fileName: "spec.pdf",
      pageCount: 12,
      imagesAttached: 5,
      textExcerpt: "Cover page",
    });
    assert.match(summary, /spec\.pdf \(PDF\)/);
    assert.match(summary, /Layout images sent to Koda: 5/);
  });

  it("summarizes pdf/text with filename note and truncation", () => {
    const summary = summarizeTextForPlanning({
      fileName: "spec.pdf",
      kind: "pdf",
      raw: "A".repeat(5000),
      maxChars: 500,
    });
    assert.match(summary, /spec\.pdf \(PDF\)/);
    assert.match(summary, /Extracted text for planning/);
    assert.match(summary, /truncated for planning/i);
    assert.ok(!summary.includes("A".repeat(1000)));
  });

  it("detects binary / pdf bytes mis-read as text", () => {
    assert.equal(looksLikeBinaryText("%PDF-1.4\n..."), true);
    assert.equal(looksLikeBinaryText("date,amount\n1,2\n"), false);
    assert.equal(looksLikeBinaryText(`hello\u0000world`), true);
  });

  it("formats agent prompt section without being a Goal dump", () => {
    const section = formatAgentFilePromptSection({
      fileName: "a.pdf",
      kind: "pdf",
      mimeType: "application/pdf",
      agentNote: "3 pages rendered",
      images: [{ data: "abc", mimeType: "image/png" }],
    });
    assert.match(section, /Attached file for layout/);
    assert.match(section, /images API/);
  });
});
