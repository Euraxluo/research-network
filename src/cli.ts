#!/usr/bin/env node
import path from "node:path";
import {
  acceptDelegationJob,
  buyPlatformMembership,
  completeDelegationJob,
  createAccessIntent,
  createDelegationJob,
  openDispute,
  publishResearchReport,
  packageWorkspace,
  publishWorkspace,
  recordAccessReceipt,
  settleMembershipPeriod,
  submitPrivateResult,
  subscribeAgent
} from "./index.js";
import { registerAgentPassport } from "./core/agents.js";
import { connectGithubRepo, githubAppFromEnv } from "./core/github.js";
import { clearCliLoginSession, readCliLoginSession, startCliLogin } from "./core/cli-login.js";
import { completeAuthLogin, startAuthLogin } from "./core/auth.js";
import { decodeJwtClaims, deriveUserSalt, deriveZkLoginAddress } from "./core/zklogin.js";
import { replayIndexer, searchIndex, getGraph, summarizeAssetEconomics } from "./core/indexer.js";
import { readIndex } from "./core/local-store.js";
import { pollSuiEvents } from "./core/sui-events.js";
import { buildLiveIndex } from "./core/live-index.js";
import {
  isSuiObjectId,
  readResolvedSkillArtifact,
  resolveSkillFromLiveIndex,
  type SkillArtifactKind
} from "./core/skill-resolver.js";
import { buildStaticWeb } from "./core/web.js";
import { buildAuthAssets, buildVercelAuthShell, loadAuthSiteConfig } from "./core/web-auth.js";
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
  research index:poll --package-id 0x... [--rpc-url URL] [--module revenue,research_asset] [--limit 50] [--max-pages 1]
  research search <query> [--type asset|skill|workflow|paper]
  research graph <asset-id>
  research reports [report-id]
  research report:publish --agent 0x... --title "Report" [--visibility public|encrypted] [--seal-id seal:...] [--walrus-blob-id walrus:...] [--ciphertext-hash sha256:...] [--plaintext-commitment sha256:...]
  research channels
  research delegations [job-id]
  research revenue [pool-id]
  research payments
  research economics <asset-id>
  research fork <asset-id> <target-dir> [--include paper,skill,workflow,code]
  research install <skill-id> [workspace] [--mode referenced|vendored]
  research skill:resolve <skill-object-id> [--limit 20] [--include-content] [--file entry|manifest]
  research auth:start --provider github|gitlab|gitea|privy|dynamic|web3auth|particle|lit|custom-oidc --client-id id --redirect-uri URL
  research auth:complete --intent auth:... --issuer ISS --subject SUB [--jwt <id_token>] [--git-provider github --git-user-id id --git-username name] [--wallet sui:0x...]
  research login [--port 8765] [--no-open]
  research whoami
  research logout
  research zklogin:address --jwt <id_token> [--salt <salt>]  (real Sui zkLogin address via @mysten/sui)
  research agent:register --name "Agent" [--owner-address 0x...]
  research github:connect --installation <id> --owner <o> --repo <r> [--ref <ref>]  (env: GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY)
  research access:intent --kind platform_membership|agent_subscription|private_delegation [--buyer 0x...] [--target id]
  research membership:buy --owner 0x... [--tier 1] [--duration-days 30]
  research agent:subscribe --owner 0x... --agent 0x... [--amount 1000]
  research delegation:create --buyer 0x... --agent 0x... --budget 1000 [--deadline-ms 1780000000000]
  research delegation:accept <job-id> --agent 0x...
  research delegation:submit <job-id> --agent 0x... --walrus-blob-id walrus:... --seal-id seal:... --ciphertext-hash sha256:... --plaintext-commitment sha256:...
  research delegation:complete <job-id> [--payout 1000]
  research delegation:dispute <job-id> --opened-by 0x... --arbitrator 0x...
  research access:receipt --period-id 202606 --user 0x... --report-id rep:... --agent 0x... [--access-type platform_member|agent_subscription]
  research membership:settle --period-id 202606 --user 0x... --gross-amount 1000
  research web:build [--out web/dist]
  research vercel:shell [--out .vercel-shell]
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

  if (command === "index:poll") {
    const packageId = flagString(flags, "packageId") ?? flagString(flags, "package") ?? positional[0];
    if (!packageId) {
      throw new Error("Usage: research index:poll --package-id 0x... [--rpc-url URL]");
    }
    const result = await pollSuiEvents({
      packageId,
      rpcUrl: flagString(flags, "rpcUrl", "https://sui-testnet-rpc.publicnode.com") ?? "https://sui-testnet-rpc.publicnode.com",
      modules: flagList(flags, "module"),
      limit: Number(flagString(flags, "limit", "50")),
      maxPagesPerModule: Number(flagString(flags, "maxPages", "1")),
      localnetRoot: flagString(flags, "localnetRoot")
    });
    printJson({
      pages_fetched: result.pages_fetched,
      events_seen: result.events_seen,
      events_ingested: result.events_ingested,
      state: result.state
    });
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

  if (command === "reports") {
    const index = await readIndex();
    printJson(positional[0] ? index.reports[positional[0]] : Object.values(index.reports));
    return;
  }

  if (command === "report:publish") {
    const agent = flagString(flags, "agent");
    const title = flagString(flags, "title") ?? positional.join(" ");
    const visibility = flagString(flags, "visibility", "public") as "public" | "encrypted" | "private_delegation";
    if (!agent || !title || !["public", "encrypted", "private_delegation"].includes(visibility)) {
      throw new Error("Usage: research report:publish --agent 0x... --title \"Report\" [--visibility public|encrypted|private_delegation]");
    }
    printJson(await publishResearchReport({
      agent,
      title,
      visibility,
      requiredTier: Number(flagString(flags, "requiredTier", "1")),
      assetId: flagString(flags, "assetId"),
      reportId: flagString(flags, "reportId"),
      walrusBlobId: flagString(flags, "walrusBlobId"),
      sealId: flagString(flags, "sealId"),
      ciphertextHash: flagString(flags, "ciphertextHash"),
      plaintextCommitment: flagString(flags, "plaintextCommitment"),
      freePreview: flagString(flags, "freePreview"),
      freePreviewHash: flagString(flags, "freePreviewHash"),
      localnetRoot: flagString(flags, "localnetRoot")
    }));
    return;
  }

  if (command === "channels") {
    printJson(Object.values((await readIndex()).agent_channels));
    return;
  }

  if (command === "delegations") {
    const index = await readIndex();
    printJson(positional[0] ? index.delegations[positional[0]] : Object.values(index.delegations));
    return;
  }

  if (command === "revenue") {
    const index = await readIndex();
    printJson(positional[0] ? index.revenue_pools[positional[0]] : Object.values(index.revenue_pools));
    return;
  }

  if (command === "payments") {
    printJson(Object.values((await readIndex()).payments));
    return;
  }

  if (command === "economics") {
    if (!positional[0]) {
      throw new Error("Usage: research economics <asset-id>");
    }
    printJson(summarizeAssetEconomics(await readIndex(), positional[0]));
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

  if (command === "skill:resolve") {
    const [skillObjectId] = positional;
    if (!skillObjectId || !isSuiObjectId(skillObjectId)) {
      throw new Error("Usage: research skill:resolve <skill-object-id>");
    }
    const index = await buildLiveIndex({
      limit: Number(flagString(flags, "limit", "20")) || 20
    });
    const resolution = resolveSkillFromLiveIndex(index, skillObjectId);
    if (!resolution) {
      throw new Error(`Published SkillAsset not found in live index: ${skillObjectId}`);
    }
    if (!flagBool(flags, "includeContent")) {
      printJson(resolution);
      return;
    }
    const file = flagString(flags, "file", "entry");
    const kind: SkillArtifactKind = file === "manifest" || file === "skill.yaml" ? "manifest" : "entry";
    const artifact = await readResolvedSkillArtifact(resolution, kind, index.aggregator_url);
    printJson({
      ...resolution,
      content: artifact ? {
        kind,
        path: artifact.path,
        content_type: artifact.contentType,
        text: new TextDecoder().decode(artifact.bytes)
      } : null
    });
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
      jwt: flagString(flags, "jwt"),
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

  if (command === "login") {
    const port = Number(flagString(flags, "port", "8765"));
    const result = await startCliLogin({
      port,
      openBrowser: !flagBool(flags, "noOpen"),
      onAuthorizeUrl: (url) => {
        process.stdout.write(`Open this URL to sign in:\n${url}\n\nWaiting for browser callback on http://localhost:${port}/callback ...\n`);
      }
    });
    printJson({
      account_id: result.account.id,
      address: result.session.address,
      email: result.session.email,
      expires_at: result.session.expires_at
    });
    return;
  }

  if (command === "whoami") {
    const session = await readCliLoginSession();
    if (!session) {
      printJson({ authenticated: false });
      return;
    }
    printJson({
      authenticated: true,
      account_id: session.account_id,
      address: session.address,
      email: session.email,
      expires_at: session.expires_at
    });
    return;
  }

  if (command === "logout") {
    await clearCliLoginSession();
    printJson({ authenticated: false });
    return;
  }

  if (command === "zklogin:address") {
    const jwt = flagString(flags, "jwt");
    if (!jwt) {
      throw new Error("Usage: research zklogin:address --jwt <id_token> [--salt <salt>]");
    }
    const claims = decodeJwtClaims(jwt);
    const salt = flagString(flags, "salt") ?? deriveUserSalt({ issuer: claims.iss, subject: claims.sub, audience: claims.aud });
    printJson({ address: deriveZkLoginAddress(jwt, salt), issuer: claims.iss, subject: claims.sub, audience: claims.aud });
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

  if (command === "github:connect") {
    const client = githubAppFromEnv();
    printJson(await connectGithubRepo(client, {
      installationId: flagString(flags, "installation") ?? "",
      owner: flagString(flags, "owner") ?? "",
      repo: flagString(flags, "repo") ?? "",
      ref: flagString(flags, "ref")
    }));
    return;
  }

  if (command === "access:intent") {
    const kind = flagString(flags, "kind", positional[0]) as "platform_membership" | "agent_subscription" | "private_delegation";
    if (!["platform_membership", "agent_subscription", "private_delegation"].includes(kind)) {
      throw new Error("Usage: research access:intent --kind platform_membership|agent_subscription|private_delegation [--buyer 0x...] [--target id]");
    }
    printJson(createAccessIntent(kind, flagString(flags, "buyer", "0x0") ?? "0x0", flagString(flags, "target", positional[1])));
    return;
  }

  if (command === "membership:buy") {
    const ownerAddress = flagString(flags, "ownerAddress") ?? flagString(flags, "owner") ?? positional[0];
    if (!ownerAddress) {
      throw new Error("Usage: research membership:buy --owner 0x... [--tier 1] [--duration-days 30]");
    }
    printJson(await buyPlatformMembership({
      ownerAddress,
      tier: Number(flagString(flags, "tier", "1")),
      durationDays: Number(flagString(flags, "durationDays", "30")),
      localnetRoot: flagString(flags, "localnetRoot")
    }));
    return;
  }

  if (command === "agent:subscribe") {
    const ownerAddress = flagString(flags, "ownerAddress") ?? flagString(flags, "owner");
    const agent = flagString(flags, "agent") ?? positional[0];
    if (!ownerAddress || !agent) {
      throw new Error("Usage: research agent:subscribe --owner 0x... --agent 0x... [--amount 1000]");
    }
    printJson(await subscribeAgent({
      ownerAddress,
      agent,
      tier: Number(flagString(flags, "tier", "1")),
      durationDays: Number(flagString(flags, "durationDays", "30")),
      amount: Number(flagString(flags, "amount", "0")),
      platformFeeBps: Number(flagString(flags, "platformFeeBps", "1500")),
      localnetRoot: flagString(flags, "localnetRoot")
    }));
    return;
  }

  if (command === "delegation:create") {
    const buyer = flagString(flags, "buyer");
    const agent = flagString(flags, "agent");
    if (!buyer || !agent) {
      throw new Error("Usage: research delegation:create --buyer 0x... --agent 0x... --budget 1000");
    }
    printJson(await createDelegationJob({
      buyer,
      agent,
      budget: Number(flagString(flags, "budget", "0")),
      deadlineMs: flagString(flags, "deadlineMs") ? Number(flagString(flags, "deadlineMs")) : undefined,
      localnetRoot: flagString(flags, "localnetRoot")
    }));
    return;
  }

  if (command === "delegation:accept") {
    const jobId = positional[0];
    const agent = flagString(flags, "agent");
    if (!jobId || !agent) {
      throw new Error("Usage: research delegation:accept <job-id> --agent 0x...");
    }
    printJson(await acceptDelegationJob({ jobId, agent, localnetRoot: flagString(flags, "localnetRoot") }));
    return;
  }

  if (command === "delegation:submit") {
    const jobId = positional[0];
    const agent = flagString(flags, "agent");
    const walrusBlobId = flagString(flags, "walrusBlobId");
    const sealId = flagString(flags, "sealId");
    const ciphertextHash = flagString(flags, "ciphertextHash");
    const plaintextCommitment = flagString(flags, "plaintextCommitment");
    if (!jobId || !agent || !walrusBlobId || !sealId || !ciphertextHash || !plaintextCommitment) {
      throw new Error("Usage: research delegation:submit <job-id> --agent 0x... --walrus-blob-id walrus:... --seal-id seal:... --ciphertext-hash sha256:... --plaintext-commitment sha256:...");
    }
    printJson(await submitPrivateResult({
      jobId,
      agent,
      title: flagString(flags, "title"),
      reportId: flagString(flags, "reportId"),
      walrusBlobId,
      sealId,
      ciphertextHash,
      plaintextCommitment,
      freePreviewHash: flagString(flags, "freePreviewHash"),
      localnetRoot: flagString(flags, "localnetRoot")
    }));
    return;
  }

  if (command === "delegation:complete") {
    const jobId = positional[0];
    if (!jobId) {
      throw new Error("Usage: research delegation:complete <job-id> [--payout 1000]");
    }
    printJson(await completeDelegationJob({
      jobId,
      payout: flagString(flags, "payout") ? Number(flagString(flags, "payout")) : undefined,
      localnetRoot: flagString(flags, "localnetRoot")
    }));
    return;
  }

  if (command === "delegation:dispute") {
    const jobId = positional[0];
    const openedBy = flagString(flags, "openedBy");
    const arbitrator = flagString(flags, "arbitrator");
    if (!jobId || !openedBy || !arbitrator) {
      throw new Error("Usage: research delegation:dispute <job-id> --opened-by 0x... --arbitrator 0x...");
    }
    printJson(await openDispute({ jobId, openedBy, arbitrator, localnetRoot: flagString(flags, "localnetRoot") }));
    return;
  }

  if (command === "access:receipt") {
    const accessType = flagString(flags, "accessType", "platform_member") as "platform_member" | "agent_subscription";
    if (!["platform_member", "agent_subscription"].includes(accessType)) {
      throw new Error("Usage: research access:receipt --period-id 202606 --user 0x... --report-id rep:... --agent 0x... [--access-type platform_member|agent_subscription]");
    }
    printJson(await recordAccessReceipt({
      periodId: Number(flagString(flags, "periodId", "0")),
      user: flagString(flags, "user", "0x0") ?? "0x0",
      reportId: flagString(flags, "reportId") ?? "",
      agent: flagString(flags, "agent", "0x0") ?? "0x0",
      accessType,
      localnetRoot: flagString(flags, "localnetRoot")
    }));
    return;
  }

  if (command === "membership:settle") {
    printJson(await settleMembershipPeriod({
      periodId: Number(flagString(flags, "periodId", "0")),
      user: flagString(flags, "user", "0x0") ?? "0x0",
      grossAmount: Number(flagString(flags, "grossAmount", "0")),
      platformFeeBps: Number(flagString(flags, "platformFeeBps", "1500")),
      localnetRoot: flagString(flags, "localnetRoot")
    }));
    return;
  }

  if (command === "web:build") {
    const outputDir = path.resolve(flagString(flags, "out", "web/dist") ?? "web/dist");
    await buildStaticWeb(outputDir);
    const authConfig = await loadAuthSiteConfig();
    if (authConfig) {
      await buildAuthAssets(outputDir, authConfig);
    }
    printJson({ outputDir, account: "account auth surface", auth: authConfig ? "generated" : "skipped (no secrets/oauth.json or github.json)" });
    return;
  }

  if (command === "vercel:shell") {
    const outputDir = path.resolve(flagString(flags, "out", ".vercel-shell") ?? ".vercel-shell");
    await buildVercelAuthShell(outputDir);
    printJson({ outputDir, account: "vite-owned account auth surface", auth: "generated", content: "static-current-build-with-404" });
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
