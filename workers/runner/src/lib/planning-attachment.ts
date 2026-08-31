import { db } from "@automation-studio/db";
import {
  decryptSecret,
  formatAgentFilePromptSection,
  type PlanningAgentFilePayload,
} from "@automation-studio/domain";

export type LoadedPlanningAttachment = {
  promptSection: string;
  images: Array<{ data: string; mimeType: string }>;
  fileName: string;
  kind: string;
};

export async function loadPlanningAttachmentForAgent(opts: {
  companyId: string;
  projectId: string;
  attachmentRef: string;
}): Promise<LoadedPlanningAttachment | null> {
  const row = await db.secretRef.findUnique({
    where: {
      companyId_projectId_keyName_purpose: {
        companyId: opts.companyId,
        projectId: opts.projectId,
        keyName: opts.attachmentRef,
        purpose: "CHAT",
      },
    },
  });
  if (!row?.ciphertext) {
    console.warn(
      `[planning-attachment] missing ciphertext for ref=${opts.attachmentRef}`,
    );
    return null;
  }

  let payload: PlanningAgentFilePayload;
  try {
    payload = JSON.parse(decryptSecret(row.ciphertext)) as PlanningAgentFilePayload;
  } catch (error) {
    console.error(
      `[planning-attachment] decrypt/parse failed ref=${opts.attachmentRef}`,
      error,
    );
    return null;
  }

  const images = (payload.images ?? [])
    .filter((img) => img.data && img.mimeType)
    .slice(0, 5)
    .map((img) => ({ data: img.data, mimeType: img.mimeType }));

  console.info(
    `[planning-attachment] loaded ref=${opts.attachmentRef} file=${payload.fileName} kind=${payload.kind} images=${images.length} agentTextChars=${payload.agentText?.length ?? 0}`,
  );

  return {
    promptSection: formatAgentFilePromptSection(payload),
    images,
    fileName: payload.fileName,
    kind: payload.kind,
  };
}
