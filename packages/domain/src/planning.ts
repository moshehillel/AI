export type PlanningTopic =
  | "goals"
  | "systems"
  | "apis"
  | "workflow"
  | "edge_cases"
  | "acceptance";

export type PlanningMeta = {
  apiDocsUrl?: string | null;
  docsText?: string | null;
  examples?: string | null;
  coveredTopics?: PlanningTopic[];
  lastQuestionTopic?: PlanningTopic | null;
  /** Latest synthesized plan markdown (also mirrored in Plan rows). */
  planMarkdown?: string | null;
  /** Pending encrypted file payload key (SecretRef) for the next Cursor agent turn. */
  pendingAttachmentRef?: string | null;
  /** Multiple pending encrypted file payload keys for the next Cursor agent turn. */
  pendingAttachmentRefs?: string[] | null;
  /** Credential SecretRef keyNames the customer has already provided (never values). */
  providedSecretKeys?: string[];
  /** Extra prerequisite lines Koda / staff added beyond inferred defaults. */
  neededItems?: string[];
  /** Live agent step label while a turn is in flight (customer-facing). */
  liveProgress?: string | null;
  /** Partial assistant draft text while streaming (customer-facing). */
  liveDraft?: string | null;
};

export const PLANNING_TOPICS: PlanningTopic[] = [
  "goals",
  "systems",
  "apis",
  "workflow",
  "edge_cases",
  "acceptance",
];

/** Opening assistant message when a program enters PLANNING. */
export function buildOpeningPlanningMessage(opts: {
  title?: string;
  hasInitialPrompt: boolean;
}): string {
  const brand = opts.title
    ? `Hi — I'm **Koda**, Advanced Automations' AI Builder. Let's plan **${opts.title}** together.`
    : "Hi — I'm **Koda**, Advanced Automations' AI Builder. Let's plan your automation together.";

  if (opts.hasInitialPrompt) {
    return [
      brand,
      "",
      "I've got your starting notes. I'll keep a living plan in the Plan panel and ask clear numbered questions here when I still need something from you.",
      "",
      "Use **+** to attach docs, examples, or files. For passwords and API keys, choose **Add secrets / credentials** so values stay private and never appear in chat.",
    ].join("\n");
  }

  return [
    brand,
    "",
    "Tell me what you want to automate in your own words. I'll draft a plan in the Plan panel, answer in plain English here, and ask clear numbered questions when I still need details from you.",
    "",
    "Use **+** to attach docs or files. For passwords and API keys, choose **Add secrets / credentials** so values stay private and never appear in chat.",
  ].join("\n");
}

/**
 * System prompt for live Cursor plan-mode agents.
 * Never mention Cursor / GitHub / Railway by name.
 */
export function planningAgentInstructions(): string {
  return [
    "You are Koda, Advanced Automations' AI Builder, in PLANNING mode only.",
    "Audience: non-technical school administrators and office staff. Write in plain, simple English a busy school admin understands on first read.",
    "Short sentences. Everyday words. No unexplained jargon. If you must use a term like API, RPA, webhook, or OAuth, add a one-short-phrase plain meaning in parentheses the first time (e.g. API (a secure way two programs share data)).",
    "Do not implement, write production code, or create files unless the client explicitly asks for a diagram or plan document in chat.",
    "Behave like a helpful planning partner: clear, specific to what the client said, and easy to follow — not like a dense technical report.",
    "Answer direct questions directly (including who you are: Koda). Never ignore the user's message to push a scripted questionnaire.",
    "When the client asks how systems should connect, explain options in plain language and recommend one approach based on what they described — do not dump a generic plan template into chat.",
    "Never set the plan Goal to the client's latest question verbatim. Goals are durable outcomes; questions get answered in prose, then the living plan is updated thoughtfully.",
    "CHAT vs PLAN PANEL (critical):",
    "- Chat replies stay short and conversational (like a helpful colleague). Usually 2–8 short paragraphs max.",
    "- Do NOT paste the full living plan into chat every turn.",
    "- When you update the durable plan, put the FULL markdown plan ONLY inside a fenced block tagged plan (opening fence: ```plan ). Outside that fence, write a brief chat summary of what changed, then say you've updated the Plan panel.",
    "- Use markdown headings in chat when helpful (## for section titles) so important lines stand out — but keep chat short.",
    "Plan markdown (inside ```plan) must include: Goal, Systems, Integrations / APIs, Workflow, Edge cases, Acceptance criteria, and a section titled exactly \"## What you need to provide\".",
    "Always keep \"## What you need to provide\" current: accounts, passwords, API keys, sample files, VPN/remote access, and logins the client must supply before build. Tell them to use Add secrets / credentials for passwords and keys — never ask them to paste secret values into chat.",
    "ASK CLEARLY WHAT YOU NEED (critical — every meaningful turn):",
    "- End nearly every planning reply with a short section titled exactly \"## What I still need from you\" (or bold WHAT I STILL NEED FROM YOU).",
    "- Under it, ask clear numbered questions (1., 2., 3.) about open items required to finish the plan — drawn from \"## What you need to provide\" and any missing workflow details.",
    "- Prefer 1–3 questions. One question is fine when only one thing blocks progress. Never dump a long rotating checklist.",
    "- Phrase questions so a school admin knows exactly what to answer or upload (e.g. \"1. Do staff only log into Provider Soft in a browser, or do you already have a file export?\").",
    "- If nothing is missing and the plan is ready, say so clearly and note they can Submit to developer for building.",
    "When the client asks for a diagram / digram / flowchart / architecture view: show the mermaid diagram in chat, add 1–3 plain clarifying questions, and put the durable plan update in the ```plan fence (not a huge plan dump in chat).",
    "Never echo or repeat secret values if the client pastes them anyway; acknowledge only the secret name (e.g. Secret saved: HHA_PASSWORD).",
    "Never mention underlying AI vendors, source-control hosts, cloud hosts, job queues, or other internal tooling by name.",
    "Do not repeat \"Koda is AI and can make mistakes\" in every reply — the product chrome already shows that once.",
  ].join("\n");
}

