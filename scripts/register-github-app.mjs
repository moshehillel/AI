#!/usr/bin/env node
/**
 * GitHub App manifest registration — works without visiting Railway (NetFree-safe).
 *
 * Usage:
 *   pnpm register:github-app
 *   APP_URL=https://web-production-98ce0.up.railway.app GITHUB_APP_ORG=moshehillel pnpm register:github-app
 *   pnpm register:github-app -- --code=YOUR_ONE_TIME_CODE
 *   pnpm register:github-app -- --mode=local
 *
 * Modes (default: github-only):
 *   github-only — writes register-github-app.html; only github.com is opened in the browser
 *   local       — localhost callback server on port 8765 (original flow)
 *
 * After creating the app on GitHub, copy the `code` query param from the redirect URL
 * and run with --code=… to exchange credentials and write Railway variables.
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildGitHubAppManifest,
  buildGitHubAppManifestStartHtml,
  convertGitHubAppManifestCode,
  getGitHubAppManifestFormAction,
  getGitHubAppManifestRedirectUrl,
  manifestToEnvVars,
} from "@automation-studio/github";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const args = process.argv.slice(2);
const modeArg = args.find((a) => a.startsWith("--mode="))?.split("=")[1];
const codeArg = args.find((a) => a.startsWith("--code="))?.split("=")[1];

const APP_URL = (
  process.env.APP_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  "http://localhost:3000"
).replace(/\/$/, "");
const PORT = Number(process.env.GITHUB_MANIFEST_PORT ?? 8765);
const ORG = process.env.GITHUB_APP_ORG;
const APP_NAME = process.env.GITHUB_APP_NAME ?? "Automation Studio";
const SET_RAILWAY = process.env.SKIP_RAILWAY !== "1";
const MODE = modeArg ?? process.env.GITHUB_MANIFEST_MODE ?? "github-only";

function setRailwayVar(service, key, value) {
  const result = spawnSync(
    "railway",
    ["variable", "set", "--service", service, `${key}=${value}`],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      result.stderr || result.stdout || `Failed to set ${key} on ${service}`,
    );
  }
}

function applyToRailway(creds) {
  const vars = manifestToEnvVars(creds);
  for (const service of ["web", "worker"]) {
    for (const [key, value] of Object.entries(vars)) {
      setRailwayVar(service, key, value);
    }
  }
}

async function exchangeCode(code) {
  const creds = await convertGitHubAppManifestCode(code);
  if (SET_RAILWAY) {
    applyToRailway(creds);
  }
  return creds;
}

function html(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>GitHub App</title></head><body>${body}</body></html>`;
}

function buildManifest(redirectUrl) {
  return buildGitHubAppManifest({
    appUrl: APP_URL,
    appName: APP_NAME,
    org: ORG,
    redirectUrl,
  });
}

async function runCodeExchange() {
  if (!codeArg) {
    console.error("Missing --code=… (one-time code from GitHub redirect URL)");
    process.exit(1);
  }
  try {
    const creds = await exchangeCode(codeArg);
    console.log(
      JSON.stringify(
        {
          slug: creds.slug,
          id: creds.id,
          html_url: creds.html_url,
          install_url: `https://github.com/apps/${creds.slug}/installations/new`,
          railway: SET_RAILWAY ? "updated web + worker" : "skipped (SKIP_RAILWAY=1)",
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

function runGithubOnly() {
  const state = randomBytes(16).toString("hex");
  const redirectUrl = getGitHubAppManifestRedirectUrl(ORG);
  const manifest = buildManifest(redirectUrl);
  const formAction = getGitHubAppManifestFormAction(ORG);
  const page = buildGitHubAppManifestStartHtml({ manifest, org: ORG, state });
  const outPath = join(root, "register-github-app.html");

  writeFileSync(outPath, page, "utf8");

  console.log("GitHub App registration (NetFree-safe — no Railway URL required)\n");
  console.log(`App URL (webhooks/callbacks): ${APP_URL}`);
  console.log(`Org: ${ORG ?? "(your GitHub user account)"}`);
  console.log(`Post-create redirect: ${redirectUrl}?code=…&state=…`);
  console.log(`GitHub form target: ${formAction}\n`);
  console.log("Steps:");
  console.log("  1. Save as register-github-app.html (not .txt).");
  console.log("  2. Right-click → Open with → Chrome/Edge.");
  console.log("  3. Click Continue to GitHub (no auto-redirect). Only github.com is contacted.");
  console.log("  4. Sign into GitHub as an org owner (moshehillel) if prompted.");
  console.log("  5. Review the pre-filled app and click Create GitHub App.");
  console.log("  6. GitHub redirects to github.com/settings/apps?code=ONE_TIME_CODE&state=…");
  console.log("     Copy the code value from the address bar.");
  console.log("  7. Paste the code to the cloud agent, or run:");
  console.log(`     APP_URL=${APP_URL}${ORG ? ` GITHUB_APP_ORG=${ORG}` : ""} pnpm register:github-app -- --code=PASTE_CODE_HERE`);
  console.log(`\nWrote ${outPath}`);
}

async function runLocalServer() {
  const state = randomBytes(16).toString("hex");
  const redirectUrl = `http://127.0.0.1:${PORT}/callback`;
  const manifest = buildManifest(redirectUrl);
  const formAction = getGitHubAppManifestFormAction(ORG);
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
        const creds = await exchangeCode(code);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html(`
          <h1>GitHub App registered</h1>
          <p>App: <strong>${creds.slug}</strong> (id ${creds.id})</p>
          <p>${SET_RAILWAY ? "Railway variables updated on web + worker." : "Set Railway variables manually (see docs/github-app-setup.md)."}</p>
          <p>Install: <a href="https://github.com/apps/${creds.slug}/installations/new">https://github.com/apps/${creds.slug}/installations/new</a></p>
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
}

if (codeArg) {
  await runCodeExchange();
} else if (MODE === "local") {
  await runLocalServer();
} else if (MODE === "github-only") {
  runGithubOnly();
} else {
  console.error(`Unknown mode: ${MODE}. Use github-only or local.`);
  process.exit(1);
}
