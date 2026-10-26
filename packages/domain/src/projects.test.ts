import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CUSTOMER_ONBOARDING_SLUG,
  canAssignProjectMember,
  canChatInProject,
  canCreateProject,
  canStartProgram,
  elevateRole,
  membershipRoleFromClerk,
} from "./projects.js";
import { roleHasPermission } from "./permissions.js";

describe("customer onboarding access intent", () => {
  it("exports the shared planning workspace slug", () => {
    assert.equal(CUSTOMER_ONBOARDING_SLUG, "customer-onboarding");
  });

  it("lets an assigned employee chat, without granting project admin", () => {
    assert.equal(roleHasPermission("EMPLOYEE", "change_request:create"), false);
    assert.equal(roleHasPermission("EMPLOYEE", "change_request:chat"), true);
    assert.equal(roleHasPermission("ADMIN", "change_request:create"), true);
    assert.equal(roleHasPermission("EMPLOYEE", "project:manage"), false);
    assert.equal(roleHasPermission("EMPLOYEE", "members:manage"), false);
    assert.equal(roleHasPermission("DEVELOPER", "project:manage"), false);
    assert.equal(roleHasPermission("DEVELOPER", "members:manage"), false);
  });

  it("maps Clerk org roles and only lets an admin open or assign a project", () => {
    assert.equal(membershipRoleFromClerk("org:admin"), "ADMIN");
    assert.equal(membershipRoleFromClerk("org:developer"), "DEVELOPER");
    assert.equal(membershipRoleFromClerk("org:member"), "EMPLOYEE");
    assert.equal(membershipRoleFromClerk("org:employee"), "EMPLOYEE");
    assert.equal(elevateRole("EMPLOYEE", "org:admin"), "ADMIN");
    assert.equal(elevateRole("ADMIN", "org:member"), "ADMIN");
    assert.equal(canCreateProject("ADMIN"), true);
    assert.equal(canCreateProject("DEVELOPER"), false);
    assert.equal(canCreateProject("EMPLOYEE"), false);
    assert.equal(canAssignProjectMember("ADMIN"), true);
    assert.equal(canAssignProjectMember("DEVELOPER"), false);
    assert.equal(canAssignProjectMember("EMPLOYEE"), false);
  });

  it("lets only an admin start a program", () => {
    assert.equal(canStartProgram("ADMIN"), true);
    assert.equal(canStartProgram("DEVELOPER"), false);
    assert.equal(canStartProgram("EMPLOYEE"), false);
  });

  it("lets an assigned member chat inside the project and blocks everyone else", () => {
    assert.equal(
      canChatInProject({ role: "ADMIN", isProjectMember: false }),
      true,
    );
    assert.equal(
      canChatInProject({ role: "EMPLOYEE", isProjectMember: true }),
      true,
    );
    assert.equal(
      canChatInProject({ role: "EMPLOYEE", isProjectMember: false }),
      false,
    );
    assert.equal(
      canChatInProject({ role: "DEVELOPER", isProjectMember: true }),
      true,
    );
    assert.equal(
      canChatInProject({ role: "DEVELOPER", isProjectMember: false }),
      false,
    );
  });
});
