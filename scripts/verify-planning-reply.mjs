/** Live smoke test: long text-only planning message gets a real Koda reply. */
const BASE = process.env.KODA_BASE_URL ?? "https://koda.advancedautomations.net";

const STAFFING_EXCERPT = `NYC Early Intervention staffing workflow (long verify paste):
Each week our coordinators pull authorized service hours from the municipal EI portal,
match them against therapist caseloads in our scheduling spreadsheet, and email branch
managers when a slot is unfilled or a therapist is over capacity. We need this to run
automatically every Monday at 6am, flag exceptions in red, and post a summary to Slack
#ei-staffing. Systems involved: NYC EI portal (browser login), Google Sheets master roster,
Slack workspace. Edge cases: duplicate authorizations, therapists on PTO, new intakes with
missing Medicaid IDs. Success = managers get one consolidated report without manual exports.

Additional detail for robustness testing — branch managers currently re-check the portal
when email totals look wrong, which adds 2–3 hours every Monday. Therapists on PTO should
still appear on the roster but flagged as unavailable. New intakes missing Medicaid IDs
should land in a separate "needs data" tab, not block the main report. If the portal export
format changes, we need a visible error in Slack rather than silent bad numbers. Coordinators
also want a CSV attachment alongside the Slack summary for archiving.`.repeat(2);

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const projectsRes = await fetch(`${BASE}/api/change-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: process.env.PROJECT_ID,
      kind: "PROGRAM",
      title: "Staffing verify " + Date.now(),
      prompt: "Quick hello to start planning.",
    }),
  }).catch(() => null);

  let crId = process.env.CHANGE_REQUEST_ID;

  if (!crId) {
    // Discover project via onboard page data — fallback create needs PROJECT_ID
    const onboard = await fetch(`${BASE}/onboarding`, { redirect: "follow" });
    const html = await onboard.text();
    const m = html.match(/"projectId":"([^"]+)"/);
    const projectId = process.env.PROJECT_ID ?? m?.[1];
    if (!projectId) {
      throw new Error("Set PROJECT_ID or CHANGE_REQUEST_ID for live verify");
    }
    const createRes = await fetch(`${BASE}/api/change-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        kind: "PROGRAM",
        title: "Staffing verify " + Date.now(),
        prompt: "Quick hello to start planning.",
      }),
    });
    if (!createRes.ok) {
      throw new Error(`create failed ${createRes.status}: ${await createRes.text()}`);
    }
    const created = await createRes.json();
    crId = created.changeRequest?.id ?? created.id;
    console.log("created", crId);
    await sleep(25000);
  }

  const msgRes = await fetch(`${BASE}/api/change-requests/${crId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: STAFFING_EXCERPT }),
  });
  if (!msgRes.ok) {
    throw new Error(`message failed ${msgRes.status}: ${await msgRes.text()}`);
  }
  const msgJson = await msgRes.json();
  const userMsgId = msgJson.message?.id;
  const sentAt = msgJson.message?.createdAt ?? new Date().toISOString();
  console.log("sent long message to", crId, "userMsgId", userMsgId);

  for (let i = 0; i < 90; i += 1) {
    await sleep(4000);
    const res = await fetch(`${BASE}/api/change-requests/${crId}`);
    if (!res.ok) continue;
    const cr = await res.json();
    const messages = cr.messages ?? [];
    const userIdx = messages.findIndex((m) => m.id === userMsgId);
    const afterUser = userIdx >= 0 ? messages.slice(userIdx + 1) : messages.filter((m) => m.createdAt >= sentAt);
    const lastAssistant = [...afterUser].reverse().find((m) => m.role === "ASSISTANT");
    if (lastAssistant) {
      const bad = /couldn't finish that reply|finished without a reply/i.test(
        lastAssistant.content,
      );
      console.log(
        JSON.stringify({
          ok: !bad,
          crId,
          assistantPreview: lastAssistant.content.slice(0, 280),
          bad,
        }),
      );
      process.exit(bad ? 1 : 0);
    }
    process.stdout.write(".");
  }
  throw new Error("timeout waiting for assistant reply");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
