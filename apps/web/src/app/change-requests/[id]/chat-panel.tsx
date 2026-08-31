"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  PLANNING_FILE_ACCEPT,
  classifyPlanningFile,
  formatPlanningFileRejection,
  validatePlanningFileSize,
} from "@automation-studio/domain/planning-files";

type Message = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
};

type AttachMode = "api_docs_url" | "docs_text" | "examples" | "file" | null;

const WORKING_STATUSES = [
  "ANALYZING",
  "IMPLEMENTING",
  "TESTING",
  "BUILDING",
  "DEPLOYING",
] as const;

/** True when the latest user turn still has no ASSISTANT reply (SYSTEM “connecting…” does not count). */
function isAwaitingAssistantReply(messages: Message[]): boolean {
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "USER") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx < 0) return false;
  return !messages
    .slice(lastUserIdx + 1)
    .some((m) => m.role === "ASSISTANT");
}

function isConnectingSession(messages: Message[]): boolean {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m) continue;
    if (m.role === "ASSISTANT") return false;
    if (m.role === "USER") return false;
    if (
      m.role === "SYSTEM" &&
      /connecting|live planning session|starting/i.test(m.content)
    ) {
      return true;
    }
  }
  return false;
}

function thinkingLabel(opts: {
  liveLink: "connected" | "connecting" | "reconnecting";
  connectingSession: boolean;
  working: boolean;
  status: string;
}): string {
  if (opts.liveLink === "reconnecting") return "Reconnecting live updates…";
  if (opts.liveLink === "connecting") return "Connecting live updates…";
  if (opts.connectingSession) return "Koda is connecting…";
  if (opts.working) {
    if (opts.status === "BUILDING" || opts.status === "IMPLEMENTING") {
      return "Koda is working…";
    }
    if (opts.status === "TESTING") return "Koda is testing…";
    if (opts.status === "DEPLOYING") return "Koda is deploying…";
    return "Koda is analyzing…";
  }
  return "Koda is thinking…";
}

