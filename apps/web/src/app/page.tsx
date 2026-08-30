import Link from "next/link";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const clerkEnabled = Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim(),
  );
  const demoAuth = process.env.NEXT_PUBLIC_ALLOW_DEMO_AUTH === "1";

  if (!clerkEnabled || demoAuth) {
    return (
      <main className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-8">
        <header className="relative z-10 flex items-center justify-between rise">
          <div className="brand-mark text-2xl tracking-tight">Koda</div>
          <div className="flex gap-3">
            {clerkEnabled ? (
              <Link className="btn btn-ghost" href="/sign-in">
                Sign in
              </Link>
            ) : null}
            <Link className="btn btn-primary" href="/projects">
              Start onboarding
            </Link>
          </div>
        </header>
        <Hero ctaHref="/projects" ctaLabel="Start onboarding" />
      </main>
    );
  }

  return <ClerkHome />;
}

function Hero({
  ctaHref,
  ctaLabel,
}: {
  ctaHref: string;
  ctaLabel: string;
}) {
  return (
    <section className="hero-stage">
      <div className="hero-grid" aria-hidden />
      <div className="relative z-10 max-w-3xl">
        <p
          className="brand-mark rise text-6xl leading-none md:text-8xl"
          style={{ animationDelay: "40ms" }}
        >
          Koda
        </p>
        <h1
          className="rise mt-5 max-w-2xl text-2xl font-medium leading-snug text-[var(--accent-soft)] md:text-4xl"
          style={{ animationDelay: "120ms" }}
        >
          Advanced Automations AI Builder
        </h1>
        <p
          className="muted rise mt-6 max-w-xl text-lg leading-relaxed"
          style={{ animationDelay: "200ms" }}
        >
          Tell Koda what you need automated. Answer a few questions, review the
          plan, then ship with developer approval — without touching
          infrastructure.
        </p>
        <div className="rise mt-9" style={{ animationDelay: "280ms" }}>
          <Link className="btn btn-primary" href={ctaHref}>
            {ctaLabel}
          </Link>
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
    redirect(session.orgId ? "/projects" : "/select-org");
  }

  return (
    <main className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-8">
      <header className="relative z-10 flex items-center justify-between rise">
        <div className="brand-mark text-2xl tracking-tight">Koda</div>
        <div className="flex gap-3">
          <Link className="btn btn-ghost" href="/sign-in">
            Sign in
          </Link>
          <Link className="btn btn-primary" href="/sign-up">
            Get started
          </Link>
        </div>
      </header>
      <Hero ctaHref="/sign-up" ctaLabel="Start with Koda" />
    </main>
  );
}