const DISCLAIMER_RE = /\n*Koda is AI and can make mistakes\.?\s*/gi;

/** Remove repeated AI disclaimer lines from chat bodies (chrome already shows one). */
export function stripAiDisclaimer(text: string): string {
  return text.replace(DISCLAIMER_RE, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const PLAN_FENCE_RE = /```plan\s*\n([\s\S]*?)```/i;
const PLAN_HEADING_RE = /^#{1,2}\s+Plan\b[^\n]*$/im;

/**
 * Split an assistant reply into conversational chat vs durable plan markdown.
 * Prefers an explicit ```plan fence; falls back to extracting a # Plan section.
 */
export function splitPlanFromReply(
  raw: string,
  priorPlan?: string | null,
): { chatContent: string; planMarkdown: string } {
  const text = stripAiDisclaimer(raw || "");
  if (!text.trim()) {
    return { chatContent: "", planMarkdown: priorPlan?.trim() || "" };
  }

  const fenced = text.match(PLAN_FENCE_RE);
  if (fenced?.[1]?.trim()) {
    const chatContent = stripAiDisclaimer(
      text.replace(PLAN_FENCE_RE, "").replace(/\n{3,}/g, "\n\n").trim(),
    );
    return {
      chatContent:
        chatContent ||
        "I've updated the living plan in the Plan panel.",
      planMarkdown: fenced[1].trim(),
    };
  }

  const heading = text.match(PLAN_HEADING_RE);
  if (heading && heading.index != null) {
    const planMarkdown = text.slice(heading.index).trim();
    let chatContent = text.slice(0, heading.index).trim();
    if (!chatContent || chatContent.length < 24) {
      chatContent =
        "I've updated the living plan in the Plan panel — take a look and tell me what to refine.";
    }
    return {
      chatContent: stripAiDisclaimer(chatContent),
      planMarkdown,
    };
  }

  const looksLikePlanDump =
    /^#\s+/m.test(text) &&
    /##\s+Goal/i.test(text) &&
    /##\s+Systems/i.test(text) &&
    text.length > 400;
  if (looksLikePlanDump) {
    return {
      chatContent:
        "I've refreshed the living plan in the Plan panel based on what you shared.",
      planMarkdown: text,
    };
  }

  return {
    chatContent: text,
    planMarkdown: priorPlan?.trim() || text,
  };
}

/** Prefer a richer extracted plan; keep prior when the new extract is thin. */
export function preferPlanMarkdown(
  next: string,
  prior?: string | null,
): string {
  const n = next.trim();
  const p = (prior ?? "").trim();
  if (!n) return p;
  if (!p) return n;
  if (n.length + 80 < p.length && /##\s+Goal/i.test(p) && !/##\s+Goal/i.test(n)) {
    return p;
  }
  return n;
}

/** Prompt used when starting a plan-mode agent for a program. */
export function buildPlanningStartPrompt(opts: {
  title: string;
  description: string;
  messages?: Array<{ role: string; content: string }>;
  planningMeta?: PlanningMeta;
}): string {
  const parts = [
    planningAgentInstructions(),
    "",
    `Program title: ${opts.title}`,
    opts.description ? `Initial brief:\n${opts.description}` : "",
  ];

  const meta = opts.planningMeta;
  if (meta?.apiDocsUrl) parts.push(`API docs URL: ${meta.apiDocsUrl}`);
  if (meta?.docsText) parts.push(`Documentation notes:\n${meta.docsText}`);
  if (meta?.examples) parts.push(`Examples:\n${meta.examples}`);
  if (meta?.planMarkdown) {
    parts.push(`Current living plan document:\n${meta.planMarkdown}`);
  }

  const history = (opts.messages ?? []).filter(
    (m) => m.role === "USER" || m.role === "ASSISTANT",
  );
  if (history.length > 0) {
    parts.push(
      "",
      "Conversation so far:",
      ...history.map(
        (m) => `${m.role === "USER" ? "Client" : "Koda"}: ${m.content}`,
      ),
    );
  }

  parts.push(
    "",
    "Respond as Koda in plain English. Chat = short answer + numbered \"What I still need from you\" questions. Put the full living plan only inside a ```plan fence. If they asked a direct question, answer it first. Include mermaid in chat when a diagram was requested.",
  );

  return parts.filter((p) => p !== "").join("\n");
}

function wantsDiagram(text: string): boolean {
  return /(diagram|digram|mermaid|flowchart|architecture|sequence diagram)/i.test(
    text,
  );
}

function isDirectQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (/^(hi|hello|hey)\b/.test(t) && t.length < 40) return true;
  if (
    /what('?s| is) your name|who are you|are you koda|what can you do/.test(t)
  ) {
    return true;
  }
  if (wantsDiagram(t)) return true;
  if (t.endsWith("?") && t.length < 160) return true;
  return false;
}

function inferSystems(text: string): string[] {
  const systems: string[] = [];
  const map: Array<[RegExp, string]> = [
    [/\bquickbooks?\b|\bqb\b/i, "QuickBooks"],
    [/\bgmail\b|email/i, "Email"],
    [/\bsalesforce\b/i, "Salesforce"],
    [/\bhubspot\b/i, "HubSpot"],
    [/\bshopify\b/i, "Shopify"],
    [/\bslack\b/i, "Slack"],
    [/\bstripe\b/i, "Stripe"],
    [/\bnetsuite\b/i, "NetSuite"],
    [/\berp\b/i, "ERP"],
    [/\bsheets?\b|spreadsheet/i, "Spreadsheets"],
    [/\bhha\b|home\s*health\s*agency|hhax|hha\s*exchange/i, "HHA / HHAeXchange"],
    [/\bprovider\s*soft\b|\bprovidersoft\b/i, "Provider Soft"],
  ];
  for (const [re, label] of map) {
    if (re.test(text) && !systems.includes(label)) systems.push(label);
  }
  return systems;
}

function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.endsWith("?")) return true;
  return /^(how|what|why|when|where|who|which|can|could|would|should|do|does|is|are)\b/i.test(
    t,
  );
}

