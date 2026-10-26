import { cookies } from "next/headers";
import {
  STAFF_COOKIE,
  clerkUserIdForStaffRole,
  createStaffSessionValue,
  getStaffAccessToken,
  getStaffPassword,
  parseStaffSessionValue,
  staffRoleFromCookieValue,
  type StaffRole,
} from "@/lib/staff-session";

export {
  STAFF_COOKIE,
  clerkUserIdForStaffRole,
  createStaffSessionValue,
  getStaffAccessToken,
  getStaffPassword,
  parseStaffSessionValue,
  staffRoleFromCookieValue,
  type StaffRole,
};

export async function readStaffRoleCookie(): Promise<StaffRole | null> {
  const jar = await cookies();
  return parseStaffSessionValue(jar.get(STAFF_COOKIE)?.value);
}
