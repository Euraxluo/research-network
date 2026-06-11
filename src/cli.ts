#!/usr/bin/env node
import path from "node:path";
import { createPaymentIntent, packageWorkspace, publishWorkspace } from "./index.js";
import { registerAgentPassport } from "./core/agents.js";
import { completeAuthLogin, startAuthLogin } from "./core/auth.js";
import { replayIndexer, searchIndex, getGraph } from "./core/indexer.js";
import { readIndex } from "./core/local-store.js";
import { buildStaticWeb } from "./core/web.js";
import { serveStaticSite } from "./core/web-serve.js";
import { deployToTestnet } from "./core/testnet.js";
import { forkWorkspace, initWorkspace, initPdfOnlyWorkspace, installSkill } from "./core/workspace.js";
import { validateWorkspace } from "./core/validator.js";
import { listenApi } from "./api/server.js";
import type { CrossChainAuthProvider, GitProvider, WalletBinding } from "./core/types.js";

type Args = Record<string, string | boolean | string[]>;

function parseArgs(argv: string[]): { command: string; positional: string[]; flags: Args } {
  const [command = "help", ...rest] = argv;
  const positional: string[] = [];
  const flags: Args = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
    const next = rest[i + 1];
    const value = inlineValue ?? (next && !next.startsWith("--") ? rest[++i] : true);
    if (flags[key] === undefined) {
      flags[key] = value;
    } else if (Array.isArray(flags[key])) {
      (flags[key] as string[]).push(String(value));
    } else {
      flags[key] = [String(flags[key]), String(value)];
    }
  }
  return { command, positional, flags };
}

function flagString(flags: Args, name: string, fallback?: string): string | undefined {
  const value = flags[name];
  if (value === undefined || value === false) {
    return fallback;
  }
  if (value === true) {
    return fallback ?? "true";
  }
  return Array.isArray(value) ? value.at(-1) : String(value);
}

function flagBool(flags: Args, name: string): boolean {
  return flags[name] === true || flags[name] === "true";
}

function flagList(flags: Args, name: string): string[] {
  const value = flags[name];
  if (value === undefined || value === false) {
    return [];
  }
  const values = Array.isArray(value) ? value : [String(value)];
  return values.flatMap((item) => String(item).split(",").map((part) => part.trim()).filter(Boolean));
}

