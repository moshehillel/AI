import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import { buildExcelAgentPayload, excelBufferToSheets } from "./planning-excel.js";

function makeXlsxBuffer(): Uint8Array {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["date", "amount", "vendor"],
    ["2024-01-01", 10, "Acme"],
    ["2024-01-02", 20, "Beta"],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Invoices");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Uint8Array(buf);
}

describe("planning excel conversion", () => {
  it("parses sheets into csv with headers", () => {
    const sheets = excelBufferToSheets(makeXlsxBuffer());
    assert.equal(sheets.length, 1);
    assert.equal(sheets[0]?.name, "Invoices");
    assert.ok(sheets[0]!.headers.includes("date"));
    assert.match(sheets[0]!.csv, /Acme/);
  });

  it("builds agent payload with csv text and short chat summary", () => {
    const { chatSummary, payload } = buildExcelAgentPayload({
      fileName: "ops.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: makeXlsxBuffer(),
    });
    assert.match(chatSummary, /ops\.xlsx \(Excel\)/);
    assert.equal(payload.kind, "excel");
    assert.match(payload.agentText ?? "", /### Sheet: Invoices/);
    assert.match(payload.agentText ?? "", /Acme/);
    assert.match(payload.agentNote, /does not accept \.xlsx/i);
  });
});
