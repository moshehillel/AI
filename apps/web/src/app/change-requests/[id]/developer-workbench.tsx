"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

type BuildSetup = {
  serverLabel?: string;
  autoDeploy?: boolean;
  testImproveGranted?: boolean;
  openInWebUrl?: string | null;
  openInCursorUrl?: string | null;
  planAgentId?: string | null;
  buildAgentId?: string | null;
};

type SecretMeta = { keyName: string; createdAt?: string };

export function DeveloperWorkbench({
  changeRequestId,
  status,
  buildSetup,
  branchName,
  previewUrl,
  hasPlan,
  initialSecrets = [],
}: {
  changeRequestId: string;
  status: string;
  buildSetup: BuildSetup;
  branchName?: string | null;
  previewUrl?: string | null;
  hasPlan: boolean;
  initialSecrets?: SecretMeta[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [serverLabel, setServerLabel] = useState(
    buildSetup.serverLabel ?? "Production server",
  );
  const [autoDeploy, setAutoDeploy] = useState(buildSetup.autoDeploy ?? true);
  const [confirmGrant, setConfirmGrant] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cursorLinks, setCursorLinks] = useState<{
    openInCursorUrl?: string;
    openInWebUrl?: string;
  }>({
    openInCursorUrl: buildSetup.openInCursorUrl ?? undefined,
    openInWebUrl: buildSetup.openInWebUrl ?? undefined,
  });
  const [secrets, setSecrets] = useState<SecretMeta[]>(initialSecrets);
  const [revealed, setRevealed] = useState<{
    keyName: string;
    value: string;
  } | null>(null);
  const [revealBusy, setRevealBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setSecrets(initialSecrets);
  }, [initialSecrets]);

  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => {
      setRevealed(null);
      setCopied(false);
    }, 60_000);
    return () => clearTimeout(t);
  }, [revealed]);

  const awaitingBuild =
    status === "AWAITING_DEV_BUILD" || status === "CHANGES_REQUESTED";
  const building = status === "BUILDING";
  const testImproveOpen =
    Boolean(buildSetup.testImproveGranted) || status === "TESTING";

  async function postAction(action: string, extra?: Record<string, unknown>) {
    setActionError(null);
    const res = await fetch(`/api/change-requests/${changeRequestId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      openInCursorUrl?: string;
      openInWebUrl?: string;
      testImproveGranted?: boolean;
      pending?: boolean;
      message?: string;
    };
    if (!res.ok) {
      setActionError(data.error ?? "Action failed — try again.");
      return null;
    }
    if (data.openInCursorUrl || data.openInWebUrl) {
      setCursorLinks({
        openInCursorUrl: data.openInCursorUrl,
        openInWebUrl: data.openInWebUrl,
      });
    }
    if (data.pending && data.message) {
      setActionError(data.message);
    }
    return data;
  }

  function run(action: string, extra?: Record<string, unknown>) {
    startTransition(async () => {
      const data = await postAction(action, extra);
      if (!data) return;
      if (action === "open_in_cursor" && data.openInCursorUrl) {
        window.open(data.openInCursorUrl, "_blank", "noopener,noreferrer");
      }
      setConfirmGrant(false);
      router.refresh();
    });
  }

  async function revealSecret(keyName: string) {
    setRevealBusy(keyName);
    setActionError(null);
    setCopied(false);
    try {
      const res = await fetch(
        `/api/change-requests/${changeRequestId}/secrets/reveal`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyName }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        keyName?: string;
        value?: string;
      };
      if (!res.ok || !data.value || !data.keyName) {
        setActionError(data.error ?? "Could not reveal secret.");
        setRevealed(null);
        return;
      }
      setRevealed({ keyName: data.keyName, value: data.value });
    } catch {
      setActionError("Could not reveal secret.");
    } finally {
      setRevealBusy(null);
    }
  }

  async function copyRevealed() {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed.value);
      setCopied(true);
      setTimeout(() => {
        setRevealed(null);
        setCopied(false);
      }, 1500);
    } catch {
      setActionError("Clipboard copy failed — select and copy manually.");
    }
  }

  return (
    <div className="dev-workbench panel space-y-4 p-5">
      <div>
        <p className="muted text-xs uppercase tracking-[0.12em]">Developer</p>
        <h2 className="brand-mark text-xl">Build desk</h2>
        <p className="muted mt-1 text-sm">
          Review the customer plan in Cursor, build, then grant a Test &amp;
          Improve workspace with code edit and deploy access.
        </p>
      </div>

      {!hasPlan ? (
        <p className="text-sm text-[var(--warn)]">
          No living plan yet — open anyway to start a plan session from the
          brief.
        </p>
      ) : null}

      <div className="space-y-2 rounded-xl border border-[var(--line)] bg-black/15 p-3">
        <p className="text-sm muted">Customer secrets</p>
        {secrets.length === 0 ? (
          <p className="text-sm muted">
            None yet. When the customer uses Add secrets / credentials, names
            appear here. Reveal / copy-once for build — never commit values.
          </p>
        ) : (
          <ul className="space-y-2">
            {secrets.map((s) => (
              <li
                key={s.keyName}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <code className="text-xs">{s.keyName}</code>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={Boolean(revealBusy) || pending}
                  onClick={() => void revealSecret(s.keyName)}
                >
                  {revealBusy === s.keyName ? "Decrypting…" : "Reveal"}
                </button>
              </li>
            ))}
          </ul>
        )}
        {revealed ? (
          <div className="space-y-2 rounded-lg border border-[var(--warn)]/40 bg-black/25 p-3">
            <p className="text-xs muted">
              Revealed <code>{revealed.keyName}</code> — copy once, then it
              clears. Never paste into git / PR bodies.
            </p>
            <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all text-xs">
              {revealed.value}
            </pre>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void copyRevealed()}
              >
                {copied ? "Copied — clearing…" : "Copy once"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setRevealed(null);
                  setCopied(false);
                }}
              >
                Hide
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        <button
          type="button"
          className="btn btn-primary w-full"
          disabled={pending}
          onClick={() => run("open_in_cursor")}
        >
          Open in Cursor
        </button>
        <p className="muted text-xs">
          Opens / resumes the plan in Cursor — secret <em>names</em> are
          included; decrypt values here on the Build desk.
        </p>
        {cursorLinks.openInCursorUrl || cursorLinks.openInWebUrl ? (
          <div className="flex flex-wrap gap-2">
            {cursorLinks.openInCursorUrl ? (
              <a
                className="btn btn-ghost"
                href={cursorLinks.openInCursorUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open in Cursor app
              </a>
            ) : null}
            {cursorLinks.openInWebUrl ? (
              <a
                className="btn btn-ghost"
                href={cursorLinks.openInWebUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open agent in browser
              </a>
            ) : null}
          </div>
        ) : null}
      </div>

      {awaitingBuild ? (
        <div className="space-y-3 rounded-xl border border-[var(--line)] bg-black/15 p-3">
          <p className="text-sm muted">1. Build</p>
          <input
            className="field"
            value={serverLabel}
            onChange={(e) => setServerLabel(e.target.value)}
            placeholder="Server / environment label"
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoDeploy}
              onChange={(e) => setAutoDeploy(e.target.checked)}
            />
            Auto-deploy preview on push
          </label>
          <button
            type="button"
            className="btn btn-primary w-full"
            disabled={pending}
            onClick={() => run("start_build", { serverLabel, autoDeploy })}
          >
            Build
          </button>
        </div>
      ) : null}

      {(building || status === "TESTING") && !buildSetup.testImproveGranted ? (
        <div className="space-y-3 rounded-xl border border-[var(--line)] bg-black/15 p-3">
          <p className="text-sm muted">2. Permission</p>
          {!confirmGrant ? (
            <button
              type="button"
              className="btn btn-ghost w-full"
              disabled={pending}
              onClick={() => setConfirmGrant(true)}
            >
              Grant Test &amp; Improve workspace?
            </button>
          ) : (
            <>
              <p className="text-sm">
                This opens a Test &amp; Improve session with access to edit
                code and deploy. Confirm only when you intend to work the
                build.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={pending}
                  onClick={() =>
                    run("grant_test_improve", { confirmGrant: true })
                  }
                >
                  Yes, open Test &amp; Improve
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={pending}
                  onClick={() => setConfirmGrant(false)}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {testImproveOpen ? (
        <div className="test-improve-pane space-y-3 rounded-xl border border-[var(--accent)]/35 bg-[color-mix(in_oklab,var(--accent)_8%,transparent)] p-4">
          <div>
            <p className="muted text-xs uppercase tracking-[0.12em]">
              Test &amp; Improve
            </p>
            <h3 className="text-lg font-medium">Workspace unlocked</h3>
            <p className="muted mt-1 text-sm">
              Edit and iterate in Cursor. Deploy when ready. The customer
              verifies in Koda chat — they never see this desk.
            </p>
          </div>
          {branchName ? (
            <p className="text-sm">
              <span className="muted">Branch:</span> {branchName}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {(cursorLinks.openInCursorUrl || buildSetup.openInCursorUrl) && (
              <a
                className="btn btn-primary"
                href={
                  cursorLinks.openInCursorUrl ??
                  buildSetup.openInCursorUrl ??
                  "#"
                }
                target="_blank"
                rel="noreferrer"
              >
                Continue in Cursor
              </a>
            )}
            {(cursorLinks.openInWebUrl || buildSetup.openInWebUrl) && (
              <a
                className="btn btn-ghost"
                href={
                  cursorLinks.openInWebUrl ?? buildSetup.openInWebUrl ?? "#"
                }
                target="_blank"
                rel="noreferrer"
              >
                Agent in browser
              </a>
            )}
            {previewUrl ? (
              <a
                className="btn btn-ghost"
                href={previewUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open preview
              </a>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost"
              disabled={pending}
              onClick={() => run("approve_deploy")}
            >
              Deploy
            </button>
          </div>
        </div>
      ) : null}

      {actionError ? (
        <p className="text-sm text-[var(--danger)]">{actionError}</p>
      ) : null}
    </div>
  );
}
