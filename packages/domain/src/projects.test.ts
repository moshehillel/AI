import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CUSTOMER_ONBOARDING_SLUG,
  canStartPlanningProgram,
  elevateRole,
  membershipRoleFromClerk,
} from "./projects.js";
import { roleHasPermission } from "./permissions.js";

describe("customer onboarding access intent", () => {
  it("exports the shared planning workspace slug", () => {
    assert.equal(CUSTOMER_ONBOARDING_SLUG, "customer-onboarding");
  });

  it("gives employees permission to create change requests / programs", () => {
    assert.equal(roleHasPermission("EMPLOYEE", "change_request:create"), true);
    assert.equal(roleHasPermission("EMPLOYEE", "change_request:chat"), true);
  });

  it("maps Clerk org admins and still lets members plan", () => {
    assert.equal(membershipRoleFromClerk("org:admin"), "ADMIN");
    assert.equal(membershipRoleFromClerk("org:member"), "EMPLOYEE");
    assert.equal(elevateRole("EMPLOYEE", "org:admin"), "ADMIN");
    assert.equal(elevateRole("ADMIN", "org:member"), "ADMIN");
    assert.equal(
      canStartPlanningProgram({
        hasCompanyMembership: true,
        onboardingProjectId: "proj_onboarding",
      }),
      true,
    );
    assert.equal(
      canStartPlanningProgram({
        hasCompanyMembership: true,
        onboardingProjectId: null,
      }),
      false,
    );
  });
});
