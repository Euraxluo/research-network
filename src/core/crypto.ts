import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

export function sha256Bytes(bytes: Buffer | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export async function sha256File(filePath: string): Promise<string> {
  return sha256Bytes(await readFile(filePath));
}

export function shortHash(input: string, length = 16): string {
  return createHash("sha256").update(input).digest("hex").slice(0, length);
}

export function objectId(prefix: string, input: string): string {
  return `${prefix}${createHash("sha256").update(input).digest("hex").slice(0, 40)}`;
}

export function randomToken(prefix: string): string {
  return `${prefix}_${randomBytes(18).toString("base64url")}`;
}
