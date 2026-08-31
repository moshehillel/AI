import { NextResponse } from "next/server";
import { z } from "zod";
import {
  STAFF_COOKIE,
  getStaffAccessToken,
  staffRoleFromCookieValue,
} from "@/lib/staff-access";

const bodySchema = z.object({
  token: z.string().min(1),
  role: z.enum(["developer", "admin"]).optional(),
  next: z.string().optional(),
});

export async function POST(request: Request) {
  const expected = getStaffAccessToken();
  if (!expected) {
    return NextResponse.json(
      { error: "Staff unlock is not configured" },
      { status: 503 },
    );
  }

  const body = bodySchema.parse(await request.json());
  if (body.token !== expected) {
    return NextResponse.json({ error: "Invalid staff token" }, { status: 403 });
  }

  const role = staffRoleFromCookieValue(body.role ?? "developer") ?? "developer";
  const nextPath =
    body.next?.startsWith("/") && !body.next.startsWith("//")
      ? body.next
      : "/review";

  const response = NextResponse.json({ ok: true, role, next: nextPath });
  response.cookies.set(STAFF_COOKIE, role, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
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
  return response;
}
