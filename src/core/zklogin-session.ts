import { createHmac, timingSafeEqual } from "node:crypto";

export const ZKLOGIN_SESSION_ATTESTATION_VERSION = 1;

export interface ZkLoginSessionAttestationPayload {
  v: typeof ZKLOGIN_SESSION_ATTESTATION_VERSION;
  iss: "research-network-zklogin";
  sub: string;
  oidc_iss: string;
  oidc_sub: string;
  aud: string;
  email: string | null;
  iat: number;
  exp: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function decodeB64urlJson<T>(input: string): T {
  return JSON.parse(Buffer.from(input, "base64url").toString("utf8")) as T;
}

function signingSecret(secret?: string): string {
  const resolved = secret ?? process.env.ZKLOGIN_SESSION_SECRET ?? process.env.ZKLOGIN_SALT_SECRET;
  if (!resolved) {
    if (process.env.VERCEL || process.env.NODE_ENV === "production") {
      throw new Error("ZKLOGIN_SESSION_SECRET or ZKLOGIN_SALT_SECRET is required for zkLogin session attestations");
    }
    return "local-dev-zklogin-session-attestation";
  }
  return resolved;
}

function signPayload(payloadSegment: string, secret?: string): string {
  return createHmac("sha256", signingSecret(secret)).update(payloadSegment).digest("base64url");
}

export function createZkLoginSessionAttestation(input: {
  suiAddress: string;
  issuer: string;
  subject: string;
  audience: string;
  email?: string | null;
  nowMs?: number;
  ttlSeconds?: number;
  secret?: string;
}): { token: string; payload: ZkLoginSessionAttestationPayload } {
  const now = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const payload: ZkLoginSessionAttestationPayload = {
    v: ZKLOGIN_SESSION_ATTESTATION_VERSION,
    iss: "research-network-zklogin",
    sub: input.suiAddress,
    oidc_iss: input.issuer,
    oidc_sub: input.subject,
    aud: input.audience,
    email: input.email ?? null,
    iat: now,
    exp: now + (input.ttlSeconds ?? 2 * 60 * 60)
  };
  const payloadSegment = b64url(JSON.stringify(payload));
  return {
    token: `${payloadSegment}.${signPayload(payloadSegment, input.secret)}`,
    payload
  };
}

export function verifyZkLoginSessionAttestation(token: string, options: {
  suiAddress?: string;
  nowMs?: number;
  secret?: string;
} = {}): ZkLoginSessionAttestationPayload {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("Malformed zkLogin session attestation");
  }
  const [payloadSegment, signatureSegment] = parts;
  const expected = signPayload(payloadSegment, options.secret);
  const actual = Buffer.from(signatureSegment, "base64url");
  const expectedBuffer = Buffer.from(expected, "base64url");
  if (actual.length !== expectedBuffer.length || !timingSafeEqual(actual, expectedBuffer)) {
    throw new Error("zkLogin session attestation signature invalid");
  }
  const payload = decodeB64urlJson<ZkLoginSessionAttestationPayload>(payloadSegment);
  if (payload.v !== ZKLOGIN_SESSION_ATTESTATION_VERSION || payload.iss !== "research-network-zklogin") {
    throw new Error("zkLogin session attestation version invalid");
  }
  if (options.suiAddress && payload.sub !== options.suiAddress) {
    throw new Error("zkLogin session attestation Sui address mismatch");
  }
  const now = Math.floor((options.nowMs ?? Date.now()) / 1000);
  if (payload.exp < now) {
    throw new Error("zkLogin session attestation expired");
  }
  return payload;
}
