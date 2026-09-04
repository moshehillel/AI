import { db } from "@automation-studio/db";
import type { NormalizedStreamEvent } from "@automation-studio/cursor-adapter";
import type { PlanningMeta } from "@automation-studio/domain";

const PROGRESS_MIN_MS = 900;

/** Mirror agent stream progress into planningMeta for live Thought / Plan UI. Returns full streamed draft. */
export async function mirrorPlanningStream(opts: {
  changeRequestId: string;
  priorMeta: PlanningMeta;
  stream: AsyncIterable<NormalizedStreamEvent>;
}): Promise<string> {
  let draft = "";
  let lastWrite = 0;
  let lastLabel = "";

  const writeProgress = async (label: string, nextDraft?: string) => {
    const now = Date.now();
    if (label === lastLabel && now - lastWrite < PROGRESS_MIN_MS) return;
    lastLabel = label;
    lastWrite = now;
    const liveDraft =
      nextDraft != null
        ? nextDraft.slice(0, 1200)
        : opts.priorMeta.liveDraft ?? null;
    await db.changeRequest.update({
      where: { id: opts.changeRequestId },
      data: {
        planningMeta: {
          ...opts.priorMeta,
          liveProgress: label,
          liveDraft,
        },
        updatedAt: new Date(),
      },
    });
  };

  try {
    await writeProgress("Starting…");
    for await (const event of opts.stream) {
      if (event.type === "status") {
        await writeProgress(event.message || "Working…");
      } else if (event.type === "thinking") {
        const snippet = event.text?.trim().slice(0, 120);
        await writeProgress(snippet ? `Thinking — ${snippet}` : "Thinking…");
      } else if (event.type === "assistant") {
        draft += event.text;
        const preview = draft
          .replace(/```plan[\s\S]*$/i, "")
          .replace(/^#{1,2}\s+Plan[\s\S]*$/im, "")
          .trim()
          .slice(0, 400);
        await writeProgress(
          preview ? "Writing reply…" : "Updating plan…",
          draft,
        );
      }
    }
  } catch (error) {
    console.warn("[planning-stream] mirror failed", error);
  }
  return draft.trim();
}
