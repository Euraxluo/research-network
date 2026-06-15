import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildStaticWeb,
  completeAuthLogin,
  forkWorkspace,
  initWorkspace,
  initPdfOnlyWorkspace,
  installSkill,
  packageWorkspace,
  publishWorkspace,
  replayIndexer,
  searchIndex,
  startAuthLogin,
  validateWorkspace
} from "../src/index.js";
import { routeSegment } from "../src/core/web.js";
import { buildWalrusSitesDeployArgs, buildWalrusSitesUpdateArgs, walrusSitesRpcAttempts } from "../src/core/testnet.js";

let tempRoot: string;

async function makeTempDir(name: string) {
  const dir = path.join(tempRoot, name);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

describe("Research Network protocol kit", () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "research-network-"));
  });

  it("initializes and validates a standard research workspace", async () => {
    const workspace = await initWorkspace({
      target: await makeTempDir("workspace"),
      title: "Vehicle Routing Skill Study",
      author: "Codex Agent",
      agentId: "agent:codex",
      force: true
    });
    const report = await validateWorkspace(workspace);
    expect(report.valid).toBe(true);
    expect(report.detected_assets.skills).toBe(1);
    expect(report.warnings.some((warning) => warning.code === "paper.pdf_missing")).toBe(false);
  });

  it("rejects invalid revenue split", async () => {
    const workspace = await initWorkspace({
      target: await makeTempDir("bad-split"),
      title: "Bad Split Study",
      force: true
    });
    const assetPath = path.join(workspace, "asset.yaml");
    const original = await fs.readFile(assetPath, "utf8");
    await fs.writeFile(assetPath, original.replace("weight_bps: 1500", "weight_bps: 1499"), "utf8");
    const report = await validateWorkspace(workspace);
    expect(report.valid).toBe(false);
    expect(report.errors.map((error) => error.code)).toContain("commerce.revenue_split_sum");
  });

  it("packages a release with manifest, checksums, and zstd archive", async () => {
    const workspace = await initWorkspace({
      target: await makeTempDir("package"),
      title: "Package Study",
      force: true
    });
    const pkg = await packageWorkspace(workspace, path.join(tempRoot, "releases"));
    await expect(fs.stat(pkg.manifestPath)).resolves.toBeTruthy();
    await expect(fs.stat(pkg.checksumsPath)).resolves.toBeTruthy();
    await expect(fs.stat(pkg.archivePath)).resolves.toBeTruthy();
    expect(pkg.manifest.schema).toBe("research-asset-manifest/v0.1");
    expect(pkg.manifest.skills).toHaveLength(1);
  });

  it("publishes, replays indexer, searches, forks, installs skill, and builds web", async () => {
    const workspace = await initWorkspace({
      target: await makeTempDir("publish"),
      title: "Searchable Routing Research",
      author: "Research Bot",
      agentId: "agent:research-bot",
      force: true
    });
    const localnet = path.join(tempRoot, "localnet");
    const published = await publishWorkspace(workspace, localnet);
    expect(published.sui.assetId).toMatch(/^ra:local:/);
    const index = await replayIndexer({ localnetRoot: localnet });
    expect(Object.keys(index.assets)).toHaveLength(1);
    const results = await searchIndex("routing", "asset", localnet);
    expect(results[0]?.entity_id).toBe(published.sui.assetId);

    const forked = await forkWorkspace({
      assetId: published.sui.assetId,
      target: path.join(tempRoot, "forked"),
      localnetRoot: localnet
    });
    await expect(fs.stat(path.join(forked, "asset.yaml"))).resolves.toBeTruthy();

    const skillId = Object.keys(index.skills)[0];
    const installed = await installSkill({
      skillId,
      workspace: forked,
      mode: "referenced",
      localnetRoot: localnet
    });
    expect(installed.skill_id).toBe(skillId);

    const site = await buildStaticWeb(path.join(tempRoot, "site"), localnet);
    await expect(fs.stat(path.join(site, "index.html"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(site, "abs", `${routeSegment(published.sui.assetId)}.html`))).resolves.toBeTruthy();
  });

  it("projects a published fork as a canonical fork edge in the graph", async () => {
    const localnet = path.join(tempRoot, "fork-localnet");
    const origin = await initWorkspace({
      target: await makeTempDir("origin"),
      title: "Origin Routing Study",
      force: true
    });
    const publishedA = await publishWorkspace(origin, localnet);
    const forkedDir = await forkWorkspace({
      assetId: publishedA.sui.assetId,
      target: path.join(tempRoot, "fork-ws"),
      localnetRoot: localnet
    });
    const publishedB = await publishWorkspace(forkedDir, localnet);
    const index = await replayIndexer({ localnetRoot: localnet });

    const forkEdge = Object.values(index.relationships).find(
      (edge) =>
        edge.relation_type === "fork" &&
        edge.src_id === publishedA.sui.assetId &&
        edge.dst_id === publishedB.sui.assetId
    );
    expect(forkEdge).toBeTruthy();
    expect(forkEdge?.metadata.indexed_from).toBe("AssetForked");
  });

  it("builds Walrus Sites testnet deployment arguments", () => {
    expect(buildWalrusSitesDeployArgs({
      rpcUrl: "https://sui-testnet-rpc.publicnode.com",
      walletEnv: "testnet",
      walrusContext: "testnet",
      gasBudget: "1000000000",
      epochs: 1,
      siteName: "research-network-demo",
      distDir: "web/dist"
    })).toEqual([
      "--context",
      "testnet",
      "--rpc-url",
      "https://sui-testnet-rpc.publicnode.com",
      "--wallet-env",
      "testnet",
      "--walrus-context",
      "testnet",
      "--gas-budget",
      "1000000000",
      "deploy",
      "--epochs",
      "1",
      "--site-name",
      "research-network-demo",
      "web/dist"
    ]);
  });

  it("builds Walrus Sites testnet update arguments", () => {
    expect(buildWalrusSitesUpdateArgs({
      rpcUrl: "https://sui-testnet-rpc.publicnode.com",
      walletEnv: "testnet",
      walrusContext: "testnet",
      gasBudget: "1000000000",
      epochs: 1,
      distDir: "web/dist",
      siteObjectId: "0x2cd9764af24dde6e202bf8454ca11f312e0b21312867422fd685955f39a7f12a"
    })).toEqual([
      "--context",
      "testnet",
      "--rpc-url",
      "https://sui-testnet-rpc.publicnode.com",
      "--wallet-env",
      "testnet",
      "--walrus-context",
      "testnet",
      "--gas-budget",
      "1000000000",
      "update",
      "--epochs",
      "1",
      "web/dist",
      "0x2cd9764af24dde6e202bf8454ca11f312e0b21312867422fd685955f39a7f12a"
    ]);
  });

  it("keeps Walrus Sites RPC fallback attempts ordered and unique", () => {
    expect(walrusSitesRpcAttempts(
      "https://fullnode.testnet.sui.io:443",
      "https://sui-testnet-rpc.publicnode.com"
    )).toEqual([
      "https://fullnode.testnet.sui.io:443",
      "https://sui-testnet-rpc.publicnode.com"
    ]);
    expect(walrusSitesRpcAttempts("https://sui-testnet-rpc.publicnode.com", "https://sui-testnet-rpc.publicnode.com")).toEqual([
      "https://sui-testnet-rpc.publicnode.com"
    ]);
  });

  it("creates Git platform and cross-chain login bindings with zkLogin addresses", async () => {
    const localnetRoot = path.join(tempRoot, "auth-localnet");
    const githubIntent = await startAuthLogin({
      provider: "github",
      clientId: "github-client",
      redirectUri: "http://127.0.0.1:8787/api/auth/callback",
      state: "state-github",
      localnetRoot
    });
    expect(githubIntent.authorization_url).toContain("github.com/login/oauth/authorize");
    expect(githubIntent.git?.repository_permissions_required).toContain("contents:read");

    const githubAccount = await completeAuthLogin({
      intentId: githubIntent.id,
      issuer: "https://github.com",
      subject: "12345",
      displayName: "octo-researcher",
      git: {
        provider: "github",
        user_id: "12345",
        username: "octo-researcher",
        installation_id: "98765",
        scopes: githubIntent.scopes
      },
      localnetRoot
    });
    expect(githubAccount.git?.provider).toBe("github");
    expect(githubAccount.zklogin?.address).toMatch(/^0x[0-9a-f]{64}$/);
    expect(githubAccount.wallets[0]).toMatchObject({ chain: "sui", verified_by: "zklogin" });

    const crossChainIntent = await startAuthLogin({
      provider: "privy",
      clientId: "privy-app",
      redirectUri: "http://127.0.0.1:8787/api/auth/callback",
      externalAuthorizeUrl: "https://auth.example.test/oauth/authorize",
      externalIssuer: "https://auth.example.test",
      externalWallets: ["sui", "evm", "solana"],
      localnetRoot
    });
    expect(crossChainIntent.provider_kind).toBe("cross-chain");
    expect(crossChainIntent.external?.supports_git_linking).toBe(true);

    const crossChainAccount = await completeAuthLogin({
      intentId: crossChainIntent.id,
      issuer: "https://auth.example.test",
      subject: "did:privy:user-1",
      wallets: [
        { chain: "evm", address: "0x1111111111111111111111111111111111111111", verified_by: "external-auth" },
        { chain: "solana", address: "So11111111111111111111111111111111111111112", verified_by: "external-auth" }
      ],
      localnetRoot
    });
    expect(crossChainAccount.primary_provider).toBe("privy");
    expect(crossChainAccount.wallets.map((wallet) => wallet.chain)).toEqual(["sui", "evm", "solana"]);
  });
});
