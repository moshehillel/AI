import { PrismaClient } from "@prisma/client";

async function main() {
  const db = new PrismaClient();
  try {
    const project = await db.project.findFirst({
      where: { slug: "customer-onboarding" },
    });
    const cr = await db.changeRequest.findFirst({
      where: { status: "PLANNING", kind: "PROGRAM", cursorAgentId: { not: null } },
      orderBy: { updatedAt: "desc" },
    });
    console.log(JSON.stringify({ projectId: project?.id, crId: cr?.id, title: cr?.title }));
  } finally {
    await db.$disconnect();
  }
}

main();
