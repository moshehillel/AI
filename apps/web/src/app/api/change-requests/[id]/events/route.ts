import { getRequestAuth } from "@/lib/request-auth";
import { requireChangeRequestAccess, AuthError } from "@automation-studio/auth";
import { db } from "@automation-studio/db";
import { isCredentialSecretKey } from "@automation-studio/domain";
import {
  getQueueVisibility,
  highDemandMessage,
} from "@automation-studio/jobs";
import {
  admitSseConnection,
  releaseSseConnection,
} from "@/lib/sse-limits";

export const dynamic = "force-dynamic";

const SSE_POLL_MS =
  Number.parseInt(process.env.SSE_POLL_INTERVAL_MS ?? "1000", 10) || 1000;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const ctx = await getRequestAuth();
    await requireChangeRequestAccess(ctx, id);

    const admission = admitSseConnection(id);
    if (!admission.ok) {
      return Response.json(
        {
          error:
            "Too many live connections for this program. Close other tabs and try again.",
        },
        { status: 429 },
      );
    }
    const connectionId = admission.connectionId;

    const encoder = new TextEncoder();
    let closed = false;

    const stream = new ReadableStream({
      async start(controller) {
        const send = (payload: unknown) => {
          if (closed) return;
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
          );
        };

        send({ type: "connected", changeRequestId: id });

        let lastFingerprint = "";
        const tick = async () => {
          const cr = await db.changeRequest.findFirst({
            where: { id, companyId: ctx.company.id },
            include: {
              messages: { orderBy: { createdAt: "asc" } },
              previews: { orderBy: { createdAt: "desc" }, take: 1 },
              pullRequests: { orderBy: { createdAt: "desc" }, take: 1 },
              ciChecks: { orderBy: { createdAt: "desc" }, take: 1 },
              plans: { orderBy: { createdAt: "desc" }, take: 1 },
              agentRuns: { orderBy: { createdAt: "desc" }, take: 1 },
              secretRefs: {
                where: { purpose: "CHAT", ciphertext: { not: null } },
                select: { keyName: true, createdAt: true },
                orderBy: { createdAt: "asc" },
              },
            },
          });
          if (!cr) return;

          const credentialSecrets = cr.secretRefs.filter((s) =>
            isCredentialSecretKey(s.keyName),
          );

          const meta = (cr.planningMeta ?? {}) as {
            liveProgress?: string | null;
            liveDraft?: string | null;
            inFlightTurnAt?: string | null;
            queuedFollowUp?: { prompt?: string } | null;
            workerHeartbeatAt?: string | null;
          };

          const latestAgentRun = cr.agentRuns[0] ?? null;
          const queueStats = await getQueueVisibility({ changeRequestId: id });
          const demandMessage = highDemandMessage(queueStats);

          const fingerprint = JSON.stringify({
            status: cr.status,
            messageCount: cr.messages.length,
            preview: cr.previews[0]?.url ?? null,
            ci: cr.ciChecks[0]?.status ?? null,
            pr: cr.pullRequests[0]?.url ?? null,
            planId: cr.plans[0]?.id ?? null,
            planUpdated: cr.plans[0]?.updatedAt?.toISOString() ?? null,
            agentRunId: latestAgentRun?.id ?? null,
            agentRunStatus: latestAgentRun?.status ?? null,
            agentRunFinished: latestAgentRun?.finishedAt?.toISOString() ?? null,
            secretKeys: credentialSecrets.map((s) => s.keyName),
            liveProgress: meta.liveProgress ?? null,
            liveDraft: meta.liveDraft ?? null,
            inFlightTurnAt: meta.inFlightTurnAt ?? null,
            serverQueued: Boolean(meta.queuedFollowUp?.prompt),
            workerHeartbeatAt: meta.workerHeartbeatAt ?? null,
            queueWaiting: queueStats.waiting,
            queuePosition: queueStats.programQueuePosition ?? null,
            highDemand: demandMessage,
            updatedAt: cr.updatedAt.toISOString(),
          });

          if (fingerprint !== lastFingerprint) {
            lastFingerprint = fingerprint;
            send({
              type: "snapshot",
              status: cr.status,
              classification: cr.classification,
              messages: cr.messages.map((m) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                createdAt: m.createdAt.toISOString(),
              })),
              preview: cr.previews[0] ?? null,
              pullRequest: cr.pullRequests[0] ?? null,
              ci: cr.ciChecks[0] ?? null,
              plan: cr.plans[0] ?? null,
              latestAgentRun: latestAgentRun
                ? {
                    id: latestAgentRun.id,
                    status: latestAgentRun.status,
                    startedAt:
                      latestAgentRun.startedAt?.toISOString() ??
                      latestAgentRun.createdAt?.toISOString() ??
                      new Date(0).toISOString(),
                    finishedAt: latestAgentRun.finishedAt?.toISOString() ?? null,
                  }
                : null,
              liveProgress: meta.liveProgress ?? null,
              liveDraft: meta.liveDraft ?? null,
              inFlightTurnAt: meta.inFlightTurnAt ?? null,
              serverQueued: Boolean(meta.queuedFollowUp?.prompt),
              workerHeartbeatAt: meta.workerHeartbeatAt ?? null,
              queue: {
                waiting: queueStats.waiting,
                position: queueStats.programQueuePosition ?? null,
                cursorActive: queueStats.cursorSlots.active,
                cursorLimit: queueStats.cursorSlots.limit,
              },
              highDemandMessage: demandMessage,
              secretKeys: credentialSecrets.map((s) => ({
                keyName: s.keyName,
                createdAt: s.createdAt.toISOString(),
              })),
            });
          }
        };

        await tick();
        const interval = setInterval(() => {
          void tick().catch((error) => {
            send({ type: "error", message: String(error) });
          });
        }, SSE_POLL_MS);

        const heartbeat = setInterval(() => {
          send({ type: "heartbeat", at: new Date().toISOString() });
        }, 15000);

        const maxAgeMs =
          Number.parseInt(process.env.SSE_MAX_CONNECTION_AGE_MS ?? "", 10) ||
          2 * 60 * 60 * 1000;
        const maxAgeTimer = setTimeout(() => {
          send({
            type: "error",
            message: "Live connection expired — refresh the page to reconnect.",
          });
          close();
        }, maxAgeMs);

        const close = () => {
          if (closed) return;
          closed = true;
          clearInterval(interval);
          clearInterval(heartbeat);
          clearTimeout(maxAgeTimer);
          releaseSseConnection(connectionId);
          try {
            controller.close();
          } catch {
            // already closed
          }
        };

        _request.signal.addEventListener("abort", close);
      },
      cancel() {
        closed = true;
        releaseSseConnection(connectionId);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
