import Link from "next/link";
import { redirect } from "next/navigation";
import { SignIn } from "@clerk/nextjs";
import { isDemoAuthEnabled } from "@/lib/access-mode";

const clerkEnabled = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim(),
);

export default function SignInPage() {
  if (isDemoAuthEnabled()) {
    redirect("/projects");
  }

  if (!clerkEnabled) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
        <p className="muted text-center">
          Sign-in is unavailable until Clerk is configured.
        </p>
        <Link className="btn btn-primary" href="/projects">
          Continue
        </Link>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <SignIn />
    </main>
  );
}
