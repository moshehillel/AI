import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOpeningPlanningMessage,
  buildPlanningFollowUp,
  buildPlanningStartPrompt,
  planningAgentInstructions,
  splitPlanFromReply,
  synthesizePlanMarkdown,
} from "./planning.js";

describe("planning Q&A", () => {
  it("opens as Koda without a scripted questionnaire dump", () => {
    const msg = buildOpeningPlanningMessage({ hasInitialPrompt: false });
    assert.match(msg, /Koda/i);
    assert.match(msg, /Advanced Automations/i);
    assert.doesNotMatch(msg, /1\.\s+Links to API/);
    assert.doesNotMatch(msg, /Got it/);
  });

  it("acknowledges an initial spark without rotating canned questions", () => {
    const msg = buildOpeningPlanningMessage({
      title: "Invoice sync",
      hasInitialPrompt: true,
    });
    assert.match(msg, /Invoice sync/);
    assert.match(msg, /living plan|Plan panel|numbered questions/i);
  });

  it("answers identity questions directly instead of ignoring them", () => {
    const reply = buildPlanningFollowUp({
      meta: { coveredTopics: [] },
      latestUserContent: "whats your name",
    });
    assert.match(reply.content, /I'm \*\*Koda\*\*/i);
    assert.doesNotMatch(reply.content, /API docs/);
    assert.doesNotMatch(reply.content, /^Got it\./m);
    assert.match(reply.content, /What I still need from you/i);
  });

  it("returns a mermaid diagram when asked for a digram", () => {
    const reply = buildPlanningFollowUp({
      meta: { coveredTopics: ["goals", "systems"] },
      latestUserContent: "give me a digram of the software",
      title: "Invoice email to QB",
    });
    assert.match(reply.content, /mermaid/);
    assert.match(reply.planMarkdown, /# Plan:/);
    assert.match(reply.content, /What I still need from you/i);
  });

  it("synthesizes a real plan from an invoice → QuickBooks description", () => {
    const reply = buildPlanningFollowUp({
      meta: { coveredTopics: [] },
      title: "Invoice email automation",
      latestUserContent:
        "When an invoice email arrives, extract the fields and create a bill in QuickBooks. Then notify accounting in Slack if it fails.",
    });
    assert.doesNotMatch(reply.content, /^# Plan:/m);
    assert.match(reply.content, /Plan panel|QuickBooks/i);
    assert.match(reply.content, /What I still need from you/i);
    assert.match(reply.planMarkdown, /## Workflow/);
    assert.doesNotMatch(reply.content, /^Got it\./m);
  });

  it("planning instructions never mention Cursor and require markdown plans", () => {
    const prompt = planningAgentInstructions();
    assert.match(prompt, /Koda/);
    assert.match(prompt, /mermaid|diagram/i);
    assert.match(prompt, /```plan|plan fence|conversational/i);
    assert.doesNotMatch(prompt, /Cursor/);
  });

  it("planning instructions require plain English and clear numbered asks", () => {
    const prompt = planningAgentInstructions();
    assert.match(prompt, /plain, simple English|school admin/i);
    assert.match(prompt, /What I still need from you/);
    assert.match(prompt, /numbered questions|1\., 2\., 3\./i);
    assert.match(prompt, /Do NOT paste the full living plan/i);
  });

  it("start prompt includes conversation and instructions", () => {
    const prompt = buildPlanningStartPrompt({
      title: "Invoice sync",
      description: "Email to QB",
      messages: [
        { role: "USER", content: "whats your name" },
        { role: "ASSISTANT", content: "I'm Koda." },
      ],
    });
    assert.match(prompt, /whats your name/);
    assert.match(prompt, /PLANNING mode/);
  });

  it("synthesizePlanMarkdown builds mermaid for multi-system flows", () => {
    const md = synthesizePlanMarkdown({
      title: "Mail to QB",
      meta: {},
      latestUserContent: "Gmail invoice emails should create QuickBooks bills",
    });
    assert.match(md, /QuickBooks/);
    assert.match(md, /mermaid/);
  });

  it("does not put a follow-up question into Goal", () => {
    const reply = buildPlanningFollowUp({
      meta: {
        coveredTopics: ["goals", "systems"],
        planMarkdown: [
          "# Plan: Test Project",
          "",
          "## Goal",
          "Connect Provider Soft to HHA so visit data syncs automatically.",
          "",
          "## Systems",
          "- Provider Soft",
          "- HHA / HHAeXchange",
        ].join("\n"),
      },
      title: "Test Project",
      latestUserContent: "how will you pull the data from hha?",
    });
    assert.doesNotMatch(reply.planMarkdown, /## Goal\nhow will you pull/i);
    assert.match(
      reply.content,
      /connection|screen automation|file export|browser/i,
    );
    assert.match(reply.planMarkdown, /Provider Soft|HHA/i);
    assert.match(reply.content, /What I still need from you/i);
  });

  it("does not put HTML attachment dumps into Goal", () => {
    const html = `<!DOCTYPE html><html><head><title>API</title></head><body>${"x".repeat(2000)}</body></html>`;
    const reply = buildPlanningFollowUp({
      meta: { coveredTopics: ["goals"] },
      title: "HHA sync",
      latestUserContent: `Attached documentation:\n${html}`,
      attachmentKind: "docs_text",
    });
    assert.doesNotMatch(reply.planMarkdown, /## Goal\n<!DOCTYPE/i);
    assert.doesNotMatch(reply.planMarkdown, /## Goal\n[\s\S]*<html/i);
    assert.match(reply.planMarkdown, /## Goal\n.+/);
  });

  it("does not put CSV/PDF file excerpts into Goal", () => {
    const excerpt = [
      "File: invoices.csv (CSV/TSV)",
      "Rows: 40 · Columns: 3",
      "Headers: date,amount,vendor",
      "Excerpt (first rows):",
      "date,amount,vendor",
      "2024-01-01,10,Acme",
    ].join("\n");
    const reply = buildPlanningFollowUp({
      meta: { coveredTopics: ["goals"] },
      title: "Invoice sync",
      latestUserContent: `Attached file (invoices.csv):\n${excerpt}`,
      attachmentKind: "file",
    });
    assert.doesNotMatch(reply.planMarkdown, /## Goal\nFile:/i);
    assert.doesNotMatch(reply.planMarkdown, /## Goal\ndate,amount/i);
    assert.match(reply.planMarkdown, /## Goal\n.+/);
  });

  it("infers HHA and Provider Soft as systems", () => {
    const md = synthesizePlanMarkdown({
      title: "Test Project",
      meta: {},
      latestUserContent:
        "build an interface that connect hha and provider soft with RPA",
    });
    assert.match(md, /HHA/);
    assert.match(md, /Provider Soft/);
  });

  it("includes What you need to provide with HHA/Provider Soft credentials", () => {
    const md = synthesizePlanMarkdown({
      title: "HHA sync",
      meta: {},
      latestUserContent:
        "connect Provider Soft to HHA with RPA for visit sync",
    });
    assert.match(md, /## What you need to provide/);
    assert.match(md, /Add secrets \/ credentials/);
    assert.match(md, /HHA/);
    assert.match(md, /Provider Soft/);
    assert.match(md, /VPN|remote desktop/i);
  });

  it("marks provided secrets as received without values", () => {
    const md = synthesizePlanMarkdown({
      title: "HHA sync",
      meta: { providedSecretKeys: ["HHA_PASSWORD"] },
      latestUserContent: "Provider Soft to HHA",
    });
    assert.match(md, /\[x\] HHA_PASSWORD — received securely/);
    assert.doesNotMatch(md, /password123|sk-/i);
  });

  it("planning instructions require What you need to provide", () => {
    const prompt = planningAgentInstructions();
    assert.match(prompt, /What you need to provide/);
    assert.match(prompt, /Add secrets \/ credentials/);
  });

  it("splitPlanFromReply keeps chat light and extracts plan fences", () => {
    const raw = [
      "Updated the workflow for invoice sync.",
      "",
      "## What I still need from you",
      "1. Does this look right?",
      "",
      "```plan",
      "# Plan: Invoice",
      "## Goal",
      "Sync invoices",
      "```",
    ].join("\n");
    const split = splitPlanFromReply(raw);
    assert.match(split.chatContent, /Updated the workflow/);
    assert.match(split.chatContent, /What I still need from you/i);
    assert.doesNotMatch(split.chatContent, /## Goal/);
    assert.match(split.planMarkdown, /## Goal/);
  });

  it("follow-ups ask numbered questions instead of dumping the plan", () => {
    const reply = buildPlanningFollowUp({
      meta: { coveredTopics: [] },
      title: "School Program",
      latestUserContent:
        "Connect Provider Soft to HHA so visit notes sync for our school program office.",
    });
    assert.doesNotMatch(reply.content, /^# Plan:/m);
    assert.match(reply.content, /What I still need from you/i);
    assert.match(reply.content, /1\./);
    assert.match(reply.planMarkdown, /## What you need to provide/);
    assert.match(
      reply.content,
      /Add secrets|browser|file export|Provider Soft/i,
    );
  });
});