/** Strip pasted docs / HTML / attachment dumps — never use those as the Goal. */
function goalCandidateFromUserText(text: string): string | null {
  const withoutAttach = text
    .replace(/\n\nAttached (API docs URL|documentation|examples|file)[^\n]*:\n[\s\S]*$/i, "")
    .replace(/^Attached (API docs URL|documentation|examples|file)[^\n]*:\n[\s\S]*$/i, "")
    .trim();
  if (!withoutAttach) return null;
  if (
    /<\/?(html|body|head|div|script|style|table|meta)\b/i.test(withoutAttach.slice(0, 4000)) ||
    /<!DOCTYPE\s+html/i.test(withoutAttach.slice(0, 200))
  ) {
    return null;
  }
  // File excerpts / CSV / Excel dumps must never become the Goal.
  if (
    /^File:\s+.+\((PDF|CSV\/TSV|Excel|document)\)/i.test(withoutAttach) ||
    /^Extracted text for planning:/im.test(withoutAttach) ||
    /^Headers:\s*.+\nExcerpt \(first rows\):/im.test(withoutAttach) ||
    /^\[Attached file for layout\/structure analysis:/im.test(withoutAttach) ||
    /Layout images sent to Koda/i.test(withoutAttach.slice(0, 500)) ||
    /Layout previews:/i.test(withoutAttach.slice(0, 500)) ||
    /Original PDF kept for Koda/i.test(withoutAttach.slice(0, 500))
  ) {
    return null;
  }
  if (looksLikeQuestion(withoutAttach)) return null;
  if (withoutAttach.length <= 20) return null;
  // Cap tightly so huge pastes never become the Goal even if they sneak through.
  return withoutAttach.slice(0, 280).replace(/\s+/g, " ").trim();
}

/** Parse prior "## What you need to provide" bullet lines (text after optional checkbox). */
function parsePriorNeedItems(priorPlan?: string | null): string[] {
  if (!priorPlan) return [];
  const section = priorPlan.match(
    /## What you need to provide\n([\s\S]*?)(?:\n## |\n*$)/,
  )?.[1];
  if (!section) return [];
  const items: string[] = [];
  for (const line of section.split("\n")) {
    const m = line.match(/^\s*-\s*(?:\[[ xX]\]\s*)?(.+)$/);
    if (!m?.[1]) continue;
    const text = m[1].trim();
    if (!text || /^to be confirmed/i.test(text)) continue;
    if (/—\s*received securely/i.test(text)) continue;
    if (!items.includes(text)) items.push(text);
  }
  return items;
}

/**
 * Infer accounts / keys / access the client must supply before build.
 * Values never belong here — only what to provide (and how).
 */
export function inferWhatYouNeedToProvide(opts: {
  systems: string[];
  meta: PlanningMeta;
  latestUserContent: string;
  priorPlan?: string | null;
}): string[] {
  const items: string[] = [];
  const push = (line: string) => {
    if (line && !items.includes(line)) items.push(line);
  };

  for (const custom of opts.meta.neededItems ?? []) push(custom);
  for (const prior of parsePriorNeedItems(opts.priorPlan)) push(prior);

  const systems = opts.systems;
  const context = `${opts.latestUserContent}\n${opts.meta.docsText ?? ""}\n${opts.priorPlan ?? ""}`;
  const wantsRpa = /\brpa\b|ui automation|screen.?scrape|browser login/i.test(
    context,
  );

  if (systems.some((s) => /hha/i.test(s))) {
    push(
      wantsRpa
        ? "HHA / HHAeXchange login for RPA (username + password) — use Add secrets / credentials"
        : "HHA / HHAeXchange API credentials or login — use Add secrets / credentials",
    );
  }
  if (systems.some((s) => /provider soft/i.test(s))) {
    push(
      wantsRpa
        ? "Provider Soft login for RPA (username + password) — use Add secrets / credentials"
        : "Provider Soft API credentials, export access, or login — use Add secrets / credentials",
    );
  }
  if (systems.some((s) => /quickbooks/i.test(s))) {
    push("QuickBooks app credentials / OAuth client — use Add secrets / credentials");
  }
  if (systems.some((s) => /salesforce|hubspot|shopify|stripe|netsuite/i.test(s))) {
    push("Downstream system API keys or OAuth credentials — use Add secrets / credentials");
  }
  if (!opts.meta.apiDocsUrl && systems.length > 0) {
    push("API docs URL, OpenAPI/Swagger, or partner integration notes (attach when available)");
  }
  if (wantsRpa) {
    push("VPN / remote desktop access if the bot must run on an internal network");
    push("Dedicated test login (not a personal production account) when possible");
  }
  if (
    systems.length === 0 &&
    items.length === 0 &&
    opts.latestUserContent.trim().length > 40
  ) {
    push("Confirm systems involved and how we authenticate to each");
  }
  if (items.length === 0) {
    push("Accounts, API keys, sample files, or access needed for this automation (to be confirmed)");
  }

  push("Sample files or screenshots of the current workflow (optional — upload as a file)");

  for (const key of opts.meta.providedSecretKeys ?? []) {
    push(`${key} — received securely`);
  }

  return items;
}

/** Turn a plan need-item into a plain question a non-technical client can answer. */
function needItemToPlainQuestion(item: string): string {
  let text = item
    .replace(/\s*—\s*use Add secrets.*/i, "")
    .replace(/\s*\(optional[^)]*\)/i, "")
    .trim();

  if (/provider\s*soft.*login/i.test(text)) {
    return "Please add your Provider Soft login under **Add secrets / credentials** if we should log in for you.";
  }
  if (/hha.*login/i.test(text)) {
    return "Please add your HHA / HHAeXchange login under **Add secrets / credentials** if we should log in for you.";
  }
  if (/quickbooks/i.test(text)) {
    return "Please add your QuickBooks connection details under **Add secrets / credentials** when you have them.";
  }
  if (/api docs|openapi|swagger|integration notes/i.test(text)) {
    return "Do you have a link to documentation that explains how these systems connect, or should we plan around file exports?";
  }
  if (/vpn|remote desktop/i.test(text)) {
    return "Will this need to run inside your office network (VPN or remote desktop)?";
  }
  if (/dedicated test login/i.test(text)) {
    return "Can you provide a test login (not someone's personal production account) for us to try with?";
  }
  if (/sample file|screenshot/i.test(text)) {
    return "Can you upload a sample file or screenshot that shows what the data looks like today?";
  }
  if (/downstream|oauth|api key/i.test(text)) {
    return "Please add login or connection details for the other system under **Add secrets / credentials**.";
  }
  if (/confirm systems/i.test(text)) {
    return "Which software or websites are involved in this workflow?";
  }
  if (/accounts.*api keys|to be confirmed/i.test(text)) {
    return "What logins, files, or access will we need from you before we can build this?";
  }
  if (text.endsWith("?")) return text;
  return `${text}?`;
}

