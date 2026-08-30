import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOpeningPlanningMessage,
  buildPlanningFollowUp,
  buildPlanningStartPrompt,
  planningAgentInstructions,
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
    assert.match(msg, /living plan|diagram|clarifying/i);
  });

  it("answers identity questions directly instead of ignoring them", () => {
    const reply = buildPlanningFollowUp({
      meta: { coveredTopics: [] },
      latestUserContent: "whats your name",
    });
    assert.match(reply.content, /I'm \*\*Koda\*\*/i);
    assert.doesNotMatch(reply.content, /API docs/);
    assert.doesNotMatch(reply.content, /^Got it\./m);
  });

  it("returns a mermaid diagram when asked for a digram", () => {
    const reply = buildPlanningFollowUp({
      meta: { coveredTopics: ["goals", "systems"] },
      latestUserContent: "give me a digram of the software",
      title: "Invoice email to QB",
    });
    assert.match(reply.content, /mermaid/);
    assert.match(reply.planMarkdown, /# Plan:/);
  });

  it("synthesizes a real plan from an invoice → QuickBooks description", () => {
    const reply = buildPlanningFollowUp({
      meta: { coveredTopics: [] },
      title: "Invoice email automation",
      latestUserContent:
        "When an invoice email arrives, extract the fields and create a bill in QuickBooks. Then notify accounting in Slack if it fails.",
    });
    assert.match(reply.content, /# Plan:/);
    assert.match(reply.content, /QuickBooks/);
    assert.match(reply.planMarkdown, /## Workflow/);
    assert.doesNotMatch(reply.content, /^Got it\./m);
  });

  it("planning instructions never mention Cursor and require markdown plans", () => {
    const prompt = planningAgentInstructions();
    assert.match(prompt, /Koda/);
    assert.match(prompt, /mermaid|diagram/i);
    assert.doesNotMatch(prompt, /Cursor/);
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
});
