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
};

export const PLANNING_TOPICS: PlanningTopic[] = [
  "goals",
  "systems",
  "apis",
  "workflow",
  "edge_cases",
  "acceptance",
];

const QUESTIONS: Record<PlanningTopic, string[]> = {
  goals: [
    "What outcome should this automation deliver — what does “done” look like for the business?",
    "Who benefits from this automation, and how often should it run?",
  ],
  systems: [
    "Which systems or tools are involved (e.g. CRM, email, spreadsheet, ERP)?",
    "Where does the data start, and where should the final result land?",
  ],
  apis: [
    "Do you have API docs, an OpenAPI link, or sample endpoints I should follow? You can attach a URL or paste examples below.",
    "Any auth, rate limits, or environment details (sandbox vs production) I should plan around?",
  ],
  workflow: [
    "Walk me through the happy-path steps, one by one — what happens first, then next?",
    "Are there approvals, notifications, or hand-offs to a person in the middle?",
  ],
  edge_cases: [
    "What should happen when something fails — missing data, API errors, duplicates?",
    "Any cases we must never automate, or always escalate to a human?",
  ],
  acceptance: [
    "How will we know the build is correct — a few concrete acceptance checks?",
    "Anything else that must be true before you submit this to a developer for building?",
  ],
};

function pickQuestion(topic: PlanningTopic, covered: PlanningTopic[]): string {
  const options = QUESTIONS[topic];
  const index = covered.filter((t) => t === topic).length % options.length;
  return options[index] ?? options[0]!;
}

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

/** Opening assistant message when a program enters PLANNING. */
export function buildOpeningPlanningMessage(opts: {
  title?: string;
  hasInitialPrompt: boolean;
}): string {
  if (opts.hasInitialPrompt) {
    return [
      opts.title
        ? `Thanks — I've started planning **${opts.title}** with you.`
        : "Thanks — I've started planning this program with you.",
      "",
      "We'll shape the build together. One question at a time.",
      "",
      pickQuestion("systems", []),
      "",
      "You can also attach API docs, paste examples, or upload a file anytime.",
      "",
      "Koda is AI and can make mistakes.",
    ].join("\n");
  }

  return [
    opts.title
      ? `Hi — I'm Koda. Let's plan **${opts.title}** together.`
      : "Hi — I'm Koda. Let's plan your automation together.",
    "",
    "I'll ask a few clarifying questions (goals, systems, APIs, workflow, edge cases, and acceptance criteria). Answer in your own words — one step at a time.",
    "",
    pickQuestion("goals", []),
    "",
    "You can attach an API docs URL, paste examples, or upload a file whenever it's useful.",
    "",
    "Koda is AI and can make mistakes.",
  ].join("\n");
}

/**
 * Plan-mode follow-up when no live agent session exists yet.
 * Asks one (or few) clarifying questions; never dumps a full form.
 */
export function buildPlanningFollowUp(opts: {
  meta: PlanningMeta;
  latestUserContent: string;
  attachmentKind?: "api_docs_url" | "docs_text" | "examples" | "file" | null;
}): { content: string; nextMeta: PlanningMeta } {
  let meta = { ...opts.meta };
  const covered = new Set(meta.coveredTopics ?? []);

  // Credit the topic Koda last asked about once the user replies.
  if (meta.lastQuestionTopic) {
    covered.add(meta.lastQuestionTopic);
  }

  if (opts.attachmentKind === "api_docs_url" || opts.attachmentKind === "docs_text") {
    covered.add("apis");
  }
  if (opts.attachmentKind === "examples" || opts.attachmentKind === "file") {
    covered.add("apis");
    covered.add("workflow");
  }

  // Light keyword boosts from the user's answer
  const lower = opts.latestUserContent.toLowerCase();
  if (/(crm|salesforce|hubspot|shopify|erp|slack|email|gmail|sheets?)/.test(lower)) {
    covered.add("systems");
  }
  if (/(api|endpoint|webhook|oauth|token|swagger|openapi)/.test(lower)) {
    covered.add("apis");
  }
  if (/(then |after that|first |step |when |trigger)/.test(lower)) {
    covered.add("workflow");
  }
  if (/(error|fail|retry|duplicate|missing|edge)/.test(lower)) {
    covered.add("edge_cases");
  }
  if (/(accept|must |should |criteria|done when)/.test(lower)) {
    covered.add("acceptance");
  }
  if (opts.latestUserContent.trim().length > 40 && !covered.has("goals")) {
    covered.add("goals");
  }

  meta = {
    ...meta,
    coveredTopics: [...covered],
  };

  const next = nextPlanningTopic(meta);
  if (!next) {
    const summaryBits = [
      meta.apiDocsUrl ? "API docs link on file" : null,
      meta.docsText ? "documentation notes saved" : null,
      meta.examples ? "examples saved" : null,
    ].filter(Boolean);

    return {
      nextMeta: { ...meta, lastQuestionTopic: "acceptance" },
      content: [
        "Got it — that covers the main planning areas.",
        summaryBits.length
          ? `I also have ${summaryBits.join(", ")}.`
          : "If you still have docs or examples, attach them now.",
        "",
        "Here's what I'd draft for a developer:",
        "• Goal and systems involved",
        "• Workflow and integrations",
        "• Edge cases and acceptance checks",
        "",
        "Anything you'd like to refine, or are you ready to **Submit to developer for building**?",
        "",
        "Koda is AI and can make mistakes.",
      ].join("\n"),
    };
  }

  const ack =
    opts.attachmentKind === "api_docs_url"
      ? "Thanks — I've saved that API docs link."
      : opts.attachmentKind === "docs_text"
        ? "Thanks — I've added those docs to the plan."
        : opts.attachmentKind === "examples"
          ? "Thanks — those examples help a lot."
          : opts.attachmentKind === "file"
            ? "Thanks — I've pulled that file into the plan notes."
            : "Got it.";

  const question = pickQuestion(next, meta.coveredTopics ?? []);

  return {
    nextMeta: { ...meta, lastQuestionTopic: next },
    content: [
      ack,
      "",
      question,
      next === "apis"
        ? "\nTip: use the chips below to attach a docs URL, paste text, or upload a file."
        : "",
      "",
      "Koda is AI and can make mistakes.",
    ]
      .filter((line) => line !== "")
      .join("\n"),
  };
}

/** System prompt snippet for live plan-mode agents. */
export function planningAgentInstructions(): string {
  return [
    "You are Koda in PLANNING mode only. Do not implement or write production code.",
    "Have a back-and-forth conversation: ask clarifying questions one or a few at a time.",
    "Cover: goals, systems, APIs, workflow, edge cases, and acceptance criteria.",
    "Invite the client to attach API docs URLs, paste examples, or upload files when useful.",
    "When the plan feels solid, remind them they can Submit to developer for building.",
    "Never mention Cursor, GitHub, Railway, or internal tooling by name.",
    "Remind briefly that Koda is AI and can make mistakes when appropriate.",
  ].join("\n");
}
