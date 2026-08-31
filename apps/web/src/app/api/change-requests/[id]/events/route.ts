import { getRequestAuth } from "@/lib/request-auth";
import { requireChangeRequestAccess, AuthError } from "@automation-studio/auth";
import { db } from "@automation-studio/db";
import { isCredentialSecretKey } from "@automation-studio/domain";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const ctx = await getRequestAuth();
    await requireChangeRequestAccess(ctx, id);

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

          const fingerprint = JSON.stringify({
            status: cr.status,
            messageCount: cr.messages.length,
            preview: cr.previews[0]?.url ?? null,
            ci: cr.ciChecks[0]?.status ?? null,
            pr: cr.pullRequests[0]?.url ?? null,
            planId: cr.plans[0]?.id ?? null,
            secretKeys: credentialSecrets.map((s) => s.keyName),
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
        }, 2000);

        const heartbeat = setInterval(() => {
          send({ type: "heartbeat", at: new Date().toISOString() });
        }, 15000);

        const close = () => {
          if (closed) return;
          closed = true;
          clearInterval(interval);
          clearInterval(heartbeat);
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
