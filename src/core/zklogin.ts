import { createHmac, createPublicKey, verify as verifySignature } from "node:crypto";
import { jwtToAddress, generateNonce, generateRandomness } from "@mysten/sui/zklogin";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { type FetchLike } from "./github.js";

/** Decoded standard OIDC claims used by zkLogin. */
export interface JwtClaims {
  iss: string;
  sub: string;
  aud: string;
  [key: string]: unknown;
}

/** Decode (NOT verify) a JWT's claims. Signature verification is the prover's / chain's job;
 *  address derivation only needs the claims. */
export function decodeJwtClaims(jwt: string): JwtClaims {
  const parts = jwt.split(".");
  if (parts.length < 2) {
    throw new Error("Malformed JWT");
  }
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  const aud = Array.isArray(payload.aud) ? String(payload.aud[0]) : String(payload.aud ?? "");
  return { ...payload, iss: String(payload.iss ?? ""), sub: String(payload.sub ?? ""), aud };
}

/** Derive a per-user zkLogin salt (< 2^128) deterministically from the stable subject. The salt
 *  secret MUST come from `ZKLOGIN_SALT_SECRET` in any deployed environment — a missing secret
 *  throws there instead of silently degrading to the public dev default (which would derive
 *  addresses anyone can recompute). Returns a decimal string as `jwtToAddress` expects. */
export function deriveUserSalt(input: { issuer: string; subject: string; audience?: string; secret?: string }): string {
  let secret = input.secret ?? process.env.ZKLOGIN_SALT_SECRET;
  if (!secret) {
    if (process.env.VERCEL || process.env.NODE_ENV === "production") {
      throw new Error("ZKLOGIN_SALT_SECRET is not configured; refusing to derive salts from the public dev default");
    }
    secret = "local-dev-zklogin-salt";
  }
  const seed = createHmac("sha256", secret).update(`${input.issuer}:${input.subject}:${input.audience ?? ""}`).digest();
  // 16 bytes => value in [0, 2^128), the valid zkLogin salt range.
  return BigInt(`0x${seed.subarray(0, 16).toString("hex")}`).toString();
}

export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export interface JsonWebKey {
  kid?: string;
  kty?: string;
  alg?: string;
  n?: string;
  e?: string;
  [key: string]: unknown;
}

export class JwtVerificationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "JwtVerificationError";
  }
}

interface JwksCacheEntry {
  keys: JsonWebKey[];
  expiresAt: number;
}

const jwksCache = new Map<string, JwksCacheEntry>();
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000;

/** Fetch (and cache) a JWKS document, e.g. Google's signing keys. */
export async function fetchJwks(jwksUrl = GOOGLE_JWKS_URL, fetchImpl?: FetchLike): Promise<JsonWebKey[]> {
  const cached = jwksCache.get(jwksUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.keys;
  }
  const doFetch = fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!doFetch) {
    throw new Error("No fetch implementation available for JWKS retrieval");
  }
  const res = await doFetch(jwksUrl, { method: "GET", headers: {} });
  if (!res.ok) {
    throw new Error(`JWKS fetch failed: HTTP ${res.status}`);
  }
  const body = await res.json() as { keys?: JsonWebKey[] };
  const keys = body.keys ?? [];
  jwksCache.set(jwksUrl, { keys, expiresAt: Date.now() + JWKS_CACHE_TTL_MS });
  return keys;
}

export interface VerifyJwtOptions {
  /** Acceptable `iss` values. Defaults to Google's. */
  issuers?: string[];
  /** Required `aud` (the OAuth client id). Verification fails when set and not matching. */
  audience?: string;
  /** Expected `nonce` claim (binds the JWT to a login intent / ephemeral key). */
  nonce?: string;
  /** Keys to verify against; fetched from `jwksUrl` when omitted. */
  jwks?: JsonWebKey[];
  jwksUrl?: string;
  fetchImpl?: FetchLike;
  /** Clock for `exp` checking (ms since epoch); defaults to Date.now(). */
  nowMs?: number;
}

/** Verify a JWT's RS256 signature against a JWKS plus iss/aud/exp/nonce claims, returning the
 *  verified claims. This is the check `decodeJwtClaims` deliberately skips — any server-side
 *  account binding MUST go through here (D-14/D-15). */
