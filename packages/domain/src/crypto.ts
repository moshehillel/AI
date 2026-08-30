import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function deriveKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY ?? "dev-only-insecure-encryption-key";
  return createHash("sha256").update(raw).digest();
}

/** Encrypt plaintext to `iv:ciphertext:tag` hex for SecretRef storage */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${encrypted.toString("hex")}:${tag.toString("hex")}`;
}

export function decryptSecret(payload: string): string {
  const [ivHex, dataHex, tagHex] = payload.split(":");
  if (!ivHex || !dataHex || !tagHex) {
    throw new Error("Invalid ciphertext payload");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(),
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
