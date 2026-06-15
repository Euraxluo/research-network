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
  headers?: { get: (name: string) => string | null };
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

export interface GithubUserSummary {
  id: number | null;
  login: string;
  html_url: string | null;
  avatar_url: string | null;
}

export interface GithubOrganizationSummary {
  id: number | null;
  login: string;
  description: string | null;
  html_url: string | null;
  avatar_url: string | null;
  installed?: boolean;
  installation_id?: number | null;
}

export interface GithubUserInstallationSummary {
  id: number;
  app_slug: string | null;
  repository_selection: string | null;
  account: {
    id: number | null;
    login: string | null;
    type: string | null;
    html_url: string | null;
    avatar_url: string | null;
  };
}

export interface GithubRepositorySummary {
  id: number | null;
  full_name: string;
  private: boolean;
  html_url: string | null;
  owner: {
    login: string | null;
    type: string | null;
  };
}

export interface GithubAuthorizedRepositorySummary extends GithubRepositorySummary {
  granted: boolean;
  installation_id: number | null;
  installation_account: string | null;
  installation_account_type: string | null;
}

export interface GithubAccountScopeSummary {
  id: string;
  account: string;
  accountType: string;
  installed: boolean;
  installation_id: number | null;
  repos: string[];
}

export interface GithubUserAccessSnapshot {
  user: GithubUserSummary;
  installations: Array<GithubUserInstallationSummary & { repos: string[] }>;
  organizations: GithubOrganizationSummary[];
  organization_scopes: GithubAccountScopeSummary[];
  available_repositories: GithubAuthorizedRepositorySummary[];
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

function githubApiBase(apiBaseUrl?: string): string {
  return (apiBaseUrl ?? "https://api.github.com").replace(/\/$/, "");
}

function githubUserHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "research-network-protocol-kit"
  };
}

function nextLink(linkHeader: string | null | undefined): string | null {
  if (!linkHeader) {
    return null;
  }
  for (const part of linkHeader.split(",")) {
    const [urlPart, ...params] = part.trim().split(";");
    if (params.some((param) => param.trim() === 'rel="next"')) {
      const match = urlPart.trim().match(/^<(.+)>$/);
      return match ? match[1] : null;
    }
  }
  return null;
}

async function getGithubJson(
  url: string,
  token: string,
  options: { fetchImpl?: FetchLike; label?: string } = {}
): Promise<{ body: any; link: string | null }> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!fetchImpl) {
    throw new Error("No fetch implementation available; pass fetchImpl");
  }
  const res = await fetchImpl(url, { headers: githubUserHeaders(token) });
  if (!res.ok) {
    throw new Error(`GitHub ${options.label ?? "GET"} failed: ${res.status} ${await res.text()}`);
  }
  return { body: await res.json(), link: res.headers?.get("link") ?? null };
}

async function paginateGithub<T>(
  firstUrl: string,
  token: string,
  extract: (body: any) => T[],
  options: { fetchImpl?: FetchLike; label?: string } = {}
): Promise<T[]> {
  const out: T[] = [];
  let url: string | null = firstUrl;
  let page = 1;
  while (url) {
    const { body, link } = await getGithubJson(url, token, options);
    const items = extract(body);
    out.push(...items);
    const fromLink = nextLink(link);
    if (fromLink) {
      url = fromLink;
    } else if (items.length >= 100 && !/[?&]page=\d+/.test(url)) {
      page += 1;
      url = `${url}${url.includes("?") ? "&" : "?"}page=${page}`;
    } else if (items.length >= 100) {
      page += 1;
      url = url.replace(/([?&]page=)\d+/, `$1${page}`);
    } else {
      url = null;
    }
  }
  return out;
}

function normalizeUser(body: any): GithubUserSummary {
  return {
    id: typeof body.id === "number" ? body.id : null,
    login: String(body.login ?? ""),
    html_url: body.html_url ? String(body.html_url) : null,
    avatar_url: body.avatar_url ? String(body.avatar_url) : null
  };
}

function normalizeOrg(body: any): GithubOrganizationSummary {
  return {
    id: typeof body.id === "number" ? body.id : null,
    login: String(body.login ?? ""),
    description: body.description ? String(body.description) : null,
    html_url: body.html_url ? String(body.html_url) : null,
    avatar_url: body.avatar_url ? String(body.avatar_url) : null
  };
}

function normalizeOrgMembership(body: any): GithubOrganizationSummary {
  return normalizeOrg(body?.organization ?? body);
}

function normalizeInstallation(body: any): GithubUserInstallationSummary {
  return {
    id: Number(body.id),
    app_slug: body.app_slug ? String(body.app_slug) : null,
    repository_selection: body.repository_selection ? String(body.repository_selection) : null,
    account: {
      id: typeof body.account?.id === "number" ? body.account.id : null,
      login: body.account?.login ? String(body.account.login) : null,
      type: body.account?.type ? String(body.account.type) : null,
      html_url: body.account?.html_url ? String(body.account.html_url) : null,
      avatar_url: body.account?.avatar_url ? String(body.account.avatar_url) : null
    }
  };
}

