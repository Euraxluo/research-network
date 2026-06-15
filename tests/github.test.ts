import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect, vi } from "vitest";
import { createSign, createVerify, generateKeyPairSync } from "node:crypto";
import { createApiServer } from "../src/api/server.js";
import githubBindingHandler from "../api/github-binding.js";
import githubOauthHandler from "../api/github-oauth.js";
import { readAuthState } from "../src/core/local-store.js";
import {
  createGithubBindingAttestation,
  createAppJwt,
  GithubAppClient,
  collectGithubUserAccess,
  connectGithubRepo,
  createZkLoginSessionAttestation,
  githubAppFromEnv,
  listUserOrgs,
  verifyGithubBindingAttestation,
  verifyZkLoginSessionAttestation,
  type FetchLike,
  type FetchResponseLike
} from "../src/index.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});
const { privateKey: oauthPrivateKey, publicKey: oauthPublicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const oauthJwk = { ...oauthPublicKey.export({ format: "jwk" }), kid: "oauth-test-key", alg: "RS256" } as Record<string, unknown>;

function b64urlToBuf(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function signTestJwt(claims: Record<string, unknown>, key = oauthPrivateKey, kid = "oauth-test-key"): string {
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const signed = `${b64({ alg: "RS256", typ: "JWT", kid })}.${b64(claims)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signed);
  signer.end();
  return `${signed}.${signer.sign(key).toString("base64url")}`;
}

function ok(json: unknown, link?: string): FetchResponseLike {
  return {
    ok: true,
    status: 200,
    json: async () => json,
    text: async () => JSON.stringify(json),
    headers: { get: (name: string) => name.toLowerCase() === "link" ? link ?? null : null }
  };
}

const originalForkToken = process.env.RN_GITHUB_FORK_API_TOKEN;
const originalGithubClientId = process.env.GITHUB_APP_CLIENT_ID;
const originalGithubClientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
const originalGoogleClientId = process.env.GOOGLE_CLIENT_ID;
const originalZkloginSaltSecret = process.env.ZKLOGIN_SALT_SECRET;
const originalZkloginSessionSecret = process.env.ZKLOGIN_SESSION_SECRET;
const originalBindingAttestationSecret = process.env.GITHUB_BINDING_ATTESTATION_SECRET;

afterEach(() => {
  if (originalForkToken === undefined) {
    delete process.env.RN_GITHUB_FORK_API_TOKEN;
  } else {
    process.env.RN_GITHUB_FORK_API_TOKEN = originalForkToken;
  }
  for (const [key, value] of Object.entries({
    GITHUB_APP_CLIENT_ID: originalGithubClientId,
    GITHUB_APP_CLIENT_SECRET: originalGithubClientSecret,
    GITHUB_BINDING_ATTESTATION_SECRET: originalBindingAttestationSecret,
    GOOGLE_CLIENT_ID: originalGoogleClientId,
    ZKLOGIN_SESSION_SECRET: originalZkloginSessionSecret,
    ZKLOGIN_SALT_SECRET: originalZkloginSaltSecret
  })) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

function listen(app: ReturnType<typeof createApiServer>): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("server did not bind to a TCP port");
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((done) => server.close(() => done()))
      });
    });
  });
}

function mockJsonResponse() {
  const headers = new Map<string, string>();
  return {
    statusCode: 200,
    body: "",
    headers,
    setHeader(key: string, value: string) {
      headers.set(key.toLowerCase(), value);
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(body: string) {
      this.body = body;
      return this;
    }
  };
}

describe("GitHub App client", () => {
  it("createAppJwt signs a verifiable RS256 JWT", () => {
    const jwt = createAppJwt("123456", privateKey, 1_700_000_000);
    const [h, p, s] = jwt.split(".");
    expect(JSON.parse(b64urlToBuf(h).toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const payload = JSON.parse(b64urlToBuf(p).toString());
    expect(payload.iss).toBe("123456");
    expect(payload.exp - payload.iat).toBe(600);

    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${h}.${p}`);
    verifier.end();
    expect(verifier.verify(publicKey, b64urlToBuf(s))).toBe(true);
  });

  it("mints an installation token and connects a repo (token → commit → tree → asset.yaml)", async () => {
    const assetYaml = [
      "schema: research-asset/v0.1",
      "title: Repo Paper",
      "version: 0.1.0",
      "types: [paper]",
      "authors: []",
      "legal_terms: {}",
      "access: { visibility: public }",
      "publish: { storage: walrus, chain: sui }"
    ].join("\n");

    const fetchImpl: FetchLike = async (url, init) => {
      if (url.includes("/access_tokens") && init?.method === "POST") {
        return ok({ token: "ghs_installation_token", expires_at: "2026-01-01T00:00:00Z" });
      }
      if (url.includes("/commits/")) {
        return ok({ sha: "abc1234commit" });
      }
      if (url.includes("/git/trees/")) {
        return ok({ tree: [
          { path: "asset.yaml", type: "blob", sha: "s1", size: 80 },
          { path: "paper/main.tex", type: "blob", sha: "s2", size: 12 }
        ] });
      }
      if (url.includes("/contents/asset.yaml")) {
        return ok({ encoding: "base64", content: Buffer.from(assetYaml).toString("base64") });
      }
      throw new Error(`unexpected url ${url}`);
    };

    const client = new GithubAppClient({ appId: "1", privateKeyPem: privateKey, fetchImpl });
    const result = await connectGithubRepo(client, { installationId: "999", owner: "octo", repo: "research" });

    expect(result.commit).toBe("abc1234commit");
    expect(result.tree.map((t) => t.path)).toContain("asset.yaml");
    expect(result.manifest?.title).toBe("Repo Paper");
    expect(result.manifest?.types).toEqual(["paper"]);
  });

  it("caches installation tokens until shortly before expiry", async () => {
    let tokenMints = 0;
    const nowSeconds = 1_700_000_000;
    const fetchImpl: FetchLike = async (url, init) => {
      expect(url).toContain("/access_tokens");
      expect(init?.method).toBe("POST");
      tokenMints += 1;
      return ok({
        token: `ghs_installation_token_${tokenMints}`,
        expires_at: new Date((nowSeconds + 3600) * 1000).toISOString()
      });
    };
    const client = new GithubAppClient({ appId: "1", privateKeyPem: privateKey, fetchImpl });

    const first = await client.getInstallationToken("999", nowSeconds);
    const second = await client.getInstallationToken("999", nowSeconds + 120);

    expect(first.token).toBe("ghs_installation_token_1");
    expect(second.token).toBe("ghs_installation_token_1");
    expect(tokenMints).toBe(1);
  });

  it("rejects truncated recursive tree listings instead of silently ingesting partial repos", async () => {
    const fetchImpl: FetchLike = async () => ok({ truncated: true, tree: [{ path: "asset.yaml", type: "blob", sha: "s1" }] });
    const client = new GithubAppClient({ appId: "1", privateKeyPem: privateKey, fetchImpl });

    await expect(client.getRepoTree("ghs_token", { owner: "octo", repo: "huge" })).rejects.toThrow(/truncated/);
  });

  it("falls back to the git blob API for GitHub contents responses over 1MB", async () => {
    const largeReadme = "# Large README\n\n" + "body\n".repeat(4);
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes("/contents/README.md")) {
        return ok({ encoding: "none", sha: "blob-sha" });
      }
      if (url.includes("/git/blobs/blob-sha")) {
        return ok({ encoding: "base64", content: Buffer.from(largeReadme).toString("base64") });
      }
      throw new Error(`unexpected url ${url}`);
    };
    const client = new GithubAppClient({ appId: "1", privateKeyPem: privateKey, fetchImpl });

    await expect(client.getFileContent("ghs_token", { owner: "octo", repo: "research" }, "README.md"))
      .resolves.toBe(largeReadme);
  });

  it("forkRepo POSTs to the forks endpoint and parses the new repo", async () => {
    const fetchImpl: FetchLike = async (url, init) => {
      expect(init?.method).toBe("POST");
      expect(url).toContain("/repos/octo/research/forks");
      return ok({ full_name: "me/research", html_url: "https://github.com/me/research", owner: { login: "me" }, name: "research" });
    };
    const client = new GithubAppClient({ appId: "1", privateKeyPem: privateKey, fetchImpl });
    const fork = await client.forkRepo("ghs_token", { owner: "octo", repo: "research" });
    expect(fork).toMatchObject({ owner: "me", repo: "research", fullName: "me/research" });
  });

  it("githubAppFromEnv decodes base64 PEM and errors when unconfigured", () => {
    const b64Pem = Buffer.from(privateKey).toString("base64");
    const client = githubAppFromEnv({ GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: b64Pem }, async () => ok({}));
    expect(client).toBeInstanceOf(GithubAppClient);
    expect(() => githubAppFromEnv({})).toThrow(/not configured/);
  });

  it("paginates GitHub user organizations from a user access token", async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url === "https://api.github.test/user/orgs?per_page=100") {
        return ok(
          [{ id: 1, login: "alpha-lab", html_url: "https://github.com/alpha-lab" }],
          '<https://api.github.test/user/orgs?per_page=100&page=2>; rel="next"'
        );
      }
      if (url === "https://api.github.test/user/orgs?per_page=100&page=2") {
        return ok([{ id: 2, login: "beta-lab", html_url: "https://github.com/beta-lab" }]);
      }
      throw new Error(`unexpected url ${url}`);
    };

    await expect(listUserOrgs("gho_user", { apiBaseUrl: "https://api.github.test", fetchImpl }))
      .resolves.toEqual([
        { id: 1, login: "alpha-lab", description: null, html_url: "https://github.com/alpha-lab", avatar_url: null },
        { id: 2, login: "beta-lab", description: null, html_url: "https://github.com/beta-lab", avatar_url: null }
      ]);
  });

  it("collects authorized installations plus uninstalled organization scopes", async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url === "https://api.github.test/user") {
        return ok({ id: 10, login: "octo", html_url: "https://github.com/octo" });
      }
      if (url === "https://api.github.test/user/installations?per_page=100") {
        return ok({
          installations: [
            { id: 42, app_slug: "research-network-app", account: { id: 10, login: "octo", type: "User" } },
            { id: 77, app_slug: "research-network-app", account: { id: 11, login: "octo-org", type: "Organization" } },
            { id: 99, app_slug: "other-app", account: { id: 12, login: "ignored-org", type: "Organization" } }
          ]
        });
      }
      if (url === "https://api.github.test/user/orgs?per_page=100") {
        return ok([
          { id: 11, login: "octo-org", html_url: "https://github.com/octo-org" },
          { id: 12, login: "uninstalled-org", html_url: "https://github.com/uninstalled-org" }
        ]);
      }
      if (url === "https://api.github.test/user/installations/42/repositories?per_page=100") {
        return ok({ repositories: [{ id: 1, full_name: "octo/research", private: false, html_url: "https://github.com/octo/research", owner: { login: "octo", type: "User" } }] });
      }
      if (url === "https://api.github.test/user/installations/77/repositories?per_page=100") {
        return ok({ repositories: [{ id: 2, full_name: "octo-org/lab", private: true, html_url: "https://github.com/octo-org/lab", owner: { login: "octo-org", type: "Organization" } }] });
      }
      if (url.includes("/user/repos?")) {
        return ok([
          { id: 1, full_name: "octo/research", private: false, html_url: "https://github.com/octo/research", owner: { login: "octo", type: "User" } },
          { id: 2, full_name: "octo-org/lab", private: true, html_url: "https://github.com/octo-org/lab", owner: { login: "octo-org", type: "Organization" } },
          { id: 3, full_name: "uninstalled-org/visible", private: false, html_url: "https://github.com/uninstalled-org/visible", owner: { login: "uninstalled-org", type: "Organization" } }
        ]);
      }
      throw new Error(`unexpected url ${url}`);
    };

    const snapshot = await collectGithubUserAccess("gho_user", {
      apiBaseUrl: "https://api.github.test",
      appSlug: "research-network-app",
      fetchImpl
    });

    expect(snapshot.installations.map((installation) => installation.account.login)).toEqual(["octo", "octo-org"]);
    expect(snapshot.organization_scopes).toEqual([
      { id: "42", account: "octo", accountType: "User", installed: true, installation_id: 42, repos: ["octo/research"] },
      { id: "77", account: "octo-org", accountType: "Organization", installed: true, installation_id: 77, repos: ["octo-org/lab"] },
      { id: "uninstalled:uninstalled-org", account: "uninstalled-org", accountType: "Organization", installed: false, installation_id: null, repos: [] }
    ]);
    expect(snapshot.available_repositories.map((repo) => [repo.full_name, repo.granted, repo.installation_id])).toEqual([
      ["octo/research", true, 42],
      ["octo-org/lab", true, 77],
      ["uninstalled-org/visible", false, null]
    ]);
  });

  it("surfaces GitHub API errors", async () => {
    const fetchImpl: FetchLike = async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => "Bad credentials" });
    const client = new GithubAppClient({ appId: "1", privateKeyPem: privateKey, fetchImpl });
    await expect(client.getInstallationToken("999")).rejects.toThrow(/401/);
  });

  it("keeps the local GitHub fork proxy disabled unless a bearer token is configured", async () => {
    delete process.env.RN_GITHUB_FORK_API_TOKEN;
    const server = await listen(createApiServer());
    try {
      const disabled = await fetch(`${server.url}/api/github/fork`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ installationId: "1", owner: "octo", repo: "research" })
      });
      expect(disabled.status).toBe(503);
      expect(await disabled.json()).toEqual({ error: "github_fork_not_enabled" });

      process.env.RN_GITHUB_FORK_API_TOKEN = "secret-token";
      const unauthorized = await fetch(`${server.url}/api/github/fork`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer wrong-token" },
        body: JSON.stringify({ installationId: "1", owner: "octo", repo: "research" })
      });
      expect(unauthorized.status).toBe(401);
      expect(await unauthorized.json()).toEqual({ error: "github_fork_unauthorized" });
    } finally {
      await server.close();
    }
  });

  it("does not echo internal exception messages from the local API", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rn-api-error-"));
    const notADirectory = path.join(tempRoot, "not-a-directory");
    await fs.writeFile(notADirectory, "blocks mkdir", "utf8");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const server = await listen(createApiServer({ localnetRoot: notADirectory, workspaceRoot: tempRoot }));
    try {
      const response = await fetch(`${server.url}/api/search?q=paper`);
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toEqual({ error: "internal_error" });
      expect(JSON.stringify(body)).not.toContain(notADirectory);
    } finally {
      await server.close();
      errorSpy.mockRestore();
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("signs GitHub binding attestations and rejects tampering", () => {
    const { token, payload } = createGithubBindingAttestation({
      suiAddress: "0xabc",
      githubLogin: "octo",
      installationId: 42,
      account: "octo-org",
      repos: ["octo/research", "octo/research", "octo/notes"],
      nowMs: 1_700_000_000_000,
      secret: "attestation-secret"
    });

    expect(payload.repos).toEqual(["octo/notes", "octo/research"]);
    expect(verifyGithubBindingAttestation(token, {
      suiAddress: "0xabc",
      installationId: 42,
      repos: ["octo/research", "octo/notes"],
      nowMs: 1_700_000_001_000,
      secret: "attestation-secret"
    })).toMatchObject({ sub: "0xabc", github_login: "octo", installation_id: 42 });

    const [payloadSegment, signature] = token.split(".");
    const tampered = `${Buffer.from(JSON.stringify({ ...payload, sub: "0xattacker" })).toString("base64url")}.${signature}`;
    expect(() => verifyGithubBindingAttestation(tampered, { secret: "attestation-secret" })).toThrow(/signature/);
    expect(() => verifyGithubBindingAttestation(token, { suiAddress: "0xabc", nowMs: 1_800_000_000_000, secret: "attestation-secret" })).toThrow(/expired/);
    expect(payloadSegment.length).toBeGreaterThan(10);
  });

  it("signs zkLogin session attestations and rejects tampering", () => {
    const { token, payload } = createZkLoginSessionAttestation({
      suiAddress: "0xzk",
      issuer: "https://accounts.google.com",
      subject: "user-abc",
      audience: "google-client",
      email: "octo@example.com",
      nowMs: 1_700_000_000_000,
      ttlSeconds: 120,
      secret: "zk-session-secret"
    });

    expect(payload).toMatchObject({
      sub: "0xzk",
      oidc_sub: "user-abc",
      aud: "google-client",
      email: "octo@example.com"
    });
    expect(verifyZkLoginSessionAttestation(token, {
      suiAddress: "0xzk",
      nowMs: 1_700_000_001_000,
      secret: "zk-session-secret"
    })).toMatchObject({ sub: "0xzk", oidc_iss: "https://accounts.google.com" });

    const [, signature] = token.split(".");
    const tampered = `${Buffer.from(JSON.stringify({ ...payload, sub: "0xattacker" })).toString("base64url")}.${signature}`;
    expect(() => verifyZkLoginSessionAttestation(tampered, { secret: "zk-session-secret" })).toThrow(/signature/);
    expect(() => verifyZkLoginSessionAttestation(token, { nowMs: 1_700_000_300_000, secret: "zk-session-secret" })).toThrow(/expired/);
  });

  it("verifies GitHub binding attestations through the server endpoint", async () => {
    process.env.GITHUB_BINDING_ATTESTATION_SECRET = "binding-secret";
    const { token } = createGithubBindingAttestation({
      suiAddress: "0xabc",
      githubLogin: "octo",
      installationId: 42,
      account: "octo-org",
      repos: ["octo/research"],
      secret: "binding-secret"
    });
    const valid = mockJsonResponse();
    await githubBindingHandler({
      method: "POST",
      body: {
        binding_attestation: token,
        sui_address: "0xabc",
        installation_id: 42,
        repos: ["octo/research"]
      }
    }, valid);

    expect(valid.statusCode).toBe(200);
    expect(JSON.parse(valid.body)).toMatchObject({ valid: true, payload: { sub: "0xabc", installation_id: 42 } });

    const invalid = mockJsonResponse();
    await githubBindingHandler({
      method: "POST",
      body: {
        binding_attestation: token,
        sui_address: "0xabc",
        installation_id: 42,
        repos: ["octo/other"]
      }
    }, invalid);
    expect(invalid.statusCode).toBe(401);
    expect(JSON.parse(invalid.body)).toEqual({ error: "invalid_binding_attestation" });
  });

  it("requires a verified zkLogin proof before exchanging GitHub OAuth code", async () => {
    process.env.GITHUB_APP_CLIENT_ID = "Iv23test";
    process.env.GITHUB_APP_CLIENT_SECRET = "secret";
    process.env.GOOGLE_CLIENT_ID = "google-client";
    process.env.ZKLOGIN_SALT_SECRET = "salt-secret";
    const res = mockJsonResponse();

    await githubOauthHandler({
      method: "POST",
      body: { code: "dummy-code" }
    }, res);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "missing_zklogin_proof" });
  });

  it("accepts a server-signed zkLogin session attestation when the callback tab has no id_token", async () => {
    const localnetRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rn-gh-zk-session-"));
    process.env.GITHUB_APP_CLIENT_ID = "Iv23test";
    process.env.GITHUB_APP_CLIENT_SECRET = "github-secret";
    process.env.GITHUB_APP_SLUG = "research-network-app";
    process.env.ZKLOGIN_SESSION_SECRET = "zk-session-secret";
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.ZKLOGIN_SALT_SECRET;
    const { token } = createZkLoginSessionAttestation({
      suiAddress: "0xzkaddress",
      issuer: "https://accounts.google.com",
      subject: "user-abc",
      audience: "google-client",
      secret: "zk-session-secret"
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, init?: { method?: string }) => {
      const href = String(url);
      if (href === "https://github.com/login/oauth/access_token") {
        expect(init?.method).toBe("POST");
        return ok({ access_token: "gho_user_token" });
      }
      if (href === "https://api.github.com/user") {
        return ok({ login: "octo" });
      }
      if (href === "https://api.github.com/user/installations?per_page=100") {
        return ok({
          installations: [
            { id: 42, app_slug: "research-network-app", account: { login: "octo", type: "User" } }
          ]
        });
      }
      if (href === "https://api.github.com/user/orgs?per_page=100") {
        return ok([]);
      }
      if (href === "https://api.github.com/user/installations/42/repositories?per_page=100") {
        return ok({ repositories: [{ id: 1, full_name: "octo/research", private: false, html_url: "https://github.com/octo/research" }] });
      }
      if (href.includes("/user/repos?")) {
        return ok([{ id: 1, full_name: "octo/research", private: false, html_url: "https://github.com/octo/research" }]);
      }
      throw new Error(`unexpected url ${href}`);
    }) as unknown as typeof fetch;

    try {
      const res = mockJsonResponse();
      await githubOauthHandler({
        method: "POST",
        body: { code: "dummy-code", zk_session_attestation: token },
        localnetRoot
      }, res);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.sui_address).toBe("0xzkaddress");
      expect(body.login).toBe("octo");
      expect(body.installations).toEqual([
        { id: 42, account: "octo", accountType: "User", appSlug: "research-network-app", repos: ["octo/research"] }
      ]);
      expect(body.binding_attestation_payload).toMatchObject({
        sub: "0xzkaddress",
        github_login: "octo",
        installation_id: 42
      });
    } finally {
      globalThis.fetch = originalFetch;
      await fs.rm(localnetRoot, { recursive: true, force: true });
    }
  });

  it("returns a server-signed GitHub binding attestation after verified OAuth", async () => {
    const localnetRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rn-gh-oauth-"));
    process.env.GITHUB_APP_CLIENT_ID = "Iv23test";
    process.env.GITHUB_APP_CLIENT_SECRET = "github-secret";
    process.env.GITHUB_APP_SLUG = "research-network-app";
    process.env.GOOGLE_CLIENT_ID = "google-client";
    process.env.ZKLOGIN_SALT_SECRET = "salt-secret";
    process.env.GITHUB_BINDING_ATTESTATION_SECRET = "binding-secret";
    const originalFetch = globalThis.fetch;
    const idToken = signTestJwt({
      iss: "https://accounts.google.com",
      sub: "user-abc",
      aud: "google-client",
      exp: Math.floor(Date.now() / 1000) + 600
    });
    globalThis.fetch = (async (url: unknown, init?: { method?: string }) => {
      const href = String(url);
      if (href === "https://www.googleapis.com/oauth2/v3/certs") {
        return ok({ keys: [oauthJwk] });
      }
      if (href === "https://github.com/login/oauth/access_token") {
        expect(init?.method).toBe("POST");
        return ok({ access_token: "gho_user_token" });
      }
      if (href === "https://api.github.com/user") {
        return ok({ login: "octo" });
      }
      if (href === "https://api.github.com/user/installations?per_page=100") {
        return ok({
          installations: [
            { id: 42, app_slug: "research-network-app", account: { login: "octo", type: "User" } },
            { id: 77, app_slug: "research-network-app", account: { login: "octo-org", type: "Organization" } },
            { id: 99, app_slug: "other-app", account: { login: "ignored-org" } }
          ]
        });
      }
      if (href === "https://api.github.com/user/orgs?per_page=100") {
        return ok([
          { id: 7, login: "octo-org", html_url: "https://github.com/octo-org" },
          { id: 8, login: "uninstalled-org", html_url: "https://github.com/uninstalled-org" }
        ]);
      }
      if (href === "https://api.github.com/user/installations/42/repositories?per_page=100") {
        return ok({ repositories: [{ full_name: "octo/research" }] });
      }
      if (href === "https://api.github.com/user/installations/77/repositories?per_page=100") {
        return ok({ repositories: [{ full_name: "octo-org/lab" }] });
      }
      if (href.includes("/user/repos?")) {
        return ok([
          { id: 1, full_name: "octo/research", private: false, html_url: "https://github.com/octo/research" },
          { id: 3, full_name: "octo-org/lab", private: true, html_url: "https://github.com/octo-org/lab" },
          { id: 2, full_name: "octo/private-notes", private: true, html_url: "https://github.com/octo/private-notes" }
        ]);
      }
      throw new Error(`unexpected url ${href}`);
    }) as unknown as typeof fetch;

    try {
      const res = mockJsonResponse();
      await githubOauthHandler({
        method: "POST",
        body: { code: "dummy-code", id_token: idToken },
        localnetRoot
      }, res);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toMatchObject({
        login: "octo",
        installed: true,
        installations: [
          { id: 42, account: "octo", accountType: "User", appSlug: "research-network-app", repos: ["octo/research"] },
          { id: 77, account: "octo-org", accountType: "Organization", appSlug: "research-network-app", repos: ["octo-org/lab"] }
        ]
      });
      expect(body.available_repositories).toEqual([
        { id: 1, full_name: "octo/research", private: false, html_url: "https://github.com/octo/research", granted: true, installation_id: 42, installation_account: "octo", installation_account_type: "User" },
        { id: 3, full_name: "octo-org/lab", private: true, html_url: "https://github.com/octo-org/lab", granted: true, installation_id: 77, installation_account: "octo-org", installation_account_type: "Organization" },
        { id: 2, full_name: "octo/private-notes", private: true, html_url: "https://github.com/octo/private-notes", granted: false, installation_id: null, installation_account: null, installation_account_type: null }
      ]);
      expect(body.organizations).toEqual([
        { id: 7, login: "octo-org", description: null, html_url: "https://github.com/octo-org", avatar_url: null, installed: true, installation_id: 77 },
        { id: 8, login: "uninstalled-org", description: null, html_url: "https://github.com/uninstalled-org", avatar_url: null, installed: false, installation_id: null }
      ]);
      expect(body.organization_scopes).toEqual([
        { id: "42", account: "octo", accountType: "User", installed: true, installation_id: 42, repos: ["octo/research"] },
        { id: "77", account: "octo-org", accountType: "Organization", installed: true, installation_id: 77, repos: ["octo-org/lab"] },
        { id: "uninstalled:uninstalled-org", account: "uninstalled-org", accountType: "Organization", installed: false, installation_id: null, repos: [] }
      ]);
      expect(body.binding_attestation_payload).toMatchObject({
        sub: body.sui_address,
        github_login: "octo",
        installation_id: 42,
        account: "octo",
        repos: ["octo/research"]
      });
      expect(body.binding_attestations["77"].binding_attestation_payload).toMatchObject({
        installation_id: 77,
        account: "octo-org",
        repos: ["octo-org/lab"]
      });
      expect(verifyGithubBindingAttestation(body.binding_attestation, {
        suiAddress: body.sui_address,
        installationId: 42,
        repos: ["octo/research"],
        secret: "binding-secret"
      })).toMatchObject({ github_login: "octo" });
      expect(body.server_persisted).toBe(true);
      expect(body.account_id).toMatch(/^acct:/);
      const auth = await readAuthState(localnetRoot);
      expect(auth.accounts[body.account_id]?.github_bindings).toEqual([
        expect.objectContaining({
          provider: "github",
          github_login: "octo",
          sui_address: body.sui_address,
          installation_id: 42,
          account: "octo",
          repos: ["octo/research"],
          binding_attestation: body.binding_attestation
        }),
        expect.objectContaining({
          provider: "github",
          github_login: "octo",
          sui_address: body.sui_address,
          installation_id: 77,
          account: "octo-org",
          repos: ["octo-org/lab"],
          binding_attestation: body.binding_attestations["77"].binding_attestation
        })
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      await fs.rm(localnetRoot, { recursive: true, force: true });
    }
  });
});
