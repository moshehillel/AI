import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { getRequestAuth } from "@/lib/request-auth";
import {
  AuthError,
  requireChangeRequestAccess,
  requirePermission,
} from "@automation-studio/auth";
import {
  PLANNING_FILE_MAX_BYTES,
  classifyPlanningFile,
  formatPlanningFileRejection,
  summarizeTextForPlanning,
  validatePlanningFileSize,
} from "@automation-studio/domain/planning-files";

export const runtime = "nodejs";

/** Extract planning-safe text excerpt from an uploaded PDF (or text fallback). */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const ctx = await getRequestAuth();
    await requirePermission(ctx, "change_request:chat");
    await requireChangeRequestAccess(ctx, id);

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file upload." }, { status: 400 });
    }

    const sizeError = validatePlanningFileSize(file.size);
    if (sizeError) {
      return NextResponse.json({ error: sizeError }, { status: 400 });
    }

    const kind = classifyPlanningFile({
      fileName: file.name,
      mimeType: file.type,
    });
    if (kind === "unsupported") {
      return NextResponse.json(
        {
          error: formatPlanningFileRejection({
            fileName: file.name,
            mimeType: file.type,
          }),
        },
        { status: 400 },
      );
    }

    const buffer = new Uint8Array(await file.arrayBuffer());
    let rawText = "";

    if (kind === "pdf") {
      try {
        const pdf = await getDocumentProxy(buffer);
        const extracted = await extractText(pdf, { mergePages: true });
        const pages = extracted.text as string | string[];
        rawText = Array.isArray(pages) ? pages.join("\n") : String(pages ?? "");
      } catch {
        return NextResponse.json(
          {
            error:
              "Could not read that PDF. Try a text-based PDF (not a scanned image-only file), or paste the key text.",
          },
          { status: 400 },
        );
      }
      if (!rawText.trim()) {
        return NextResponse.json(
          {
            error:
              "No extractable text in that PDF (it may be image-only). Paste the key sections instead.",
          },
          { status: 400 },
        );
      }
    } else {
      rawText = new TextDecoder("utf-8").decode(buffer);
    }

    const excerpt = summarizeTextForPlanning({
      fileName: file.name,
      raw: rawText,
      kind,
    });

    if (excerpt.length > PLANNING_FILE_MAX_BYTES) {
      // Defensive — summarize already caps chars; keep payload small.
      return NextResponse.json(
        { error: "Extracted text is too large after processing." },
        { status: 400 },
      );
    }

    return NextResponse.json({
      fileName: file.name,
      kind,
      excerpt,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not process that file." }, { status: 500 });
  }
}
