"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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

type AttachMode =
  | "api_docs_url"
  | "docs_text"
  | "examples"
  | "file"
  | "secrets"
  | null;

type SecretDraft = { keyName: string; value: string };

const WORKING_STATUSES = [
  "ANALYZING",
  "IMPLEMENTING",
  "TESTING",
  "BUILDING",
  "DEPLOYING",
] as const;

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
  if (opts.connectingSession) return "Connecting planning session…";
  if (opts.working) {
    if (opts.status === "BUILDING" || opts.status === "IMPLEMENTING") {
      return "Working on your request…";
    }
    if (opts.status === "TESTING") return "Running tests…";
    if (opts.status === "DEPLOYING") return "Preparing preview…";
    return "Analyzing…";
  }
  return "Thinking…";
}

function IconPlus() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 3v10M3 8h10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconSend() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 12.5V3.5M8 3.5L4.5 7M8 3.5L11.5 7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      style={{ transform: open ? "rotate(90deg)" : undefined }}
    >
      <path
        d="M4.5 2.5L8 6L4.5 9.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ThoughtBlock({
  title,
  summary,
  openDefault = false,
  live = false,
}: {
  title: string;
  summary?: string;
  openDefault?: boolean;
  live?: boolean;
}) {
  const [open, setOpen] = useState(openDefault || live);
  return (
    <div className="thought-block">
      <button
        type="button"
        className="thought-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <IconChevron open={open} />
        <span>{title}</span>
        {live ? (
          <span className="thinking-dots ml-1" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        ) : null}
      </button>
      {open && summary ? <div className="thought-body">{summary}</div> : null}
    </div>
  );
}

function secondsBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.max(1, Math.round(ms / 1000));
}

