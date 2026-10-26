"use client";

import { SignIn } from "@clerk/nextjs";
import { useEffect, useState } from "react";

type Phase = "loading" | "ready" | "slow";

/**
 * The first HTML paint is this panel. Clerk's script is same-origin and can
 * be slow; the form mounts when that script is ready and does not leave a
 * blank page if it never arrives.
 */
export function SignInGate() {
  const [phase, setPhase] = useState<Phase>("loading");

  useEffect(() => {
    let attempts = 0;
    const id = window.setInterval(() => {
      attempts += 1;
      const clerk = (window as Window & { Clerk?: { loaded?: boolean } }).Clerk;
      if (clerk?.loaded) {
        window.clearInterval(id);
        setPhase("ready");
        return;
      }
      if (attempts === 60) setPhase("slow");
      if (attempts >= 120) window.clearInterval(id);
    }, 100);
    return () => window.clearInterval(id);
  }, []);

  if (phase === "ready") {
    return (
      <SignIn
        appearance={{
          elements: {
            footerAction: { display: "none" },
          },
        }}
      />
    );
  }

  return (
    <section className="w-full max-w-md rounded-xl border border-neutral-200 bg-white px-8 py-10 text-center shadow-sm">
      <h1 className="text-xl font-semibold text-neutral-900">Sign in</h1>
      <p className="mt-3 text-sm text-neutral-600">
        {phase === "slow"
          ? "Sign-in is still unreachable. Refresh the page to try again."
          : "Loading the sign-in form."}
      </p>
    </section>
  );
}
