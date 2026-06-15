import { createSign } from "node:crypto";
import YAML from "yaml";
import { type ResearchAssetManifest } from "./types.js";

/** Minimal structural subset of the global `fetch` Response we depend on. Lets tests inject a
 *  mock without pulling in an HTTP library; production uses the platform `fetch`. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json: () => Promise<any>;
  text: () => Promise<string>;
}

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<FetchResponseLike>;

export interface GithubAppConfig {
  appId: string;
  /** PEM-encoded RSA private key of the GitHub App (the `.pem` you download from the App settings). */
  privateKeyPem: string;
  apiBaseUrl?: string;
  fetchImpl?: FetchLike;
}

export interface RepoRef {
  owner: string;
  repo: string;
  ref?: string;
}

export interface RepoTreeEntry {
  path: string;
  type: string;
  sha: string;
  size?: number;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Create a GitHub App JWT (RS256) used to mint installation tokens. Real signing — no network.
 *  `nowSeconds` is injectable for deterministic tests. */
export function createAppJwt(appId: string, privateKeyPem: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  // iat backdated 60s to tolerate clock skew; exp <= 10 min per GitHub's limit.
  const payload = base64url(JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: appId }));
  const signingInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = base64url(signer.sign(privateKeyPem));
  return `${signingInput}.${signature}`;
}

const API_VERSION = "2022-11-28";
const TOKEN_EXPIRY_SKEW_MS = 5 * 60 * 1000;

/** A real GitHub App API client: app-JWT → installation token → repo reads / fork.
 *  All HTTP goes through an injectable `fetchImpl`, so the flow is exercised in tests with a
 *  mock and goes live unchanged once real App credentials are supplied. */
export class GithubAppClient {
  private readonly api: string;
  private readonly fetchImpl: FetchLike;
  private readonly tokenCache = new Map<string, { token: string; expiresAt?: string; expiresAtMs: number }>();

  constructor(private readonly config: GithubAppConfig) {
    this.api = (config.apiBaseUrl ?? "https://api.github.com").replace(/\/$/, "");
    const platformFetch = config.fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
    if (!platformFetch) {
      throw new Error("No fetch implementation available; pass fetchImpl in GithubAppConfig");
    }
    this.fetchImpl = platformFetch;
  }

