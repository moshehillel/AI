/**
 * Access modes for Koda.
 *
 * OPEN_ACCESS=1 — local single-customer mode: no login, fixed EMPLOYEE on
 * demo-co. Not demo mode — no role switcher. Do not use in production.
 *
 * OPEN_ACCESS=0 — production: Clerk sign-in + Organizations (default).
 *
 * ALLOW_DEMO_AUTH=1 — local explore with role switcher. Keep at 0 in production.
 *
 * Set both server and NEXT_PUBLIC_ variants so middleware/API and client agree.
 */

export function isOpenAccess(): boolean {
  return (
    process.env.OPEN_ACCESS === "1" ||
    process.env.NEXT_PUBLIC_OPEN_ACCESS === "1"
  );
}

/** Seed auth path (open access or explicit demo flag). */
export function isDemoAuthEnabled(): boolean {
  return (
    isOpenAccess() ||
    process.env.ALLOW_DEMO_AUTH === "1" ||
    process.env.NEXT_PUBLIC_ALLOW_DEMO_AUTH === "1"
  );
}

/** Client-safe: hide Sign in / role switcher under open access only. */
export function isOpenAccessPublic(): boolean {
  return process.env.NEXT_PUBLIC_OPEN_ACCESS === "1";
}