/** Build 1–3 numbered plain-English questions about open plan items. */
export function buildStillNeededQuestions(opts: {
  systems: string[];
  meta: PlanningMeta;
  latestUserContent: string;
  priorPlan?: string | null;
  covered: Set<PlanningTopic>;
}): string[] {
  const hasHhaProvider =
    opts.systems.some((s) => /hha/i.test(s)) &&
    opts.systems.some((s) => /provider soft/i.test(s));

  const questions: string[] = [];

  if (
    hasHhaProvider &&
    !/\b(upload|excel|file export|export file|spreadsheet)\b/i.test(
      opts.latestUserContent,
    )
  ) {
    questions.push(
      "Do staff only log into Provider Soft and HHA in a browser, or do you already get spreadsheet or file exports?",
    );
  }

  const openNeeds = inferWhatYouNeedToProvide({
    systems: opts.systems,
    meta: opts.meta,
    latestUserContent: opts.latestUserContent,
    priorPlan: opts.priorPlan,
  })
    .filter((item) => !/—\s*received securely/i.test(item))
    .filter((item) => !/^to be confirmed/i.test(item))
    .filter((item) => !/sample file|screenshot/i.test(item) || questions.length < 2);

  for (const item of openNeeds) {
    const q = needItemToPlainQuestion(item);
    if (!questions.includes(q)) questions.push(q);
    if (questions.length >= 3) break;
  }

  if (questions.length === 0 && !opts.covered.has("edge_cases")) {
    questions.push("What should happen when a record fails or is a duplicate?");
  }
  if (questions.length === 0) {
    questions.push(
      "Does this plan look right, or should we change anything before you submit it to a developer?",
    );
  }

  return questions.slice(0, 3);
}

