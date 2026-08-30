import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canTransition,
  assertTransition,
  InvalidTransitionError,
} from "./status.js";
import { classifyChangeRequest } from "./classification.js";
import { buildBranchName, slugify } from "./branch.js";
import { roleHasPermission } from "./permissions.js";
import { parseCompanySettings } from "./usage.js";

describe("status machine", () => {
  it("allows draft to analyzing", () => {
    assert.equal(canTransition("DRAFT", "ANALYZING"), true);
  });

  it("blocks employee merge-like jumps", () => {
    assert.equal(canTransition("DRAFT", "MERGED"), false);
    assert.throws(
      () => assertTransition("PREVIEW_READY", "MERGED"),
      InvalidTransitionError,
    );
  });

  it("allows failed to analyzing for retry", () => {
    assert.equal(canTransition("FAILED", "ANALYZING"), true);
  });

  it("supports program lifecycle transitions", () => {
    assert.equal(canTransition("DRAFT", "PLANNING"), true);
    assert.equal(canTransition("PLANNING", "AWAITING_DEV_BUILD"), true);
    assert.equal(canTransition("AWAITING_DEV_BUILD", "BUILDING"), true);
    assert.equal(canTransition("BUILDING", "CLIENT_VERIFY"), true);
    assert.equal(canTransition("CLIENT_VERIFY", "AWAITING_FINAL_REVIEW"), true);
    assert.equal(canTransition("AWAITING_FINAL_REVIEW", "DEPLOYING"), true);
    assert.equal(canTransition("DEPLOYING", "DONE"), true);
  });
});

describe("secret redaction", () => {
  it("redacts api keys from chat", async () => {
    const { detectAndRedactSecrets } = await import("./secrets.js");
    const result = detectAndRedactSecrets(
      "Here is my key sk-abcdefghijklmnopqrstuvwxyz123456",
    );
    assert.equal(result.hadSecrets, true);
    assert.equal(result.redacted.includes("sk-"), false);
    assert.equal(result.secrets.length >= 1, true);
  });
});

describe("classification", () => {
  it("flags auth changes as high risk", () => {
    const result = classifyChangeRequest({
      title: "Update authentication",
      description: "Change how users log in",
    });
    assert.equal(result.classification, "HIGH_RISK");
    assert.equal(result.requiresDeveloperPreApproval, true);
  });

  it("flags schema work as complex", () => {
    const result = classifyChangeRequest({
      title: "Add fields",
      description: "Need a database schema change for invoices",
    });
    assert.equal(result.classification, "COMPLEX");
    assert.equal(result.requiresPlan, true);
  });

  it("treats copy tweaks as simple", () => {
    const result = classifyChangeRequest({
      title: "Fix typo on invoice label",
      description: "Change the button text",
    });
    assert.equal(result.classification, "SIMPLE");
  });
});

describe("branch naming", () => {
  it("builds expected branch names", () => {
    assert.equal(slugify("Sarah O'Neil"), "sarah-oneil");
    assert.equal(
      buildBranchName({
        userSlug: "sarah",
        taskId: 482,
        shortDescription: "Add invoice retry",
      }),
      "ai/sarah/482-add-invoice-retry",
    );
  });
});

describe("permissions", () => {
  it("prevents employees from merging", () => {
    assert.equal(roleHasPermission("EMPLOYEE", "change_request:merge"), false);
    assert.equal(roleHasPermission("DEVELOPER", "change_request:merge"), true);
  });
});

describe("usage settings", () => {
  it("parses soft caps", () => {
    const settings = parseCompanySettings({
      usageSoftCapCents: 1000,
      usageSoftCapTokens: 50000,
      allowAdminDeploy: false,
    });
    assert.equal(settings.usageSoftCapCents, 1000);
    assert.equal(settings.usageSoftCapTokens, 50000);
    assert.equal(settings.allowAdminDeploy, false);
  });
});
