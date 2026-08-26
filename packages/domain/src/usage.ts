import type { Prisma } from "@automation-studio/db";
import { db } from "@automation-studio/db";

export type CompanySettings = {
  usageSoftCapCents?: number | null;
  usageSoftCapTokens?: number | null;
  allowAdminDeploy?: boolean;
};

export function parseCompanySettings(
  settings: Prisma.JsonValue,
): CompanySettings {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return {};
  }
  const s = settings as Record<string, unknown>;
  return {
    usageSoftCapCents:
      typeof s.usageSoftCapCents === "number" ? s.usageSoftCapCents : null,
    usageSoftCapTokens:
      typeof s.usageSoftCapTokens === "number" ? s.usageSoftCapTokens : null,
    allowAdminDeploy: Boolean(s.allowAdminDeploy),
  };
}

export async function getCompanyUsageTotals(companyId: string, since?: Date) {
  const where = {
    companyId,
    ...(since ? { createdAt: { gte: since } } : {}),
  };
  const aggregates = await db.usageRecord.aggregate({
    where,
    _sum: {
      totalTokens: true,
      billedCents: true,
      inputTokens: true,
      outputTokens: true,
    },
    _count: true,
  });
  return {
    records: aggregates._count,
    totalTokens: aggregates._sum.totalTokens ?? 0,
    billedCents: aggregates._sum.billedCents ?? 0,
    inputTokens: aggregates._sum.inputTokens ?? 0,
    outputTokens: aggregates._sum.outputTokens ?? 0,
  };
}

export async function assertUnderUsageSoftCap(companyId: string) {
  const company = await db.company.findUniqueOrThrow({ where: { id: companyId } });
  const settings = parseCompanySettings(company.settings);
  if (!settings.usageSoftCapCents && !settings.usageSoftCapTokens) {
    return { ok: true as const };
  }

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const totals = await getCompanyUsageTotals(companyId, monthStart);

  if (
    settings.usageSoftCapCents != null &&
    totals.billedCents >= settings.usageSoftCapCents
  ) {
    return {
      ok: false as const,
      reason: `Monthly usage soft cap reached (${totals.billedCents}¢ / ${settings.usageSoftCapCents}¢)`,
    };
  }
  if (
    settings.usageSoftCapTokens != null &&
    totals.totalTokens >= settings.usageSoftCapTokens
  ) {
    return {
      ok: false as const,
      reason: `Monthly token soft cap reached (${totals.totalTokens} / ${settings.usageSoftCapTokens})`,
    };
  }
  return { ok: true as const, totals };
}
