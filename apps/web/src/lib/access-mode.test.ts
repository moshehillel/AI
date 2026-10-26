import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  isDemoAuthEnabled,
  isOpenAccess,
  isOpenAccessPublic,
} from "./access-mode.js";

const ENV_KEYS = [
  "OPEN_ACCESS",
  "NEXT_PUBLIC_OPEN_ACCESS",
  "ALLOW_DEMO_AUTH",
  "NEXT_PUBLIC_ALLOW_DEMO_AUTH",
] as const;

function clearAccessEnv() {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

describe("access-mode", () => {
  afterEach(() => {
    clearAccessEnv();
  });

  it("defaults to Clerk production mode (open access off)", () => {
    clearAccessEnv();
    assert.equal(isOpenAccess(), false);
    assert.equal(isOpenAccessPublic(), false);
    assert.equal(isDemoAuthEnabled(), false);
  });

  it("detects server open access flag", () => {
    process.env.OPEN_ACCESS = "1";
    assert.equal(isOpenAccess(), true);
    assert.equal(isDemoAuthEnabled(), true);
  });

  it("detects client open access flag", () => {
    process.env.NEXT_PUBLIC_OPEN_ACCESS = "1";
    assert.equal(isOpenAccess(), true);
    assert.equal(isOpenAccessPublic(), true);
  });

  it("demo auth without open access", () => {
    process.env.ALLOW_DEMO_AUTH = "1";
    assert.equal(isOpenAccess(), false);
    assert.equal(isDemoAuthEnabled(), true);
  });
});
