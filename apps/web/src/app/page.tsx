import Link from "next/link";
import { redirect } from "next/navigation";
import { Space_Grotesk, Manrope } from "next/font/google";
import { isOpenAccess } from "@/lib/access-mode";

export const dynamic = "force-dynamic";

const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-onboard-display",
});

const body = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-onboard-body",
});

export default function HomePage() {
  const clerkEnabled = Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim(),
  );

  // Single-customer open access: go straight to onboarding (no Clerk).
  if (isOpenAccess()) {
    redirect("/projects");
  }

  if (!clerkEnabled) {
    return (
      <main className={`onboard ${display.variable} ${body.variable}`}>
        <div className="onboard-atmosphere" aria-hidden>
          <div className="onboard-glow onboard-glow-a" />
          <div className="onboard-glow onboard-glow-b" />
          <div className="onboard-grid" />
          <div className="onboard-cubes" />
        </div>
        <header className="onboard-top">
          <div className="onboard-top-brand">
            <picture>
              <source srcSet="/brand/AA-Logo.webp" type="image/webp" />
              <img
                src="/brand/AA-Logo.png"
                alt="Advanced Automations"
                className="onboard-top-logo"
                width={48}
                height={48}
              />
            </picture>
            <span className="onboard-top-name">Advanced Automations</span>
          </div>
          <Link className="onboard-btn onboard-btn-compact" href="/projects">
            Continue
          </Link>
        </header>
        <Hero ctaHref="/projects" ctaLabel="Continue" />
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
    <section className="onboard-hero">
      <div className="onboard-hero-visual rise" style={{ animationDelay: "40ms" }}>
        <picture>
          <source srcSet="/brand/AA-Logo.webp" type="image/webp" />
          <img
            src="/brand/AA-Logo.png"
            alt="Advanced Automations"
            className="onboard-hero-logo"
            width={720}
            height={720}
            fetchPriority="high"
          />
        </picture>
      </div>
      <div className="onboard-hero-copy">
        <p className="onboard-koda rise" style={{ animationDelay: "100ms" }}>
          Koda
        </p>
        <h1
          className="onboard-headline rise"
          style={{ animationDelay: "160ms" }}
        >
          Advanced Automations AI Builder
        </h1>
        <p className="onboard-lead rise" style={{ animationDelay: "220ms" }}>
          Tell Koda what you need automated. Answer a few questions, review the
          plan, then ship with developer approval.
        </p>
        <div className="onboard-cta rise" style={{ animationDelay: "280ms" }}>
          <Link className="onboard-btn" href={ctaHref}>
            {ctaLabel}
          </Link>
        </div>
      </div>
    </section>
  );
}

async function ClerkHome() {
  const { auth } = await import("@clerk/nextjs/server");
  const session = await auth();
  if (session.userId) {
    redirect(session.orgId ? "/projects" : "/select-org");
  }

  return (
    <main className={`onboard ${display.variable} ${body.variable}`}>
      <div className="onboard-atmosphere" aria-hidden>
        <div className="onboard-glow onboard-glow-a" />
        <div className="onboard-glow onboard-glow-b" />
        <div className="onboard-grid" />
        <div className="onboard-cubes" />
      </div>
      <header className="onboard-top">
        <div className="onboard-top-brand">
          <picture>
            <source srcSet="/brand/AA-Logo.webp" type="image/webp" />
            <img
              src="/brand/AA-Logo.png"
              alt="Advanced Automations"
              className="onboard-top-logo"
              width={48}
              height={48}
            />
          </picture>
          <span className="onboard-top-name">Advanced Automations</span>
        </div>
        <div className="onboard-top-nav">
          <Link href="/sign-in">Sign in</Link>
          <Link className="onboard-btn onboard-btn-compact" href="/sign-up">
            Get started
          </Link>
        </div>
      </header>
      <Hero ctaHref="/sign-up" ctaLabel="Start with Koda" />
    </main>
  );
}
