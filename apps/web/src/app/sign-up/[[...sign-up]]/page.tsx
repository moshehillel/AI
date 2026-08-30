import Link from "next/link";
import { SignUp } from "@clerk/nextjs";

const clerkEnabled = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim(),
);

export default function SignUpPage() {
  if (!clerkEnabled) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
        <p className="muted text-center">
          Sign-up is unavailable until Clerk is configured. Demo mode can open
          the workspace directly.
        </p>
        <Link className="btn btn-primary" href="/projects">
          Open workspace
        </Link>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <SignUp />
    </main>
  );
}
