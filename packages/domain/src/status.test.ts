import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canTransition,
  assertTransition,
  InvalidTransitionError,
  isHiddenFromDashboard,
  isProgramPlanning,
  isProgramBuildLocked,
  isProgramVerifyPhase,
  canProgramCustomerChat,
  isProgramPlanOnly,
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
    assert.equal(canTransition("AWAITING_DEV_BUILD", "PLANNING"), true);
    assert.equal(canTransition("BUILDING", "TESTING"), true);
    assert.equal(canTransition("TESTING", "DEPLOYING"), true);
    assert.equal(canTransition("BUILDING", "CLIENT_VERIFY"), true);
    assert.equal(canTransition("CLIENT_VERIFY", "AWAITING_FINAL_REVIEW"), true);
    assert.equal(canTransition("AWAITING_FINAL_REVIEW", "DEPLOYING"), true);
    assert.equal(canTransition("DEPLOYING", "DONE"), true);
  });

  it("allows reopening planning after accidental submit", () => {
    assert.equal(canTransition("AWAITING_DEV_BUILD", "PLANNING"), true);
  });

  it("hides cancelled programs from dashboard lists", () => {
    assert.equal(isHiddenFromDashboard("CANCELLED"), true);
    assert.equal(isHiddenFromDashboard("PLANNING"), false);
    assert.equal(isHiddenFromDashboard("DONE"), false);
  });

  it("defines program lifecycle chat phases", () => {
    assert.equal(isProgramPlanning("PLANNING"), true);
    assert.equal(isProgramPlanOnly("PLANNING"), true);
    assert.equal(isProgramPlanOnly("AWAITING_DEV_BUILD"), false);
    assert.equal(isProgramBuildLocked("AWAITING_DEV_BUILD"), true);
    assert.equal(isProgramBuildLocked("BUILDING"), true);
    assert.equal(canProgramCustomerChat("PLANNING"), true);
    assert.equal(canProgramCustomerChat("AWAITING_DEV_BUILD"), false);
    assert.equal(isProgramVerifyPhase("CLIENT_VERIFY"), true);
    assert.equal(canProgramCustomerChat("CLIENT_VERIFY"), true);
    assert.equal(canProgramCustomerChat("AWAITING_FINAL_REVIEW"), false);
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

  it("lets employees submit programs but not reopen planning", () => {
    assert.equal(roleHasPermission("EMPLOYEE", "program:submit_to_dev"), true);
    assert.equal(roleHasPermission("EMPLOYEE", "program:reopen_planning"), false);
    assert.equal(roleHasPermission("DEVELOPER", "program:reopen_planning"), true);
  });

  it("reserves open-in-cursor and test-improve for staff", () => {
    assert.equal(roleHasPermission("EMPLOYEE", "program:open_in_cursor"), false);
    assert.equal(roleHasPermission("DEVELOPER", "program:open_in_cursor"), true);
    assert.equal(roleHasPermission("EMPLOYEE", "program:grant_test_improve"), false);
    assert.equal(roleHasPermission("ADMIN", "program:grant_test_improve"), true);
    assert.equal(roleHasPermission("EMPLOYEE", "members:manage"), false);
    assert.equal(roleHasPermission("DEVELOPER", "members:manage"), true);
    assert.equal(roleHasPermission("ADMIN", "members:manage"), true);
    assert.equal(roleHasPermission("EMPLOYEE", "program:reveal_secrets"), false);
    assert.equal(roleHasPermission("DEVELOPER", "program:reveal_secrets"), true);
    assert.equal(roleHasPermission("ADMIN", "program:reveal_secrets"), true);
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
