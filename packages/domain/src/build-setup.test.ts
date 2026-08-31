import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseBuildSetup,
  developerPlanReviewPrompt,
  developerBuildPrompt,
  developerTestImprovePrompt,
} from "./build-setup.js";

describe("build setup", () => {
  it("parses empty and object setups", () => {
    assert.deepEqual(parseBuildSetup(null), {});
    assert.equal(
      parseBuildSetup({ testImproveGranted: true }).testImproveGranted,
      true,
    );
  });

  it("builds developer plan review prompt with customer plan", () => {
    const prompt = developerPlanReviewPrompt({
      title: "Invoice sync",
      planMarkdown: "## Goal\nSync invoices",
      description: "From QuickBooks",
    });
    assert.match(prompt, /Invoice sync/);
    assert.match(prompt, /Sync invoices/);
    assert.match(prompt, /PLAN mode/i);
  });

  it("builds build and test-improve prompts", () => {
    assert.match(
      developerBuildPrompt({ title: "A", planMarkdown: "# Plan" }),
      /BUILD/i,
    );
    assert.match(
      developerTestImprovePrompt({ title: "A", planMarkdown: "# Plan" }),
      /Test & Improve/,
    );
  });
});
