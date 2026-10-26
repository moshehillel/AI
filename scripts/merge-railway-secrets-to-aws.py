#!/usr/bin/env python3
"""Merge Railway web service vars into AWS Secrets Manager app-env without wiping keys.

Only updates values that are missing, empty, or still REPLACE_ME placeholders.
Never prints secret values. Intended for cutover from Railway to AWS ECS.

Usage:
  python scripts/merge-railway-secrets-to-aws.py
  python scripts/merge-railway-secrets-to-aws.py --admin-password admin
  python scripts/merge-railway-secrets-to-aws.py --railway-json /tmp/rw-web.json
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from typing import Any

SECRET_ID = "koda-platform-production/app-env"
AWS_REGION = "us-east-1"

# Keys to pull from Railway when still placeholder in AWS.
RAILWAY_KEYS = (
    "ENCRYPTION_KEY",
    "ADMIN_PASSWORD",
    "STAFF_ACCESS_TOKEN",
    "CURSOR_API_KEY",
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "CLERK_SECRET_KEY",
    "CLERK_WEBHOOK_SECRET",
    "CURSOR_MOCK",
    "GITHUB_MOCK",
)


def run(cmd: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, check=check, text=True, capture_output=True)


def is_placeholder(value: Any) -> bool:
    if value is None:
        return True
    if not isinstance(value, str):
        return False
    trimmed = value.strip()
    if not trimmed:
        return True
    return trimmed.startswith("REPLACE_ME")


def fetch_aws_secret() -> dict[str, str]:
    proc = run(
        [
            "aws",
            "secretsmanager",
            "get-secret-value",
            "--secret-id",
            SECRET_ID,
            "--region",
            AWS_REGION,
            "--query",
            "SecretString",
            "--output",
            "text",
        ]
    )
    return json.loads(proc.stdout)


def fetch_railway_json(path: str | None) -> dict[str, str]:
    if path:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    try:
        proc = run(
            [
                "railway",
                "variables",
                "--service",
                "web",
                "--json",
            ],
            check=False,
        )
    except FileNotFoundError:
        return {}
    if proc.returncode != 0:
        return {}
    return json.loads(proc.stdout or "{}")


def merge(
    current: dict[str, str],
    railway: dict[str, str],
    *,
    admin_password: str | None,
) -> tuple[dict[str, str], list[str]]:
    merged = dict(current)
    updated: list[str] = []

    for key in RAILWAY_KEYS:
        if not is_placeholder(merged.get(key)):
            continue
        rw_val = railway.get(key)
        if key == "ADMIN_PASSWORD" and not rw_val:
            rw_val = railway.get("STAFF_ACCESS_TOKEN")
        if rw_val and not is_placeholder(rw_val):
            merged[key] = str(rw_val).strip()
            updated.append(key)

    if is_placeholder(merged.get("ADMIN_PASSWORD")):
        fallback = admin_password or "admin"
        merged["ADMIN_PASSWORD"] = fallback
        if "ADMIN_PASSWORD" not in updated:
            updated.append("ADMIN_PASSWORD")

    return merged, updated


def put_aws_secret(payload: dict[str, str]) -> None:
    run(
        [
            "aws",
            "secretsmanager",
            "put-secret-value",
            "--secret-id",
            SECRET_ID,
            "--region",
            AWS_REGION,
            "--secret-string",
            json.dumps(payload, separators=(",", ":")),
        ]
    )


def force_ecs_redeploy() -> None:
    cluster = "koda-platform-production-cluster"
    for service in ("koda-platform-production-web", "koda-platform-production-worker"):
        run(
            [
                "aws",
                "ecs",
                "update-service",
                "--cluster",
                cluster,
                "--service",
                service,
                "--force-new-deployment",
                "--region",
                AWS_REGION,
            ]
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--railway-json",
        help="Path to railway variables --json export (skip live Railway CLI)",
    )
    parser.add_argument(
        "--admin-password",
        default=None,
        help='ADMIN_PASSWORD fallback when Railway has no value (default: "admin")',
    )
    parser.add_argument(
        "--no-redeploy",
        action="store_true",
        help="Skip ECS force-new-deployment",
    )
    args = parser.parse_args()

    current = fetch_aws_secret()
    railway = fetch_railway_json(args.railway_json)
    merged, updated = merge(
        current,
        railway,
        admin_password=args.admin_password,
    )

    if not updated:
        print("No placeholder keys to update.")
        return 0

    put_aws_secret(merged)
    print(f"Updated keys ({len(updated)}): {', '.join(updated)}")

    if not args.no_redeploy:
        force_ecs_redeploy()
        print("ECS redeploy triggered for web + worker.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
