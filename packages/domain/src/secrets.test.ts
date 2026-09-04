import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectAndRedactSecrets,
  normalizeSecretKeyName,
  isCredentialSecretKey,
  secretSavedMessage,
} from "./secrets.js";

describe("labeled secrets", () => {
  it("normalizes labels to env-style keys", () => {
    assert.equal(normalizeSecretKeyName("HHA password"), "HHA_PASSWORD");
    assert.equal(normalizeSecretKeyName(""), "SECRET");
  });

  it("excludes planning-file attachment keys", () => {
    assert.equal(isCredentialSecretKey("HHA_PASSWORD"), true);
    assert.equal(isCredentialSecretKey("planning-file-abc"), false);
  });

  it("ack message never includes a value", () => {
    assert.equal(secretSavedMessage("hha password"), "Secret saved: HHA_PASSWORD");
  });

  it("still redacts openai-style keys in chat", () => {
    const result = detectAndRedactSecrets(
      "key sk-abcdefghijklmnopqrstuvwxyz012345",
    );
    assert.equal(result.hadSecrets, true);
    assert.doesNotMatch(result.redacted, /sk-abcde/);
  });
});
