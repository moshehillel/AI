import { db } from "@automation-studio/db";
import {
  decryptSecret,
  formatAgentFilePromptSection,
  PLANNING_AGENT_MAX_IMAGES,
  planningUploadWorkspacePath,
  type PlanningAgentFilePayload,
} from "@automation-studio/domain";
import { commitFilesToBranch } from "@automation-studio/github";

export type LoadedPlanningAttachment = {
  promptSection: string;
  images: Array<{ data: string; mimeType: string }>;
  fileName: string;
  kind: string;
  workspacePath?: string;
};

export async function loadPlanningAttachmentPayload(opts: {
  companyId: string;
  projectId: string;
  attachmentRef: string;
}): Promise<PlanningAgentFilePayload | null> {
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

  try {
    return JSON.parse(decryptSecret(row.ciphertext)) as PlanningAgentFilePayload;
  } catch (error) {
    console.error(
      `[planning-attachment] decrypt/parse failed ref=${opts.attachmentRef}`,
      error,
    );
    return null;
  }
}

/**
 * Load one or more planning attachments for a Cursor agent turn.
 * For PDFs with original bytes, commit the real PDF into the planning branch
 * so the agent can open the file (Cloud Agents API has no PDF prompt field).
 */
export async function loadPlanningAttachmentsForAgent(opts: {
  companyId: string;
  projectId: string;
  attachmentRefs: string[];
  /** When set, original PDF/Excel bytes are written into the branch for the agent. */
  repoWrite?: {
    installationId: string;
    owner: string;
    repo: string;
    branch: string;
  } | null;
  onProgress?: (label: string) => void | Promise<void>;
}): Promise<{
  promptSection: string;
  images: Array<{ data: string; mimeType: string }>;
  fileNames: string[];
}> {
  const refs = [...new Set(opts.attachmentRefs.filter(Boolean))];
  const sections: string[] = [];
  const images: Array<{ data: string; mimeType: string }> = [];
  const fileNames: string[] = [];
  const filesToCommit: Array<{
    path: string;
    content: string;
    encoding: "base64";
  }> = [];

  for (const ref of refs) {
    await opts.onProgress?.("Reading your attached files…");
    const payload = await loadPlanningAttachmentPayload({
      companyId: opts.companyId,
      projectId: opts.projectId,
      attachmentRef: ref,
    });
    if (!payload) continue;

    fileNames.push(payload.fileName);
    const progressLabel =
      payload.kind === "pdf"
        ? `Reading your PDF (${payload.fileName})…`
        : payload.kind === "excel"
          ? `Reading your spreadsheet (${payload.fileName})…`
          : `Reading ${payload.fileName}…`;
    await opts.onProgress?.(progressLabel);

    const workspacePath =
      payload.workspacePath ||
      (payload.originalBase64 && (payload.kind === "pdf" || payload.kind === "excel")
        ? planningUploadWorkspacePath(payload.fileName)
        : undefined);

    if (payload.originalBase64 && workspacePath && opts.repoWrite) {
      filesToCommit.push({
        path: workspacePath,
        content: payload.originalBase64,
        encoding: "base64",
      });
      payload.workspacePath = workspacePath;
    }

    sections.push(formatAgentFilePromptSection(payload));

    for (const img of payload.images ?? []) {
      if (images.length >= PLANNING_AGENT_MAX_IMAGES) break;
      if (img.data && img.mimeType) {
        images.push({ data: img.data, mimeType: img.mimeType });
      }
    }

    console.info(
      `[planning-attachment] loaded ref=${ref} file=${payload.fileName} kind=${payload.kind} images=${payload.images?.length ?? 0} agentTextChars=${payload.agentText?.length ?? 0} workspace=${workspacePath ?? "none"}`,
    );
  }

  if (filesToCommit.length && opts.repoWrite) {
    try {
      const result = await commitFilesToBranch({
        installationId: opts.repoWrite.installationId,
        owner: opts.repoWrite.owner,
        repo: opts.repoWrite.repo,
        branch: opts.repoWrite.branch,
        message: `Add Koda planning upload(s): ${fileNames.join(", ")}`,
        files: filesToCommit,
      });
      console.info(
        `[planning-attachment] wrote ${result.paths.length} file(s) to ${opts.repoWrite.owner}/${opts.repoWrite.repo}@${opts.repoWrite.branch} sha=${result.sha}`,
      );
      sections.push(
        [
          "Original upload file(s) were committed into this repository for you to open:",
          ...result.paths.map((p) => `- ${p}`),
          "If a path is missing locally, run `git pull` on the current branch, then open the PDF/file with your tools. Prefer the real file over any chat text snippet.",
        ].join("\n"),
      );
    } catch (error) {
      console.error(
        "[planning-attachment] failed to commit original upload(s) to branch",
        error,
      );
      sections.push(
        "Could not write the original upload into the workspace this turn. Use the attached page images (PDF) or structured content (Excel/CSV). Original bytes remain encrypted for the developer.",
      );
    }
  }

  return {
    promptSection: sections.join("\n\n"),
    images,
    fileNames,
  };
}

/** @deprecated Prefer loadPlanningAttachmentsForAgent */
export async function loadPlanningAttachmentForAgent(opts: {
  companyId: string;
  projectId: string;
  attachmentRef: string;
}): Promise<LoadedPlanningAttachment | null> {
  const loaded = await loadPlanningAttachmentsForAgent({
    companyId: opts.companyId,
    projectId: opts.projectId,
    attachmentRefs: [opts.attachmentRef],
  });
  if (!loaded.fileNames.length) return null;
  return {
    promptSection: loaded.promptSection,
    images: loaded.images,
    fileName: loaded.fileNames[0]!,
    kind: "file",
  };
}
