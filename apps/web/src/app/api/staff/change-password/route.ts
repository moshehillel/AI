import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRateLimit } from "@/lib/rate-limit";
import { AuthError } from "@automation-studio/auth";
import {
  setStaffPasswordHash,
  staffPasswordConfigured,
  verifyStaffPassword,
} from "@/lib/staff-password";

const bodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(4).max(256),
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
  if (body.currentPassword === body.newPassword) {
    return NextResponse.json(
      { error: "New password must differ from the current password" },
      { status: 400 },
    );
  }

  if (!(await verifyStaffPassword(body.currentPassword))) {
    return NextResponse.json({ error: "Invalid current password" }, { status: 403 });
  }

  await setStaffPasswordHash(body.newPassword);
  return NextResponse.json({ ok: true });
}