/** Format numbered still-needed questions for chat. */
export function formatStillNeededSection(questions: string[]): string {
  const numbered = questions.map((q, i) => {
    const cleaned = q.replace(/^\d+\.\s*/, "").trim();
    return `${i + 1}. ${cleaned}`;
  });
  return ["## What I still need from you", ...numbered].join("\n");
}

/** Prefer a durable goal; never copy a short question or attachment dump into ## Goal. */
function deriveGoal(opts: {
  title?: string;
  latestUserContent: string;
  priorPlan?: string | null;
  systems: string[];
}): string {
  const priorGoal = opts.priorPlan?.match(/## Goal\n([\s\S]*?)(?:\n## |\n*$)/)?.[1]
    ?.trim();
  if (
    priorGoal &&
    priorGoal.length > 8 &&
    !looksLikeQuestion(priorGoal) &&
    !/^define the business outcome/i.test(priorGoal) &&
    !/<\/?(html|body|div)\b/i.test(priorGoal)
  ) {
    return priorGoal.slice(0, 500);
  }

  const fromUser = goalCandidateFromUserText(opts.latestUserContent);
  if (fromUser) return fromUser;

  if (opts.systems.length >= 2) {
    return `Connect ${opts.systems.join(" and ")} so data flows reliably between them.`;
  }
  if (opts.systems.length === 1) {
    return `Automate the ${opts.systems[0]} workflow described with the client.`;
  }
  if (opts.title?.trim() && !/^program\s+\d+/i.test(opts.title)) {
    return `Deliver the automation for ${opts.title.trim()}.`;
  }
  return "Define the business outcome with the client.";
}


/** Build / refresh living plan markdown from conversation context. */
export function synthesizePlanMarkdown(opts: {
  title?: string;
  meta: PlanningMeta;
  latestUserContent: string;
  priorPlan?: string | null;
}): string {
  const systems = inferSystems(
    `${opts.latestUserContent}\n${opts.meta.docsText ?? ""}\n${opts.meta.examples ?? ""}\n${opts.priorPlan ?? ""}\n${opts.meta.planMarkdown ?? ""}`,
  );
  // Merge systems already listed in prior plan
  const priorSystems = opts.priorPlan?.match(/## Systems\n([\s\S]*?)(?:\n## |\n*$)/)?.[1];
  if (priorSystems) {
    for (const line of priorSystems.split("\n")) {
      const name = line.replace(/^\s*-\s*/, "").trim();
      if (
        name &&
        !/^to be confirmed/i.test(name) &&
        !systems.includes(name)
      ) {
        systems.push(name);
      }
    }
  }

  const title = opts.title?.trim() || "Automation program";
  const brief = opts.latestUserContent.trim();
  const hasWorkflow =
    (brief.length > 60 && !looksLikeQuestion(brief)) ||
    /(then |after |when |trigger|invoice|sync|create|send|rpa|pull|push)/i.test(
      brief,
    );

  const goal = deriveGoal({
    title: opts.title,
    latestUserContent: opts.latestUserContent,
    priorPlan: opts.priorPlan ?? opts.meta.planMarkdown,
    systems,
  });

  const lines = [
    `# Plan: ${title}`,
    "",
    "## Goal",
    goal,
    "",
    "## Systems",
    systems.length
      ? systems.map((s) => `- ${s}`).join("\n")
      : "- To be confirmed with the client",
    "",
    "## Integrations / APIs",
    opts.meta.apiDocsUrl
      ? `- Docs: ${opts.meta.apiDocsUrl}`
      : systems.some((s) => /hha|provider soft/i.test(s))
        ? "- Prefer official APIs / exports where available; fall back to attended/unattended RPA only if no API exists"
        : "- API docs / auth details: attach when available",
    opts.meta.docsText
      ? `- Notes: ${opts.meta.docsText.slice(0, 280)}${opts.meta.docsText.length > 280 ? "…" : ""}`
      : "",
    "",
    "## Workflow",
    hasWorkflow || systems.length >= 2
      ? [
          systems.some((s) => /provider soft/i.test(s))
            ? "1. Read/export records from Provider Soft (API or scheduled export / RPA)"
            : "1. Trigger from the described source event",
          "2. Validate and normalize payload fields",
          systems.some((s) => /hha/i.test(s))
            ? "3. Push mapped data into HHA / HHAeXchange"
            : "3. Call downstream system(s) with mapped data",
          "4. Record success / surface failures for review",
        ].join("\n")
      : "Walk through happy-path steps with the client.",
    "",
    "## Edge cases",
    "- Missing or invalid fields",
    "- Downstream API errors / retries",
    "- Duplicates and idempotency",
    "",
    "## Acceptance criteria",
    "- Happy path completes end-to-end in a test environment",
    "- Failures are visible and recoverable",
    "- Secrets never appear in chat logs",
    "",
    "## What you need to provide",
    ...inferWhatYouNeedToProvide({
      systems,
      meta: opts.meta,
      latestUserContent: opts.latestUserContent,
      priorPlan: opts.priorPlan ?? opts.meta.planMarkdown,
    }).map((item) => {
      const received = /—\s*received securely/i.test(item);
      return received ? `- [x] ${item}` : `- [ ] ${item}`;
    }),
  ];

  if (wantsDiagram(brief) || systems.length >= 2) {
    const nodes =
      systems.length >= 2
        ? systems
        : ["Source", "Automation", "Destination"];
    lines.push(
      "",
      "## Diagram",
      "```mermaid",
      "flowchart LR",
      ...nodes.map((n, i) => {
        const id = `N${i}`;
        const next = nodes[i + 1];
        if (!next) return `  ${id}[${n}]`;
        return `  ${id}[${n}] --> N${i + 1}[${next}]`;
      }),
      "```",
    );
  }

  if (opts.priorPlan && opts.priorPlan.includes("## Goal")) {
    // Prefer freshly synthesized content; prior plan is already reflected via meta.
  }

  return lines.filter((l) => l !== undefined).join("\n");
}

function answerDirectly(opts: {
  latestUserContent: string;
  planMarkdown: string;
  meta?: PlanningMeta;
}): string | null {
  const lower = opts.latestUserContent.toLowerCase().trim();
  const context = `${opts.latestUserContent}\n${opts.planMarkdown}\n${opts.meta?.planMarkdown ?? ""}\n${opts.meta?.docsText ?? ""}`;

  if (
    /what('?s| is) your name|who are you|are you (an )?ai|what can you do/.test(
      lower,
    )
  ) {
    return [
      "I'm **Koda** — Advanced Automations' AI Builder.",
      "",
      "I help you plan business automations in plain language: what should happen, which systems are involved, and what we need from you before building. When the plan looks right, you can submit it to a developer.",
      "",
      formatStillNeededSection([
        "What would you like to automate?",
      ]),
    ].join("\n");
  }

  if (/^(hi|hello|hey)\b/.test(lower) && lower.length < 40) {
    return [
      "Hey — I'm Koda. Tell me the automation you have in mind, or ask for a diagram anytime.",
      "",
      formatStillNeededSection([
        "What should this automation do for your team?",
      ]),
    ].join("\n");
  }

  if (
    /(how (will|do|can|would) (you |we |i )?(pull|get|fetch|read|export).*(hha|provider)|rpa|api.*(hha|provider)|(hha|provider).*(api|rpa|pull|data))/i.test(
      lower,
    ) ||
    (/hha|provider\s*soft/i.test(context) &&
      /(how|pull|api|rpa|data|connect)/i.test(lower) &&
      looksLikeQuestion(opts.latestUserContent))
  ) {
    return [
      "Here's the simple order I'd use to move data between Provider Soft and HHA:",
      "",
      "1. **Official connection / file share** — if either system already offers a secure data connection (API) or scheduled file export, we use that first. It's the most reliable.",
      "2. **Scheduled file export** — many offices already save visit or payroll files to a folder on a schedule. We can pick those up, check them, and send them onward.",
      "3. **Screen automation (RPA)** — only if there is no better option. A bot logs into the website and clicks through screens. It works, but breaks more easily when the website changes.",
      "",
      "**Recommendation:** use a real data connection or file export first; use screen automation only as a last resort.",
      "",
      "I've updated the Plan panel with this approach.",
      "",
      "## What I still need from you",
      "1. Today, do staff only log into these systems in a browser, or do you already get file exports?",
      "2. Which direction should data flow first — Provider Soft → HHA, HHA → Provider Soft, or both?",
    ].join("\n");
  }

  if (wantsDiagram(lower)) {
    return [
      "Here's a simple diagram of the flow based on what we know so far.",
      "",
      opts.planMarkdown.includes("```mermaid")
        ? opts.planMarkdown.slice(opts.planMarkdown.indexOf("## Diagram"))
        : [
            "```mermaid",
            "flowchart LR",
            "  A[Source system] --> B[Koda automation]",
            "  B --> C[Destination system]",
            "```",
          ].join("\n"),
      "",
      "I've also refreshed the living plan in the Plan panel.",
      "",
      "## What I still need from you",
      "1. Does this match how work moves in your office today?",
      "2. What should happen when a record fails or is incomplete?",
    ].join("\n");
  }

  return null;
}

/**
 * Local / mock planning follow-up when a live agent session is unavailable.
 * Keyword-aware: answers directly, synthesizes plan markdown — not a scripted Q&A loop.
 */
export function buildPlanningFollowUp(opts: {
  meta: PlanningMeta;
  latestUserContent: string;
  attachmentKind?: "api_docs_url" | "docs_text" | "examples" | "file" | null;
  title?: string;
}): { content: string; nextMeta: PlanningMeta; planMarkdown: string } {
  let meta = { ...opts.meta };
  const covered = new Set(meta.coveredTopics ?? []);

  if (opts.attachmentKind === "api_docs_url" || opts.attachmentKind === "docs_text") {
    covered.add("apis");
  }
  if (opts.attachmentKind === "examples" || opts.attachmentKind === "file") {
    covered.add("apis");
    covered.add("workflow");
  }

  const lower = opts.latestUserContent.toLowerCase();
  if (/(crm|salesforce|hubspot|shopify|erp|slack|email|gmail|sheets?|quickbooks?|\bqb\b|hha|provider\s*soft|hhax)/.test(lower)) {
    covered.add("systems");
  }
  if (/(api|endpoint|webhook|oauth|token|swagger|openapi|rpa)/.test(lower)) {
    covered.add("apis");
  }
  if (/(then |after that|first |step |when |trigger|invoice|workflow|pull|push|connect)/.test(lower)) {
    covered.add("workflow");
  }
  if (/(error|fail|retry|duplicate|missing|edge)/.test(lower)) {
    covered.add("edge_cases");
  }
  if (/(accept|must |should |criteria|done when)/.test(lower)) {
    covered.add("acceptance");
  }
  if (opts.latestUserContent.trim().length > 40 && !looksLikeQuestion(opts.latestUserContent)) {
    covered.add("goals");
  }

  const planMarkdown = synthesizePlanMarkdown({
    title: opts.title,
    meta: { ...meta, coveredTopics: [...covered] },
    latestUserContent: opts.latestUserContent,
    priorPlan: meta.planMarkdown,
  });

  meta = {
    ...meta,
    coveredTopics: [...covered],
    planMarkdown,
  };

  if (opts.attachmentKind === "api_docs_url") {
    meta = { ...meta, apiDocsUrl: meta.apiDocsUrl };
  }

  const direct = answerDirectly({
    latestUserContent: opts.latestUserContent,
    planMarkdown,
    meta,
  });
  if (direct) {
    return { content: direct, nextMeta: meta, planMarkdown };
  }

  const attachAck =
    opts.attachmentKind === "api_docs_url"
      ? "I've saved that documentation link into the plan."
      : opts.attachmentKind === "docs_text"
        ? "I've added those notes into the plan."
        : opts.attachmentKind === "examples"
          ? "Those examples are in the plan now."
          : opts.attachmentKind === "file"
            ? "I've added that file to the plan."
            : null;

  const systems = inferSystems(opts.latestUserContent);
  const substantive = opts.latestUserContent.trim().length > 80 || systems.length > 0;

  if (substantive || isDirectQuestion(opts.latestUserContent)) {
    const systemsLabel = systems.length
      ? systems.join(" and ")
      : "the workflow you described";

    const needQuestions = buildStillNeededQuestions({
      systems,
      meta,
      latestUserContent: opts.latestUserContent,
      priorPlan: planMarkdown,
      covered,
    });

    return {
      content: [
        attachAck,
        `Thanks — I've updated the living plan for **${systemsLabel}** in the Plan panel.`,
        "",
        formatStillNeededSection(needQuestions),
      ]
        .filter(Boolean)
        .join("\n"),
      nextMeta: meta,
      planMarkdown,
    };
  }

  return {
    content: [
      attachAck ?? "Happy to help.",
      "",
      "In a few sentences, tell me what should happen: what starts the work, the steps, and where the result should go.",
      "",
      formatStillNeededSection([
        "What systems are involved (for example Provider Soft, HHA, email, spreadsheets)?",
        "What does a successful run look like for your team?",
      ]),
    ]
      .filter((line) => line !== "")
      .join("\n"),
    nextMeta: meta,
    planMarkdown,
  };
}

/** @deprecated topic helpers kept for tests / light meta tracking */
export function nextPlanningTopic(meta: PlanningMeta): PlanningTopic | null {
  const covered = new Set(meta.coveredTopics ?? []);
  for (const topic of PLANNING_TOPICS) {
    if (!covered.has(topic)) return topic;
  }
  return null;
}

export function markTopicCovered(
  meta: PlanningMeta,
  topic: PlanningTopic,
): PlanningMeta {
  const covered = new Set(meta.coveredTopics ?? []);
  covered.add(topic);
  return {
    ...meta,
    coveredTopics: [...covered],
    lastQuestionTopic: topic,
  };
}

export function inferTopicFromAssistantQuestion(
  content: string,
): PlanningTopic | null {
  const lower = content.toLowerCase();
  if (
    lower.includes("outcome") ||
    lower.includes("automate") ||
    lower.includes("looking to build") ||
    lower.includes("done” look") ||
    lower.includes('done" look')
  ) {
    return "goals";
  }
  if (
    lower.includes("systems") ||
    lower.includes("crm") ||
    lower.includes("tools are involved")
  ) {
    return "systems";
  }
  if (
    lower.includes("api") ||
    lower.includes("openapi") ||
    lower.includes("endpoint") ||
    lower.includes("auth")
  ) {
    return "apis";
  }
  if (
    lower.includes("happy-path") ||
    lower.includes("steps") ||
    lower.includes("approvals") ||
    lower.includes("walk me through")
  ) {
    return "workflow";
  }
  if (
    lower.includes("fail") ||
    lower.includes("edge") ||
    lower.includes("escalate") ||
    lower.includes("duplicates")
  ) {
    return "edge_cases";
  }
  if (
    lower.includes("acceptance") ||
    lower.includes("submit this to a developer") ||
    lower.includes("know the build is correct")
  ) {
    return "acceptance";
  }
  return null;
}
