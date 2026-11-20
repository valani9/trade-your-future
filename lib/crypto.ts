import crypto from "node:crypto";

const FALLBACK_KEY = "0".repeat(64);

function key(): Buffer {
  const hex = process.env.WALLET_ENC_KEY;
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, "hex");
  return Buffer.from(FALLBACK_KEY, "hex");
}

export function encryptSecret(plaintext: Uint8Array): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

export function decryptSecret(payload: string): Uint8Array {
  const [version, ivB64, tagB64, dataB64] = payload.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) throw new Error("bad payload");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return new Uint8Array(Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]));
}
