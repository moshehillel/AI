#!/usr/bin/env bash
# Bootstrap Automation Studio on Railway: Postgres + Redis + web + worker.
# Requires: railway CLI on PATH, RAILWAY_TOKEN or an interactive login.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PATH="${HOME}/.local/bin:${PATH}"

PROJECT_NAME="${RAILWAY_PROJECT_NAME:-automation-studio}"
WEB_SERVICE="${RAILWAY_WEB_SERVICE:-web}"
WORKER_SERVICE="${RAILWAY_WORKER_SERVICE:-worker}"
SKIP_DEPLOY="${SKIP_DEPLOY:-0}"
SKIP_SEED="${SKIP_SEED:-0}"

die() { echo "error: $*" >&2; exit 1; }

need_auth() {
  if ! railway whoami --json >/dev/null 2>&1; then
    if [[ -z "${RAILWAY_TOKEN:-}${RAILWAY_API_TOKEN:-}" ]]; then
      die "Not logged in. Set RAILWAY_TOKEN (or RAILWAY_API_TOKEN) and retry, or run: railway login"
    fi
  fi
}

service_exists() {
  local name="$1"
  railway service list --json 2>/dev/null | grep -q "\"name\":\"${name}\"" \
    || railway service list --json 2>/dev/null | grep -q "\"${name}\""
}

echo "==> Checking Railway auth"
need_auth
railway whoami 2>/dev/null || true

# Link or create project
if ! railway status --json >/dev/null 2>&1; then
  echo "==> Creating project: ${PROJECT_NAME}"
  railway init --name "${PROJECT_NAME}" --json || railway init --name "${PROJECT_NAME}"
else
  echo "==> Using linked Railway project"
  railway status || true
fi

echo "==> Ensuring Postgres + Redis"
EXISTING="$(railway service list --json 2>/dev/null || echo '[]')"
if ! echo "$EXISTING" | grep -qiE 'postgres|PostgreSQL'; then
  railway add --database postgres --json
else
  echo "    Postgres already present"
fi
if ! echo "$EXISTING" | grep -qiE 'redis|Redis'; then
  # Re-list after possible postgres add
  EXISTING="$(railway service list --json 2>/dev/null || echo '[]')"
  if ! echo "$EXISTING" | grep -qiE 'redis|Redis'; then
    railway add --database redis --json
  else
    echo "    Redis already present"
  fi
else
  echo "    Redis already present"
fi

# Resolve DB service names (Railway default names: Postgres, Redis)
PG_NAME="$(railway service list --json 2>/dev/null | python3 -c '
import json,sys
try:
  data=json.load(sys.stdin)
except Exception:
  data=[]
items=data if isinstance(data,list) else data.get("services",data.get("data",[]))
for s in items or []:
  name=s.get("name") or s.get("serviceName") or ""
  if "postgres" in name.lower() or "postgresql" in name.lower():
    print(name); break
' 2>/dev/null || true)"
PG_NAME="${PG_NAME:-Postgres}"

REDIS_NAME="$(railway service list --json 2>/dev/null | python3 -c '
import json,sys
try:
  data=json.load(sys.stdin)
except Exception:
  data=[]
items=data if isinstance(data,list) else data.get("services",data.get("data",[]))
for s in items or []:
  name=s.get("name") or s.get("serviceName") or ""
  if "redis" in name.lower():
    print(name); break
' 2>/dev/null || true)"
REDIS_NAME="${REDIS_NAME:-Redis}"

echo "    Postgres service: ${PG_NAME}"
echo "    Redis service:    ${REDIS_NAME}"

ensure_empty_service() {
  local name="$1"
  EXISTING="$(railway service list --json 2>/dev/null || echo '[]')"
  if echo "$EXISTING" | grep -q "\"${name}\""; then
    echo "    Service ${name} already present"
  else
    echo "    Creating service ${name}"
    railway add --service "${name}" --json
  fi
}

echo "==> Ensuring web + worker services"
ensure_empty_service "${WEB_SERVICE}"
ensure_empty_service "${WORKER_SERVICE}"

