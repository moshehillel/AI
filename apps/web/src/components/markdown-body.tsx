"use client";

import { Fragment, type ReactNode } from "react";

function stripAiDisclaimer(text: string): string {
  return text
    .replace(/\n*Koda is AI and can make mistakes\.?\s*/gi, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; lang: string; code: string }
  | { type: "hr" };

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = line.match(/^```([\w-]*)\s*$/);
    if (fence) {
      const lang = (fence[1] || "").toLowerCase();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i] ?? "")) {
        body.push(lines[i] ?? "");
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ type: "code", lang, code: body.join("\n") });
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+?)\s*$/);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1]!.length as 1 | 2 | 3,
        text: heading[2]!,
      });
      i += 1;
      continue;
    }

    if (/^([-*_])\1{2,}\s*$/.test(line.trim())) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const isOrdered = Boolean(ordered);
      const items: string[] = [];
      while (i < lines.length) {
        const cur = lines[i] ?? "";
        const m = isOrdered
          ? cur.match(/^\s*\d+[.)]\s+(.+)$/)
          : cur.match(/^\s*[-*+]\s+(.+)$/);
        if (!m) break;
        items.push(m[1]!);
        i += 1;
      }
      blocks.push({ type: "list", ordered: isOrdered, items });
      continue;
    }

    const para: string[] = [line];
    i += 1;
    while (i < lines.length) {
      const cur = lines[i] ?? "";
      if (!cur.trim()) break;
      if (/^#{1,3}\s+/.test(cur)) break;
      if (/^```/.test(cur)) break;
      if (/^\s*[-*+]\s+/.test(cur)) break;
      if (/^\s*\d+[.)]\s+/.test(cur)) break;
      para.push(cur);
      i += 1;
    }
    blocks.push({ type: "paragraph", text: para.join("\n") });
  }

  return blocks;
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|`[^`\n]+`|\*[^*\n]+?\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    if (
      (token.startsWith("**") && token.endsWith("**")) ||
      (token.startsWith("__") && token.endsWith("__"))
    ) {
      nodes.push(
        <strong key={key++} className="md-strong">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code key={key++} className="md-inline-code">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
    } else {
      nodes.push(token);
    }
    last = match.index + token.length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** Lightweight markdown renderer with visible heading hierarchy (Cursor-like). */
export function MarkdownBody({
  content,
  className = "",
  compact = false,
  mode = "chat",
}: {
  content: string;
  className?: string;
  compact?: boolean;
  /** chat strips plan fences (plan lives in sidebar) */
  mode?: "chat" | "plan";
}) {
  let source = stripAiDisclaimer(content || "");
  if (mode === "chat") {
    source = source
      .replace(/```plan[\s\S]*?```/gi, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  const blocks = parseBlocks(source);

  return (
    <div className={`koda-markdown ${className}`.trim()}>
      {blocks.map((block, idx) => {
        if (block.type === "heading") {
          const Tag = (`h${block.level}` as "h1" | "h2" | "h3");
          return (
            <Tag key={idx} className={`md-h md-h${block.level}`}>
              {renderInline(block.text)}
            </Tag>
          );
        }
        if (block.type === "paragraph") {
          return (
            <p key={idx} className="md-p">
              {block.text.split("\n").map((line, lineIdx, arr) => (
                <Fragment key={lineIdx}>
                  {renderInline(line)}
                  {lineIdx < arr.length - 1 ? <br /> : null}
                </Fragment>
              ))}
            </p>
          );
        }
        if (block.type === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag key={idx} className={block.ordered ? "md-ol" : "md-ul"}>
              {block.items.map((item, itemIdx) => (
                <li key={itemIdx} className="md-li">
                  {renderInline(item)}
                </li>
              ))}
            </ListTag>
          );
        }
        if (block.type === "code") {
          if (mode === "chat" && block.lang === "plan") {
            return (
              <p key={idx} className="md-p md-plan-hint">
                Living plan updated in the Plan panel.
              </p>
            );
          }
          return (
            <div
              key={idx}
              className={
                block.lang === "mermaid"
                  ? "md-code-wrap md-mermaid"
                  : "md-code-wrap"
              }
            >
              {block.lang ? (
                <div className="md-code-lang">
                  {block.lang === "mermaid" ? "Diagram" : block.lang}
                </div>
              ) : null}
              <pre className="md-code-pre">
                <code>{block.code}</code>
              </pre>
            </div>
          );
        }
        return <hr key={idx} className="md-hr" />;
      })}
    </div>
  );
}
