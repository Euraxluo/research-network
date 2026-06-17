// On-chain + storage configuration for the M3/M4 client layer.
// All object ids come from move/Published.toml.
// Override at build time with VITE_RN_* or at runtime via window.__RN_M3_CONFIG__.

export interface M3Config {
  suiRpcUrl: string;
  network: "testnet" | "mainnet" | "devnet";
  /** Current testnet package with Seal id == report.seal_id policy. */
  packageId: string;
  /** settlement::init shared objects */
  settlementConfigId: string;
  agentEarningsId: string;
  membershipReceiptRegistryId: string;
  /** Walrus */
  walrusPublisherUrl: string;
  walrusAggregatorUrl: string;
  walrusEpochs: number;
  /** Seal key servers (committee). `weight` is summed; `aggregatorUrl` for
   *  committee-mode servers. At least `sealThreshold` of weights must respond. */
  sealKeyServers: { objectId: string; weight: number; aggregatorUrl?: string }[];
  /** Threshold (sum of weights) of key servers that must respond to decrypt. */
  sealThreshold: number;
  /** Default production/testnet transaction amounts in MIST. Override per deployment. */
  platformMembershipPriceMist: string;
  agentSubscriptionPriceMist: string;
  delegationBudgetMist: string;
  membershipSettlementShareMist: string;
  accessDurationMs: number;
  defaultArbitratorAddress?: string;
}

type EnvLike = Record<string, unknown>;

export const DEFAULT_M3_CONFIG: M3Config = {
  suiRpcUrl: "https://sui-testnet-rpc.publicnode.com",
  network: "testnet",
  packageId: "0x5ecd097d8f13e995493d23c9b033c815bd6a8bf771331c389c027296e8b8231e",
  settlementConfigId: "0x612c971a021e8139e0cd4e63bfef162f4301e72532b808a840d3d16512125ea4",
  agentEarningsId: "0xb637059cb77aca697e36673afa2e8639f7f82d16b8f0eba8eb6a1f5bd12eda2b",
  membershipReceiptRegistryId: "0x5a25a789a4032c8460afa68b26b839a081c770372fa04e567207c606b68ad748",
  walrusPublisherUrl: "https://publisher.walrus-testnet.walrus.space",
  walrusAggregatorUrl: "https://aggregator.walrus-testnet.walrus.space",
  walrusEpochs: 5,
  // Seal testnet decentralized key server (committee mode). The single object id
  // references an on-chain KeyServer object whose URL is the aggregator for the
  // whole committee; SealClient fetches per-member keys through it.
  // Source: MystenLabs/seal examples/frontend/src/utils.ts (DEVNET/TESTNET).
  sealKeyServers: [
    {
      objectId: "0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98",
      weight: 1,
      aggregatorUrl: "https://seal-aggregator-testnet.mystenlabs.com"
    }
  ],
  sealThreshold: 1,
  platformMembershipPriceMist: "1000000",
  agentSubscriptionPriceMist: "1000000",
  delegationBudgetMist: "1000000",
  membershipSettlementShareMist: "800000",
  accessDurationMs: 30 * 24 * 60 * 60 * 1000,
  defaultArbitratorAddress: undefined
};

const KNOWN_TESTNET_VALUES = new Set([
  DEFAULT_M3_CONFIG.packageId,
  DEFAULT_M3_CONFIG.settlementConfigId,
  DEFAULT_M3_CONFIG.agentEarningsId,
  DEFAULT_M3_CONFIG.membershipReceiptRegistryId,
  DEFAULT_M3_CONFIG.sealKeyServers[0]?.objectId ?? ""
].map((value) => value.toLowerCase()).filter(Boolean));

export function m3ConfigOverridesFromEnv(env: EnvLike | undefined): Partial<M3Config> {
  if (!env) return {};
  const network = stringEnv(env, "VITE_RN_NETWORK");
  const sealKeyServersJson = stringEnv(env, "VITE_RN_SEAL_KEY_SERVERS_JSON");
  const sealKeyServerObjectId = stringEnv(env, "VITE_RN_SEAL_KEY_SERVER_OBJECT_ID");
  const sealKeyServerAggregatorUrl = stringEnv(env, "VITE_RN_SEAL_KEY_SERVER_AGGREGATOR_URL");
  const overrides: Partial<M3Config> = {
    suiRpcUrl: stringEnv(env, "VITE_RN_SUI_RPC_URL"),
    packageId: stringEnv(env, "VITE_RN_PACKAGE_ID"),
    settlementConfigId: stringEnv(env, "VITE_RN_SETTLEMENT_CONFIG_ID"),
    agentEarningsId: stringEnv(env, "VITE_RN_AGENT_EARNINGS_ID"),
    membershipReceiptRegistryId: stringEnv(env, "VITE_RN_MEMBERSHIP_RECEIPT_REGISTRY_ID"),
    walrusPublisherUrl: stringEnv(env, "VITE_RN_WALRUS_PUBLISHER_URL"),
    walrusAggregatorUrl: stringEnv(env, "VITE_RN_WALRUS_AGGREGATOR_URL"),
    walrusEpochs: numberEnv(env, "VITE_RN_WALRUS_EPOCHS"),
    sealThreshold: numberEnv(env, "VITE_RN_SEAL_THRESHOLD"),
    platformMembershipPriceMist: stringEnv(env, "VITE_RN_PLATFORM_MEMBERSHIP_PRICE_MIST"),
    agentSubscriptionPriceMist: stringEnv(env, "VITE_RN_AGENT_SUBSCRIPTION_PRICE_MIST"),
    delegationBudgetMist: stringEnv(env, "VITE_RN_DELEGATION_BUDGET_MIST"),
    membershipSettlementShareMist: stringEnv(env, "VITE_RN_MEMBERSHIP_SETTLEMENT_SHARE_MIST"),
    accessDurationMs: numberEnv(env, "VITE_RN_ACCESS_DURATION_MS"),
    defaultArbitratorAddress: stringEnv(env, "VITE_RN_DEFAULT_ARBITRATOR_ADDRESS")
  };
  if (network !== undefined) {
    if (network !== "testnet" && network !== "mainnet" && network !== "devnet") {
      throw new Error("VITE_RN_NETWORK must be testnet, mainnet, or devnet");
    }
    overrides.network = network;
  }
  if (sealKeyServersJson) {
    overrides.sealKeyServers = parseSealKeyServersJson(sealKeyServersJson);
  } else if (sealKeyServerObjectId) {
    overrides.sealKeyServers = [{
      objectId: sealKeyServerObjectId,
      weight: numberEnv(env, "VITE_RN_SEAL_KEY_SERVER_WEIGHT") ?? 1,
      aggregatorUrl: sealKeyServerAggregatorUrl
    }];
  }
  return dropUndefined(overrides);
}

