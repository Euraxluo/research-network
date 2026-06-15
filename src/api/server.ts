import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import express from "express";
import {
  acceptDelegationJob,
  buyPlatformMembership,
  completeDelegationJob,
  createAccessIntent,
  createDelegationJob,
  openDispute,
  publishResearchReport,
  publishWorkspace,
  recordAccessReceipt,
  settleMembershipPeriod,
  submitPrivateResult,
  subscribeAgent
} from "../core/adapters.js";
import { registerAgentPassport } from "../core/agents.js";
import { completeAuthLogin, startAuthLogin } from "../core/auth.js";
import { getGraph, replayIndexer, searchIndex, summarizeAssetEconomics } from "../core/indexer.js";
import { collectGithubUserAccess, connectGithubRepo, githubAppFromEnv } from "../core/github.js";
import { decodeJwtClaims, deriveUserSalt, deriveZkLoginAddress, requestZkProof, verifyJwt } from "../core/zklogin.js";
import { readAuthState, readIndex } from "../core/local-store.js";
import { forkWorkspace, installSkill } from "../core/workspace.js";
import { validateWorkspace } from "../core/validator.js";
import type { CrossChainAuthProvider, GitProvider, WalletBinding } from "../core/types.js";

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);

function hostnameOf(hostHeader: string): string {
  return hostHeader.replace(/^\[/, "").replace(/\]$/, "").replace(/:\d+$/, "").replace(/\]$/, "");
}

class HttpError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message?: string) {
    super(message ?? code);
  }
}

/** Confine a caller-supplied path inside `root` — the API must never write/read outside the
 *  workspace root no matter what the request body says (D-17 drive-by hardening). */
function resolveWithinRoot(root: string, candidate: string, label: string): string {
  const resolved = path.resolve(root, candidate);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new HttpError(400, "path_outside_workspace_root", `${label} must stay within the workspace root`);
  }
  return resolved;
}

function constantTimeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

function requireGithubForkAuthorization(req: express.Request): void {
  const expected = process.env.RN_GITHUB_FORK_API_TOKEN;
  if (!expected) {
    throw new HttpError(503, "github_fork_not_enabled");
  }
  const header = String(req.headers.authorization ?? "");
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!token || !constantTimeEqual(token, expected)) {
    throw new HttpError(401, "github_fork_unauthorized");
  }
}

function requireGithubUserAccessToken(req: express.Request): string {
  const header = String(req.headers.authorization ?? "");
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token) {
    throw new HttpError(401, "github_user_token_required");
  }
  return token;
}

