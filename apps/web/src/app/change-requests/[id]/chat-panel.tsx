"use client";

import { useEffect, useState, useTransition } from "react";

type Message = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
};

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
  const [messages, setMessages] = useState(initialMessages);
  const [status, setStatus] = useState(initialStatus);
  const [prompt, setPrompt] = useState("");
  const [pending, startTransition] = useTransition();
  const isProgram = kind === "PROGRAM";

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
          if (data.messages) setMessages(data.messages);
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

  const placeholder = isProgram
    ? status === "PLANNING"
      ? "Share docs, examples, or answer Koda’s questions…"
      : status === "CLIENT_VERIFY" || status === "PREVIEW_READY"
        ? "Ask how it works, request a test script, or describe a change…"
        : "Send a message…"
    : "Ask for another change or clarification…";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 rounded-xl border border-[var(--line)] bg-black/20 px-3 py-2 text-xs muted">
        Koda is AI and can make mistakes.
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`rounded-xl border border-[var(--line)] p-3 ${
              message.role === "USER" ? "bg-white/5" : "bg-black/20"
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
        {[
          "ANALYZING",
          "PLANNING",
          "IMPLEMENTING",
          "TESTING",
          "BUILDING",
          "DEPLOYING",
        ].includes(status) ? (
          <p className="muted pulse-soft text-sm">Koda is working…</p>
        ) : null}
        {status === "FAILED" ? (
          <p className="text-sm text-[var(--danger)]">
            Something went wrong. Use Retry in the actions panel.
          </p>
        ) : null}
      </div>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!prompt.trim()) return;
          startTransition(async () => {
            const response = await fetch(
              `/api/change-requests/${changeRequestId}/messages`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: prompt }),
              },
            );
            if (response.ok) {
              const json = (await response.json()) as { message: Message };
              setMessages((prev) => [...prev, json.message]);
              setPrompt("");
            }
          });
        }}
      >
        <input
          className="field"
          placeholder={placeholder}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <button className="btn btn-primary" disabled={pending}>
          Send
        </button>
      </form>
    </div>
  );
}
