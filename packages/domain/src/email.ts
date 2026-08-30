export type QueueEmailInput = {
  toEmail: string;
  subject: string;
  body: string;
  companyId: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Try Resend when RESEND_API_KEY is set; otherwise return queued-only.
 * Persistence is handled by the caller (OutboundEmail row).
 */
export async function trySendEmail(
  input: QueueEmailInput,
): Promise<{ sent: boolean; provider?: string; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from =
    process.env.EMAIL_FROM ?? "Koda <onboarding@resend.dev>";

  if (!apiKey) {
    return { sent: false, error: "RESEND_API_KEY not configured" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.toEmail],
        subject: input.subject,
        text: input.body,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      return { sent: false, provider: "resend", error: text };
    }
    return { sent: true, provider: "resend" };
  } catch (error) {
    return {
      sent: false,
      provider: "resend",
      error: error instanceof Error ? error.message : "send failed",
    };
  }
}

export function programSubmittedEmail(input: {
  programTitle: string;
  programNumber: number;
  requesterName: string;
  reviewUrl: string;
}) {
  return {
    subject: `[Koda] Program #${input.programNumber} ready for build: ${input.programTitle}`,
    body: [
      `A new program plan is ready for developer build.`,
      ``,
      `Program: #${input.programNumber} ${input.programTitle}`,
      `Requested by: ${input.requesterName}`,
      ``,
      `Open in Koda Admin / Review:`,
      input.reviewUrl,
      ``,
      `— Koda`,
      `Koda is AI and can make mistakes.`,
    ].join("\n"),
  };
}

export function finalReviewEmail(input: {
  programTitle: string;
  programNumber: number;
  reviewUrl: string;
}) {
  return {
    subject: `[Koda] Program #${input.programNumber} awaiting final review`,
    body: [
      `The client submitted program #${input.programNumber} (${input.programTitle}) for final review.`,
      ``,
      `Review and approve deploy:`,
      input.reviewUrl,
      ``,
      `— Koda`,
      `Koda is AI and can make mistakes.`,
    ].join("\n"),
  };
}
