# Planning file attachments → Cursor agent

## Goal

When a client attaches a **PDF** or **Excel** file in program planning chat, Koda’s live Cursor/cloud agent should receive the **real file** (or the closest API-supported stand-in), not a text transcript dumped into the Goal.

## Composer UX

1. Choosing a file only **stages** it in the composer (chip with remove).
2. Multiple files (up to 5) can be queued for one message.
3. Message + files are sent together only when the user clicks **Send** or presses **Enter**.

## Cursor API constraint

`@cursor/sdk` / Cloud Agents API `prompt` supports:

- `prompt.text` (string)
- `prompt.images[]` — up to **5** raster images (`image/png|jpeg|gif|webp`), base64 or URL

There is **no** native PDF or `.xlsx` attachment field on `prompt`.

## What we do

| Upload | Chat UI (human) | Cursor agent |
|---|---|---|
| **PDF** | Short summary (pages + tiny snippet). Original PDF staged until Send. | **Original PDF** committed to `.koda/uploads/…` on the planning branch so the agent can open the real file. Also ≤5 page **PNG** renders via `prompt.images` (API limit). **No OCR/full-text dump** as the primary agent payload. Encrypted original kept in SecretRef. |
| **Excel (.xlsx/.xls)** | Sheet names, row/col counts, headers | Workbook converted to **structured CSV** in the agent prompt; original bytes also written under `.koda/uploads/` when possible. |
| **CSV / text** | Truncated excerpt | Structured text in agent prompt |

## Pipeline

1. Browser → `POST …/extract-file` (multipart) — prepares payload; **does not** enqueue agent turn
2. Composer shows staged chips; user may add more files / a note
3. Send/Enter → `POST …/messages` with `attachments[]` (summaries + `attachmentRef`s)
4. `cursor.follow-up` / `cursor.start-agent` loads payloads, commits original PDF/Excel into the branch, appends agent notes, passes page `images` into `cursor-adapter`
5. Adapter calls `agent.send({ text, images })` when images are present

## Tradeoffs

- **PDF file itself** reaches the agent via the workspace (`.koda/uploads/…`). The Cloud Agents API still cannot put raw PDF bytes on `prompt.images`.
- **PDF layout** is also visible immediately via page images (≤5 pages per message shared across all attachments).
- **Excel** cannot be attached as `.xlsx` on the prompt; CSV conversion preserves tabular structure for planning.
- Chat / Goal never receive huge HTML or binary dumps — only short summaries go into message content and `planningMeta.docsText`.
