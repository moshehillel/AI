import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { db } from "@automation-studio/db";
import { getStaffPassword } from "@/lib/staff-session";

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LEN = 32;

export function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function hashStaffPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(plain, salt, SCRYPT_KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

async function verifyScryptHash(plain: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const saltHex = parts[4];
  const hashHex = parts[5];
  if (!saltHex || !hashHex || !Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false;
  }
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const derived = await scryptAsync(plain, salt, expected.length, {
    N: n,
    r,
    p,
  });
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export async function getStaffPasswordHashFromDb(): Promise<string | null> {
  const row = await db.platformConfig.findUnique({ where: { id: "default" } });
  return row?.staffPasswordHash ?? null;
}

/** True when env password or a DB override hash exists. */
export async function staffPasswordConfigured(): Promise<boolean> {
  if (getStaffPassword()) return true;
  const hash = await getStaffPasswordHashFromDb();
  return Boolean(hash);
}

/** Accepts env ADMIN_PASSWORD / STAFF_ACCESS_TOKEN or DB scrypt override. */
export async function verifyStaffPassword(provided: string): Promise<boolean> {
  const trimmed = provided.trim();
  if (!trimmed) return false;

  const envPassword = getStaffPassword();
  if (envPassword && timingSafeEqualString(trimmed, envPassword)) {
    return true;
  }

  const hash = await getStaffPasswordHashFromDb();
  if (hash && (await verifyScryptHash(trimmed, hash))) {
    return true;
  }

  return false;
}

export async function setStaffPasswordHash(plain: string): Promise<void> {
  const hash = await hashStaffPassword(plain);
  await db.platformConfig.upsert({
    where: { id: "default" },
    create: { id: "default", staffPasswordHash: hash },
    update: { staffPasswordHash: hash },
  });
}
