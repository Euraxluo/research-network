import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { packageWorkspace } from "./packager.js";
import { buildStaticWeb } from "./web.js";
import { DEFAULT_RELEASE_DIR, PROJECT_ROOT, WEB_DIST_DIR } from "./paths.js";
import { writeJsonFile } from "./fs.js";

export interface TestnetDeployOptions {
  workspace: string;
  epochs?: number | string;
  gasBudget?: string;
  walrusContext?: string;
  uploadRelay?: string;
  childProcessUploads?: boolean;
  skipMovePublish?: boolean;
  packageId?: string;
  skipRegister?: boolean;
  skipWalrusSites?: boolean;
  walrusSitesRpcUrl?: string;
  walrusSitesFallbackRpcUrl?: string;
  walrusSitesWalletEnv?: string;
  siteName?: string;
  siteObjectId?: string;
  movePath?: string;
  receiptPath?: string;
}

export interface TestnetDeployReceipt {
  schema: "research-network-testnet-deployment/v0.1";
  created_at: string;
  workspace: string;
  walrus: {
    context: string;
    epochs: number | string;
    upload_relay: string;
    archive_path: string;
    output: unknown;
    blob_id?: string;
    object_id?: string;
    certified_epoch?: number;
  };
  release: {
    manifest_path: string;
    checksums_path: string;
  };
  sui: {
    active_env?: string;
    active_address?: string;
    package_id?: string;
    package_publish?: unknown;
    register_tx?: unknown;
    register_status?: "skipped" | "success" | "failed";
    register_error?: string;
  };
  web: {
    dist_dir: string;
    walrus_sites_mode?: "deploy" | "update";
    walrus_sites_target_object_id?: string;
    walrus_sites_status: "not-installed" | "skipped" | "success" | "failed";
    walrus_sites_rpc_url?: string;
    walrus_sites_fallback_rpc_url?: string;
    walrus_sites_output?: string;
    walrus_sites_error?: string;
    requested_site_name?: string;
    site_name?: string;
    site_object_id?: string;
    local_portal_url?: string;
    resources_path?: string;
  };
}

function run(command: string, args: string[], cwd = PROJECT_ROOT) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function runCapture(command: string, args: string[], cwd = PROJECT_ROOT) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return {
    ok: result.status === 0,
    output: [result.stdout, result.stderr].filter(Boolean).join("\n").trim()
  };
}

function runJson(command: string, args: string[], cwd = PROJECT_ROOT): unknown {
  const output = run(command, args, cwd);
  try {
    return JSON.parse(output);
  } catch {
    const jsonStart = output.indexOf("{");
    const arrayStart = output.indexOf("[");
    const start = jsonStart === -1 ? arrayStart : arrayStart === -1 ? jsonStart : Math.min(jsonStart, arrayStart);
    if (start >= 0) {
      return JSON.parse(output.slice(start));
    }
    throw new Error(`Expected JSON from ${command} ${args.join(" ")}:\n${output}`);
  }
}

function getActiveEnv(): string | undefined {
  try {
    return run("sui", ["client", "active-env"]);
  } catch {
    return undefined;
  }
}

function getActiveAddress(): string | undefined {
  try {
    return run("sui", ["client", "active-address"]);
  } catch {
    return undefined;
  }
}

function firstWalrusBlob(output: unknown): Record<string, unknown> | undefined {
  const stack: unknown[] = [output];
  while (stack.length > 0) {
    const value = stack.pop();
    if (!value || typeof value !== "object") {
      continue;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.blobId === "string" && typeof record.id === "string") {
      return record;
    }
    for (const child of Object.values(record)) {
      if (Array.isArray(child)) {
        stack.push(...child);
      } else if (child && typeof child === "object") {
        stack.push(child);
      }
    }
  }
  return undefined;
}

function extractWalrusBlobId(output: unknown): string | undefined {
  return firstWalrusBlob(output)?.blobId as string | undefined;
}

function extractWalrusObjectId(output: unknown): string | undefined {
  return firstWalrusBlob(output)?.id as string | undefined;
}

function extractWalrusCertifiedEpoch(output: unknown): number | undefined {
  const epoch = firstWalrusBlob(output)?.certifiedEpoch;
  return typeof epoch === "number" ? epoch : undefined;
}

function extractPackageId(output: unknown): string | undefined {
  const candidate = output as {
    objectChanges?: Array<Record<string, unknown>>;
    effects?: { created?: Array<Record<string, unknown>> };
  };
  const published = candidate.objectChanges?.find((change) => change.type === "published");
  if (published?.packageId) {
    return String(published.packageId);
  }
  const packageChange = candidate.objectChanges?.find((change) => change.objectType === "package" || change.type === "created" && String(change.objectType ?? "").includes("::package::UpgradeCap"));
  if (packageChange?.packageId) {
    return String(packageChange.packageId);
  }
  const text = JSON.stringify(output);
  const match = text.match(/"packageId"\s*:\s*"([^"]+)"/);
  return match?.[1];
}

