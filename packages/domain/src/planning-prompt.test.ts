import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PLANNING_AGENT_PROMPT_MAX,
  classifyEmptyReplyRecovery,
  preparePlanningUserPrompt,
} from "./planning-prompt.js";

describe("preparePlanningUserPrompt", () => {
  it("passes through short messages unchanged", () => {
    const text = "Weekly staffing report every Monday.";
    const out = preparePlanningUserPrompt(text);
    assert.equal(out.wasLong, false);
    assert.equal(out.prompt, text);
    assert.equal(out.originalLength, text.length);
  });

  it("condenses very long pastes while keeping head and tail", () => {
    const text = "A".repeat(PLANNING_AGENT_PROMPT_MAX + 5000);
    const out = preparePlanningUserPrompt(text);
    assert.equal(out.wasLong, true);
    assert.equal(out.originalLength, text.length);
    assert.ok(out.prompt.length < text.length);
    assert.ok(out.prompt.startsWith("[Long note"));
    assert.ok(out.prompt.includes("A".repeat(100)));
    assert.ok(out.prompt.includes("omitted from the middle"));
  });
});

describe("classifyEmptyReplyRecovery", () => {
  it("prefers wait result over stream", () => {
    assert.equal(
      classifyEmptyReplyRecovery({
        waitText: "hello",
        streamedText: "also",
      }),
      "wait_result",
    );
  });

  it("returns none when all sources empty", () => {
    assert.equal(classifyEmptyReplyRecovery({}), "none");
  });
});
