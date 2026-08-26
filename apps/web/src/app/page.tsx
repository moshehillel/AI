import Link from "next/link";

const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export default function HomePage() {
  if (!clerkEnabled) {
    return (
      <main className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-10">
        <header className="flex items-center justify-between rise">
          <div className="brand-mark text-3xl">Automation Studio</div>
          <Link className="btn btn-primary" href="/projects">
            Enter demo
          </Link>
        </header>
        <Hero />
      </main>
    );
  }

  return <ClerkHome />;
}

function Hero() {
  return (
    <section className="relative mt-24 grid gap-10 lg:grid-cols-[1.2fr_0.8fr]">
      <div className="rise" style={{ animationDelay: "80ms" }}>
        <p className="muted mb-4 text-sm uppercase tracking-[0.2em]">
          Isolated AI changes · Developer gatekeepers
        </p>
        <h1 className="brand-mark max-w-3xl text-5xl leading-tight md:text-6xl">
          Ask for software changes in plain English.
        </h1>
        <p className="muted mt-6 max-w-xl text-lg leading-relaxed">
          Employees describe what they need. Automation Studio uses AI to prepare
          changes on isolated branches and temporary previews. Developers review
          and merge to production.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link className="btn btn-primary" href="/projects">
            Open the studio
          </Link>
        </div>
      </div>

      <div
        className="panel rise relative overflow-hidden p-6"
        style={{ animationDelay: "160ms" }}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(125,206,160,0.18),transparent_45%)]" />
        <div className="relative space-y-4">
          <div className="status-pill pulse-soft">Analyzing project…</div>
          <div className="rounded-xl border border-[var(--line)] bg-black/20 p-4">
            <p className="text-sm muted">Sarah · Invoice Automation</p>
            <p className="mt-2">
              Add a way to retry invoices that failed because the customer’s
              account was temporarily unavailable.
            </p>
          </div>
          <ul className="space-y-2 text-sm">
            <li>✓ Found invoice processing logic</li>
            <li>✓ Found dashboard</li>
            <li>✓ Found existing tests</li>
            <li className="muted">Making the change…</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

async function ClerkHome() {
  const { auth } = await import("@clerk/nextjs/server");
  const { redirect } = await import("next/navigation");
  const session = await auth();
  if (session.userId) {
    redirect("/projects");
  }

  return (
    <main className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-10">
      <header className="flex items-center justify-between rise">
        <div className="brand-mark text-3xl">Automation Studio</div>
        <div className="flex gap-3">
          <Link className="btn btn-ghost" href="/sign-in">
            Sign in
          </Link>
          <Link className="btn btn-primary" href="/sign-up">
            Get started
          </Link>
        </div>
      </header>
      <Hero />
    </main>
  );
}