function normalizeRepo(body: any): GithubRepositorySummary {
  return {
    id: typeof body.id === "number" ? body.id : null,
    full_name: String(body.full_name ?? ""),
    private: Boolean(body.private),
    html_url: body.html_url ? String(body.html_url) : null,
    owner: {
      login: body.owner?.login ? String(body.owner.login) : (String(body.full_name ?? "").split("/")[0] || null),
      type: body.owner?.type ? String(body.owner.type) : null
    }
  };
}

export async function getAuthenticatedGithubUser(
  userAccessToken: string,
  options: { apiBaseUrl?: string; fetchImpl?: FetchLike } = {}
): Promise<GithubUserSummary> {
  const { body } = await getGithubJson(`${githubApiBase(options.apiBaseUrl)}/user`, userAccessToken, {
    fetchImpl: options.fetchImpl,
    label: "user fetch"
  });
  return normalizeUser(body);
}

export async function listUserOrgs(
  userAccessToken: string,
  options: { apiBaseUrl?: string; fetchImpl?: FetchLike } = {}
): Promise<GithubOrganizationSummary[]> {
  return paginateGithub<GithubOrganizationSummary>(
    `${githubApiBase(options.apiBaseUrl)}/user/orgs?per_page=100`,
    userAccessToken,
    (body) => Array.isArray(body) ? body.map((raw: any) => normalizeOrg(raw)).filter((org: GithubOrganizationSummary) => org.login) : [],
    { fetchImpl: options.fetchImpl, label: "org list" }
  );
}

export async function listUserOrgMemberships(
  userAccessToken: string,
  options: { apiBaseUrl?: string; fetchImpl?: FetchLike } = {}
): Promise<GithubOrganizationSummary[]> {
  return paginateGithub<GithubOrganizationSummary>(
    `${githubApiBase(options.apiBaseUrl)}/user/memberships/orgs?per_page=100`,
    userAccessToken,
    (body) => Array.isArray(body) ? body.map((raw: any) => normalizeOrgMembership(raw)).filter((org: GithubOrganizationSummary) => org.login) : [],
    { fetchImpl: options.fetchImpl, label: "org membership list" }
  );
}

async function listUserOrganizations(
  userAccessToken: string,
  options: { apiBaseUrl?: string; fetchImpl?: FetchLike } = {}
): Promise<GithubOrganizationSummary[]> {
  const [memberships, orgs] = await Promise.all([
    listUserOrgMemberships(userAccessToken, options).catch(() => [] as GithubOrganizationSummary[]),
    listUserOrgs(userAccessToken, options).catch(() => [] as GithubOrganizationSummary[])
  ]);
  const byLogin = new Map<string, GithubOrganizationSummary>();
  for (const org of [...memberships, ...orgs]) {
    if (org.login && !byLogin.has(org.login)) {
      byLogin.set(org.login, org);
    }
  }
  return [...byLogin.values()].sort((a, b) => a.login.localeCompare(b.login));
}

export async function listUserInstallations(
  userAccessToken: string,
  options: { apiBaseUrl?: string; fetchImpl?: FetchLike; appSlug?: string } = {}
): Promise<GithubUserInstallationSummary[]> {
  const installations = await paginateGithub<GithubUserInstallationSummary>(
    `${githubApiBase(options.apiBaseUrl)}/user/installations?per_page=100`,
    userAccessToken,
    (body) => Array.isArray(body?.installations)
      ? body.installations.map((raw: any) => normalizeInstallation(raw)).filter((installation: GithubUserInstallationSummary) => Number.isFinite(installation.id))
      : [],
    { fetchImpl: options.fetchImpl, label: "installation list" }
  );
  return options.appSlug
    ? installations.filter((installation) => installation.app_slug === options.appSlug)
    : installations;
}

export async function listInstallationRepos(
  userAccessToken: string,
  installationId: string | number,
  options: { apiBaseUrl?: string; fetchImpl?: FetchLike } = {}
): Promise<GithubRepositorySummary[]> {
  return paginateGithub<GithubRepositorySummary>(
    `${githubApiBase(options.apiBaseUrl)}/user/installations/${installationId}/repositories?per_page=100`,
    userAccessToken,
    (body) => Array.isArray(body?.repositories)
      ? body.repositories.map((raw: any) => normalizeRepo(raw)).filter((repo: GithubRepositorySummary) => repo.full_name)
      : [],
    { fetchImpl: options.fetchImpl, label: "installation repo list" }
  );
}

export async function listUserRepositories(
  userAccessToken: string,
  options: { apiBaseUrl?: string; fetchImpl?: FetchLike } = {}
): Promise<GithubRepositorySummary[]> {
  return paginateGithub<GithubRepositorySummary>(
    `${githubApiBase(options.apiBaseUrl)}/user/repos?per_page=100&affiliation=owner,collaborator,organization_member&visibility=all&sort=updated`,
    userAccessToken,
    (body) => Array.isArray(body) ? body.map((raw: any) => normalizeRepo(raw)).filter((repo: GithubRepositorySummary) => repo.full_name) : [],
    { fetchImpl: options.fetchImpl, label: "user repo list" }
  );
}

