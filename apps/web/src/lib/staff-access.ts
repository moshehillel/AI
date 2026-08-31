import { cookies } from "next/headers";

export const STAFF_COOKIE = "koda_staff_role";

export type StaffRole = "developer" | "admin";

/** Temporary staff unlock while OPEN_ACCESS keeps the public site as EMPLOYEE. */
export function getStaffAccessToken(): string | null {
  const token = process.env.STAFF_ACCESS_TOKEN?.trim();
  return token || null;
}

export function staffRoleFromCookieValue(
  value: string | undefined | null,
): StaffRole | null {
  if (value === "developer" || value === "admin") return value;
  return null;
}

export async function readStaffRoleCookie(): Promise<StaffRole | null> {
  const jar = await cookies();
  return staffRoleFromCookieValue(jar.get(STAFF_COOKIE)?.value);
}

export function clerkUserIdForStaffRole(role: StaffRole): string {
  return role === "admin" ? "seed_admin" : "seed_developer";
}
