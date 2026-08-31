import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PLANNING_FILE_MAX_BYTES,
  classifyPlanningFile,
  looksLikeBinaryText,
  summarizeCsvForPlanning,
  summarizeTextForPlanning,
  validatePlanningFileSize,
} from "./planning-files.js";

describe("planning file attachments", () => {
  it("classifies pdf and csv by extension and mime", () => {
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
    assert.equal(classifyPlanningFile({ fileName: "notes.md" }), "text");
    assert.equal(classifyPlanningFile({ fileName: "photo.png" }), "unsupported");
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
    const rows = ["date,amount,vendor", ...Array.from({ length: 80 }, (_, i) => `2024-01-01,${i},Acme`)];
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
});
