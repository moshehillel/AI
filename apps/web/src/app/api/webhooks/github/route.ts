import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@automation-studio/db";
import { parseBuildSetup } from "@automation-studio/domain";
import { enqueueJob } from "@automation-studio/jobs";

function verifySignature(payload: string, signature: string | null) {
  const secret = process.env.GITHUB_APP_WEBHOOK_SECRET;
  if (!secret) return process.env.GITHUB_MOCK === "1";
  if (!signature) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

const PREVIEW_STATUSES = [
  "BUILDING",
  "TESTING",
  "PREVIEW_READY",
  "CLIENT_VERIFY",
  "CHANGES_REQUESTED",
  "DEVELOPER_REVIEW",
] as const;

export async function POST(request: Request) {
  const payload = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifySignature(payload, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = request.headers.get("x-github-event");
  const body = JSON.parse(payload) as Record<string, unknown>;

  if (event === "check_suite" || event === "check_run" || event === "status") {
    const repo = body.repository as { full_name?: string } | undefined;
    const fullName = repo?.full_name;
    if (fullName) {
      const [owner, name] = fullName.split("/");
      const repository = await db.repository.findFirst({
        where: { githubOwner: owner, githubRepo: name },
        include: {
          project: {
            include: {
              changeRequests: {
                where: { status: { in: [...PREVIEW_STATUSES] } },
                orderBy: { updatedAt: "desc" },
                take: 5,
              },
            },
          },
        },
      });
      for (const cr of repository?.project.changeRequests ?? []) {
        await enqueueJob("ci.sync-checks", {
          changeRequestId: cr.id,
          companyId: cr.companyId,
        });
      }
    }
  }

  if (event === "push") {
    const ref = String(body.ref ?? "");
    const branch = ref.startsWith("refs/heads/")
      ? ref.slice("refs/heads/".length)
      : "";
    const repo = body.repository as
      | { owner?: { login?: string }; name?: string }
      | undefined;
    if (branch && repo?.owner?.login && repo.name) {
      const changeRequests = await db.changeRequest.findMany({
        where: {
          branchName: branch,
          status: { in: [...PREVIEW_STATUSES] },
          project: {
            repository: {
              githubOwner: repo.owner.login,
              githubRepo: repo.name,
            },
          },
        },
        take: 10,
      });
      for (const cr of changeRequests) {
        const setup = parseBuildSetup(cr.buildSetup);
        if (setup.autoDeploy === false) continue;
        await enqueueJob("github.ensure-pr", {
          changeRequestId: cr.id,
          companyId: cr.companyId,
        });
        await enqueueJob("railway.sync-preview", {
          changeRequestId: cr.id,
          companyId: cr.companyId,
        });
      }
    }
  }

  if (event === "pull_request") {
    const action = String(body.action ?? "");
    const pr = body.pull_request as { number?: number; html_url?: string } | undefined;
    const repo = body.repository as { owner?: { login?: string }; name?: string } | undefined;
    if (pr?.number && repo?.owner?.login && repo.name) {
      const pull = await db.pullRequest.findFirst({
        where: {
          githubPrNumber: pr.number,
          changeRequest: {
            project: {
              repository: {
                githubOwner: repo.owner.login,
                githubRepo: repo.name,
              },
            },
          },
        },
        include: { changeRequest: true },
      });
      if (pull && (action === "opened" || action === "synchronize" || action === "reopened")) {
        const setup = parseBuildSetup(pull.changeRequest.buildSetup);
        if (setup.autoDeploy !== false) {
          await enqueueJob("railway.sync-preview", {
            changeRequestId: pull.changeRequestId,
            companyId: pull.changeRequest.companyId,
          });
        }
      }
      if (pull && action === "closed") {
        await db.previewEnvironment.updateMany({
          where: { changeRequestId: pull.changeRequestId, status: "READY" },
          data: { status: "DESTROYED", destroyedAt: new Date() },
        });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
