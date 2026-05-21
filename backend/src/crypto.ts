import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const raw = process.env.WABA_ENCRYPTION_KEY;
  if (!raw) throw new Error("WABA_ENCRYPTION_KEY env var is not set");
  const buf = Buffer.from(raw, "hex");
  if (buf.length !== KEY_LEN) throw new Error(`WABA_ENCRYPTION_KEY must be ${KEY_LEN * 2} hex chars`);
  return buf;
}

export interface Encrypted {
  enc: Buffer;
  iv: Buffer;
  tag: Buffer;
}

export function encrypt(plaintext: string): Encrypted {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { enc, iv, tag };
}

export function decrypt(enc: Buffer, iv: Buffer, tag: Buffer): string {
  const key = getKey();
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(enc).toString("utf8") + decipher.final("utf8");
}

/** Constant-time HMAC comparison helper (avoids timing attacks on webhook sigs). */
export function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
