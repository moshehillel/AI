import { NextResponse } from "next/server";
import { Webhook } from "svix";
import { db, ensureCustomerOnboardingProject } from "@automation-studio/db";
import { membershipRoleFromClerk, slugify } from "@automation-studio/domain";
import { ensurePlanningMembership } from "@/lib/clerk-sync";

export async function POST(request: Request) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CLERK_WEBHOOK_SECRET not configured" },
      { status: 500 },
    );
  }

  const payload = await request.text();
  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "Missing svix headers" }, { status: 400 });
  }

  const wh = new Webhook(secret);
  let event: { type: string; data: Record<string, unknown> };
  try {
    event = wh.verify(payload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as { type: string; data: Record<string, unknown> };
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "organization.created": {
      const orgId = String(event.data.id);
      const name = String(event.data.name ?? "Company");
      const company = await db.company.upsert({
        where: { clerkOrgId: orgId },
        update: { name },
        create: {
          clerkOrgId: orgId,
          name,
          slug: slugify(name),
        },
      });
      await ensureCustomerOnboardingProject(db, company.id);
      break;
    }
    case "user.created":
    case "user.updated": {
      const userId = String(event.data.id);
      const email =
        (event.data.email_addresses as Array<{ email_address: string }> | undefined)?.[0]
          ?.email_address ?? `${userId}@users.local`;
      const first = String(event.data.first_name ?? "");
      const last = String(event.data.last_name ?? "");
      const name = `${first} ${last}`.trim() || email;
      await db.user.upsert({
        where: { clerkUserId: userId },
        update: { email, name, slug: slugify(name || email) },
        create: {
          clerkUserId: userId,
          email,
          name,
          slug: slugify(name || email),
        },
      });
      break;
    }
    case "organizationMembership.created":
    case "organizationMembership.updated": {
      const orgId = String(
        (event.data.organization as { id?: string } | undefined)?.id ?? "",
      );
      const userId = String(
        (event.data.public_user_data as { user_id?: string } | undefined)?.user_id ??
          "",
      );
      const role = membershipRoleFromClerk(String(event.data.role ?? "org:member"));
      if (!orgId || !userId) break;

      const company = await db.company.findUnique({ where: { clerkOrgId: orgId } });
      if (!company) break;
      // Workspace exists even if the user webhook has not landed yet.
      await ensureCustomerOnboardingProject(db, company.id);

      const user = await db.user.findUnique({ where: { clerkUserId: userId } });
      if (!user) break;

      await db.companyMembership.upsert({
        where: {
          companyId_userId: { companyId: company.id, userId: user.id },
        },
        update: { role },
        create: { companyId: company.id, userId: user.id, role },
      });

      // Members can always plan — grant shared onboarding workspace (not iterate projects).
      await ensurePlanningMembership(company.id, user.id);
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ ok: true });
}
