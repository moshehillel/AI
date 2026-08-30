/**
 * Access modes for Koda while Clerk is blocked (e.g. NetFree).
 *
 * OPEN_ACCESS=1 — single-customer open site: no login, always EMPLOYEE on demo-co.
 * ALLOW_DEMO_AUTH=1 — same server-side fallback; prefer OPEN_ACCESS for production.
 *
 * Set both server and NEXT_PUBLIC_ variants so middleware/API and client UI agree.
 * When OPEN_ACCESS=0 and ALLOW_DEMO_AUTH=0, Clerk protect + real sessions apply.
 */

export function isOpenAccess(): boolean {
  return (
    process.env.OPEN_ACCESS === "1" ||
    process.env.NEXT_PUBLIC_OPEN_ACCESS === "1"
  );
}

/** Demo/seed auth path (open access or explicit demo flag). */
export function isDemoAuthEnabled(): boolean {
  return (
    isOpenAccess() ||
    process.env.ALLOW_DEMO_AUTH === "1" ||
    process.env.NEXT_PUBLIC_ALLOW_DEMO_AUTH === "1"
  );
}

/** Client-safe: hide Sign in / Sign up / role switcher. */
export function isOpenAccessPublic(): boolean {
  return (
    process.env.NEXT_PUBLIC_OPEN_ACCESS === "1" ||
    process.env.NEXT_PUBLIC_ALLOW_DEMO_AUTH === "1"
  );
}
