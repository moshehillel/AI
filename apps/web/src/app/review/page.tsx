export const dynamic = "force-dynamic";
import { AppHeader } from "@/components/app-header";
import { requirePageAuth } from "@/lib/page-auth";
import { isOpenAccess } from "@/lib/access-mode";
import { db } from "@automation-studio/db";
import { STATUS_LABELS } from "@automation-studio/domain";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function ReviewQueuePage() {
  const ctx = await requirePageAuth();

  if (ctx.role !== "DEVELOPER" && ctx.role !== "ADMIN") {
    if (isOpenAccess()) {
      redirect("/staff?next=/review");
    }
    return (
      <main className="app-frame">
        <AppHeader role={ctx.role} />
        <div className="panel space-y-3 p-6">
          <p>Developer access is required to view the review queue.</p>
          <p className="muted text-sm">
            Sign in with a developer or admin account, or unlock staff tools at{" "}
            <Link className="underline" href="/staff">
              /staff
            </Link>
            .
          </p>
        </div>
      </main>
    );
  }

  const items = await db.changeRequest.findMany({
    where: {
      companyId: ctx.company.id,
      status: {
        in: [
          "AWAITING_DEV_BUILD",
          "BUILDING",
          "TESTING",
          "CLIENT_VERIFY",
          "PREVIEW_READY",
          "CHANGES_REQUESTED",
          "AWAITING_FINAL_REVIEW",
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
    <main className="app-frame">
      <AppHeader role={ctx.role} />
      <section className="rise">
        <h1 className="brand-mark text-4xl">Review queue</h1>
        <p className="muted mt-2">
          Submitted plans → Open in Cursor → Build → Test & Improve → deploy.
        </p>
        <div className="mt-8 space-y-4">
          {items.map((item) => (
            <article key={item.id} className="panel p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="muted text-sm">
                    {item.project.name}
                    {item.kind === "PROGRAM" ? " · Program" : " · Change"}
                  </p>
                  <h2 className="text-xl font-medium">
                    #{item.number} · {item.title}
                  </h2>
                  <p className="muted mt-1 text-sm">
                    Requested by {item.createdBy.name ?? item.createdBy.email}
                  </p>
                </div>
                <span className="status-pill">{STATUS_LABELS[item.status]}</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  className="btn btn-primary"
                  href={`/change-requests/${item.id}`}
                >
                  Open
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
              </div>
            </article>
          ))}
          {items.length === 0 ? (
            <div className="panel p-6 muted">Nothing waiting for review.</div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
