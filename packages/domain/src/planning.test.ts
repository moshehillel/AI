import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOpeningPlanningMessage,
  buildPlanningFollowUp,
  nextPlanningTopic,
} from "./planning.js";

describe("planning Q&A", () => {
  it("opens with a single goals question when there is no spark", () => {
    const msg = buildOpeningPlanningMessage({ hasInitialPrompt: false });
    assert.match(msg, /Let's plan/i);
    assert.match(msg, /outcome|automate|done/i);
    assert.doesNotMatch(msg, /1\.\s+Links to API/);
  });

  it("asks systems next after an initial spark", () => {
    const msg = buildOpeningPlanningMessage({
      title: "Invoice sync",
      hasInitialPrompt: true,
    });
    assert.match(msg, /Invoice sync/);
    assert.match(msg, /systems|tools/i);
  });

  it("advances topics one at a time on follow-up", () => {
    const first = buildPlanningFollowUp({
      meta: { coveredTopics: [], lastQuestionTopic: "goals" },
      latestUserContent: "We want to sync invoices from our ERP to Stripe nightly.",
    });
    assert.equal(nextPlanningTopic(first.nextMeta), "apis");
    assert.match(first.content, /Got it/);
    assert.doesNotMatch(first.content, /1\.\s+/);

    const second = buildPlanningFollowUp({
      meta: first.nextMeta,
      latestUserContent: "ERP is NetSuite, payments go to Stripe.",
      attachmentKind: "api_docs_url",
    });
    assert.ok(second.nextMeta.coveredTopics?.includes("apis"));
    assert.match(second.content, /API docs|saved/i);
  });
});
