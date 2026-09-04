/** Edge-safe staff password + signed session helpers (no next/headers). */

export const STAFF_COOKIE = "koda_staff_session";

export type StaffRole = "developer" | "admin";

/**
 * Password for the staff unlock form.
 * Prefer ADMIN_PASSWORD; STAFF_ACCESS_TOKEN remains supported.
 */
export function getStaffPassword(): string | null {
  const password =
    process.env.ADMIN_PASSWORD?.trim() ||
    process.env.STAFF_ACCESS_TOKEN?.trim();
  return password || null;
}

/** @deprecated Use getStaffPassword */
export function getStaffAccessToken(): string | null {
  return getStaffPassword();
}

export function staffRoleFromCookieValue(
  value: string | undefined | null,
): StaffRole | null {
  if (value === "developer" || value === "admin") return value;
  return null;
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return toHex(sig);
}

/** Stable signing material for staff cookies (not the login password). */
function staffSessionSigningSecret(): string | null {
  const key = process.env.ENCRYPTION_KEY?.trim();
  return key || null;
}

/** Cookie value: `role.<hmac>` so a forged role cookie cannot unlock staff. */
export async function createStaffSessionValue(
  role: StaffRole,
): Promise<string | null> {
  const secret = staffSessionSigningSecret();
  if (!secret) return null;
  const mac = await hmacHex(secret, `koda-staff-v1:${role}`);
  return `${role}.${mac}`;
}

export async function parseStaffSessionValue(
  value: string | undefined | null,
): Promise<StaffRole | null> {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot <= 0) {
    // Legacy unsigned cookie (`developer` / `admin`) — reject.
    return null;
  }
  const role = staffRoleFromCookieValue(value.slice(0, dot));
  const mac = value.slice(dot + 1);
  if (!role || !mac) return null;
  const secret = staffSessionSigningSecret();
  if (!secret) return null;
  const expected = await hmacHex(secret, `koda-staff-v1:${role}`);
  if (!timingSafeEqualHex(mac, expected)) return null;
  return role;
}

export function clerkUserIdForStaffRole(role: StaffRole): string {
  return role === "admin" ? "seed_admin" : "seed_developer";
}

/** Paths that require a staff session while OPEN_ACCESS keeps the public site open. */
export function isStaffProtectedPath(pathname: string): boolean {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/review" ||
    pathname.startsWith("/review/") ||
    pathname === "/usage" ||
    pathname.startsWith("/usage/")
  );
}

export function safeNextPath(raw: string | null | undefined): string {
  if (raw?.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/review";
}

/** Staff cookie lifetime (seconds). Default 8h; max 30d. */
export function staffSessionMaxAgeSec(): number {
  const raw = process.env.STAFF_SESSION_MAX_AGE_SEC?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : 60 * 60 * 8;
  if (!Number.isFinite(parsed)) return 60 * 60 * 8;
  return Math.min(60 * 60 * 24 * 30, Math.max(900, parsed));
}
