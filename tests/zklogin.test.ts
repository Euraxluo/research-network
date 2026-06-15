import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { describe, it, expect, beforeEach } from "vitest";
import {
  completeAuthLogin,
  createEphemeralKey,
  decodeJwtClaims,
  deriveUserSalt,
  deriveZkLoginAddress,
  JwtVerificationError,
  prepareZkLoginNonce,
  requestZkProof,
  startAuthLogin,
  verifyJwt,
  type FetchLike,
  type FetchResponseLike
} from "../src/index.js";

let localnetRoot: string;
beforeEach(async () => {
  localnetRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rn-zk-"));
});

function makeJwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return [b64({ alg: "RS256", typ: "JWT" }), b64(claims), "sig"].join(".");
}

function ok(json: unknown): FetchResponseLike {
  return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) };
}

const { publicKey: testRsaPublicKey, privateKey: testRsaPrivateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const testJwk = { ...testRsaPublicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256" } as Record<string, unknown>;

function signJwt(claims: Record<string, unknown>, kid = "test-key"): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const signed = `${b64({ alg: "RS256", typ: "JWT", kid })}.${b64(claims)}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signed);
  return `${signed}.${signer.sign(testRsaPrivateKey).toString("base64url")}`;
}

describe("real zkLogin", () => {
  const jwt = makeJwt({ iss: "https://accounts.google.com", sub: "user-abc", aud: "client-123" });

  it("derives a canonical Sui zkLogin address (deterministic, salt-sensitive)", () => {
    const addr = deriveZkLoginAddress(jwt, "12345678901234567890");
    expect(addr).toMatch(/^0x[0-9a-f]{64}$/);
    expect(deriveZkLoginAddress(jwt, "12345678901234567890")).toBe(addr);
    expect(deriveZkLoginAddress(jwt, "999")).not.toBe(addr);
  });

  it("decodes JWT claims and derives an in-range salt", () => {
    const claims = decodeJwtClaims(jwt);
    expect(claims).toMatchObject({ iss: "https://accounts.google.com", sub: "user-abc", aud: "client-123" });
    const salt = deriveUserSalt({ issuer: claims.iss, subject: claims.sub, audience: claims.aud });
    expect(BigInt(salt) < (1n << 128n)).toBe(true);
    // deterministic, and changes with subject
    expect(deriveUserSalt({ issuer: claims.iss, subject: claims.sub, audience: claims.aud })).toBe(salt);
    expect(deriveUserSalt({ issuer: claims.iss, subject: "other", audience: claims.aud })).not.toBe(salt);
  });

  it("prepares an OIDC nonce binding the ephemeral key + maxEpoch", () => {
    const eph = createEphemeralKey();
    const { nonce, randomness, maxEpoch } = prepareZkLoginNonce({ ephemeralPublicKey: eph.getPublicKey(), maxEpoch: 142 });
    expect(typeof nonce).toBe("string");
    expect(nonce.length).toBeGreaterThan(0);
    expect(maxEpoch).toBe(142);
    expect(randomness.length).toBeGreaterThan(0);
  });

  it("calls a prover (injected) and surfaces prover errors", async () => {
    const fetchOk: FetchLike = async () => ok({ proofPoints: { a: ["1"], b: [["2"]], c: ["3"] } });
    const proof = await requestZkProof("https://prover.example/v1", {
      jwt, extendedEphemeralPublicKey: "0xeph", maxEpoch: 142, jwtRandomness: "123", salt: "456"
    }, fetchOk);
    expect(proof).toHaveProperty("proofPoints");

    const fetchErr: FetchLike = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "prover down" });
    await expect(requestZkProof("https://prover.example/v1", {
      jwt, extendedEphemeralPublicKey: "0xeph", maxEpoch: 142, jwtRandomness: "123", salt: "456"
    }, fetchErr)).rejects.toThrow(/prover/);
  });

  it("completeAuthLogin verifies the JWT (signature + nonce) and uses the REAL address", async () => {
    const intent = await startAuthLogin({
      provider: "github",
      clientId: "client-123",
      redirectUri: "http://127.0.0.1/cb",
      zkLoginIssuer: "https://accounts.google.com",
      localnetRoot
    });
    const signed = signJwt({
      iss: "https://accounts.google.com",
      sub: "user-abc",
      aud: "client-123",
      nonce: intent.nonce,
      exp: Math.floor(Date.now() / 1000) + 600
    });
    const account = await completeAuthLogin({ intentId: intent.id, jwt: signed, jwks: [testJwk], displayName: "octo", localnetRoot });
    const expected = deriveZkLoginAddress(signed, deriveUserSalt({ issuer: "https://accounts.google.com", subject: "user-abc", audience: "client-123" }));
    expect(account.zklogin?.address).toBe(expected);
    expect(account.zklogin?.issuer).toBe("https://accounts.google.com");
    expect(account.wallets[0]).toMatchObject({ chain: "sui", verified_by: "zklogin", address: expected });

    // D-16: the intent is consumed — completing it again must fail.
    await expect(completeAuthLogin({ intentId: intent.id, jwt: signed, jwks: [testJwk], localnetRoot }))
      .rejects.toThrow(/consumed/);
  });

  it("completeAuthLogin rejects an unverified / wrong-nonce JWT", async () => {
    const intent = await startAuthLogin({
      provider: "github",
      clientId: "client-123",
      redirectUri: "http://127.0.0.1/cb",
      zkLoginIssuer: "https://accounts.google.com",
      localnetRoot
    });
    // Unsigned JWT (the old D-14 hole): must be rejected.
    await expect(completeAuthLogin({ intentId: intent.id, jwt, jwks: [testJwk], localnetRoot })).rejects.toThrow();
    // Properly signed but bound to a different nonce (D-15): must be rejected.
    const wrongNonce = signJwt({
      iss: "https://accounts.google.com",
      sub: "user-abc",
      aud: "client-123",
      nonce: "some-other-intent-nonce",
      exp: Math.floor(Date.now() / 1000) + 600
    });
    await expect(completeAuthLogin({ intentId: intent.id, jwt: wrongNonce, jwks: [testJwk], localnetRoot })).rejects.toThrow(/nonce/);
  });

  it("falls back to the simulated address when no JWT is supplied", async () => {
    const intent = await startAuthLogin({ provider: "github", clientId: "c", redirectUri: "http://127.0.0.1/cb", localnetRoot });
    const account = await completeAuthLogin({ intentId: intent.id, issuer: "https://github.com", subject: "u1", localnetRoot });
    // Simulated derivation still yields a valid Sui-shaped address, distinct from the real one.
    expect(account.zklogin?.address).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("verifyJwt (RS256 + claims)", () => {
  const jwk = testJwk;
  const baseClaims = {
    iss: "https://accounts.google.com",
    sub: "user-abc",
    aud: "client-123",
    nonce: "nonce-1",
    exp: Math.floor(Date.now() / 1000) + 600
  };

  it("accepts a correctly signed JWT and returns the claims", async () => {
    const claims = await verifyJwt(signJwt(baseClaims), { jwks: [jwk], audience: "client-123", nonce: "nonce-1" });
    expect(claims.sub).toBe("user-abc");
  });

  it("rejects tampered payloads, wrong audience, wrong nonce, expiry, and unsigned JWTs", async () => {
    const token = signJwt(baseClaims);
    const [header, , signature] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ ...baseClaims, sub: "attacker" })).toString("base64url");
    await expect(verifyJwt(`${header}.${forgedPayload}.${signature}`, { jwks: [jwk] })).rejects.toThrow(/signature/);
    await expect(verifyJwt(token, { jwks: [jwk], audience: "other-client" })).rejects.toThrow(/audience/);
    await expect(verifyJwt(token, { jwks: [jwk], nonce: "different" })).rejects.toThrow(/nonce/);
    await expect(verifyJwt(signJwt({ ...baseClaims, exp: Math.floor(Date.now() / 1000) - 10 }), { jwks: [jwk] }))
      .rejects.toThrow(/expired/);
    const unsigned = `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(JSON.stringify(baseClaims)).toString("base64url")}.`;
    await expect(verifyJwt(unsigned, { jwks: [jwk] })).rejects.toThrow(/alg/);
    await expect(verifyJwt(signJwt({ ...baseClaims, iss: "https://evil.example" }), { jwks: [jwk] })).rejects.toThrow(/issuer/);
  });

  it("classifies token verification failures with stable error codes", async () => {
    await expect(verifyJwt("not-a-jwt", { jwks: [jwk] })).rejects.toMatchObject({
      name: "JwtVerificationError",
      code: "malformed_jwt"
    });
    await expect(verifyJwt(signJwt({ ...baseClaims, aud: "wrong-client" }), { jwks: [jwk], audience: "client-123" }))
      .rejects.toBeInstanceOf(JwtVerificationError);
  });
});
