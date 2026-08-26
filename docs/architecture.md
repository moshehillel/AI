# Architecture

## Overview

Automation Studio is a Next.js + worker platform that orchestrates:

1. Employee change requests (chat UX)
2. Risk classification
3. GitHub feature branches (`ai/{user}/{task}-{slug}`)
4. Cursor Cloud Agents (`@cursor/sdk`) on those branches
5. PR + CI checks
6. Railway preview environments
7. Developer review and merge to protected `main`

## Runtime components

| Component | Responsibility |
|---|---|
| `apps/web` | Branded UI, auth, APIs, webhooks |
| `workers/runner` | Long-running BullMQ jobs (Cursor/GitHub/Railway) |
| `packages/*` | Shared domain, DB, adapters |

## Change request state machine

See `@automation-studio/domain` `status.ts` for allowed transitions.

Employee-facing labels hide Git concepts. Developers see branch/PR/check details.

## Cursor integration

- Prefer `@cursor/sdk` Cloud Agents API v1 concepts (durable agent + runs)
- Pre-create `ai/...` branch via GitHub App
- Start agent with `workOnCurrentBranch: true`
- Plan mode for COMPLEX; developer gate for HIGH_RISK before implement
- Persist `cursorAgentId` and resume for follow-ups
- Mock mode: `CURSOR_MOCK=1` or missing `CURSOR_API_KEY`

## GitHub integration

- GitHub App installation tokens (least privilege)
- Create branch, open PR, read checks, merge
- Webhook endpoint: `/api/webhooks/github`
- Mock mode: `GITHUB_MOCK=1` or missing `GITHUB_APP_ID`

## Railway previews

- Preferred: managed PR Environments inheriting **staging/preview-base** (never production secrets)
- Enable Bot PR Environments for AI-created PRs
- Platform stores preview URL for `[Open Test Version]`
- Mock mode: `RAILWAY_MOCK=1` or missing `RAILWAY_API_TOKEN`

## Multi-tenancy

Every company-owned row is scoped by `companyId`. Authorization checks:

1. Clerk session / demo auth
2. Company membership + role
3. Project membership for employees
4. Permission for the specific action