echo "==> Configuring Dockerfiles (separate files — no dockerBuildTarget)"
# Prefer GraphQL: CLI `environment edit` path aliases are unreliable for dockerfilePath.
set_service_instance() {
  local service_name="$1"
  shift
  local service_id
  service_id="$(railway service list --json 2>/dev/null | python3 -c '
import json,sys
name=sys.argv[1]
data=json.load(sys.stdin)
items=data if isinstance(data,list) else []
for s in items:
  if s.get("name")==name:
    print(s.get("id","")); break
' "${service_name}" 2>/dev/null || true)"
  if [[ -z "${service_id}" ]]; then
    # Fallback: resolve from railway status when service list omits undeployed services
    service_id="$(railway status --json 2>/dev/null | python3 -c '
import json,sys
name=sys.argv[1]
d=json.load(sys.stdin)
for e in d.get("services",{}).get("edges",[]):
  n=e.get("node") or {}
  if n.get("name")==name:
    print(n.get("id","")); break
' "${service_name}" 2>/dev/null || true)"
  fi
  [[ -n "${service_id}" ]] || die "Could not resolve service id for ${service_name}"

  local env_id
  env_id="$(railway status --json 2>/dev/null | python3 -c '
import json,sys
d=json.load(sys.stdin)
edges=(d.get("environments") or {}).get("edges") or []
print((edges[0].get("node") or {}).get("id","") if edges else "")
' 2>/dev/null || true)"
  [[ -n "${env_id}" ]] || die "Could not resolve environment id"

  local token
  token="$(python3 -c 'import json; print(json.load(open(__import__("os").path.expanduser("~/.railway/config.json")))["user"].get("accessToken") or json.load(open(__import__("os").path.expanduser("~/.railway/config.json")))["user"].get("token") or "")' 2>/dev/null || true)"
  [[ -n "${token}" ]] || die "No Railway access token; run railway login"

  local input_json="$1"
  curl -sS https://backboard.railway.com/graphql/v2 \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${token}" \
    --data-binary @- <<EOF | python3 -c 'import json,sys; d=json.load(sys.stdin); 
assert not d.get("errors"), d; assert d.get("data",{}).get("serviceInstanceUpdate") is True, d'
{"query":"mutation(\$serviceId:String!,\$environmentId:String,\$input:ServiceInstanceUpdateInput!){ serviceInstanceUpdate(serviceId:\$serviceId, environmentId:\$environmentId, input:\$input) }","variables":{"serviceId":"${service_id}","environmentId":"${env_id}","input":${input_json}}}
EOF
}

set_service_instance "${WEB_SERVICE}" '{"dockerfilePath":"Dockerfile.web","healthcheckPath":"/api/health","healthcheckTimeout":30}'
set_service_instance "${WORKER_SERVICE}" '{"dockerfilePath":"Dockerfile.worker"}'
echo "    web -> Dockerfile.web (+ /api/health)"
echo "    worker -> Dockerfile.worker"

ENCRYPTION_KEY_VALUE="${ENCRYPTION_KEY:-}"
if [[ -z "${ENCRYPTION_KEY_VALUE}" ]]; then
  ENCRYPTION_KEY_VALUE="$(openssl rand -hex 32)"
  echo "==> Generated ENCRYPTION_KEY (store securely; not printed again in CI logs if you set ENCRYPTION_KEY yourself)"
fi

set_shared_vars() {
  local svc="$1"
  railway variable set \
    --service "${svc}" \
    NODE_ENV=production \
    ALLOW_DEMO_AUTH=1 \
    NEXT_PUBLIC_ALLOW_DEMO_AUTH=1 \
    CURSOR_MOCK=1 \
    GITHUB_MOCK=1 \
    RAILWAY_MOCK=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    "DATABASE_URL=\${{${PG_NAME}.DATABASE_URL}}" \
    "REDIS_URL=\${{${REDIS_NAME}.REDIS_URL}}" \
    "ENCRYPTION_KEY=${ENCRYPTION_KEY_VALUE}"
}

