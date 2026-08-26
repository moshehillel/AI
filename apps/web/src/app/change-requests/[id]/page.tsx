import { AppHeader } from "@/components/app-header";
import { getRequestAuth } from "@/lib/request-auth";
import { requireChangeRequestAccess } from "@automation-studio/auth";
import { db } from "@automation-studio/db";
import { STATUS_LABELS } from "@automation-studio/domain";
import { notFound } from "next/navigation";
import { ChatPanel } from "./chat-panel";
import { ActionBar } from "./action-bar";

export default async function ChangeRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getRequestAuth();

  let changeRequest;
  try {
    changeRequest = await requireChangeRequestAccess(ctx, id);
  } catch {
    notFound();
  }

  const full = await db.changeRequest.findFirstOrThrow({
    where: { id: changeRequest.id },
    include: {
      project: true,
      messages: { orderBy: { createdAt: "asc" } },
      plans: { orderBy: { createdAt: "desc" }, take: 1 },
      previews: { orderBy: { createdAt: "desc" }, take: 1 },
      pullRequests: { orderBy: { createdAt: "desc" }, take: 1 },
      ciChecks: { orderBy: { createdAt: "desc" }, take: 1 },
      statusEvents: { orderBy: { createdAt: "asc" } },
    },
  });

  const preview = full.previews[0];
  const pr = full.pullRequests[0];
  const plan = full.plans[0];
  const ci = full.ciChecks[0];

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <AppHeader role={ctx.role} />
      <section className="rise grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="panel flex min-h-[70vh] flex-col p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="muted text-sm">{full.project.name}</p>
              <h1 className="brand-mark text-3xl">
                #{full.number} {full.title}
              </h1>
            </div>
            <span className="status-pill">{STATUS_LABELS[full.status]}</span>
          </div>
          <ChatPanel
            changeRequestId={full.id}
            initialMessages={full.messages.map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              createdAt: m.createdAt.toISOString(),
            }))}
            status={full.status}
          />
        </div>

        <aside className="space-y-4">
          <div className="panel p-5">
            <h2 className="text-lg">Progress</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {full.statusEvents.map((event) => (
                <li key={event.id} className="flex justify-between gap-3">
                  <span>{STATUS_LABELS[event.toStatus]}</span>
                  <span className="muted">
                    {event.createdAt.toLocaleTimeString()}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="panel space-y-3 p-5">
            <h2 className="text-lg">Details</h2>
            <p className="text-sm">
              <span className="muted">Classification:</span> {full.classification}
            </p>
            {full.branchName ? (
              <p className="text-sm">
                <span className="muted">Branch:</span> {full.branchName}
              </p>
            ) : null}
            {ci ? (
              <p className="text-sm">
                <span className="muted">Build/tests:</span> {ci.status}
              </p>
            ) : null}
            {pr ? (
              <a className="btn btn-ghost w-full" href={pr.url} target="_blank">
                View pull request
              </a>
            ) : null}
            {preview?.url ? (
              <a
                className="btn btn-primary w-full"
                href={preview.url}
                target="_blank"
              >
                Open test version
              </a>
            ) : null}
          </div>

          {plan ? (
            <div className="panel p-5">
              <h2 className="text-lg">Plan</h2>
              <pre className="muted mt-3 whitespace-pre-wrap text-sm">
                {plan.content}
              </pre>
            </div>
          ) : null}

          <ActionBar
            changeRequestId={full.id}
            status={full.status}
            role={ctx.role}
            hasPlan={Boolean(plan)}
          />
        </aside>
      </section>
    </main>
  );
}
