import express from "express";
import { createPaymentIntent, publishWorkspace } from "../core/adapters.js";
import { registerAgentPassport } from "../core/agents.js";
import { completeAuthLogin, startAuthLogin } from "../core/auth.js";
import { getGraph, replayIndexer, searchIndex } from "../core/indexer.js";
import { readAuthState, readIndex } from "../core/local-store.js";
import { forkWorkspace, installSkill } from "../core/workspace.js";
import { validateWorkspace } from "../core/validator.js";
import type { CrossChainAuthProvider, GitProvider, WalletBinding } from "../core/types.js";

export function createApiServer(options: { localnetRoot?: string } = {}) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

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
        state: req.body?.state ? String(req.body.state) : undefined,
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
        wallets: Array.isArray(req.body?.wallets) ? req.body.wallets : undefined,
        roles: Array.isArray(req.body?.roles) ? req.body.roles.map(String) : undefined,
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
      const target = String(req.body?.target ?? `./forks/${req.params.id.replaceAll(":", "-")}`);
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
        workspace: String(req.body?.workspace ?? "."),
        mode: req.body?.mode === "vendored" ? "vendored" : "referenced",
        localnetRoot: options.localnetRoot
      }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/publish/github", async (req, res, next) => {
    try {
      const repoPath = String(req.body?.repoPath ?? req.body?.repo ?? ".");
      res.json(await publishWorkspace(repoPath, options.localnetRoot));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/validate", async (req, res, next) => {
    try {
      res.json(await validateWorkspace(String(req.body?.workspace ?? ".")));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/licenses/purchase-intent", async (req, res, next) => {
    try {
      res.json(createPaymentIntent(String(req.body?.skill_id ?? req.body?.skillId), String(req.body?.buyer ?? "0x0")));
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
    res.status(500).json({
      error: "internal_error",
      message: error instanceof Error ? error.message : String(error)
    });
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
