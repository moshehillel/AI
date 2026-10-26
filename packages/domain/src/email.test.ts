import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  isPlaceholderEmail,
  resolveDeveloperNotifyEmails,
} from "./email.js";

describe("developer notify emails", () => {
  const prevNotify = process.env.NOTIFY_EMAIL;
  const prevDevNotify = process.env.DEVELOPER_NOTIFY_EMAIL;

  afterEach(() => {
    if (prevNotify === undefined) delete process.env.NOTIFY_EMAIL;
    else process.env.NOTIFY_EMAIL = prevNotify;
    if (prevDevNotify === undefined) delete process.env.DEVELOPER_NOTIFY_EMAIL;
    else process.env.DEVELOPER_NOTIFY_EMAIL = prevDevNotify;
  });

  it("detects placeholder seed emails", () => {
    assert.equal(isPlaceholderEmail("dev@demo.local"), true);
    assert.equal(isPlaceholderEmail("admin@example.com"), true);
    assert.equal(isPlaceholderEmail("owner@advancedautomations.net"), false);
  });

  it("prefers NOTIFY_EMAIL over demo memberships", () => {
    delete process.env.DEVELOPER_NOTIFY_EMAIL;
    process.env.NOTIFY_EMAIL = "owner@advancedautomations.net, ops@advancedautomations.net";
    const emails = resolveDeveloperNotifyEmails([
      "dev@demo.local",
      "admin@demo.local",
    ]);
    assert.deepEqual(emails.sort(), [
      "ops@advancedautomations.net",
      "owner@advancedautomations.net",
    ]);
  });

  it("uses real membership emails when notify env unset", () => {
    delete process.env.NOTIFY_EMAIL;
    delete process.env.DEVELOPER_NOTIFY_EMAIL;
    const emails = resolveDeveloperNotifyEmails([
      "dev@demo.local",
      "moshe@advancedautomations.net",
    ]);
    assert.deepEqual(emails, ["moshe@advancedautomations.net"]);
  });

  it("returns empty when only placeholders and no notify env", () => {
    delete process.env.NOTIFY_EMAIL;
    delete process.env.DEVELOPER_NOTIFY_EMAIL;
    assert.deepEqual(resolveDeveloperNotifyEmails(["a@demo.local"]), []);
  });
});
