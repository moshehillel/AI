/**
 * Automation Studio — Railway Infrastructure as Code.
 *
 * Defines Postgres + Redis + web + worker for the production environment.
 * Docker builds use Dockerfile.web / Dockerfile.worker (set by scripts/railway-bootstrap.sh
 * via `build.dockerfilePath` — the IaC DSL does not yet express Dockerfile builder paths).
 *
 * Preview:  railway config plan
 * Apply:    railway config apply   (only after reviewing the plan)
 */
import {
  defineRailway,
  github,
  group,
  postgres,
  project,
  redis,
  service,
} from "railway/iac";

const REPO = "moshehillel/AI";

/** Shared demo-mode vars so the first deploy works without Clerk/Cursor/GitHub. */
const demoEnv = {
  NODE_ENV: "production",
  ALLOW_DEMO_AUTH: "1",
  NEXT_PUBLIC_ALLOW_DEMO_AUTH: "1",
  CURSOR_MOCK: "1",
  GITHUB_MOCK: "1",
  RAILWAY_MOCK: "1",
  NEXT_TELEMETRY_DISABLED: "1",
} as const;

export default defineRailway(() => {
  const db = postgres("Postgres");
  const cache = redis("Redis");

  const web = service("web", {
    source: github(REPO),
    // Dockerfile.web is configured by bootstrap (dockerfilePath). Start/health
    // here document intent and apply if Railpack is used instead.
    start:
      "pnpm --filter @automation-studio/db exec prisma migrate deploy && pnpm --filter @automation-studio/web start",
    healthcheck: "/api/health",
    healthcheckTimeout: 30,
    env: {
      ...demoEnv,
      PORT: "3000",
      HOSTNAME: "0.0.0.0",
      DATABASE_URL: db.env.DATABASE_URL,
      REDIS_URL: cache.env.REDIS_URL,
      // Set once via bootstrap / dashboard (openssl rand -hex 32). Not committed.
      // ENCRYPTION_KEY is applied by scripts/railway-bootstrap.sh
      NEXT_PUBLIC_APP_URL: "https://placeholder.up.railway.app",
    },
  });

  const worker = service("worker", {
    source: github(REPO),
    start: "pnpm --filter @automation-studio/worker start",
    env: {
      ...demoEnv,
      DATABASE_URL: db.env.DATABASE_URL,
      REDIS_URL: cache.env.REDIS_URL,
    },
  });

  const data = group("Data", [db, cache]);
  const app = group("App", [web, worker]);

  return project("automation-studio", {
    resources: [data, app],
  });
});
