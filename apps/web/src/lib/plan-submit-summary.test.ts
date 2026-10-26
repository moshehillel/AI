import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSubmitSummary,
  getMeaningfulPlanMermaid,
  isGenericMermaid,
} from "./plan-submit-summary.ts";

const schoolPlan = [
  "# Plan: School timesheet automation",
  "",
  "## Goal",
  "Save school office staff time by turning provider session PDFs into Excel timesheets.",
  "",
  "## Systems",
  "- Provider Soft",
  "- School PDF uploads",
  "- Excel timesheet",
  "",
  "## Workflow",
  "1. When staff upload a provider session PDF",
  "2. Read fields from the PDF and calculate service codes",
  "3. Fill the Excel timesheet with the calculated rows",
  "4. Record success and flag failures for review",
  "",
  "## What you need to provide",
  "- [ ] Provider Soft login — use Add secrets / credentials",
  "- [ ] A sample provider session PDF",
].join("\n");

describe("buildSubmitSummary", () => {
  it("builds plain-English bullets from living plan sections", () => {
    const { bullets } = buildSubmitSummary(schoolPlan);
    assert.ok(bullets.length >= 3);
    assert.match(bullets[0], /upload|provider session pdf/i);
    assert.match(bullets.join(" "), /read|service codes|excel/i);
    assert.match(bullets.join(" "), /Provider Soft|Excel timesheet/i);
    assert.match(bullets.join(" "), /still need|sample/i);
  });

  it("does not include truncated goal-only generic flow text", () => {
    const { bullets } = buildSubmitSummary(schoolPlan);
    for (const b of bullets) {
      assert.ok(b.length > 20);
      assert.doesNotMatch(b, /Koda automation/i);
      assert.doesNotMatch(b, /^Destination/i);
    }
  });

  it("handles minimal plan with goal only", () => {
    const { bullets } = buildSubmitSummary("## Goal\nSync invoices to QuickBooks.");
    assert.equal(bullets.length, 1);
    assert.match(bullets[0], /QuickBooks/i);
  });
});

describe("getMeaningfulPlanMermaid", () => {
  it("rejects generic Source → Automation → Destination diagrams", () => {
    const generic = [
      "flowchart LR",
      "  N0[Source] --> N1[Automation] --> N2[Destination]",
    ].join("\n");
    assert.equal(isGenericMermaid(generic), true);

    const plan = `## Diagram\n\`\`\`mermaid\n${generic}\n\`\`\``;
    assert.equal(getMeaningfulPlanMermaid(plan), null);
  });

  it("rejects Koda automation fallback diagrams", () => {
    const generic = [
      "flowchart LR",
      '  goal["Save time"]',
      '  auto["Koda automation"]',
      '  dest["Destination"]',
      "  goal --> auto --> dest",
    ].join("\n");
    assert.equal(isGenericMermaid(generic), true);
  });

  it("accepts custom diagrams with real system names", () => {
    const custom = [
      "flowchart LR",
      "  N0[Provider Soft] --> N1[HHA / HHAeXchange]",
    ].join("\n");
    assert.equal(isGenericMermaid(custom), false);

    const plan = `## Diagram\n\`\`\`mermaid\n${custom}\n\`\`\``;
    assert.equal(getMeaningfulPlanMermaid(plan), custom);
  });
});
