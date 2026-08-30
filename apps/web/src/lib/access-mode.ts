/**
 * Access modes for Koda while Clerk is blocked (e.g. NetFree).
 *
 * OPEN_ACCESS=1 — single-customer open site: no login, always EMPLOYEE on demo-co.
 * ALLOW_DEMO_AUTH=1 — seed auth fallback (prefer OPEN_ACCESS in production).
 *
 * Set server + NEXT_PUBLIC_ variants so middleware/API and client UI agree.
 * When both are off, Clerk protect + real sessions apply.
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