export async function verifyJwt(jwt: string, options: VerifyJwtOptions = {}): Promise<JwtClaims> {
  const parts = jwt.split(".");
  if (parts.length !== 3) {
    throw new JwtVerificationError("malformed_jwt", "Malformed JWT");
  }
  const [headerPart, payloadPart, signaturePart] = parts;
  let header: { alg?: string; kid?: string };
  try {
    header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8")) as { alg?: string; kid?: string };
  } catch {
    throw new JwtVerificationError("malformed_jwt_header", "Malformed JWT header");
  }
  if (header.alg !== "RS256") {
    throw new JwtVerificationError("unsupported_jwt_alg", `Unsupported JWT alg: ${header.alg ?? "none"}`);
  }
  const keys = options.jwks ?? await fetchJwks(options.jwksUrl, options.fetchImpl);
  const candidates = keys.filter((key) => key.kty === "RSA" && (!header.kid || key.kid === header.kid));
  if (candidates.length === 0) {
    throw new JwtVerificationError("jwks_key_not_found", `No JWKS key matches kid ${header.kid ?? "<none>"}`);
  }
  const signed = Buffer.from(`${headerPart}.${payloadPart}`, "utf8");
  const signature = Buffer.from(signaturePart, "base64url");
  const valid = candidates.some((key) => {
    try {
      const publicKey = createPublicKey({ key: key as never, format: "jwk" });
      return verifySignature("RSA-SHA256", signed, publicKey, signature);
    } catch {
      return false;
    }
  });
  if (!valid) {
    throw new JwtVerificationError("jwt_signature_invalid", "JWT signature verification failed");
  }
  let claims: JwtClaims;
  try {
    claims = decodeJwtClaims(jwt);
  } catch {
    throw new JwtVerificationError("malformed_jwt_payload", "Malformed JWT payload");
  }
  const issuers = options.issuers ?? GOOGLE_ISSUERS;
  if (!issuers.includes(claims.iss)) {
    throw new JwtVerificationError("jwt_issuer_not_allowed", `JWT issuer not allowed: ${claims.iss}`);
  }
  if (options.audience && claims.aud !== options.audience) {
    throw new JwtVerificationError("jwt_audience_mismatch", "JWT audience mismatch");
  }
  const now = options.nowMs ?? Date.now();
  const exp = typeof claims.exp === "number" ? claims.exp : Number(claims.exp ?? 0);
  if (!exp || exp * 1000 < now) {
    throw new JwtVerificationError("jwt_expired", "JWT expired");
  }
  if (options.nonce !== undefined && String(claims.nonce ?? "") !== options.nonce) {
    throw new JwtVerificationError("jwt_nonce_mismatch", "JWT nonce does not match the login intent");
  }
  return claims;
}

/** Derive the REAL Sui zkLogin address from a JWT + salt (Poseidon-based, via @mysten/sui).
 *  This is the canonical address a zkLogin signature would authorize on-chain. */
export function deriveZkLoginAddress(jwt: string, salt: string | bigint): string {
  return jwtToAddress(jwt, salt, false);
}

/** Create an ephemeral session keypair (the key the user signs transactions with for `maxEpoch`). */
export function createEphemeralKey(): Ed25519Keypair {
  return Ed25519Keypair.generate();
}

export interface ZkLoginNonceInput {
  ephemeralPublicKey: ReturnType<Ed25519Keypair["getPublicKey"]>;
  maxEpoch: number;
  randomness?: string;
}

/** Produce the OIDC `nonce` that binds the ephemeral key + maxEpoch (sent in the OAuth request). */
export function prepareZkLoginNonce(input: ZkLoginNonceInput): { nonce: string; randomness: string; maxEpoch: number } {
  const randomness = input.randomness ?? generateRandomness();
  const nonce = generateNonce(input.ephemeralPublicKey, input.maxEpoch, randomness);
  return { nonce, randomness: String(randomness), maxEpoch: input.maxEpoch };
}

export interface ZkProofRequest {
  jwt: string;
  extendedEphemeralPublicKey: string;
  maxEpoch: number;
  jwtRandomness: string;
  salt: string;
  keyClaimName?: string;
}

/** Call a zkLogin prover (e.g. Mysten's prover or self-hosted) to obtain the ZK proof for a JWT.
 *  HTTP is injectable so the flow is testable; the real prover URL is provided by the operator. */
export async function requestZkProof(
  proverUrl: string,
  request: ZkProofRequest,
  fetchImpl?: FetchLike
): Promise<Record<string, unknown>> {
  const doFetch = fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!doFetch) {
    throw new Error("No fetch implementation available for the zkLogin prover");
  }
  const res = await doFetch(proverUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keyClaimName: "sub", ...request })
  });
  if (!res.ok) {
    throw new Error(`zkLogin prover failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}