function bytesArg(input: string): string {
  return `[${[...Buffer.from(input, "utf8")].join(",")}]`;
}

function assetTypeMask(types: string[]): number {
  const bitByType: Record<string, number> = {
    paper: 1 << 0,
    skill: 1 << 1,
    workflow: 1 << 2,
    dataset: 1 << 3,
    experiment: 1 << 4,
    benchmark: 1 << 5,
    code: 1 << 6,
    review: 1 << 7
  };
  return types.reduce((mask, type) => mask | (bitByType[type] ?? 0), 0);
}

async function maybeWalrusSitesTool(): Promise<string | undefined> {
  for (const command of ["site-builder", "walrus-sites"]) {
    const result = spawnSync("which", [command], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    if (result.status === 0) {
      return result.stdout.trim();
    }
  }
  return undefined;
}

export interface WalrusSitesDeployArgsOptions {
  rpcUrl: string;
  walletEnv: string;
  walrusContext: string;
  gasBudget: string;
  epochs: number | string;
  siteName: string;
  distDir: string;
}

function walrusSitesCommonArgs(options: {
  walrusContext: string;
  rpcUrl: string;
  walletEnv: string;
  gasBudget: string;
}): string[] {
  return [
    "--context",
    options.walrusContext,
    "--rpc-url",
    options.rpcUrl,
    "--wallet-env",
    options.walletEnv,
    "--walrus-context",
    options.walrusContext,
    "--gas-budget",
    options.gasBudget
  ];
}

export function buildWalrusSitesDeployArgs(options: WalrusSitesDeployArgsOptions): string[] {
  return [
    ...walrusSitesCommonArgs(options),
    "deploy",
    "--epochs",
    String(options.epochs),
    "--site-name",
    options.siteName,
    options.distDir
  ];
}

export interface WalrusSitesUpdateArgsOptions extends Omit<WalrusSitesDeployArgsOptions, "siteName"> {
  siteObjectId: string;
}

export function buildWalrusSitesUpdateArgs(options: WalrusSitesUpdateArgsOptions): string[] {
  return [
    ...walrusSitesCommonArgs(options),
    "update",
    "--epochs",
    String(options.epochs),
    options.distDir,
    options.siteObjectId
  ];
}

export function walrusSitesRpcAttempts(primaryRpc: string, fallbackRpc: string): string[] {
  return [primaryRpc, fallbackRpc].filter((rpc, index, values) => values.indexOf(rpc) === index);
}

function siteObjectIdToLocalPortalUrl(objectId: string): string | undefined {
  try {
    const normalized = objectId.startsWith("0x") ? objectId : `0x${objectId}`;
    const host = BigInt(normalized).toString(36);
    return `http://${host}.localhost:3000`;
  } catch {
    return undefined;
  }
}

async function readExistingSiteObjectId(distDir: string): Promise<string | undefined> {
  const resources = await readWalrusSitesResources(path.join(distDir, "ws-resources.json"));
  return typeof resources?.object_id === "string" ? resources.object_id : undefined;
}

async function readWalrusSitesResources(resourcesPath: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await fs.readFile(resourcesPath, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export async function deployToTestnet(options: TestnetDeployOptions): Promise<TestnetDeployReceipt> {
  const epochs = options.epochs ?? 2;
  const gasBudget = options.gasBudget ?? "1000000000";
  const walrusContext = options.walrusContext ?? "testnet";
  const uploadRelay = options.uploadRelay ?? "https://upload-relay.testnet.walrus.space";
  const childProcessUploads = options.childProcessUploads ?? false;
  const walrusSitesTool = await maybeWalrusSitesTool();
  const existingSiteObjectId = await readExistingSiteObjectId(WEB_DIST_DIR);
  const pkg = await packageWorkspace(options.workspace, DEFAULT_RELEASE_DIR);
  const webDist = await buildStaticWeb();
  const siteObjectId = (await readExistingSiteObjectId(webDist)) ?? existingSiteObjectId ?? options.siteObjectId;

  const walrusOutput = runJson("walrus", [
    "--context",
    walrusContext,
    "store",
    "--epochs",
    String(epochs),
    "--json",
    "--skip-tip-confirmation",
    "--upload-relay",
    uploadRelay,
    `--child-process-uploads=${String(childProcessUploads)}`,
    pkg.archivePath
  ]);

  let packageId = options.packageId;
  let publishOutput: unknown;
  if (!options.skipMovePublish && !packageId) {
    publishOutput = runJson("sui", [
      "client",
      "publish",
      options.movePath ?? path.join(PROJECT_ROOT, "move"),
      "--gas-budget",
      gasBudget,
      "--json"
    ]);
    packageId = extractPackageId(publishOutput);
    if (!packageId) {
      throw new Error("Sui package publish succeeded but packageId could not be extracted");
    }
  }

  const receipt: TestnetDeployReceipt = {
    schema: "research-network-testnet-deployment/v0.1",
    created_at: new Date().toISOString(),
    workspace: path.resolve(options.workspace),
    walrus: {
      context: walrusContext,
      epochs,
      upload_relay: uploadRelay,
      archive_path: pkg.archivePath,
      output: walrusOutput,
      blob_id: extractWalrusBlobId(walrusOutput),
      object_id: extractWalrusObjectId(walrusOutput),
      certified_epoch: extractWalrusCertifiedEpoch(walrusOutput)
    },
    release: {
      manifest_path: pkg.manifestPath,
      checksums_path: pkg.checksumsPath
    },
    sui: {
      active_env: getActiveEnv(),
      active_address: getActiveAddress(),
      package_id: packageId,
      package_publish: publishOutput,
      register_status: options.skipRegister ? "skipped" : undefined
    },
    web: {
      dist_dir: webDist,
      walrus_sites_tool: walrusSitesTool,
      walrus_sites_status: options.skipWalrusSites ? "skipped" : walrusSitesTool ? "failed" : "not-installed"
    }
  };

  if (!options.skipRegister && packageId) {
    try {
      receipt.sui.register_tx = runJson("sui", [
        "client",
        "call",
        "--package",
        packageId,
        "--module",
        "research_asset",
        "--function",
        "publish_research_asset",
        "--args",
        String(assetTypeMask(pkg.manifest.assets.types)),
        pkg.manifest.assets.version,
        bytesArg(pkg.manifest.manifest_hash),
        bytesArg(receipt.walrus.blob_id ?? JSON.stringify(walrusOutput)),
        bytesArg(pkg.manifest.commit),
        "[]",
        String(Date.now()),
        "--gas-budget",
        gasBudget,
        "--json"
      ]);
      receipt.sui.register_status = "success";
    } catch (error) {
      receipt.sui.register_status = "failed";
      receipt.sui.register_error = error instanceof Error ? error.message : String(error);
    }
  }

  if (!options.skipWalrusSites && walrusSitesTool) {
    const siteName = options.siteName ?? "research-network-demo";
    const primaryRpc = options.walrusSitesRpcUrl ?? "https://fullnode.testnet.sui.io:443";
    const fallbackRpc = options.walrusSitesFallbackRpcUrl ?? "https://sui-testnet-rpc.publicnode.com";
    const walletEnv = options.walrusSitesWalletEnv ?? walrusContext;
    const attempts = walrusSitesRpcAttempts(primaryRpc, fallbackRpc);
    const logs: string[] = [];

    receipt.web.requested_site_name = siteName;
    receipt.web.walrus_sites_mode = siteObjectId ? "update" : "deploy";
    receipt.web.walrus_sites_target_object_id = siteObjectId;
    receipt.web.walrus_sites_rpc_url = primaryRpc;
    receipt.web.walrus_sites_fallback_rpc_url = fallbackRpc;

    for (const rpcUrl of attempts) {
      const args = siteObjectId
        ? buildWalrusSitesUpdateArgs({
            rpcUrl,
            walletEnv,
            walrusContext,
            gasBudget,
            epochs,
            distDir: webDist,
            siteObjectId
          })
        : buildWalrusSitesDeployArgs({
            rpcUrl,
            walletEnv,
            walrusContext,
            gasBudget,
            epochs,
            siteName,
            distDir: webDist
          });
      const result = runCapture(walrusSitesTool, args);
      logs.push(`${rpcUrl}: ${result.output || (result.ok ? "ok" : "failed without output")}`);
      if (result.ok) {
        receipt.web.walrus_sites_status = "success";
        receipt.web.walrus_sites_rpc_url = rpcUrl;
        receipt.web.walrus_sites_output = logs.join("\n\n");
        break;
      }
    }

    const resourcesPath = path.join(webDist, "ws-resources.json");
    receipt.web.resources_path = resourcesPath;
    const resources = await readWalrusSitesResources(resourcesPath);
    const objectId = typeof resources?.object_id === "string" ? resources.object_id : undefined;
    if (objectId) {
      receipt.web.site_object_id = objectId;
      receipt.web.local_portal_url = siteObjectIdToLocalPortalUrl(objectId);
    }
    if (typeof resources?.site_name === "string") {
      receipt.web.site_name = resources.site_name;
    }
    if (receipt.web.walrus_sites_status !== "success") {
      receipt.web.walrus_sites_error = logs.join("\n\n") || "Walrus Sites deployment did not run";
    }
  }

  const receiptPath = options.receiptPath ?? path.join(PROJECT_ROOT, ".research-network", "deployments", "testnet.json");
  await writeJsonFile(receiptPath, receipt);
  return receipt;
}