echo "==> Setting demo-mode env on web + worker"
set_shared_vars "${WEB_SERVICE}"
set_shared_vars "${WORKER_SERVICE}"
railway variable set --service "${WEB_SERVICE}" PORT=3000 HOSTNAME=0.0.0.0

if [[ "${SKIP_DEPLOY}" != "1" ]]; then
  echo "==> Deploying web"
  railway up --service "${WEB_SERVICE}" --detach -m "Bootstrap web (Dockerfile.web, demo mode)"
  echo "==> Deploying worker"
  railway up --service "${WORKER_SERVICE}" --detach -m "Bootstrap worker (Dockerfile.worker, demo mode)"

  echo "==> Waiting for web deployment"
  for i in $(seq 1 60); do
    STATUS="$(railway deployment list --service "${WEB_SERVICE}" --json 2>/dev/null | python3 -c '
import json,sys
try:
  data=json.load(sys.stdin)
except Exception:
  print("UNKNOWN"); raise SystemExit
items=data if isinstance(data,list) else data.get("deployments",[])
print((items[0].get("status") if items else "UNKNOWN") or "UNKNOWN")
' 2>/dev/null || echo UNKNOWN)"
    echo "    web status: ${STATUS} (${i}/60)"
    case "${STATUS}" in
      SUCCESS) break ;;
      FAILED|CRASHED) die "web deploy ${STATUS}. Check: railway logs --service ${WEB_SERVICE} --build --lines 100" ;;
      NEEDS_APPROVAL) die "web deploy needs approval in Railway dashboard" ;;
    esac
    sleep 15
  done

  echo "==> Attaching public domain to web"
  railway domain --service "${WEB_SERVICE}" 2>/dev/null || railway domain generate --service "${WEB_SERVICE}" 2>/dev/null || true

  DOMAIN_JSON="$(railway domain list --service "${WEB_SERVICE}" --json 2>/dev/null || echo '[]')"
  APP_URL="$(echo "${DOMAIN_JSON}" | python3 -c '
import json,sys,re
raw=sys.stdin.read()
try:
  data=json.loads(raw)
except Exception:
  print("")
  raise SystemExit
items=data if isinstance(data,list) else data.get("domains",[])
for d in items or []:
  host=d.get("domain") or d.get("host") or ""
  if host:
    print("https://"+host if not host.startswith("http") else host)
    break
' 2>/dev/null || true)"

  if [[ -n "${APP_URL}" ]]; then
    echo "==> Setting NEXT_PUBLIC_APP_URL=${APP_URL}"
    railway variable set --service "${WEB_SERVICE}" "NEXT_PUBLIC_APP_URL=${APP_URL}"
    railway variable set --service "${WORKER_SERVICE}" "NEXT_PUBLIC_APP_URL=${APP_URL}" || true
  else
    echo "    (no public domain resolved yet — set NEXT_PUBLIC_APP_URL after domain attaches)"
  fi

  if [[ "${SKIP_SEED}" != "1" ]]; then
    echo "==> Seeding demo data (web service)"
    # Prefer SSH into the running service: DATABASE_URL uses *.railway.internal
    # which is unreachable from `railway run` on the local agent machine.
    if railway ssh --service "${WEB_SERVICE}" -- pnpm db:seed:deploy; then
      echo "    Seed complete (via railway ssh)"
    elif railway run --service "${WEB_SERVICE}" pnpm db:seed:deploy; then
      echo "    Seed complete (via railway run)"
    else
      echo "    Seed skipped/failed — run later:"
      echo "      railway ssh --service ${WEB_SERVICE} -- pnpm db:seed:deploy"
    fi
  fi

  echo ""
  echo "Bootstrap complete."
  if [[ -n "${APP_URL}" ]]; then
    echo "Live URL: ${APP_URL}"
  else
    echo "Open the Railway dashboard for the public URL (railway open)."
  fi
else
  echo "==> SKIP_DEPLOY=1 — services and variables configured; deploy manually with:"
  echo "    railway up --service ${WEB_SERVICE} -m 'deploy web'"
  echo "    railway up --service ${WORKER_SERVICE} -m 'deploy worker'"
fi
