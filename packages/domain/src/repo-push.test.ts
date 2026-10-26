import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  connectedRepoPushResultMessage,
  isUserPushRequest,
  readClientAwsDeployTarget,
} from "./repo-push.js";

describe("user push requests", () => {
  it("accepts a clear push or deploy ask", () => {
    for (const text of [
      "push",
      "push it",
      "please push",
      "can you deploy this",
      "go ahead and push the changes",
      "commit and push",
      "restructure the project and push",
      "restructure the project and then deploy it",
    ]) {
      assert.equal(isUserPushRequest(text), true, text);
    }
  });

  it("does not treat feature talk or a refusal as a push", () => {
    for (const text of [
      "add push notifications to the app",
      "add a deploy button",
      "don't push yet",
      "do not deploy this",
      "restructure the homepage",
    ]) {
      assert.equal(isUserPushRequest(text), false, text);
    }
  });
});

describe("client aws deploy target", () => {
  it("is not configured, so a push must not read secret values for a host", () => {
    assert.equal(readClientAwsDeployTarget(null), null);
    assert.equal(
      readClientAwsDeployTarget({ railwayProjectId: "proj", githubRepo: "app" }),
      null,
    );
  });

  it("describes a github push without claiming secrets were deployed", () => {
    const message = connectedRepoPushResultMessage({
      repoLabel: "acme/app",
      branch: "koda/1-app",
      headSha: "abc1234ffff",
      previousSha: "0000000",
      previewLinked: false,
      awsTargetConnected: false,
    });
    assert.match(message, /own commit/);
    assert.match(message, /abc1234/);
    assert.match(message, /AWS deploy target/);
    assert.match(message, /not connected/);
    assert.doesNotMatch(message, /sk-|password|secret value/i);
  });
});
