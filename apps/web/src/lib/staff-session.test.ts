import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  createStaffSessionValue,
  getStaffPassword,
  isStaffProtectedPath,
  parseStaffSessionValue,
  safeNextPath,
} from "./staff-session.ts";

describe("staff session", () => {
  const prevAdmin = process.env.ADMIN_PASSWORD;
  const prevStaff = process.env.STAFF_ACCESS_TOKEN;

  afterEach(() => {
    if (prevAdmin === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = prevAdmin;
    if (prevStaff === undefined) delete process.env.STAFF_ACCESS_TOKEN;
    else process.env.STAFF_ACCESS_TOKEN = prevStaff;
  });

  it("prefers ADMIN_PASSWORD over STAFF_ACCESS_TOKEN", () => {
    process.env.ADMIN_PASSWORD = "admin-secret";
    process.env.STAFF_ACCESS_TOKEN = "legacy-token";
    assert.equal(getStaffPassword(), "admin-secret");
  });

  it("falls back to STAFF_ACCESS_TOKEN", () => {
    delete process.env.ADMIN_PASSWORD;
    process.env.STAFF_ACCESS_TOKEN = "legacy-token";
    assert.equal(getStaffPassword(), "legacy-token");
  });

  it("signs and verifies staff cookies", async () => {
    delete process.env.ADMIN_PASSWORD;
    process.env.STAFF_ACCESS_TOKEN = "test-password-abc";
    const value = await createStaffSessionValue("developer");
    assert.ok(value);
    assert.equal(await parseStaffSessionValue(value), "developer");
    assert.equal(await parseStaffSessionValue("developer"), null);
    assert.equal(await parseStaffSessionValue("developer.forged"), null);
  });

  it("rejects cookies when password changes", async () => {
    process.env.STAFF_ACCESS_TOKEN = "one";
    delete process.env.ADMIN_PASSWORD;
    const value = await createStaffSessionValue("admin");
    process.env.STAFF_ACCESS_TOKEN = "two";
    assert.equal(await parseStaffSessionValue(value), null);
  });

  it("identifies staff-protected paths", () => {
    assert.equal(isStaffProtectedPath("/admin"), true);
    assert.equal(isStaffProtectedPath("/admin/foo"), true);
    assert.equal(isStaffProtectedPath("/review"), true);
    assert.equal(isStaffProtectedPath("/usage"), true);
    assert.equal(isStaffProtectedPath("/projects"), false);
    assert.equal(isStaffProtectedPath("/staff"), false);
    assert.equal(isStaffProtectedPath("/change-requests/x"), false);
  });

  it("sanitizes next paths", () => {
    assert.equal(safeNextPath("/review"), "/review");
    assert.equal(safeNextPath("//evil.com"), "/review");
    assert.equal(safeNextPath("https://evil.com"), "/review");
  });
});
