import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDetailedPlanMermaid,
  countMermaidNodes,
  isDetailedMermaid,
  mermaidLabel,
  resolvePlanMermaid,
} from "./plan-diagram.js";

describe("plan-diagram", () => {
  const excelPlan = [
    "# Plan: Payroll Excel",
    "",
    "## Goal",
    "When staff upload a payroll file, extract fields, calculate totals, map service codes, fill the Excel template, validate, and let them download the result.",
    "",
    "## Systems",
    "- Upload portal",
    "- Excel template",
    "- Code mapping table",
    "",
    "## Workflow",
    "1. User uploads source file",
    "2. Extract rows and normalize columns",
    "3. Calculate derived amounts and totals",
    "4. Map provider codes to billing codes",
    "5. Fill the Excel output template",
    "6. Validate required fields and totals",
    "7. Surface errors for correction",
    "8. Offer completed file for download",
  ].join("\n");

  it("builds a multi-step flowchart from workflow steps", () => {
    const chart = resolvePlanMermaid(excelPlan);
    assert.match(chart, /flowchart TD/);
    assert.ok(countMermaidNodes(chart) >= 8);
    assert.match(chart, /upload/i);
    assert.match(chart, /Excel/i);
    assert.match(chart, /download/i);
  });

  it("does not truncate long step labels", () => {
    const long =
      "Extract every column from the uploaded payroll spreadsheet and normalize date and currency formats";
    const label = mermaidLabel(long);
    assert.match(label, /spreadsheet/);
    assert.match(label, /currency/);
    assert.doesNotMatch(label, /…/);
  });

  it("wraps long labels with line breaks instead of cutting them off", () => {
    const label = mermaidLabel(
      "Map provider service codes to billing codes using the lookup table",
    );
    assert.match(label, /<br\/>/);
  });

  it("rejects generic 3-box embedded mermaid in favor of detailed build", () => {
    const generic = [
      excelPlan,
      "",
      "## Diagram",
      "```mermaid",
      "flowchart LR",
      "  A[Source] --> B[Koda automation] --> C[Destination]",
      "```",
    ].join("\n");
    const chart = resolvePlanMermaid(generic);
    assert.ok(countMermaidNodes(chart) >= 5);
    assert.doesNotMatch(chart, /Koda automation.*Destination/s);
  });

  it("keeps embedded mermaid when it is already detailed", () => {
    const detailed = [
      excelPlan,
      "",
      "## Diagram",
      "```mermaid",
      "flowchart TD",
      '  s0["Upload"]',
      '  s1["Extract"]',
      '  s2["Calculate"]',
      '  s3["Map codes"]',
      '  s4["Fill Excel"]',
      '  s5["Validate"]',
      "  s0 --> s1 --> s2 --> s3 --> s4 --> s5",
      "```",
    ].join("\n");
    const chart = resolvePlanMermaid(detailed);
    assert.ok(isDetailedMermaid(chart));
    assert.match(chart, /Map codes/);
  });

  it("buildDetailedPlanMermaid includes goal and completion nodes", () => {
    const chart = buildDetailedPlanMermaid({
      goal: "Sync invoices to QuickBooks",
      steps: ["Read email", "Create bill", "Notify on failure"],
      systems: ["Gmail", "QuickBooks", "Slack"],
    });
    assert.match(chart, /Sync invoices/);
    assert.match(chart, /QuickBooks/);
    assert.ok(countMermaidNodes(chart) >= 5);
  });

  it("splits compound workflow lines on arrows and then", () => {
    const plan = [
      "# Plan: Test",
      "## Goal",
      "Automate payroll",
      "## Systems",
      "- Excel",
      "## Workflow",
      "1. Upload file → extract rows → calculate totals",
    ].join("\n");
    const chart = resolvePlanMermaid(plan);
    assert.match(chart, /Upload file/i);
    assert.match(chart, /extract rows/i);
    assert.match(chart, /calculate totals/i);
  });
});
