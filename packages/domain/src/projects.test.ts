import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CUSTOMER_ONBOARDING_SLUG } from "./projects.js";
import { roleHasPermission } from "./permissions.js";

describe("customer onboarding access intent", () => {
  it("exports the shared planning workspace slug", () => {
    assert.equal(CUSTOMER_ONBOARDING_SLUG, "customer-onboarding");
  });

  it("gives employees permission to create change requests / programs", () => {
    assert.equal(roleHasPermission("EMPLOYEE", "change_request:create"), true);
    assert.equal(roleHasPermission("EMPLOYEE", "change_request:chat"), true);
  });
});
