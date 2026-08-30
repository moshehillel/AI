"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Message = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
};

type AttachMode = "api_docs_url" | "docs_text" | "examples" | "file" | null;

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
  const [attachMode, setAttachMode] = useState<AttachMode>(null);
  const [attachValue, setAttachValue] = useState("");
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const isProgram = kind === "PROGRAM";
  const isPlanning =
    isProgram &&
    (status === "PLANNING" || status === "AWAITING_PLAN_APPROVAL");

  useEffect(() => {
    const source = new EventSource(
      `/api/change-requests/${changeRequestId}/events`,
    );
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as {
          type: string;
          status?: string;
          messages?: Message[];
        };
        if (data.type === "snapshot") {
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
      // browser will retry EventSource automatically
    };
    return () => source.close();
  }, [changeRequestId]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, awaitingReply]);

  const placeholder = isProgram
    ? isPlanning
      ? "Message Koda — ask anything, request a diagram, refine the plan…"
      : status === "CLIENT_VERIFY" || status === "PREVIEW_READY"
        ? "Ask how it works, request a test script, or describe a change…"
        : "Send a message…"
    : "Ask for another change or clarification…";

  const workingStatuses = [
    "ANALYZING",
    "IMPLEMENTING",
    "TESTING",
    "BUILDING",
    "DEPLOYING",
  ];

  function sendMessage(opts?: {
    content?: string;
    attachment?: {
      kind: Exclude<AttachMode, null>;
      value: string;
      fileName?: string;
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
        if (json.assistantMessage) setAwaitingReply(false);
      } else {
        setAwaitingReply(false);
        setAttachError("Could not send — try again.");
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

  async function onFilePicked(file: File | null) {
    if (!file) return;
    try {
      const text = await file.text();
      sendMessage({
        attachment: {
          kind: "file",
          value: text.slice(0, 20000),
          fileName: file.name,
        },
      });
    } catch {
      setAttachError("Could not read that file as text.");
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-start justify-between gap-3 rounded-xl border border-[var(--line)] bg-black/20 px-3 py-2">
        <p className="text-xs muted">
          {isPlanning
            ? "Planning with Koda — real Q&A and a living plan. Attach docs anytime."
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
        {awaitingReply || workingStatuses.includes(status) ? (
          <p className="muted pulse-soft text-sm">Koda is thinking…</p>
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
              accept=".txt,.md,.json,.yaml,.yml,.csv,.xml,.html,.ts,.js,.py"
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
                  disabled={pending}
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
          sendMessage({ content: prompt });
        }}
      >
        <input
          className="field"
          placeholder={placeholder}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <button className="btn btn-primary" disabled={pending || !prompt.trim()}>
          Send
        </button>
      </form>

      {isPlanning ? (
        <button
          type="button"
          className="btn btn-primary mt-3 w-full"
          disabled={pending}
          onClick={() => {
            startTransition(async () => {
              await fetch(`/api/change-requests/${changeRequestId}/actions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "submit_to_dev" }),
              });
              router.refresh();
            });
          }}
        >
          Submit to developer for building
        </button>
      ) : null}
    </div>
  );
}
