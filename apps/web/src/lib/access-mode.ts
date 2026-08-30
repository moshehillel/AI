/**
 * Access modes for Koda while Clerk is blocked (e.g. NetFree).
 *
 * OPEN_ACCESS=1 — temporary single-customer open site: no login, fixed
 * EMPLOYEE (customer) on demo-co. Not demo mode — no role switcher.
 *
 * ALLOW_DEMO_AUTH=1 — local explore only. Keep at 0 while OPEN_ACCESS is on.
 *
 * Set both server and NEXT_PUBLIC_ variants so middleware/API and client UI agree.
 * When OPEN_ACCESS=0 (and ALLOW_DEMO_AUTH=0), Clerk protect + real sessions apply.
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