  private authHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": "research-network-protocol-kit"
    };
  }

  private async getJson(url: string, token: string): Promise<any> {
    const res = await this.fetchImpl(url, { headers: this.authHeaders(token) });
    if (!res.ok) {
      throw new Error(`GitHub GET ${url} failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }

  /** Exchange the app JWT for a short-lived installation access token. Tokens are cached until
   *  shortly before expiry (docs/04: short-term cache) to avoid re-minting on every call. */
  async getInstallationToken(installationId: string, nowSeconds?: number): Promise<{ token: string; expiresAt?: string }> {
    const now = (nowSeconds ?? Math.floor(Date.now() / 1000)) * 1000;
    const cached = this.tokenCache.get(installationId);
    if (cached && cached.expiresAtMs - TOKEN_EXPIRY_SKEW_MS > now) {
      return { token: cached.token, expiresAt: cached.expiresAt };
    }
    const jwt = createAppJwt(this.config.appId, this.config.privateKeyPem, nowSeconds);
    const res = await this.fetchImpl(`${this.api}/app/installations/${installationId}/access_tokens`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "research-network-protocol-kit"
      }
    });
    if (!res.ok) {
      throw new Error(`GitHub installation token failed: ${res.status} ${await res.text()}`);
    }
    const body = await res.json();
    const token = String(body.token);
    const expiresAt = body.expires_at ? String(body.expires_at) : undefined;
    const expiresAtMs = expiresAt ? Date.parse(expiresAt) : now + 55 * 60 * 1000;
    this.tokenCache.set(installationId, { token, expiresAt, expiresAtMs });
    return { token, expiresAt };
  }

  /** Resolve a branch/tag/sha ref to a concrete commit sha. */
  async resolveCommit(token: string, ref: RepoRef): Promise<string> {
    const body = await this.getJson(`${this.api}/repos/${ref.owner}/${ref.repo}/commits/${ref.ref ?? "HEAD"}`, token);
    return String(body.sha);
  }

  /** List the repository file tree (recursive) at a ref. Fails loudly when GitHub truncates the
   *  listing (huge repos) instead of silently returning an incomplete manifest discovery. */
  async getRepoTree(token: string, ref: RepoRef): Promise<RepoTreeEntry[]> {
    const body = await this.getJson(`${this.api}/repos/${ref.owner}/${ref.repo}/git/trees/${ref.ref ?? "HEAD"}?recursive=1`, token);
    if (body.truncated === true) {
      throw new Error(`GitHub tree listing for ${ref.owner}/${ref.repo} was truncated; repository too large for recursive tree API`);
    }
    return (body.tree ?? []).map((entry: any) => ({
      path: String(entry.path),
      type: String(entry.type),
      sha: String(entry.sha),
      size: typeof entry.size === "number" ? entry.size : undefined
    }));
  }

  /** Fetch and decode a UTF-8 file from the repo. Files >1MB are not inlined by the contents
   *  API; fall back to the git blob API (works up to 100MB). */
  async getFileContent(token: string, ref: RepoRef, filePath: string): Promise<string> {
    const url = `${this.api}/repos/${ref.owner}/${ref.repo}/contents/${filePath}${ref.ref ? `?ref=${encodeURIComponent(ref.ref)}` : ""}`;
    const body = await this.getJson(url, token);
    if (body.encoding === "base64" && typeof body.content === "string") {
      return Buffer.from(body.content, "base64").toString("utf8");
    }
    if (body.encoding === "none" && typeof body.sha === "string") {
      const blob = await this.getJson(`${this.api}/repos/${ref.owner}/${ref.repo}/git/blobs/${body.sha}`, token);
      if (blob.encoding === "base64" && typeof blob.content === "string") {
        return Buffer.from(blob.content, "base64").toString("utf8");
      }
      throw new Error(`Unexpected blob response for ${filePath}`);
    }
    if (typeof body.content === "string") {
      return body.content;
    }
    throw new Error(`Unexpected contents response for ${filePath}`);
  }

  /** Read and parse the research asset manifest (`asset.yaml`) from a connected repo. */
  async readAssetManifest(token: string, ref: RepoRef, manifestPath = "asset.yaml"): Promise<ResearchAssetManifest> {
    const text = await this.getFileContent(token, ref, manifestPath);
    return YAML.parse(text) as ResearchAssetManifest;
  }

  /** Create a fork of a repository (workflow B "fork workspace creator", repo side). */
  async forkRepo(token: string, ref: RepoRef): Promise<{ fullName: string; htmlUrl: string; owner: string; repo: string }> {
    const res = await this.fetchImpl(`${this.api}/repos/${ref.owner}/${ref.repo}/forks`, {
      method: "POST",
      headers: this.authHeaders(token)
    });
    if (!res.ok) {
      throw new Error(`GitHub fork failed: ${res.status} ${await res.text()}`);
    }
    const body = await res.json();
    return {
      fullName: String(body.full_name),
      htmlUrl: String(body.html_url),
      owner: String(body.owner?.login ?? ""),
      repo: String(body.name ?? "")
    };
  }
}

/** Build a client from environment variables. `GITHUB_APP_PRIVATE_KEY` may be raw PEM or
 *  base64-encoded PEM (base64 is convenient for single-line env vars). */
export function githubAppFromEnv(env: NodeJS.ProcessEnv = process.env, fetchImpl?: FetchLike): GithubAppClient {
  const appId = env.GITHUB_APP_ID;
  let privateKeyPem = env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKeyPem) {
    throw new Error("GitHub App not configured: set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY");
  }
  if (!privateKeyPem.includes("BEGIN")) {
    privateKeyPem = Buffer.from(privateKeyPem, "base64").toString("utf8");
  }
  return new GithubAppClient({ appId, privateKeyPem, apiBaseUrl: env.GITHUB_API_BASE_URL, fetchImpl });
}

/** High-level "connect a repo" used by API/CLI: mint a token, resolve the commit, list the
 *  tree, and read asset.yaml. Returns everything the indexer/packager needs to ingest a repo. */
export async function connectGithubRepo(
  client: GithubAppClient,
  params: { installationId: string; owner: string; repo: string; ref?: string }
): Promise<{ commit: string; tree: RepoTreeEntry[]; manifest: ResearchAssetManifest | null }> {
  const { token } = await client.getInstallationToken(params.installationId);
  const ref: RepoRef = { owner: params.owner, repo: params.repo, ref: params.ref };
  const commit = await client.resolveCommit(token, ref);
  const pinned: RepoRef = { ...ref, ref: commit };
  const tree = await client.getRepoTree(token, pinned);
  let manifest: ResearchAssetManifest | null = null;
  if (tree.some((entry) => entry.path === "asset.yaml")) {
    manifest = await client.readAssetManifest(token, pinned);
  }
  return { commit, tree, manifest };
}