export function ChatPanel({
  changeRequestId,
  initialMessages,
  status: initialStatus,
  kind,
}: {
  changeRequestId: string;
  initialMessages: Message[];
  status: string;
  kind: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [status, setStatus] = useState(initialStatus);
  const [prompt, setPrompt] = useState("");
  const [pending, startTransition] = useTransition();
  const [awaitingReply, setAwaitingReply] = useState(false);
  const [preparingFile, setPreparingFile] = useState(false);
  const [liveLink, setLiveLink] = useState<
    "connected" | "connecting" | "reconnecting"
  >("connecting");
  const [attachMode, setAttachMode] = useState<AttachMode>(null);
  const [attachValue, setAttachValue] = useState("");
  const [attachError, setAttachError] = useState<string | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const isProgram = kind === "PROGRAM";
  const isPlanning =
    isProgram &&
    (status === "PLANNING" || status === "AWAITING_PLAN_APPROVAL");
  const canReopenPlanning =
    isProgram && status === "AWAITING_DEV_BUILD";
  const working = (WORKING_STATUSES as readonly string[]).includes(status);
  const connectingSession = isConnectingSession(messages);
  const waitingOnReply =
    status !== "FAILED" &&
    (awaitingReply ||
      preparingFile ||
      working ||
      connectingSession ||
      isAwaitingAssistantReply(messages));
  const showThinking = waitingOnReply || liveLink === "reconnecting";
  const inputBusy = pending || preparingFile;
  const label = thinkingLabel({
    liveLink: waitingOnReply ? "connected" : liveLink,
    connectingSession,
    working,
    status,
  });

  useEffect(() => {
    setLiveLink("connecting");
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const source = new EventSource(
      `/api/change-requests/${changeRequestId}/events`,
    );
    source.onopen = () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      setLiveLink("connected");
    };
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as {
          type: string;
          status?: string;
          messages?: Message[];
        };
        if (data.type === "connected" || data.type === "heartbeat") {
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = null;
          setLiveLink("connected");
          return;
        }
        if (data.type === "snapshot") {
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = null;
          setLiveLink("connected");
          if (data.status) setStatus(data.status);
          if (data.messages) {
            setMessages(data.messages);
            // Clear optimistic wait once server state is in; derived waiting
            // (no ASSISTANT after last USER / connecting SYSTEM) keeps the UI.
            setAwaitingReply(false);
          }
        }
      } catch {
        // ignore malformed events
      }
    };
    source.onerror = () => {
      // Debounce — EventSource often blips through CONNECTING during retries.
      if (reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        if (source.readyState !== EventSource.OPEN) {
          setLiveLink("reconnecting");
        }
      }, 1200);
    };
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source.close();
    };
  }, [changeRequestId]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, showThinking, label]);

  const placeholder = isProgram
    ? isPlanning
      ? "Message Koda — ask anything, request a diagram, refine the plan…"
      : status === "CLIENT_VERIFY" || status === "PREVIEW_READY"
        ? "Ask how it works, request a test script, or describe a change…"
        : "Send a message…"
    : "Ask for another change or clarification…";

  function sendMessage(opts?: {
    content?: string;
    attachment?: {
      kind: Exclude<AttachMode, null>;
      value: string;
      fileName?: string;
      attachmentRef?: string;
    };
  }) {
    const content = (opts?.content ?? prompt).trim();
    if (!content && !opts?.attachment) return;
    setAttachError(null);
    setAwaitingReply(true);
    startTransition(async () => {
      const response = await fetch(
        `/api/change-requests/${changeRequestId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: content || undefined,
            attachment: opts?.attachment,
          }),
        },
      );
      if (response.ok) {
        const json = (await response.json()) as {
          message: Message;
          assistantMessage?: Message | null;
        };
        setMessages((prev) => {
          const next = [...prev, json.message];
          if (json.assistantMessage) next.push(json.assistantMessage);
          return next;
        });
        setPrompt("");
        setAttachMode(null);
        setAttachValue("");
        // Only clear optimistic flag; keep thinking if reply is SYSTEM
        // “connecting…” or follow-up is still processing (no ASSISTANT yet).
        setAwaitingReply(
          !(json.assistantMessage && json.assistantMessage.role === "ASSISTANT"),
        );
      } else {
        setAwaitingReply(false);
        const data = (await response.json().catch(() => ({}))) as {
          error?: string | { formErrors?: string[] };
        };
        const err =
          typeof data.error === "string"
            ? data.error
            : Array.isArray(data.error?.formErrors)
              ? data.error.formErrors[0]
              : null;
        setAttachError(err || "Could not send — try again.");
      }
    });
  }

  function submitAttach() {
    if (!attachMode) return;
    if (!attachValue.trim()) {
      setAttachError("Add something to attach first.");
      return;
    }
    sendMessage({
      attachment: { kind: attachMode, value: attachValue.trim() },
    });
  }

  async function prepareFileAttachment(file: File): Promise<{
    value: string;
    fileName: string;
    attachmentRef?: string;
  } | null> {
    const sizeError = validatePlanningFileSize(file.size);
    if (sizeError) {
      setAttachError(sizeError);
      return null;
    }

    const kind = classifyPlanningFile({
      fileName: file.name,
      mimeType: file.type,
    });
    if (kind === "unsupported") {
      setAttachError(
        formatPlanningFileRejection({
          fileName: file.name,
          mimeType: file.type,
        }),
      );
      return null;
    }

    // Binary files (PDF / Excel) and text alike go through the server so the
    // Cursor agent receives layout images / structured CSV — not only a chat excerpt.
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(
      `/api/change-requests/${changeRequestId}/extract-file`,
      { method: "POST", body: form },
    );
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      excerpt?: string;
      fileName?: string;
      attachmentRef?: string;
      agentImages?: number;
    };
    if (!res.ok || !data.excerpt) {
      setAttachError(data.error || "Could not read that file.");
      return null;
    }
    return {
      value: data.excerpt.slice(0, 20000),
      fileName: data.fileName || file.name,
      attachmentRef: data.attachmentRef,
    };
  }

  async function onFilePicked(file: File | null) {
    if (!file) return;
    setAttachError(null);
    setPreparingFile(true);
    setAwaitingReply(true);
    try {
      const prepared = await prepareFileAttachment(file);
      if (!prepared) {
        setAwaitingReply(false);
        return;
      }
      sendMessage({
        attachment: {
          kind: "file",
          value: prepared.value,
          fileName: prepared.fileName,
          attachmentRef: prepared.attachmentRef,
        },
      });
    } catch {
      setAwaitingReply(false);
      setAttachError("Could not upload that file.");
    } finally {
      setPreparingFile(false);
    }
  }

  function postProgramAction(
    action: "submit_to_dev" | "reopen_planning",
    extra?: Record<string, unknown>,
  ) {
    setActionError(null);
    startTransition(async () => {
      const response = await fetch(
        `/api/change-requests/${changeRequestId}/actions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...extra }),
        },
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setActionError(data.error ?? "Action failed — try again.");
        return;
      }
      setConfirmSubmit(false);
      router.refresh();
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-start justify-between gap-3 rounded-xl border border-[var(--line)] bg-black/20 px-3 py-2">
        <p className="text-xs muted">
          {isPlanning
            ? "Planning with Koda — real Q&A and a living plan. Attach docs anytime."
            : canReopenPlanning
              ? "Submitted — waiting for a developer. You can reopen planning if this was accidental."
              : "Koda is AI and can make mistakes."}
        </p>
        <p className="shrink-0 text-xs muted">Koda is AI and can make mistakes.</p>
      </div>

      <div ref={scrollerRef} className="flex-1 space-y-3 overflow-y-auto pr-1">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`chat-bubble rise ${
              message.role === "USER"
                ? "chat-bubble-user"
                : message.role === "SYSTEM"
                  ? "chat-bubble-system"
                  : "chat-bubble-koda"
            }`}
          >
            <p className="muted mb-1 text-xs uppercase tracking-wide">
              {message.role === "USER"
                ? "You"
                : message.role === "SYSTEM"
                  ? "System"
                  : "Koda"}
            </p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {message.content}
            </p>
          </div>
        ))}
        {showThinking ? (
          <div
            className="chat-bubble chat-bubble-koda chat-thinking rise"
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            <p className="muted mb-1 text-xs uppercase tracking-wide">Koda</p>
            <p className="thinking-line text-sm leading-relaxed">
              <span>{preparingFile ? "Reading your file…" : label}</span>
              <span className="thinking-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </p>
          </div>
        ) : null}
        {status === "FAILED" ? (
          <p className="text-sm text-[var(--danger)]">
            Something went wrong. Use Retry in the actions panel.
          </p>
        ) : null}
      </div>

      {isPlanning ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["api_docs_url", "API docs URL"],
                ["docs_text", "Paste docs"],
                ["examples", "Paste examples"],
                ["file", "Upload file"],
              ] as const
            ).map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                className={`chip ${attachMode === kind ? "chip-active" : ""}`}
                onClick={() => {
                  setAttachError(null);
                  if (kind === "file") {
                    setAttachMode(null);
                    fileRef.current?.click();
                    return;
                  }
                  setAttachMode((prev) => (prev === kind ? null : kind));
                  setAttachValue("");
                }}
              >
                {label}
              </button>
            ))}
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept={PLANNING_FILE_ACCEPT}
              onChange={(e) => {
                void onFilePicked(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </div>

          {attachMode && attachMode !== "file" ? (
            <div className="space-y-2 rounded-xl border border-[var(--line)] bg-black/15 p-3">
              {attachMode === "api_docs_url" ? (
                <input
                  className="field"
                  type="url"
                  placeholder="https://… API documentation"
                  value={attachValue}
                  onChange={(e) => setAttachValue(e.target.value)}
                />
              ) : (
                <textarea
                  className="field min-h-28"
                  placeholder={
                    attachMode === "examples"
                      ? "Paste example requests / responses…"
                      : "Paste documentation excerpts…"
                  }
                  value={attachValue}
                  onChange={(e) => setAttachValue(e.target.value)}
                />
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={inputBusy}
                  onClick={submitAttach}
                >
                  Attach to chat
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setAttachMode(null);
                    setAttachValue("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          {attachError ? (
            <p className="text-sm text-[var(--danger)]">{attachError}</p>
          ) : null}
        </div>
      ) : null}

      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (inputBusy) return;
          sendMessage({ content: prompt });
        }}
      >
        <input
          className="field"
          placeholder={
            inputBusy
              ? preparingFile
                ? "Reading your file…"
                : "Sending…"
              : placeholder
          }
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={inputBusy}
          aria-busy={inputBusy}
        />
        <button
          className="btn btn-primary"
          disabled={inputBusy || !prompt.trim()}
        >
          {inputBusy ? "…" : "Send"}
        </button>
      </form>
      {inputBusy ? (
        <p className="mt-1.5 text-xs muted pulse-soft">
          {preparingFile
            ? "Preparing attachment — composer paused."
            : "Sending your message…"}
        </p>
      ) : showThinking ? (
        <p className="mt-1.5 text-xs muted">
          Koda is still responding — you can send another message anytime.
        </p>
      ) : null}

      {isPlanning ? (
        <div className="mt-3 space-y-2">
          {!confirmSubmit ? (
            <button
              type="button"
              className="btn btn-ghost w-full"
              disabled={inputBusy}
              onClick={() => {
                setActionError(null);
                setConfirmSubmit(true);
              }}
            >
              Ready to submit to a developer?
            </button>
          ) : (
            <div className="space-y-2 rounded-xl border border-[var(--line)] bg-black/15 p-3">
              <p className="text-sm">
                This notifies Advanced Automations that the plan is ready to
                build. You can reopen planning afterward if needed.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={inputBusy}
                  onClick={() =>
                    postProgramAction("submit_to_dev", { confirmSubmit: true })
                  }
                >
                  Yes, submit for building
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={inputBusy}
                  onClick={() => setConfirmSubmit(false)}
                >
                  Keep planning
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {canReopenPlanning ? (
        <div className="mt-3 space-y-2">
          <button
            type="button"
            className="btn btn-primary w-full"
            disabled={inputBusy}
            onClick={() => postProgramAction("reopen_planning")}
          >
            Continue planning (reopen)
          </button>
        </div>
      ) : null}

      {actionError ? (
        <p className="mt-2 text-sm text-[var(--danger)]">{actionError}</p>
      ) : null}
    </div>
  );
}