export function loadM3Config(): M3Config {
  const g = globalThis as unknown as { __RN_M3_CONFIG__?: Partial<M3Config> };
  const envOverrides = m3ConfigOverridesFromEnv((import.meta as unknown as { env?: EnvLike }).env);
  const runtimeOverrides = g.__RN_M3_CONFIG__ || {};
  // Merge arrays/objects shallowly; runtime overrides win over build-time env.
  return validateM3Config({ ...DEFAULT_M3_CONFIG, ...envOverrides, ...runtimeOverrides } as M3Config);
}

export function validateM3Config(config: M3Config): M3Config {
  if (config.network !== "testnet" && config.network !== "mainnet" && config.network !== "devnet") {
    throw new Error("M3 config network must be testnet, mainnet, or devnet");
  }
  if (!config.packageId || !config.settlementConfigId || !config.agentEarningsId || !config.membershipReceiptRegistryId) {
    throw new Error("M3 config requires package and shared object ids");
  }
  if (!config.suiRpcUrl || !config.walrusPublisherUrl || !config.walrusAggregatorUrl) {
    throw new Error("M3 config requires Sui and Walrus endpoints");
  }
  if (!config.sealKeyServers.length || config.sealKeyServers.some((server) => !server.objectId || server.weight <= 0)) {
    throw new Error("M3 config requires at least one weighted Seal key server");
  }
  if (!Number.isFinite(config.sealThreshold) || config.sealThreshold <= 0) {
    throw new Error("M3 config requires a positive Seal threshold");
  }
  if (config.network === "mainnet") {
    const leaks = m3MainnetTestnetLeaks(config);
    if (leaks.length) {
      throw new Error(`mainnet M3 config rejects testnet values in ${leaks.join(", ")}`);
    }
  }
  return config;
}

function m3MainnetTestnetLeaks(config: M3Config): string[] {
  const checks: Array<[string, string | undefined]> = [
    ["suiRpcUrl", config.suiRpcUrl],
    ["packageId", config.packageId],
    ["settlementConfigId", config.settlementConfigId],
    ["agentEarningsId", config.agentEarningsId],
    ["membershipReceiptRegistryId", config.membershipReceiptRegistryId],
    ["walrusPublisherUrl", config.walrusPublisherUrl],
    ["walrusAggregatorUrl", config.walrusAggregatorUrl]
  ];
  config.sealKeyServers.forEach((server, index) => {
    checks.push([`sealKeyServers[${index}].objectId`, server.objectId]);
    checks.push([`sealKeyServers[${index}].aggregatorUrl`, server.aggregatorUrl]);
  });
  return checks
    .filter(([, value]) => typeof value === "string" && isKnownTestnetValue(value))
    .map(([name]) => name);
}

function isKnownTestnetValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return KNOWN_TESTNET_VALUES.has(normalized) ||
    normalized.includes("testnet") ||
    normalized.includes("sui-testnet-rpc.publicnode.com");
}

function stringEnv(env: EnvLike, name: string): string | undefined {
  const value = env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberEnv(env: EnvLike, name: string): number | undefined {
  const value = stringEnv(env, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return parsed;
}

function parseSealKeyServersJson(value: string): M3Config["sealKeyServers"] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("VITE_RN_SEAL_KEY_SERVERS_JSON must be a non-empty array");
  }
  return parsed.map((server, index) => {
    if (!server || typeof server !== "object") {
      throw new Error(`VITE_RN_SEAL_KEY_SERVERS_JSON[${index}] must be an object`);
    }
    const item = server as Record<string, unknown>;
    const objectId = typeof item.objectId === "string" ? item.objectId : undefined;
    const weight = typeof item.weight === "number" ? item.weight : Number(item.weight ?? 1);
    const aggregatorUrl = typeof item.aggregatorUrl === "string" ? item.aggregatorUrl : undefined;
    if (!objectId || !Number.isFinite(weight) || weight <= 0) {
      throw new Error(`VITE_RN_SEAL_KEY_SERVERS_JSON[${index}] requires objectId and positive weight`);
    }
    return { objectId, weight, aggregatorUrl };
  });
}

function dropUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}

export const RESEARCH_MODULE = "research_protocol";
