export const dynamic = 'force-dynamic';
import { AppHeader } from "@/components/app-header";
import { getRequestAuth } from "@/lib/request-auth";
import { db } from "@automation-studio/db";
import { STATUS_LABELS } from "@automation-studio/domain";
import Link from "next/link";

export default async function ReviewQueuePage() {
  const ctx = await getRequestAuth();

  if (ctx.role !== "DEVELOPER" && ctx.role !== "ADMIN") {
    return (
      <main className="mx-auto max-w-6xl px-6 py-8">
        <AppHeader role={ctx.role} />
        <div className="panel p-6">
          Developer access is required to view the review queue.
        </div>
      </main>
    );
  }

  const items = await db.changeRequest.findMany({
    where: {
      companyId: ctx.company.id,
      status: {
        in: [
          "READY_FOR_REVIEW",
          "DEVELOPER_REVIEW",
          "AWAITING_HIGH_RISK_APPROVAL",
          "APPROVED",
        ],
      },
    },
    include: {
      project: true,
      createdBy: true,
      previews: { orderBy: { createdAt: "desc" }, take: 1 },
      pullRequests: { orderBy: { createdAt: "desc" }, take: 1 },
      ciChecks: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <AppHeader role={ctx.role} />
      <section className="rise">
        <h1 className="brand-mark text-4xl">Ready for review</h1>
        <p className="muted mt-2">
          Inspect AI conversation, plan, checks, and preview before merging.
        </p>
        <div className="mt-8 space-y-4">
          {items.map((item) => (
            <article key={item.id} className="panel p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="muted text-sm">{item.project.name}</p>
                  <h2 className="text-xl font-medium">
                    Task #{item.number} · {item.title}
                  </h2>
                  <p className="muted mt-1 text-sm">
                    Requested by {item.createdBy.name ?? item.createdBy.email}
                  </p>
                </div>
                <span className="status-pill">{STATUS_LABELS[item.status]}</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-sm">
                <span className="status-pill">
                  Build/tests: {item.ciChecks[0]?.status ?? "—"}
                </span>
                <span className="status-pill">
                  Preview: {item.previews[0]?.status ?? "—"}
                </span>
                <span className="status-pill">{item.classification}</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  className="btn btn-primary"
                  href={`/change-requests/${item.id}`}
                >
                  Open review
                </Link>
                {item.previews[0]?.url ? (
                  <a
                    className="btn btn-ghost"
                    href={item.previews[0].url}
                    target="_blank"
                  >
                    Open preview
                  </a>
                ) : null}
                {item.pullRequests[0]?.url ? (
                  <a
                    className="btn btn-ghost"
                    href={item.pullRequests[0].url}
                    target="_blank"
                  >
                    View PR
                  </a>
                ) : null}
              </div>
            </article>
          ))}
          {items.length === 0 ? (
            <div className="panel p-6 muted">No items waiting for review.</div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
