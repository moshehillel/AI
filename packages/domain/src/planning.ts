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
      "I've got your starting notes. I'll shape a living plan with you — ask me anything, request a diagram, or refine the workflow. I'll only ask clarifying questions when I need them.",
      "",
      "You can attach API docs, paste examples, or upload a file anytime.",
      "",
      "Koda is AI and can make mistakes.",
    ].join("\n");
  }

  return [
    brand,
    "",
    "Tell me what you want to automate in your own words. I'll draft a plan, answer questions directly, and draw diagrams when you ask. Clarifying questions only when needed.",
    "",
    "You can attach an API docs URL, paste examples, or upload a file whenever it's useful.",
    "",
    "Koda is AI and can make mistakes.",
  ].join("\n");
}

/**
 * System prompt for live Cursor plan-mode agents.
 * Never mention Cursor / GitHub / Railway by name.
 */
export function planningAgentInstructions(): string {
  return [
    "You are Koda, Advanced Automations' AI Builder, in PLANNING mode only.",
    "Do not implement, write production code, or create files unless the client explicitly asks for a diagram or plan document in chat.",
    "Behave like an expert product-planning partner: thoughtful, conversational, and specific to what the client said.",
    "Answer direct questions directly (including who you are: Koda). Never ignore the user's message to push a scripted questionnaire.",
    "When the client asks how to integrate systems (APIs, RPA/UI automation, file exports, webhooks), explain trade-offs clearly and recommend an approach based on what they described — do not dump a generic plan template.",
    "Never set the plan Goal to the client's latest question verbatim. Goals are durable outcomes; questions get answered in prose, then the living plan is updated thoughtfully.",
    "Produce markdown plans. When asked for a diagram / digram / flowchart / architecture view, include a mermaid fenced code block.",
    "Ask clarifying questions only when needed to unblock the plan — one or a few at a time, never a rotating checklist.",
    "Maintain and update a living plan document in your replies: goals, systems, integrations/APIs, workflow steps, edge cases, and acceptance criteria.",
    "When the plan feels solid, briefly note they can Submit to developer for building.",
    "Never mention underlying AI vendors, source-control hosts, cloud hosts, job queues, or other internal tooling by name.",
    "Remind briefly that Koda is AI and can make mistakes when appropriate.",
  ].join("\n");
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
    "Respond as Koda. If the client already described a workflow, synthesize a concrete markdown plan now. If they asked a direct question, answer it. Include mermaid when a diagram was requested.",
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
  // File excerpts / CSV dumps must never become the Goal.
  if (
    /^File:\s+.+\((PDF|CSV\/TSV|document)\)/i.test(withoutAttach) ||
    /^Extracted text for planning:/im.test(withoutAttach) ||
    /^Headers:\s*.+\nExcerpt \(first rows\):/im.test(withoutAttach)
  ) {
    return null;
  }
  if (looksLikeQuestion(withoutAttach)) return null;
  if (withoutAttach.length <= 20) return null;
  // Cap tightly so huge pastes never become the Goal even if they sneak through.
  return withoutAttach.slice(0, 280).replace(/\s+/g, " ").trim();
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
      "I help you plan business automations in plain language: workflows, integrations, diagrams, and acceptance checks. When the plan looks right, you can submit it to a developer to build.",
      "",
      "What would you like to automate?",
      "",
      "Koda is AI and can make mistakes.",
    ].join("\n");
  }

  if (/^(hi|hello|hey)\b/.test(lower) && lower.length < 40) {
    return [
      "Hey — I'm Koda. Tell me the automation you have in mind, or ask for a plan/diagram anytime.",
      "",
      "Koda is AI and can make mistakes.",
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
      "For HHA / Provider Soft, I'd approach data access in this order:",
      "",
      "1. **Official API / partner integration** — if HHAeXchange (or your HHA vendor) and Provider Soft expose APIs or SFTP/CSV exports, we use those first. They're more stable than screen automation.",
      "2. **Scheduled file export** — many home-health stacks can dump visits/authorizations/payroll to a folder or SFTP on a schedule; we pick up the file, validate, and push downstream.",
      "3. **RPA (UI automation)** — only if there's no API/export. A bot logs into the UI, navigates the screens, and scrapes or enters data. It works, but it's brittle when the UI changes and usually needs a dedicated Windows worker.",
      "",
      "So: **API/export first, RPA as a last resort.** For Provider Soft → HHA specifically, tell me whether either side already has an API key, EDI/export, or if staff only work in the browser today — that decides the path.",
      "",
      "I've updated the living plan with that integration approach.",
      "",
      opts.planMarkdown,
      "",
      "Koda is AI and can make mistakes.",
    ].join("\n");
  }

  if (wantsDiagram(lower)) {
    return [
      "Here's a working diagram of the software flow based on what we know so far. Tell me what to adjust.",
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
      "Koda is AI and can make mistakes.",
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
      ? "I've saved that API docs link into the plan."
      : opts.attachmentKind === "docs_text"
        ? "I've added those docs into the plan notes."
        : opts.attachmentKind === "examples"
          ? "Those examples are in the plan now."
          : opts.attachmentKind === "file"
            ? "I've pulled that file into the plan notes."
            : null;

  const systems = inferSystems(opts.latestUserContent);
  const substantive = opts.latestUserContent.trim().length > 80 || systems.length > 0;

  if (substantive || isDirectQuestion(opts.latestUserContent)) {
    const clarifying =
      !covered.has("apis") && !meta.apiDocsUrl
        ? "If you have API docs or sample payloads, attach them when you can — otherwise I can keep planning from what you described."
        : !covered.has("edge_cases")
          ? "One gap: what should happen on failures or duplicates?"
          : "Anything you'd like to refine, or are you ready to **Submit to developer for building**?";

    return {
      content: [
        attachAck,
        "Here's an updated plan based on what you shared:",
        "",
        planMarkdown,
        "",
        clarifying,
        "",
        "Koda is AI and can make mistakes.",
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
      "Describe the automation in a few sentences (trigger → steps → destination), ask for a diagram, or tell me what to change in the plan.",
      "",
      meta.planMarkdown
        ? "Current plan is in the Plan panel — I'll keep it updated as we go."
        : "",
      "",
      "Koda is AI and can make mistakes.",
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
