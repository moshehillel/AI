import {
  extractText,
  getDocumentProxy,
  renderPageAsImage,
} from "unpdf";
import {
  PLANNING_AGENT_MAX_IMAGES,
  PLANNING_ATTACHMENT_EXCERPT_MAX,
  buildExcelAgentPayload,
  classifyPlanningFile,
  formatPlanningFileRejection,
  looksLikeBinaryText,
  summarizeCsvForPlanning,
  summarizePdfChatForPlanning,
  summarizeTextForPlanning,
  validatePlanningFileSize,
  type PlanningAgentFilePayload,
  type PlanningFileKind,
} from "@automation-studio/domain";

async function renderPdfPagesAsPng(
  buffer: Uint8Array,
  pageCount: number,
): Promise<Array<{ data: string; mimeType: "image/png" }>> {
  const max = Math.min(pageCount, PLANNING_AGENT_MAX_IMAGES);
  const images: Array<{ data: string; mimeType: "image/png" }> = [];
  for (let page = 1; page <= max; page++) {
    try {
      // Use unpdf's bundled serverless PDF.js + @napi-rs/canvas (official
      // pdfjs-dist worker path fails under Node with DataCloneError).
      const result = await renderPageAsImage(buffer, page, {
        // Keep native canvas out of the Next/webpack graph.
        canvasImport: () =>
          import(/* webpackIgnore: true */ "@napi-rs/canvas"),
        scale: 1.5,
        toDataURL: true,
      });
      const dataUrl = String(result);
      const base64 = dataUrl.includes(",")
        ? dataUrl.slice(dataUrl.indexOf(",") + 1)
        : dataUrl;
      if (base64) {
        images.push({ data: base64, mimeType: "image/png" });
      }
    } catch (error) {
      console.warn(
        `[planning-attach] PDF page ${page} render failed`,
        error instanceof Error ? error.message : error,
      );
      break;
    }
  }
  return images;
}

export type PreparedPlanningAttachment = {
  fileName: string;
  kind: Exclude<PlanningFileKind, "unsupported">;
  chatSummary: string;
  payload: PlanningAgentFilePayload;
};

export async function preparePlanningAttachment(file: File): Promise<
  | { ok: true; prepared: PreparedPlanningAttachment }
  | { ok: false; error: string }
> {
  const sizeError = validatePlanningFileSize(file.size);
  if (sizeError) return { ok: false, error: sizeError };

  const kind = classifyPlanningFile({
    fileName: file.name,
    mimeType: file.type,
  });
  if (kind === "unsupported") {
    return {
      ok: false,
      error: formatPlanningFileRejection({
        fileName: file.name,
        mimeType: file.type,
      }),
    };
  }

  const buffer = new Uint8Array(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";

  if (kind === "excel") {
    try {
      const { chatSummary, payload } = buildExcelAgentPayload({
        fileName: file.name,
        mimeType,
        buffer,
        includeOriginal: true,
      });
      return {
        ok: true,
        prepared: {
          fileName: file.name,
          kind,
          chatSummary,
          payload,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not read that Excel file.",
      };
    }
  }

  if (kind === "pdf") {
    try {
      // Copy the buffer — PDF.js may transfer/detach the ArrayBuffer.
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const pageCount = pdf.numPages ?? 1;
      const extracted = await extractText(pdf, { mergePages: true });
      const pages = extracted.text as string | string[];
      const rawText = Array.isArray(pages)
        ? pages.join("\n")
        : String(pages ?? "");

      const images = await renderPdfPagesAsPng(new Uint8Array(buffer), pageCount);
      if (!images.length && !rawText.trim()) {
        return {
          ok: false,
          error:
            "Could not read that PDF (no layout images or text). Try a text-based PDF, or paste the key sections.",
        };
      }

      const chatSummary = summarizePdfChatForPlanning({
        fileName: file.name,
        pageCount,
        imagesAttached: images.length,
        textExcerpt: rawText.slice(0, 1200),
      });

      const { text: excerpt } = (() => {
        const cleaned = rawText.trim();
        if (cleaned.length <= PLANNING_ATTACHMENT_EXCERPT_MAX) {
          return { text: cleaned };
        }
        return { text: cleaned.slice(0, PLANNING_ATTACHMENT_EXCERPT_MAX) };
      })();

      const payload: PlanningAgentFilePayload = {
        fileName: file.name,
        kind: "pdf",
        mimeType: "application/pdf",
        agentNote: [
          "The user uploaded a PDF. Cursor Cloud Agents API only accepts raster images (not raw PDF bytes) on prompt.images.",
          `Rendered ${images.length} of ${pageCount} page(s) as PNG so you can see layout, tables, and structure.`,
          images.length < pageCount
            ? `(Additional pages omitted — API limit is ${PLANNING_AGENT_MAX_IMAGES} images per message.)`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
        agentText: excerpt
          ? `Extracted text (may miss layout):\n${excerpt}`
          : undefined,
        images,
        originalBase64: Buffer.from(buffer).toString("base64"),
      };

      return {
        ok: true,
        prepared: { fileName: file.name, kind, chatSummary, payload },
      };
    } catch {
      return {
        ok: false,
        error:
          "Could not read that PDF. Try a text-based PDF (not a scanned image-only file), or paste the key text.",
      };
    }
  }

  // csv / text
  const rawText = new TextDecoder("utf-8").decode(buffer);
  if (looksLikeBinaryText(rawText)) {
    return {
      ok: false,
      error: `“${file.name}” looks binary. Upload a CSV/text export, Excel (.xlsx/.xls), or a PDF.`,
    };
  }
  if (!rawText.trim()) {
    return { ok: false, error: "That file looks empty." };
  }

  const chatSummary = summarizeTextForPlanning({
    fileName: file.name,
    raw: rawText,
    kind,
  });

  const agentBody =
    kind === "csv"
      ? summarizeCsvForPlanning({
          fileName: file.name,
          raw: rawText,
          maxChars: PLANNING_ATTACHMENT_EXCERPT_MAX * 2,
        })
      : rawText.slice(0, PLANNING_ATTACHMENT_EXCERPT_MAX * 2);

  const payload: PlanningAgentFilePayload = {
    fileName: file.name,
    kind,
    mimeType,
    agentNote: `User uploaded ${kind === "csv" ? "CSV/TSV" : "a text document"} “${file.name}”. Structured content follows.`,
    agentText: agentBody,
    originalBase64: Buffer.from(buffer).toString("base64"),
  };

  return {
    ok: true,
    prepared: { fileName: file.name, kind, chatSummary, payload },
  };
}
