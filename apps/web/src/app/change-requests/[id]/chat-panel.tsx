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
  status,
}: {
  changeRequestId: string;
  initialMessages: Message[];
  status: string;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [prompt, setPrompt] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const timer = setInterval(async () => {
      const response = await fetch(`/api/change-requests/${changeRequestId}`);
      if (!response.ok) return;
      const json = (await response.json()) as { messages: Message[] };
      setMessages(json.messages);
    }, 4000);
    return () => clearInterval(timer);
  }, [changeRequestId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
                  : "Assistant"}
            </p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {message.content}
            </p>
          </div>
        ))}
        {["ANALYZING", "PLANNING", "IMPLEMENTING", "TESTING"].includes(
          status,
        ) ? (
          <p className="muted pulse-soft text-sm">Working on your request…</p>
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
          placeholder="Ask for another change or clarification…"
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