export function createApiServer(options: { localnetRoot?: string; workspaceRoot?: string; allowRemote?: boolean } = {}) {
  const app = express();
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  app.use(express.json({ limit: "2mb" }));

  // This is a LOCAL API. Reject non-local Host headers (DNS rebinding) and cross-site browser
  // requests (any web page can POST to http://127.0.0.1:* — Origin gives that away).
  if (!options.allowRemote) {
    app.use((req, res, next) => {
      const host = hostnameOf(String(req.headers.host ?? ""));
      if (!LOCAL_HOSTNAMES.has(host)) {
        res.status(403).json({ error: "forbidden_host" });
        return;
      }
      const origin = req.headers.origin;
      if (origin) {
        try {
          if (!LOCAL_HOSTNAMES.has(new URL(String(origin)).hostname)) {
            res.status(403).json({ error: "forbidden_origin" });
            return;
          }
        } catch {
          res.status(403).json({ error: "forbidden_origin" });
          return;
        }
      }
      next();
    });
  }

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "research-network-protocol-kit" });
  });

  app.post("/api/auth/login/start", async (req, res, next) => {
    try {
      res.json(await startAuthLogin({
        provider: String(req.body?.provider ?? "github") as GitProvider | CrossChainAuthProvider,
        redirectUri: String(req.body?.redirectUri ?? req.body?.redirect_uri ?? "http://127.0.0.1:8787/api/auth/callback"),
        clientId: String(req.body?.clientId ?? req.body?.client_id ?? "local-dev-client"),
        scopes: Array.isArray(req.body?.scopes) ? req.body.scopes.map(String) : undefined,
        // `state` is always generated server-side (D-16): a caller-chosen state is predictable
        // and lets an attacker pre-stage an intent it can later complete.
        giteaBaseUrl: req.body?.giteaBaseUrl ? String(req.body.giteaBaseUrl) : undefined,
        externalAuthorizeUrl: req.body?.externalAuthorizeUrl ? String(req.body.externalAuthorizeUrl) : undefined,
        externalIssuer: req.body?.externalIssuer ? String(req.body.externalIssuer) : undefined,
        externalWallets: Array.isArray(req.body?.externalWallets) ? req.body.externalWallets.map(String) as WalletBinding["chain"][] : undefined,
        externalSupportsGitLinking: typeof req.body?.externalSupportsGitLinking === "boolean" ? req.body.externalSupportsGitLinking : undefined,
        zkLogin: typeof req.body?.zkLogin === "boolean" ? req.body.zkLogin : undefined,
        zkLoginIssuer: req.body?.zkLoginIssuer ? String(req.body.zkLoginIssuer) : undefined,
        zkLoginProverUrl: req.body?.zkLoginProverUrl ? String(req.body.zkLoginProverUrl) : undefined,
        localnetRoot: options.localnetRoot
      }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/login/complete", async (req, res, next) => {
    try {
      res.json(await completeAuthLogin({
        intentId: req.body?.intentId ? String(req.body.intentId) : undefined,
        state: req.body?.state ? String(req.body.state) : undefined,
        issuer: req.body?.issuer ? String(req.body.issuer) : undefined,
        subject: req.body?.subject ? String(req.body.subject) : undefined,
        audience: req.body?.audience ? String(req.body.audience) : undefined,
        displayName: req.body?.displayName ? String(req.body.displayName) : undefined,
        git: req.body?.git,
        jwt: req.body?.jwt ? String(req.body.jwt) : undefined,
        wallets: Array.isArray(req.body?.wallets) ? req.body.wallets : undefined,
        // `roles` are adjudicated server-side (D-14): requests cannot self-assign e.g. admin.
        localnetRoot: options.localnetRoot
      }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/auth/accounts/:id", async (req, res, next) => {
    try {
      const auth = await readAuthState(options.localnetRoot);
      const account = auth.accounts[req.params.id];
      if (!account) {
        res.status(404).json({ error: "account_not_found" });
        return;
      }
      res.json(account);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/search", async (req, res, next) => {
    try {
      res.json({ results: await searchIndex(String(req.query.q ?? ""), req.query.type ? String(req.query.type) : undefined, options.localnetRoot) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/assets/:id", async (req, res, next) => {
    try {
      const index = await readIndex(options.localnetRoot);
      const asset = index.assets[req.params.id];
      if (!asset) {
        res.status(404).json({ error: "asset_not_found" });
        return;
      }
      res.json(asset);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/assets/:id/manifest", async (req, res, next) => {
    try {
      const index = await readIndex(options.localnetRoot);
      const asset = index.assets[req.params.id];
      if (!asset) {
        res.status(404).json({ error: "asset_not_found" });
        return;
      }
      res.json(asset.manifest);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/assets/:id/fork", async (req, res, next) => {
    try {
      const requested = String(req.body?.target ?? `./forks/${req.params.id.replaceAll(":", "-")}`);
      const target = resolveWithinRoot(workspaceRoot, requested, "fork target");
      const include = Array.isArray(req.body?.include) ? req.body.include.map(String) : undefined;
      res.json({ target: await forkWorkspace({ assetId: req.params.id, target, include, localnetRoot: options.localnetRoot }) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/skills/:id", async (req, res, next) => {
    try {
      const index = await readIndex(options.localnetRoot);
      const skill = index.skills[req.params.id];
      if (!skill) {
        res.status(404).json({ error: "skill_not_found" });
        return;
      }
      res.json(skill);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/skills/:id/install", async (req, res, next) => {
    try {
      res.json(await installSkill({
        skillId: req.params.id,
        workspace: resolveWithinRoot(workspaceRoot, String(req.body?.workspace ?? "."), "install workspace"),
        mode: req.body?.mode === "vendored" ? "vendored" : "referenced",
        localnetRoot: options.localnetRoot
      }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/publish/github", async (req, res, next) => {
    try {
      const repoPath = resolveWithinRoot(workspaceRoot, String(req.body?.repoPath ?? req.body?.repo ?? "."), "repoPath");
      res.json(await publishWorkspace(repoPath, options.localnetRoot));
    } catch (error) {
      next(error);
    }
  });

  // Real GitHub App: connect a repo (mint installation token → resolve commit → tree → asset.yaml).
  // Requires GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY in the environment.
  app.get("/api/github/installations", async (req, res, next) => {
    try {
      const snapshot = await collectGithubUserAccess(requireGithubUserAccessToken(req), {
        appSlug: process.env.GITHUB_APP_SLUG
      });
      res.json({
        login: snapshot.user.login,
        installed: snapshot.installations.length > 0,
        installations: snapshot.installations.map((installation) => ({
          id: installation.id,
          account: installation.account.login,
          accountType: installation.account.type,
          appSlug: installation.app_slug,
          repos: installation.repos
        })),
        organizations: snapshot.organizations,
        organization_scopes: snapshot.organization_scopes,
        available_repositories: snapshot.available_repositories.map((repo) => ({
          id: repo.id,
          full_name: repo.full_name,
          private: repo.private,
          html_url: repo.html_url,
          granted: repo.granted,
          installation_id: repo.installation_id,
          installation_account: repo.installation_account,
          installation_account_type: repo.installation_account_type
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/github/orgs", async (req, res, next) => {
    try {
      const snapshot = await collectGithubUserAccess(requireGithubUserAccessToken(req), {
        appSlug: process.env.GITHUB_APP_SLUG
      });
      res.json({
        login: snapshot.user.login,
        organizations: snapshot.organizations,
        organization_scopes: snapshot.organization_scopes
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/github/connect", async (req, res, next) => {
    try {
      const client = githubAppFromEnv();
      res.json(await connectGithubRepo(client, {
        installationId: String(req.body?.installationId ?? req.body?.installation_id ?? ""),
        owner: String(req.body?.owner ?? ""),
        repo: String(req.body?.repo ?? ""),
        ref: req.body?.ref ? String(req.body.ref) : undefined
      }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/github/fork", async (req, res, next) => {
    try {
      requireGithubForkAuthorization(req);
      const client = githubAppFromEnv();
      const installationId = String(req.body?.installationId ?? req.body?.installation_id ?? "");
      const { token } = await client.getInstallationToken(installationId);
      res.json(await client.forkRepo(token, {
        owner: String(req.body?.owner ?? ""),
        repo: String(req.body?.repo ?? "")
      }));
    } catch (error) {
      next(error);
    }
  });

  // Real zkLogin: derive the canonical Sui address from an OIDC id_token. The token signature
  // is verified against the issuer's JWKS unless RN_ALLOW_UNVERIFIED_JWT=1 (local dev only) —
  // this endpoint reaches the platform salt, so unverified JWTs must not get salts (D-14).
  app.post("/api/zklogin/address", async (req, res, next) => {
    try {
      const jwt = String(req.body?.jwt ?? "");
      if (!jwt) {
        res.status(400).json({ error: "jwt_required" });
        return;
      }
      const claims = process.env.RN_ALLOW_UNVERIFIED_JWT === "1"
        ? decodeJwtClaims(jwt)
        : await verifyJwt(jwt);
      const salt = req.body?.salt
        ? String(req.body.salt)
        : deriveUserSalt({ issuer: claims.iss, subject: claims.sub, audience: claims.aud });
      res.json({ address: deriveZkLoginAddress(jwt, salt), issuer: claims.iss, subject: claims.sub, audience: claims.aud });
    } catch (error) {
      next(error);
    }
  });

  // Proxy to a zkLogin prover (set ZKLOGIN_PROVER_URL) to obtain the ZK proof for a JWT.
  app.post("/api/zklogin/prove", async (req, res, next) => {
    try {
      const proverUrl = process.env.ZKLOGIN_PROVER_URL;
      if (!proverUrl) {
        res.status(500).json({ error: "prover_not_configured", message: "Set ZKLOGIN_PROVER_URL" });
        return;
      }
      res.json(await requestZkProof(proverUrl, {
        jwt: String(req.body?.jwt ?? ""),
        extendedEphemeralPublicKey: String(req.body?.extendedEphemeralPublicKey ?? ""),
        maxEpoch: Number(req.body?.maxEpoch ?? 0),
        jwtRandomness: String(req.body?.jwtRandomness ?? ""),
        salt: String(req.body?.salt ?? "")
      }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/validate", async (req, res, next) => {
    try {
      res.json(await validateWorkspace(resolveWithinRoot(workspaceRoot, String(req.body?.workspace ?? "."), "workspace")));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/access/intent", async (req, res, next) => {
    try {
      const kind = String(req.body?.kind ?? "platform_membership") as "platform_membership" | "agent_subscription" | "private_delegation";
      if (!["platform_membership", "agent_subscription", "private_delegation"].includes(kind)) {
        res.status(400).json({ error: "invalid_access_intent_kind" });
        return;
      }
      res.json(createAccessIntent(kind, String(req.body?.buyer ?? "0x0"), req.body?.target ? String(req.body.target) : undefined));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/membership/buy", async (req, res, next) => {
    try {
      res.json(await buyPlatformMembership({
        ownerAddress: String(req.body?.ownerAddress ?? req.body?.owner ?? "0x0"),
        tier: Number(req.body?.tier ?? 1),
        durationDays: Number(req.body?.durationDays ?? req.body?.duration_days ?? 30),
        passId: req.body?.passId ? String(req.body.passId) : undefined,
        localnetRoot: options.localnetRoot
      }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/agents/:agent/subscribe", async (req, res, next) => {
    try {
      res.json(await subscribeAgent({
        ownerAddress: String(req.body?.ownerAddress ?? req.body?.owner ?? "0x0"),
        agent: req.params.agent,
        tier: Number(req.body?.tier ?? 1),
        durationDays: Number(req.body?.durationDays ?? req.body?.duration_days ?? 30),
        amount: Number(req.body?.amount ?? 0),
        platformFeeBps: Number(req.body?.platformFeeBps ?? req.body?.platform_fee_bps ?? 1500),
        passId: req.body?.passId ? String(req.body.passId) : undefined,
        localnetRoot: options.localnetRoot
      }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/delegations", async (req, res, next) => {
    try {
      res.json(await createDelegationJob({
        buyer: String(req.body?.buyer ?? "0x0"),
        agent: String(req.body?.agent ?? "0x0"),
        budget: Number(req.body?.budget ?? 0),
        deadlineMs: req.body?.deadlineMs ?? req.body?.deadline_ms ? Number(req.body?.deadlineMs ?? req.body?.deadline_ms) : undefined,
        jobId: req.body?.jobId ? String(req.body.jobId) : undefined,
        localnetRoot: options.localnetRoot
      }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/delegations/:id/accept", async (req, res, next) => {
    try {
      res.json(await acceptDelegationJob({
        jobId: req.params.id,
        agent: String(req.body?.agent ?? "0x0"),
        localnetRoot: options.localnetRoot
      }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/delegations/:id/submit", async (req, res, next) => {
    try {
      res.json(await submitPrivateResult({
        jobId: req.params.id,
        agent: String(req.body?.agent ?? "0x0"),
        title: req.body?.title ? String(req.body.title) : undefined,
        reportId: req.body?.reportId ? String(req.body.reportId) : undefined,
        walrusBlobId: String(req.body?.walrusBlobId ?? req.body?.walrus_blob_id ?? ""),
        sealId: String(req.body?.sealId ?? req.body?.seal_id ?? ""),
        ciphertextHash: String(req.body?.ciphertextHash ?? req.body?.ciphertext_hash ?? ""),
        plaintextCommitment: String(req.body?.plaintextCommitment ?? req.body?.plaintext_commitment ?? ""),
        freePreviewHash: req.body?.freePreviewHash ?? req.body?.free_preview_hash ? String(req.body?.freePreviewHash ?? req.body?.free_preview_hash) : undefined,
        localnetRoot: options.localnetRoot
      }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/delegations/:id/complete", async (req, res, next) => {
    try {
      res.json(await completeDelegationJob({
        jobId: req.params.id,
        payout: req.body?.payout ? Number(req.body.payout) : undefined,
        localnetRoot: options.localnetRoot
      }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/delegations/:id/dispute", async (req, res, next) => {
    try {
      res.json(await openDispute({
        jobId: req.params.id,
        openedBy: String(req.body?.openedBy ?? req.body?.opened_by ?? "0x0"),
        arbitrator: String(req.body?.arbitrator ?? "0x0"),
        localnetRoot: options.localnetRoot
      }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/access/receipt", async (req, res, next) => {
    try {
      const accessType = String(req.body?.accessType ?? req.body?.access_type ?? "platform_member");
      if (!["platform_member", "agent_subscription"].includes(accessType)) {
        res.status(400).json({ error: "invalid_access_type" });
        return;
      }
      res.json(await recordAccessReceipt({
        periodId: Number(req.body?.periodId ?? req.body?.period_id ?? 0),
        user: String(req.body?.user ?? "0x0"),
        reportId: String(req.body?.reportId ?? req.body?.report_id ?? ""),
        agent: String(req.body?.agent ?? "0x0"),
        accessType: accessType as "platform_member" | "agent_subscription",
        receiptId: req.body?.receiptId ? String(req.body.receiptId) : undefined,
        localnetRoot: options.localnetRoot
      }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/membership/settle", async (req, res, next) => {
    try {
      res.json(await settleMembershipPeriod({
        periodId: Number(req.body?.periodId ?? req.body?.period_id ?? 0),
        user: String(req.body?.user ?? "0x0"),
        grossAmount: Number(req.body?.grossAmount ?? req.body?.gross_amount ?? 0),
        platformFeeBps: Number(req.body?.platformFeeBps ?? req.body?.platform_fee_bps ?? 1500),
        localnetRoot: options.localnetRoot
      }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/graph/:id", async (req, res, next) => {
    try {
      res.json(await getGraph(req.params.id, options.localnetRoot));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/assets/:id/economics", async (req, res, next) => {
    try {
      const index = await readIndex(options.localnetRoot);
      res.json(summarizeAssetEconomics(index, req.params.id));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/reports", async (_req, res, next) => {
    try {
      const index = await readIndex(options.localnetRoot);
      res.json({ reports: Object.values(index.reports) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/reports", async (req, res, next) => {
    try {
      const visibility = String(req.body?.visibility ?? "public");
      if (!["public", "encrypted", "private_delegation"].includes(visibility)) {
        res.status(400).json({ error: "invalid_report_visibility" });
        return;
      }
      res.json(await publishResearchReport({
        agent: String(req.body?.agent ?? "0x0"),
        title: String(req.body?.title ?? "Untitled report"),
        visibility: visibility as "public" | "encrypted" | "private_delegation",
        requiredTier: req.body?.requiredTier ?? req.body?.required_tier ? Number(req.body?.requiredTier ?? req.body?.required_tier) : undefined,
        assetId: req.body?.assetId ?? req.body?.asset_id ? String(req.body?.assetId ?? req.body?.asset_id) : undefined,
        reportId: req.body?.reportId ?? req.body?.report_id ? String(req.body?.reportId ?? req.body?.report_id) : undefined,
        walrusBlobId: req.body?.walrusBlobId ?? req.body?.walrus_blob_id ? String(req.body?.walrusBlobId ?? req.body?.walrus_blob_id) : undefined,
        sealId: req.body?.sealId ?? req.body?.seal_id ? String(req.body?.sealId ?? req.body?.seal_id) : undefined,
        ciphertextHash: req.body?.ciphertextHash ?? req.body?.ciphertext_hash ? String(req.body?.ciphertextHash ?? req.body?.ciphertext_hash) : undefined,
        plaintextCommitment: req.body?.plaintextCommitment ?? req.body?.plaintext_commitment ? String(req.body?.plaintextCommitment ?? req.body?.plaintext_commitment) : undefined,
        freePreview: req.body?.freePreview ?? req.body?.free_preview ? String(req.body?.freePreview ?? req.body?.free_preview) : undefined,
        freePreviewHash: req.body?.freePreviewHash ?? req.body?.free_preview_hash ? String(req.body?.freePreviewHash ?? req.body?.free_preview_hash) : undefined,
        localnetRoot: options.localnetRoot
      }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/reports/:id", async (req, res, next) => {
    try {
      const index = await readIndex(options.localnetRoot);
      const report = index.reports[req.params.id];
      if (!report) {
        res.status(404).json({ error: "report_not_found" });
        return;
      }
      res.json(report);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/agent-channels", async (_req, res, next) => {
    try {
      const index = await readIndex(options.localnetRoot);
      res.json({ agent_channels: Object.values(index.agent_channels) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/delegations", async (_req, res, next) => {
    try {
      const index = await readIndex(options.localnetRoot);
      res.json({ delegations: Object.values(index.delegations) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/revenue-pools", async (_req, res, next) => {
    try {
      const index = await readIndex(options.localnetRoot);
      res.json({ revenue_pools: Object.values(index.revenue_pools) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/revenue-pools/:id", async (req, res, next) => {
    try {
      const index = await readIndex(options.localnetRoot);
      const pool = index.revenue_pools[req.params.id];
      if (!pool) {
        res.status(404).json({ error: "revenue_pool_not_found" });
        return;
      }
      res.json(pool);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/payments", async (_req, res, next) => {
    try {
      const index = await readIndex(options.localnetRoot);
      res.json({ payments: Object.values(index.payments) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/agents/register", async (req, res, next) => {
    try {
      res.json(await registerAgentPassport({
        name: String(req.body?.name ?? "Research Agent"),
        ownerAddress: req.body?.ownerAddress ? String(req.body.ownerAddress) : undefined,
        github: req.body?.github ? String(req.body.github) : undefined,
        scopes: Array.isArray(req.body?.scopes) ? req.body.scopes.map(String) : undefined,
        localnetRoot: options.localnetRoot
      }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/indexer/replay", async (_req, res, next) => {
    try {
      res.json(await replayIndexer({ localnetRoot: options.localnetRoot }));
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof HttpError) {
      res.status(error.statusCode).json({ error: error.code });
      return;
    }
    // Log internally; never echo internal messages (paths, config) to the caller (D-22).
    console.error("[api] internal error:", error);
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}

export async function listenApi(options: { port: number; host?: string; localnetRoot?: string }) {
  const app = createApiServer({ localnetRoot: options.localnetRoot });
  const host = options.host ?? "127.0.0.1";
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    const server = app.listen(options.port, host, () => {
      resolve({
        url: `http://${host}:${options.port}`,
        close: () => new Promise<void>((done) => server.close(() => done()))
      });
    });
  });
}
