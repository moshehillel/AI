import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decryptSecret,
  encryptSecret,
  encryptionUsesPerOrgKeys,
} from "./crypto.js";

describe("crypto", () => {
  it("round-trips with global key by default", () => {
    const prior = process.env.ENCRYPTION_KEY_PER_ORG;
    delete process.env.ENCRYPTION_KEY_PER_ORG;
    process.env.ENCRYPTION_KEY = "test-key-for-unit-tests-only";
    const cipher = encryptSecret("hello", "company_a");
    assert.equal(decryptSecret(cipher, "company_a"), "hello");
    assert.equal(encryptionUsesPerOrgKeys(), false);
    if (prior) process.env.ENCRYPTION_KEY_PER_ORG = prior;
  });

  it("isolates ciphertext per org when ENCRYPTION_KEY_PER_ORG=1", () => {
    const prior = process.env.ENCRYPTION_KEY_PER_ORG;
    process.env.ENCRYPTION_KEY = "test-key-for-unit-tests-only";
    process.env.ENCRYPTION_KEY_PER_ORG = "1";
    const a = encryptSecret("secret", "company_a");
    assert.throws(() => decryptSecret(a, "company_b"));
    assert.equal(decryptSecret(a, "company_a"), "secret");
    if (prior) process.env.ENCRYPTION_KEY_PER_ORG = prior;
    else delete process.env.ENCRYPTION_KEY_PER_ORG;
  });
});