export function ChatPanel({
  changeRequestId,
  initialMessages,
  status: initialStatus,
  kind,
  title,
}: {
  changeRequestId: string;
  initialMessages: Message[];
  status: string;
  kind: string;
  title?: string;
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
  const [secretDrafts, setSecretDrafts] = useState<SecretDraft[]>([
    { keyName: "", value: "" },
  ]);
  const [savingSecrets, setSavingSecrets] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [thoughtSeconds, setThoughtSeconds] = useState(0);
  const thinkingStarted = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isProgram = kind === "PROGRAM";
  const isPlanning =
    isProgram &&
    (status === "PLANNING" || status === "AWAITING_PLAN_APPROVAL");
  const canReopenPlanning = isProgram && status === "AWAITING_DEV_BUILD";
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
  const inputBusy = pending || preparingFile || savingSecrets;
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
            setAwaitingReply(false);
          }
        }
      } catch {
        // ignore malformed events
      }
    };
    source.onerror = () => {
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

  useEffect(() => {
    if (showThinking) {
      if (!thinkingStarted.current) thinkingStarted.current = Date.now();
      const tick = () => {
        if (thinkingStarted.current) {
          setThoughtSeconds(
            Math.max(1, Math.round((Date.now() - thinkingStarted.current) / 1000)),
          );
        }
      };
      tick();
      const id = setInterval(tick, 1000);
      return () => clearInterval(id);
    }
    thinkingStarted.current = null;
    setThoughtSeconds(0);
  }, [showThinking]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(140, el.scrollHeight)}px`;
  }, [prompt]);

  const timeline = useMemo(() => {
    const items: Array<
      | { type: "message"; message: Message }
      | {
          type: "thought";
          id: string;
          title: string;
          summary?: string;
        }
    > = [];
    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i]!;
      if (message.role === "SYSTEM") {
        items.push({
          type: "thought",
          id: `sys-${message.id}`,
          title: "Worked for a moment",
          summary: message.content,
        });
        continue;
      }
      if (message.role === "ASSISTANT") {
        let prevUser: Message | undefined;
        for (let j = i - 1; j >= 0; j -= 1) {
          if (messages[j]?.role === "USER") {
            prevUser = messages[j];
            break;
          }
        }
        if (prevUser) {
          const secs = secondsBetween(prevUser.createdAt, message.createdAt);
          items.push({
            type: "thought",
            id: `thought-${message.id}`,
            title: `Thought ${secs}s`,
            summary: "Reviewed your note and updated the living plan.",
          });
        }
      }
      items.push({ type: "message", message });
    }
    return items;
  }, [messages]);

  const placeholder = isProgram
    ? isPlanning
      ? "Plan, search, build anything"
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

  async function submitSecrets() {
    const secrets = secretDrafts
      .map((s) => ({ keyName: s.keyName.trim(), value: s.value }))
      .filter((s) => s.keyName && s.value);
    if (secrets.length === 0) {
      setAttachError("Add at least one name and value.");
      return;
    }
    setAttachError(null);
    setSavingSecrets(true);
    try {
      const response = await fetch(
        `/api/change-requests/${changeRequestId}/secrets`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ secrets }),
        },
      );
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        saved?: Array<{ keyName: string; message: string }>;
      };
      if (!response.ok) {
        setAttachError(data.error || "Could not save secrets.");
        return;
      }
      setSecretDrafts([{ keyName: "", value: "" }]);
      setAttachMode(null);
      if (data.saved?.length) {
        setMessages((prev) => [
          ...prev,
          ...data.saved!.map((s, i) => ({
            id: `local-secret-${Date.now()}-${i}`,
            role: "SYSTEM",
            content: s.message,
            createdAt: new Date().toISOString(),
          })),
        ]);
      }
      router.refresh();
    } catch {
      setAttachError("Could not save secrets — try again.");
    } finally {
      setSavingSecrets(false);
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

  const planningStatus =
    isPlanning
      ? showThinking
        ? "Planning"
        : "Ready"
      : canReopenPlanning
        ? "Submitted"
        : status.replaceAll("_", " ");

  return (
    <div className="agent-chat">
      <div className="ide-main-header">
        <div className="ide-main-title">
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className="opacity-50"
          >
            <path
              d="M3 10.5c1.5-3 3.5-4.5 5-4.5s3.5 1.5 5 4.5"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
            <circle cx="8" cy="5" r="1.4" fill="currentColor" opacity="0.55" />
          </svg>
          <span>{title ?? "Planning"}</span>
        </div>
        <span className="status-pill">{planningStatus}</span>
      </div>

      <div ref={scrollerRef} className="agent-chat-scroll">
        {timeline.map((item) => {
          if (item.type === "thought") {
            return (
              <ThoughtBlock
                key={item.id}
                title={item.title}
                summary={item.summary}
              />
            );
          }
          const message = item.message;
          if (message.role === "USER") {
            return (
              <div key={message.id} className="agent-msg agent-msg-user rise">
                <p className="agent-msg-body">{message.content}</p>
              </div>
            );
          }
          return (
            <div
              key={message.id}
              className="agent-msg agent-msg-assistant rise"
            >
              <p className="agent-msg-body">{message.content}</p>
              <div className="agent-msg-actions" aria-hidden="true">
                <button type="button" tabIndex={-1} title="Helpful">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M5.5 14H4a1 1 0 01-1-1V8a1 1 0 011-1h1.5M5.5 7V4.5A1.5 1.5 0 017 3h.2c.6 0 1.1.4 1.3 1L10 8h2.5a1.5 1.5 0 011.5 1.7l-.6 3A1.5 1.5 0 0111.9 14H5.5z"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <button type="button" tabIndex={-1} title="Not helpful">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M10.5 2H12a1 1 0 011 1v5a1 1 0 01-1 1h-1.5M10.5 9v2.5A1.5 1.5 0 019 13h-.2c-.6 0-1.1-.4-1.3-1L6 8H3.5A1.5 1.5 0 012 6.3l.6-3A1.5 1.5 0 014.1 2H10.5z"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            </div>
          );
        })}

        {showThinking ? (
          <ThoughtBlock
            title={
              preparingFile
                ? "Reading file…"
                : `Thought ${thoughtSeconds || 1}s`
            }
            summary={label}
            openDefault
            live
          />
        ) : null}

        {status === "FAILED" ? (
          <p className="text-sm" style={{ color: "var(--ide-danger)" }}>
            Something went wrong. Use Retry in the actions panel.
          </p>
        ) : null}
      </div>

      <div className="pill-composer-wrap">
        {showThinking ? (
          <div className="composer-status">
            <span>
              <strong>1 Working</strong>
            </span>
            <span>
              Plan updates{" "}
              <span className="stat-add">live</span>
            </span>
          </div>
        ) : null}

        {isPlanning ? (
          <div className="attach-chips">
            {(
              [
                ["api_docs_url", "API docs URL"],
                ["docs_text", "Paste docs"],
                ["examples", "Paste examples"],
                ["file", "Upload file"],
                ["secrets", "Add secrets / credentials"],
              ] as const
            ).map(([kind, chipLabel]) => (
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
                  if (kind === "secrets") {
                    setSecretDrafts([{ keyName: "", value: "" }]);
                  }
                }}
              >
                {chipLabel}
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
        ) : null}

        {attachMode === "secrets" ? (
          <div className="attach-panel space-y-3">
            <p className="text-sm" style={{ color: "var(--ide-ink-secondary)" }}>
              Values are encrypted and never shown in chat or the plan. Use a
              clear name (e.g. <code>HHA_PASSWORD</code>) so the developer
              knows what each secret is for.
            </p>
            {secretDrafts.map((row, index) => (
              <div key={index} className="flex flex-col gap-2 sm:flex-row">
                <input
                  className="field"
                  type="text"
                  autoComplete="off"
                  placeholder="Name (e.g. HHA_PASSWORD)"
                  value={row.keyName}
                  onChange={(e) => {
                    const next = [...secretDrafts];
                    next[index] = { ...row, keyName: e.target.value };
                    setSecretDrafts(next);
                  }}
                />
                <input
                  className="field"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Secret value"
                  value={row.value}
                  onChange={(e) => {
                    const next = [...secretDrafts];
                    next[index] = { ...row, value: e.target.value };
                    setSecretDrafts(next);
                  }}
                />
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={inputBusy || secretDrafts.length >= 20}
                onClick={() =>
                  setSecretDrafts((prev) => [...prev, { keyName: "", value: "" }])
                }
              >
                Add another
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={inputBusy}
                onClick={() => void submitSecrets()}
              >
                {savingSecrets ? "Saving…" : "Save securely"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setAttachMode(null);
                  setSecretDrafts([{ keyName: "", value: "" }]);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {attachMode && attachMode !== "file" && attachMode !== "secrets" ? (
          <div className="attach-panel space-y-2">
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
                className="field min-h-24"
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
                Attach
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
          <p
            className="mb-2 text-sm"
            style={{ color: "var(--ide-danger)", maxWidth: "52rem", marginInline: "auto" }}
          >
            {attachError}
          </p>
        ) : null}

        <form
          className="pill-composer"
          onSubmit={(event) => {
            event.preventDefault();
            if (inputBusy) return;
            sendMessage({ content: prompt });
          }}
        >
          <button
            type="button"
            className="pill-attach"
            disabled={!isPlanning || inputBusy}
            title="Attach"
            onClick={() => {
              if (!isPlanning) return;
              fileRef.current?.click();
            }}
          >
            <IconPlus />
          </button>
          {isPlanning ? (
            <span className="pill-mode" title="Plan mode stays on until you submit to a developer">
              Plan
            </span>
          ) : null}
          <textarea
            ref={textareaRef}
            className="pill-input"
            rows={1}
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
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!inputBusy && prompt.trim()) {
                  sendMessage({ content: prompt });
                }
              }
            }}
          />
          <div className="pill-right">
            <span className="pill-model">
              Auto
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path
                  d="M2.5 3.5L5 6.5L7.5 3.5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  fill="none"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <button
              type="submit"
              className="pill-send"
              disabled={inputBusy || !prompt.trim()}
              aria-label="Send"
            >
              <IconSend />
            </button>
          </div>
        </form>

        <div className="composer-foot">
          <span>
            {liveLink === "connected"
              ? "Live"
              : liveLink === "reconnecting"
                ? "Reconnecting…"
                : "Connecting…"}
            {isPlanning ? " · Planning with Koda" : ""}
          </span>
          <span>Koda is AI and can make mistakes.</span>
        </div>

        {isPlanning ? (
          <div className="mx-auto mt-3 max-w-[52rem] space-y-2 px-1">
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
              <div className="attach-panel space-y-2">
                <p className="text-sm" style={{ color: "var(--ide-ink-secondary)" }}>
                  This notifies Advanced Automations that the plan is ready to
                  build. You can reopen planning afterward if needed.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={inputBusy}
                    onClick={() =>
                      postProgramAction("submit_to_dev", {
                        confirmSubmit: true,
                      })
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
          <div className="mx-auto mt-3 max-w-[52rem] px-1">
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
          <p
            className="mx-auto mt-2 max-w-[52rem] text-sm"
            style={{ color: "var(--ide-danger)" }}
          >
            {actionError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
