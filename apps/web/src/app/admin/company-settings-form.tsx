"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function CompanySettingsForm({
  initial,
}: {
  initial: {
    usageSoftCapCents?: number | null;
    usageSoftCapTokens?: number | null;
    allowAdminDeploy?: boolean;
  };
}) {
  const router = useRouter();
  const [usageSoftCapCents, setUsageSoftCapCents] = useState(
    initial.usageSoftCapCents?.toString() ?? "",
  );
  const [usageSoftCapTokens, setUsageSoftCapTokens] = useState(
    initial.usageSoftCapTokens?.toString() ?? "",
  );
  const [allowAdminDeploy, setAllowAdminDeploy] = useState(
    Boolean(initial.allowAdminDeploy),
  );
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <form
      className="mt-4 grid gap-3 md:grid-cols-3"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const response = await fetch("/api/company/settings", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              usageSoftCapCents: usageSoftCapCents
                ? Number(usageSoftCapCents)
                : null,
              usageSoftCapTokens: usageSoftCapTokens
                ? Number(usageSoftCapTokens)
                : null,
              allowAdminDeploy,
            }),
          });
          setMessage(response.ok ? "Saved" : "Failed to save");
          router.refresh();
        });
      }}
    >
      <label className="text-sm">
        <span className="muted">Monthly soft cap (¢)</span>
        <input
          className="field mt-1"
          value={usageSoftCapCents}
          onChange={(e) => setUsageSoftCapCents(e.target.value)}
          placeholder="e.g. 50000"
        />
      </label>
      <label className="text-sm">
        <span className="muted">Monthly soft cap (tokens)</span>
        <input
          className="field mt-1"
          value={usageSoftCapTokens}
          onChange={(e) => setUsageSoftCapTokens(e.target.value)}
          placeholder="e.g. 2000000"
        />
      </label>
      <label className="flex items-end gap-2 text-sm">
        <input
          type="checkbox"
          checked={allowAdminDeploy}
          onChange={(e) => setAllowAdminDeploy(e.target.checked)}
        />
        Allow admin production deploy
      </label>
      <button className="btn btn-primary md:col-span-3" disabled={pending}>
        Save settings
      </button>
      {message ? <p className="muted text-sm md:col-span-3">{message}</p> : null}
    </form>
  );
}
