import { NextResponse } from "next/server";
import { z } from "zod";
import {
  STAFF_COOKIE,
  createStaffSessionValue,
  safeNextPath,
  staffRoleFromCookieValue,
  staffSessionMaxAgeSec,
} from "@/lib/staff-session";
import {
  staffPasswordConfigured,
  verifyStaffPassword,
} from "@/lib/staff-password";
import { requireRateLimit } from "@/lib/rate-limit";
import { AuthError } from "@automation-studio/auth";

const bodySchema = z.object({
  /** Preferred field name for the staff password form. */
  password: z.string().min(1).optional(),
  /** Legacy alias — same secret as password. */
  token: z.string().min(1).optional(),
  role: z.enum(["developer", "admin"]).optional(),
  next: z.string().optional(),
});

export async function POST(request: Request) {
  if (!(await staffPasswordConfigured())) {
    return NextResponse.json(
      { error: "Staff unlock is not configured" },
      { status: 503 },
    );
  }

  const clientIp =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  try {
    await requireRateLimit({ preset: "staff_unlock", scope: clientIp });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const body = bodySchema.parse(await request.json());
  const provided = (body.password ?? body.token ?? "").trim();
  if (!provided || !(await verifyStaffPassword(provided))) {
    return NextResponse.json({ error: "Invalid password" }, { status: 403 });
  }

  const role = staffRoleFromCookieValue(body.role ?? "developer") ?? "developer";
  const session = await createStaffSessionValue(role);
  if (!session) {
    return NextResponse.json(
      { error: "Staff unlock is not configured" },
      { status: 503 },
    );
  }

  const nextPath = safeNextPath(body.next);

  const response = NextResponse.json({ ok: true, role, next: nextPath });
  response.cookies.set(STAFF_COOKIE, session, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: staffSessionMaxAgeSec(),
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(STAFF_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  // Clear legacy unsigned cookie name if present.
  response.cookies.set("koda_staff_role", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
