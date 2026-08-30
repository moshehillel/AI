import Link from "next/link";
import { SignIn } from "@clerk/nextjs";

const clerkEnabled = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim(),
);
const demoAuth = process.env.NEXT_PUBLIC_ALLOW_DEMO_AUTH === "1";

export default function SignInPage() {
  if (!clerkEnabled) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
        <p className="muted text-center">
          Sign-in is unavailable until Clerk is configured. Demo mode can open
          the workspace directly.
        </p>
        <Link className="btn btn-primary" href="/projects">
          Start onboarding
        </Link>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <SignIn />
      {demoAuth ? (
        <p className="muted text-center text-sm">
          Exploring without an organization?{" "}
          <Link className="text-[var(--accent-soft)] underline" href="/projects">
            Start onboarding
          </Link>
        </p>
      ) : null}
    </main>
  );
}
