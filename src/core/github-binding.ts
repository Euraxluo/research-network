import { createHmac, timingSafeEqual } from "node:crypto";

export const GITHUB_BINDING_ATTESTATION_VERSION = 1;

export interface GithubBindingAttestationPayload {
  v: typeof GITHUB_BINDING_ATTESTATION_VERSION;
  iss: "research-network";
  sub: string;
  github_login: string | null;
  installation_id: number;
  account: string | null;
  repos: string[];
  iat: number;
  exp: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function decodeB64urlJson<T>(input: string): T {
  return JSON.parse(Buffer.from(input, "base64url").toString("utf8")) as T;
}

function stableRepos(repos: string[]): string[] {
  return [...new Set(repos.filter(Boolean).map(String))].sort();
}

function signingSecret(secret?: string): string {
  const resolved = secret ?? process.env.GITHUB_BINDING_ATTESTATION_SECRET ?? process.env.ZKLOGIN_SALT_SECRET;
  if (!resolved) {
    if (process.env.VERCEL || process.env.NODE_ENV === "production") {
      throw new Error("GITHUB_BINDING_ATTESTATION_SECRET or ZKLOGIN_SALT_SECRET is required for GitHub binding attestations");
    }
    return "local-dev-github-binding-attestation";
  }
  return resolved;
}

function signPayload(payloadSegment: string, secret?: string): string {
  return createHmac("sha256", signingSecret(secret)).update(payloadSegment).digest("base64url");
}

export function createGithubBindingAttestation(input: {
  suiAddress: string;
  githubLogin: string | null;
  installationId: number;
  account: string | null;
  repos: string[];
  nowMs?: number;
  ttlSeconds?: number;
  secret?: string;
}): { token: string; payload: GithubBindingAttestationPayload } {
  const now = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const payload: GithubBindingAttestationPayload = {
    v: GITHUB_BINDING_ATTESTATION_VERSION,
    iss: "research-network",
    sub: input.suiAddress,
    github_login: input.githubLogin,
    installation_id: input.installationId,
    account: input.account,
    repos: stableRepos(input.repos),
    iat: now,
    exp: now + (input.ttlSeconds ?? 7 * 24 * 60 * 60)
  };
  const payloadSegment = b64url(JSON.stringify(payload));
  return {
    token: `${payloadSegment}.${signPayload(payloadSegment, input.secret)}`,
    payload
  };
}

export function verifyGithubBindingAttestation(token: string, options: {
  suiAddress?: string;
  installationId?: number;
  repos?: string[];
  nowMs?: number;
  secret?: string;
} = {}): GithubBindingAttestationPayload {
  const [payloadSegment, signatureSegment] = token.split(".");
  if (!payloadSegment || !signatureSegment || token.split(".").length !== 2) {
    throw new Error("Malformed GitHub binding attestation");
  }
  const expected = signPayload(payloadSegment, options.secret);
  const actual = Buffer.from(signatureSegment, "base64url");
  const expectedBuffer = Buffer.from(expected, "base64url");
  if (actual.length !== expectedBuffer.length || !timingSafeEqual(actual, expectedBuffer)) {
    throw new Error("GitHub binding attestation signature invalid");
  }
  const payload = decodeB64urlJson<GithubBindingAttestationPayload>(payloadSegment);
  if (payload.v !== GITHUB_BINDING_ATTESTATION_VERSION || payload.iss !== "research-network") {
    throw new Error("GitHub binding attestation version invalid");
  }
  if (options.suiAddress && payload.sub !== options.suiAddress) {
    throw new Error("GitHub binding attestation Sui address mismatch");
  }
  if (options.installationId !== undefined && payload.installation_id !== options.installationId) {
    throw new Error("GitHub binding attestation installation mismatch");
  }
  if (options.repos) {
    const expectedRepos = stableRepos(options.repos);
    if (JSON.stringify(payload.repos) !== JSON.stringify(expectedRepos)) {
      throw new Error("GitHub binding attestation repositories mismatch");
    }
  }
  const now = Math.floor((options.nowMs ?? Date.now()) / 1000);
  if (payload.exp < now) {
    throw new Error("GitHub binding attestation expired");
  }
  return payload;
}