export function buildGithubAccountScopes(params: {
  user: GithubUserSummary;
  installations: Array<GithubUserInstallationSummary & { repos: string[] }>;
  organizations?: GithubOrganizationSummary[];
}): GithubAccountScopeSummary[] {
  const byAccount = new Map<string, GithubAccountScopeSummary>();
  for (const installation of params.installations) {
    const account = installation.account.login ?? "GitHub";
    const accountType = installation.account.type ?? "Account";
    const key = `${account}\0${accountType}`;
    const existing = byAccount.get(key);
    const repos = [...new Set(installation.repos)].sort((a, b) => a.localeCompare(b));
    if (existing) {
      existing.repos = [...new Set([...existing.repos, ...repos])].sort((a, b) => a.localeCompare(b));
    } else {
      byAccount.set(key, {
        id: String(installation.id),
        account,
        accountType,
        installed: true,
        installation_id: installation.id,
        repos
      });
    }
  }
  if (params.user.login) {
    const key = `${params.user.login}\0User`;
    if (!byAccount.has(key)) {
      byAccount.set(key, {
        id: `uninstalled:${params.user.login}`,
        account: params.user.login,
        accountType: "User",
        installed: false,
        installation_id: null,
        repos: []
      });
    }
  }
  for (const org of params.organizations ?? []) {
    if (!org.login) {
      continue;
    }
    const key = `${org.login}\0Organization`;
    if (!byAccount.has(key)) {
      byAccount.set(key, {
        id: `uninstalled:${org.login}`,
        account: org.login,
        accountType: "Organization",
        installed: false,
        installation_id: null,
        repos: []
      });
    }
  }
  return [...byAccount.values()].sort((a, b) => {
    if (a.installed !== b.installed) {
      return a.installed ? -1 : 1;
    }
    return a.account.localeCompare(b.account);
  });
}

export async function collectGithubUserAccess(
  userAccessToken: string,
  options: { apiBaseUrl?: string; fetchImpl?: FetchLike; appSlug?: string } = {}
): Promise<GithubUserAccessSnapshot> {
  const [user, installations, organizations] = await Promise.all([
    getAuthenticatedGithubUser(userAccessToken, options),
    listUserInstallations(userAccessToken, options),
    listUserOrganizations(userAccessToken, options)
  ]);
  const installedWithRepos: Array<GithubUserInstallationSummary & { repos: string[] }> = [];
  const grantedRepoInstallations = new Map<string, { installationId: number; account: string | null; accountType: string | null }>();
  for (const installation of installations) {
    const repos = (await listInstallationRepos(userAccessToken, installation.id, options)).map((repo) => repo.full_name);
    const dedupedRepos = [...new Set(repos)].sort((a, b) => a.localeCompare(b));
    installedWithRepos.push({ ...installation, repos: dedupedRepos });
    for (const fullName of dedupedRepos) {
      grantedRepoInstallations.set(fullName, {
        installationId: installation.id,
        account: installation.account.login,
        accountType: installation.account.type
      });
    }
  }

  const availableRepositories: GithubAuthorizedRepositorySummary[] = [];
  try {
    for (const repo of await listUserRepositories(userAccessToken, options)) {
      const grant = grantedRepoInstallations.get(repo.full_name);
      availableRepositories.push({
        ...repo,
        granted: Boolean(grant),
        installation_id: grant?.installationId ?? null,
        installation_account: grant?.account ?? null,
        installation_account_type: grant?.accountType ?? null
      });
    }
  } catch {
    // Repository enumeration is a best-effort UX enhancement; installation repos are authoritative.
  }
  for (const [fullName, grant] of grantedRepoInstallations) {
    if (!availableRepositories.some((repo) => repo.full_name === fullName)) {
      availableRepositories.push({
        id: null,
        full_name: fullName,
        private: false,
        html_url: `https://github.com/${fullName}`,
        owner: { login: fullName.split("/")[0] ?? null, type: null },
        granted: true,
        installation_id: grant.installationId,
        installation_account: grant.account,
        installation_account_type: grant.accountType
      });
    }
  }

  const installedByLogin = new Map(installedWithRepos.map((installation) => [installation.account.login, installation.id]));
  const normalizedOrganizations = organizations.map((org) => ({
    ...org,
    installed: installedByLogin.has(org.login),
    installation_id: installedByLogin.get(org.login) ?? null
  }));
  return {
    user,
    installations: installedWithRepos,
    organizations: normalizedOrganizations,
    organization_scopes: buildGithubAccountScopes({ user, installations: installedWithRepos, organizations: normalizedOrganizations }),
    available_repositories: availableRepositories
  };
}

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
