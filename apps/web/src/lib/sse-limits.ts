/** Per-process SSE connection registry (limits memory per web replica). */

function readInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const MAX_PER_PROGRAM = readInt("SSE_MAX_CONNECTIONS_PER_PROGRAM", 8);
const MAX_TOTAL = readInt("SSE_MAX_CONNECTIONS_TOTAL", 500);
const MAX_AGE_MS = readInt("SSE_MAX_CONNECTION_AGE_MS", 2 * 60 * 60 * 1000);

const byProgram = new Map<string, Set<string>>();
const openedAt = new Map<string, number>();
let total = 0;

function pruneStale(): void {
  const now = Date.now();
  for (const [id, at] of openedAt) {
    if (now - at > MAX_AGE_MS) {
      releaseSseConnection(id);
    }
  }
}

export type SseAdmission =
  | { ok: true; connectionId: string }
  | { ok: false; reason: "program_limit" | "total_limit" };

export function admitSseConnection(changeRequestId: string): SseAdmission {
  pruneStale();
  if (total >= MAX_TOTAL) {
    return { ok: false, reason: "total_limit" };
  }
  const set = byProgram.get(changeRequestId) ?? new Set<string>();
  if (set.size >= MAX_PER_PROGRAM) {
    return { ok: false, reason: "program_limit" };
  }
  const connectionId = `${changeRequestId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  set.add(connectionId);
  byProgram.set(changeRequestId, set);
  openedAt.set(connectionId, Date.now());
  total += 1;
  return { ok: true, connectionId };
}

export function releaseSseConnection(connectionId: string): void {
  const at = openedAt.get(connectionId);
  if (!at) return;
  openedAt.delete(connectionId);
  total = Math.max(0, total - 1);
  for (const [programId, set] of byProgram) {
    if (set.delete(connectionId) && set.size === 0) {
      byProgram.delete(programId);
    }
  }
}

export function sseStats(): {
  total: number;
  programs: number;
  maxPerProgram: number;
  maxTotal: number;
} {
  return {
    total,
    programs: byProgram.size,
    maxPerProgram: MAX_PER_PROGRAM,
    maxTotal: MAX_TOTAL,
  };
}
