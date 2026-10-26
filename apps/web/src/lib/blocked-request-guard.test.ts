import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clerkOrganizationPollPath,
  isFilterBlockResponse,
} from "./blocked-request-guard.ts";

describe("blocked clerk organization polls", () => {
  it("identifies the three polls that repeated after login", () => {
    assert.equal(
      clerkOrganizationPollPath(
        "https://clerk.advancedautomations.net/v1/me/organization_memberships?paginated=true&limit=10&_clerk_session_id=secret&_clerk_retry_attempt=3",
      ),
      "/v1/me/organization_memberships",
    );
    assert.equal(
      clerkOrganizationPollPath(
        "https://clerk.advancedautomations.net/v1/me/organization_invitations?status=pending&_clerk_retry_attempt=2",
      ),
      "/v1/me/organization_invitations",
    );
    assert.equal(
      clerkOrganizationPollPath(
        "https://clerk.advancedautomations.net/v1/me/organization_suggestions?status=pending&status=accepted&_clerk_retry_attempt=1",
      ),
      "/v1/me/organization_suggestions",
    );
  });

  it("leaves the successful session touch alone", () => {
    assert.equal(
      clerkOrganizationPollPath(
        "https://clerk.advancedautomations.net/v1/client/sessions/sess_example/touch",
      ),
      null,
    );
  });

  it("does not treat the query string as part of the poll identity", () => {
    const path = clerkOrganizationPollPath(
      "https://clerk.advancedautomations.net/v1/me/organization_invitations?_clerk_session_id=secret-value",
    );
    assert.equal(path, "/v1/me/organization_invitations");
    assert.equal(path?.includes("secret"), false);
  });

  it("treats an HTML block page as a failed poll", () => {
    assert.equal(isFilterBlockResponse("text/html", true), true);
    assert.equal(isFilterBlockResponse("application/json", true), false);
    assert.equal(isFilterBlockResponse("application/json", false), false);
  });
});
