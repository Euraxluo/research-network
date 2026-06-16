// Small crypto helpers built on the Web Crypto API (available in browsers).
// Used by the M3 client layer for commitments/hashes.

export function toBytesUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  // Copy into a fresh ArrayBuffer to satisfy BufferSource (SharedArrayBuffer is
  // rejected by subtle.digest's type even though we never use shared buffers).
  const buf = new ArrayBuffer(data.byteLength);
  new Uint8Array(buf).set(data);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return new Uint8Array(digest);
}

export async function randomBytes(length: number): Promise<Uint8Array> {
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  return buf;
}