function parseWallets(values: string[]): WalletBinding[] {
  return values.map((value) => {
    const separator = value.indexOf(":");
    if (separator <= 0) {
      throw new Error(`Wallet must use <chain>:<address> format: ${value}`);
    }
    return {
      chain: value.slice(0, separator) as WalletBinding["chain"],
      address: value.slice(separator + 1),
      verified_by: "external-auth"
    };
  });
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printHelp(): void {
  process.stdout.write(`Research Network Protocol Kit

Commands:
  research init <dir> [--title "..."] [--author "..."] [--agent-id "..."] [--force]
  research validate [workspace]
  research package [workspace]
  research publish [workspace]
  research replay [--from-checkpoint 0]
  research search <query> [--type asset|skill|workflow|paper]
  research graph <asset-id>
  research fork <asset-id> <target-dir> [--include paper,skill,workflow,code]
  research install <skill-id> [workspace] [--mode referenced|vendored]
  research auth:start --provider github|gitlab|gitea|privy|dynamic|web3auth|particle|lit|custom-oidc --client-id id --redirect-uri URL
  research auth:complete --intent auth:... --issuer ISS --subject SUB [--git-provider github --git-user-id id --git-username name] [--wallet sui:0x...]
  research agent:register --name "Agent" [--owner-address 0x...]
  research license:intent <skill-id> [--buyer 0x...]
  research web:build [--out web/dist]
  research web:serve [--dir web/dist] [--port 4173]
  research serve [--port 8787]
  research deploy:testnet [workspace] [--epochs 2] [--upload-relay URL] [--gas-budget 1000000000] [--package-id 0x...] [--site-name name] [--walrus-sites-rpc-url URL] [--skip-walrus-sites] [--skip-register]
  research dev:demo
  research dev:demo-pdf
`);
}

async function run() {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "init") {
    const target = positional[0] ?? ".";
    const result = await initWorkspace({
      target,
      title: flagString(flags, "title"),
      slug: flagString(flags, "slug"),
      author: flagString(flags, "author"),
      agentId: flagString(flags, "agentId"),
      force: flagBool(flags, "force")
    });
    printJson({ ok: true, workspace: result });
    return;
  }

  if (command === "validate") {
    const report = await validateWorkspace(positional[0] ?? ".");
    printJson(report);
    process.exitCode = report.valid ? 0 : 1;
    return;
  }

  if (command === "package") {
    const result = await packageWorkspace(positional[0] ?? ".");
    printJson({
      releaseDir: result.releaseDir,
      manifestPath: result.manifestPath,
      checksumsPath: result.checksumsPath,
      archivePath: result.archivePath,
      manifest: result.manifest
    });
    return;
  }

  if (command === "publish") {
    const result = await publishWorkspace(positional[0] ?? ".");
    printJson({
      assetId: result.sui.assetId,
      txDigest: result.sui.txDigest,
      walrusBlobId: result.walrus.blobId,
      archivePath: result.package.archivePath,
      indexedAssets: Object.keys(result.index.assets).length,
      indexedSkills: Object.keys(result.index.skills).length
    });
    return;
  }

  if (command === "replay") {
    printJson(await replayIndexer({ fromCheckpoint: Number(flagString(flags, "fromCheckpoint", "0")) }));
    return;
  }

  if (command === "search") {
    const query = positional.join(" ");
    printJson({ results: await searchIndex(query, flagString(flags, "type")) });
    return;
  }

  if (command === "graph") {
    printJson(await getGraph(positional[0]));
    return;
  }

  if (command === "fork") {
    const [assetId, target] = positional;
    if (!assetId || !target) {
      throw new Error("Usage: research fork <asset-id> <target-dir>");
    }
    printJson({ target: await forkWorkspace({ assetId, target, include: flagString(flags, "include")?.split(",").map((item) => item.trim()).filter(Boolean) }) });
    return;
  }

  if (command === "install") {
    const [skillId, workspace = "."] = positional;
    if (!skillId) {
      throw new Error("Usage: research install <skill-id> [workspace]");
    }
    printJson(await installSkill({
      skillId,
      workspace,
      mode: flagString(flags, "mode", "referenced") === "vendored" ? "vendored" : "referenced"
    }));
    return;
  }

  if (command === "auth:start") {
    printJson(await startAuthLogin({
      provider: flagString(flags, "provider", "github") as GitProvider | CrossChainAuthProvider,
      clientId: flagString(flags, "clientId", "local-dev-client") ?? "local-dev-client",
      redirectUri: flagString(flags, "redirectUri", "http://127.0.0.1:8787/api/auth/callback") ?? "http://127.0.0.1:8787/api/auth/callback",
      scopes: flagList(flags, "scope").length > 0 ? flagList(flags, "scope") : undefined,
      state: flagString(flags, "state"),
      giteaBaseUrl: flagString(flags, "giteaBaseUrl"),
      externalAuthorizeUrl: flagString(flags, "externalAuthorizeUrl"),
      externalIssuer: flagString(flags, "externalIssuer"),
      externalWallets: flagList(flags, "externalWallet").length > 0 ? flagList(flags, "externalWallet") as WalletBinding["chain"][] : undefined,
      externalSupportsGitLinking: flags.externalSupportsGitLinking === undefined ? undefined : flagBool(flags, "externalSupportsGitLinking"),
      zkLogin: flags.zkLogin === undefined ? undefined : flagBool(flags, "zkLogin"),
      zkLoginIssuer: flagString(flags, "zkLoginIssuer"),
      zkLoginProverUrl: flagString(flags, "zkLoginProverUrl")
    }));
    return;
  }

  if (command === "auth:complete") {
    const gitProvider = flagString(flags, "gitProvider") as GitProvider | undefined;
    const gitUserId = flagString(flags, "gitUserId");
    const gitUsername = flagString(flags, "gitUsername");
    printJson(await completeAuthLogin({
      intentId: flagString(flags, "intent", positional[0]),
      state: flagString(flags, "state"),
      issuer: flagString(flags, "issuer"),
      subject: flagString(flags, "subject"),
      audience: flagString(flags, "audience"),
      displayName: flagString(flags, "displayName"),
      git: gitProvider && gitUserId && gitUsername ? {
        provider: gitProvider,
        user_id: gitUserId,
        username: gitUsername,
        email: flagString(flags, "gitEmail"),
        installation_id: flagString(flags, "gitInstallationId"),
        scopes: flagList(flags, "gitScope")
      } : undefined,
      wallets: parseWallets(flagList(flags, "wallet")),
      roles: flagList(flags, "role").length > 0 ? flagList(flags, "role") : undefined
    }));
    return;
  }

  if (command === "agent:register") {
    printJson(await registerAgentPassport({
      name: flagString(flags, "name", positional[0] ?? "Research Agent") ?? "Research Agent",
      ownerAddress: flagString(flags, "ownerAddress"),
      github: flagString(flags, "github"),
      scopes: flagString(flags, "scopes")?.split(",").map((item) => item.trim()).filter(Boolean)
    }));
    return;
  }

  if (command === "license:intent") {
    const skillId = positional[0];
    if (!skillId) {
      throw new Error("Usage: research license:intent <skill-id> [--buyer 0x...]");
    }
    printJson(createPaymentIntent(skillId, flagString(flags, "buyer", "0x0") ?? "0x0"));
    return;
  }

  if (command === "web:build") {
    printJson({ outputDir: await buildStaticWeb(path.resolve(flagString(flags, "out", "web/dist") ?? "web/dist")) });
    return;
  }

  if (command === "web:serve") {
    const dir = path.resolve(flagString(flags, "dir", "web/dist") ?? "web/dist");
    const port = Number(flagString(flags, "port", "4173"));
    const server = await serveStaticSite(dir, port);
    process.stdout.write(`Static site at ${server.url}\n  root: ${server.root}\nPress Ctrl+C to stop.\n`);
    await new Promise<void>(() => {});
    return;
  }

  if (command === "serve") {
    const port = Number(flagString(flags, "port", "8787"));
    const server = await listenApi({ port });
    process.stdout.write(`Research Network API listening at ${server.url}\n`);
    return;
  }

  if (command === "deploy:testnet") {
    printJson(await deployToTestnet({
      workspace: positional[0] ?? ".",
      epochs: flagString(flags, "epochs", "2"),
      gasBudget: flagString(flags, "gasBudget", "1000000000"),
      walrusContext: flagString(flags, "walrusContext", "testnet"),
      uploadRelay: flagString(flags, "uploadRelay"),
      childProcessUploads: flagBool(flags, "childProcessUploads"),
      packageId: flagString(flags, "packageId"),
      skipMovePublish: flagBool(flags, "skipMovePublish"),
      skipRegister: flagBool(flags, "skipRegister"),
      skipWalrusSites: flagBool(flags, "skipWalrusSites"),
      walrusSitesRpcUrl: flagString(flags, "walrusSitesRpcUrl"),
      walrusSitesFallbackRpcUrl: flagString(flags, "walrusSitesFallbackRpcUrl"),
      walrusSitesWalletEnv: flagString(flags, "walrusSitesWalletEnv"),
      siteName: flagString(flags, "siteName"),
      receiptPath: flagString(flags, "receipt")
    }));
    return;
  }

  if (command === "index") {
    printJson(await readIndex());
    return;
  }

  if (command === "dev:demo") {
    const demoDir = path.resolve(".research-network", "demo-workspace");
    await initWorkspace({ target: demoDir, title: "Demo Research Asset", author: "Demo Agent", agentId: "agent:demo", force: true });
    const validation = await validateWorkspace(demoDir);
    if (!validation.valid) {
      printJson(validation);
      process.exitCode = 1;
      return;
    }
    const publish = await publishWorkspace(demoDir);
    const site = await buildStaticWeb();
    printJson({
      workspace: demoDir,
      assetId: publish.sui.assetId,
      walrusBlobId: publish.walrus.blobId,
      site
    });
    return;
  }

  if (command === "dev:demo-pdf") {
    const workspace = path.resolve(".research-network", "pdf-only-workspace");
    await initPdfOnlyWorkspace({
      target: workspace,
      title: "PDF Only Research Note",
      author: "PDF Demo Agent",
      agentId: "agent:pdf-demo",
      force: true
    });
    const validation = await validateWorkspace(workspace);
    if (!validation.valid) {
      printJson(validation);
      process.exitCode = 1;
      return;
    }
    const publish = await publishWorkspace(workspace);
    const site = await buildStaticWeb();
    printJson({
      workspace,
      assetId: publish.sui.assetId,
      walrusBlobId: publish.walrus.blobId,
      site,
      preview: "Run `npm run web:serve` then open /abs/<route-segment>.html#pdf"
    });
    return;
  }

  printHelp();
  process.exitCode = 1;
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
