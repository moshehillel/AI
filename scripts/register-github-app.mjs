#!/usr/bin/env node
/**
 * Local GitHub App manifest registration helper.
 * Opens a one-shot localhost callback, converts the manifest code, and
 * optionally writes Railway variables via the CLI.
 *
 * Usage:
 *   node scripts/register-github-app.mjs
 *   APP_URL=https://web-production-98ce0.up.railway.app node scripts/register-github-app.mjs
 *
 * For production, prefer the hosted flow:
 *   https://<app>/api/github/app-manifest/start
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const APP_URL = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const PORT = Number(process.env.GITHUB_MANIFEST_PORT ?? 8765);
const ORG = process.env.GITHUB_APP_ORG;
const APP_NAME = process.env.GITHUB_APP_NAME ?? "Automation Studio";
const SET_RAILWAY = process.env.SKIP_RAILWAY !== "1";

const manifest = {
  name: APP_NAME,
  url: APP_URL,
  description: "Automation Studio — AI-assisted change requests with branch/PR workflows.",
  public: false,
  hook_attributes: {
    url: `${APP_URL}/api/webhooks/github`,
    active: true,
  },
  redirect_url: `http://127.0.0.1:${PORT}/callback`,
  callback_urls: [`${APP_URL}/api/github/install/callback`],
  setup_url: `${APP_URL}/api/github/install/callback`,
  default_permissions: {
    contents: "write",
    pull_requests: "write",
    statuses: "read",
    checks: "read",
    administration: "read",
  },
  default_events: ["pull_request", "check_suite", "check_run", "status"],
};

const formAction = ORG
  ? `https://github.com/organizations/${encodeURIComponent(ORG)}/settings/apps/new`
  : "https://github.com/settings/apps/new";

function html(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>GitHub App</title></head><body>${body}</body></html>`;
}

async function convertCode(code) {
  const res = await fetch(
    `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "automation-studio-register",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Conversion failed (${res.status}): ${text}`);
  }
  return JSON.parse(text);
}

function setRailwayVar(service, key, value) {
  const result = spawnSync(
    "railway",
    ["variable", "set", "--service", service, `${key}=${value}`],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Failed to set ${key} on ${service}`);
  }
}

function applyToRailway(creds) {
  const vars = {
    GITHUB_APP_ID: String(creds.id),
    GITHUB_APP_SLUG: creds.slug,
    GITHUB_APP_CLIENT_ID: creds.client_id,
    GITHUB_APP_CLIENT_SECRET: creds.client_secret,
    GITHUB_APP_WEBHOOK_SECRET: creds.webhook_secret,
    GITHUB_APP_PRIVATE_KEY: creds.pem.replace(/\n/g, "\\n"),
    GITHUB_MOCK: "0",
  };
  for (const service of ["web", "worker"]) {
    for (const [key, value] of Object.entries(vars)) {
      setRailwayVar(service, key, value);
    }
  }
}

const state = randomBytes(16).toString("hex");
const manifestJson = JSON.stringify(manifest);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

  if (url.pathname === "/start") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html(`
      <h1>Register GitHub App</h1>
      <p>Submitting manifest to GitHub…</p>
      <form id="f" action="${formAction}?state=${state}" method="post">
        <input type="hidden" name="manifest" id="manifest" />
      </form>
      <script>
        document.getElementById("manifest").value = ${JSON.stringify(manifestJson)};
        document.getElementById("f").submit();
      </script>
    `));
    return;
  }

  if (url.pathname === "/callback") {
    const code = url.searchParams.get("code");
    if (!code) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Missing code");
      server.close();
      return;
    }
    try {
      const creds = await convertCode(code);
      if (SET_RAILWAY) {
        applyToRailway(creds);
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html(`
        <h1>GitHub App registered</h1>
        <p>App: <strong>${creds.slug}</strong> (id ${creds.id})</p>
        <p>${SET_RAILWAY ? "Railway variables updated on web + worker." : "Set Railway variables manually (see docs/github-app-setup.md)."}</p>
        <p>You can close this tab.</p>
      `));
      console.log(JSON.stringify({ slug: creds.slug, id: creds.id }, null, 2));
    } catch (error) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(String(error instanceof Error ? error.message : error));
      console.error(error);
    }
    server.close();
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "127.0.0.1", () => {
  const startUrl = `http://127.0.0.1:${PORT}/start`;
  console.log(`Open in your browser (logged into GitHub): ${startUrl}`);
  console.log(`Manifest targets app URL: ${APP_URL}`);
});
