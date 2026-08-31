# Planning file attachments → Cursor agent

## Goal

When a client attaches a **PDF** or **Excel** file in program planning chat, Koda’s live Cursor/cloud agent should receive **layout-aware content**, not only a short text excerpt dumped into the Goal field.

## Cursor API constraint

`@cursor/sdk` / Cloud Agents API `prompt` supports:

- `prompt.text` (string)
- `prompt.images[]` — up to **5** raster images (`image/png|jpeg|gif|webp`), base64 or URL

There is **no** native PDF or `.xlsx` attachment field.

## What we do

| Upload | Chat UI (human) | Cursor agent |
|---|---|---|
| **PDF** | Short summary (page count + text preview) | First ≤5 pages rendered to **PNG** and sent via `agent.send({ text, images })`. Original bytes stored encrypted for reprocess. |
| **Excel (.xlsx/.xls)** | Sheet names, row/col counts, headers | Workbook converted to **structured CSV** (one section per sheet) in the agent prompt. Original `.xlsx` bytes stored encrypted (API cannot attach them). |
| **CSV / text** | Truncated excerpt | Structured text in agent prompt |

## Pipeline

1. Browser → `POST …/extract-file` (multipart)
2. Server prepares agent payload + chat summary; encrypts payload in `SecretRef` (`purpose=CHAT`, key `planning-file-…`)
3. Chat message stores **summary only** + `attachmentRef`
4. `cursor.follow-up` / `cursor.start-agent` loads payload, appends agent note/CSV to prompt, passes `images` into `cursor-adapter`
5. Adapter calls `agent.send({ text, images })` when images are present

## Tradeoffs

- **PDF layout** is preserved visually via page images (best option under the images-only API). Pages beyond 5 are omitted (API limit).
- **Excel** cannot be attached as `.xlsx`; CSV conversion preserves tabular structure better than screenshots for automation planning.
- Chat / Goal never receive huge HTML or binary dumps — only short summaries go into message content and `planningMeta.docsText`.
