import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type ProductionAcceptanceNetwork = "testnet" | "mainnet";

export interface ProductionAcceptanceConfig {
  network: ProductionAcceptanceNetwork;
  execute: boolean;
  preflight: boolean;
  buyerSessionPath?: string;
  agentSessionPath?: string;
  receiptPath: string;
  maxSpendMist: bigint;
  gasReserveMist: bigint;
  platformMembershipPriceMist: bigint;
  agentSubscriptionPriceMist: bigint;
  delegationBudgetMist: bigint;
  membershipSettlementShareMist: bigint;
  suiRpcUrl?: string;
  packageId?: string;
  settlementConfigId?: string;
  agentEarningsId?: string;
  membershipReceiptRegistryId?: string;
  walrusPublisherUrl?: string;
  walrusAggregatorUrl?: string;
  walrusEpochs?: number;
  sealKeyServerObjectId?: string;
  sealKeyServerAggregatorUrl?: string;
  sealThreshold?: number;
}

export interface ProductionAcceptanceBudget {
  committedSpendMist: bigint;
  gasReserveMist: bigint;
  buyerMinimumMist: bigint;
  agentMinimumMist: bigint;
  totalBudgetMist: bigint;
  maxSpendMist: bigint;
}

export interface ProductionAcceptanceSessionInput {
  address?: string;
  ephemeralSecretKey?: string;
  secret?: string;
  idToken?: string;
  id_token?: string;
  salt?: string;
  maxEpoch?: number;
  max_epoch?: number;
  randomness?: string;
  rn_zk_eph?: { secret?: string; maxEpoch?: number; randomness?: string };
  rn_zk_session?: { id_token?: string; salt?: string; maxEpoch?: number; randomness?: string };
}

export interface ProductionAcceptanceSession {
  address?: string;
  ephemeralSecretKey: string;
  idToken: string;
  salt: string;
  maxEpoch: number;
  randomness: string;
}

export interface ProductionAcceptanceStep {
  name: string;
  status: "pending" | "passed" | "failed" | "skipped";
  digest?: string;
  objectId?: string;
  error?: string;
  meta?: Record<string, unknown>;
}

export interface ProductionAcceptanceReceipt {
  network: ProductionAcceptanceNetwork;
  execute: boolean;
  preflight: boolean;
  startedAt: string;
  finishedAt?: string;
  buyerAddress?: string;
  agentAddress?: string;
  budget: {
    committedSpendMist: string;
    gasReserveMist: string;
    buyerMinimumMist: string;
    agentMinimumMist: string;
    totalBudgetMist: string;
    maxSpendMist: string;
  };
  config: {
    suiRpcUrl?: string;
    packageId?: string;
    settlementConfigId?: string;
    agentEarningsId?: string;
    membershipReceiptRegistryId?: string;
    walrusPublisherUrl?: string;
    walrusAggregatorUrl?: string;
    walrusEpochs?: number;
    sealKeyServerObjectId?: string;
    sealKeyServerAggregatorUrl?: string;
    sealThreshold?: number;
  };
  steps: ProductionAcceptanceStep[];
  conclusion: "not_run" | "passed" | "failed";
}

export interface ProductionAcceptanceProofEvidence {
  hasProofPoints: boolean;
  hasIssBase64Details: boolean;
  hasHeaderBase64: boolean;
  hasAddressSeed: boolean;
}

export interface ProductionAcceptanceFreshnessEvidence {
  maxEpoch: number;
  currentEpoch: number;
  epochsRemaining: number;
}

const DEFAULT_RECEIPT_PATH = ".research-network/acceptance/production-acceptance.json";
const DEFAULT_GAS_RESERVE_MIST = 50_000_000n;
const KNOWN_TESTNET_IDS = new Set([
  "0x5ecd097d8f13e995493d23c9b033c815bd6a8bf771331c389c027296e8b8231e",
  "0x612c971a021e8139e0cd4e63bfef162f4301e72532b808a840d3d16512125ea4",
  "0xb637059cb77aca697e36673afa2e8639f7f82d16b8f0eba8eb6a1f5bd12eda2b",
  "0x5a25a789a4032c8460afa68b26b839a081c770372fa04e567207c606b68ad748",
  "0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98"
]);

export function parseMist(value: string | number | bigint | undefined, fallback: bigint, name: string): bigint {
  if (value === undefined || value === "") return fallback;
  const parsed = typeof value === "bigint" ? value : BigInt(String(value));
  if (parsed < 0n) throw new Error(`${name} must be non-negative`);
  return parsed;
}

export function parseProductionAcceptanceArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): ProductionAcceptanceConfig {
  const args = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--execute" || item === "--preflight") {
      args.set(item.slice(2), true);
      continue;
    }
    if (!item.startsWith("--")) {
      throw new Error(`Unexpected argument: ${item}`);
    }
    const key = item.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    args.set(key, value);
    i += 1;
  }

  const network = String(args.get("network") ?? env.RN_ACCEPTANCE_NETWORK ?? "testnet");
  if (network !== "testnet" && network !== "mainnet") {
    throw new Error("network must be testnet or mainnet");
  }

  const execute = args.get("execute") === true || env.RN_ACCEPTANCE_EXECUTE === "1";
  const preflight = args.get("preflight") === true || env.RN_ACCEPTANCE_PREFLIGHT === "1";
  if (execute && preflight) {
    throw new Error("--execute and --preflight are mutually exclusive");
  }

  return {
    network,
    execute,
    preflight,
    buyerSessionPath: stringArg(args, env, "buyer-session", "RN_ACCEPTANCE_BUYER_SESSION"),
    agentSessionPath: stringArg(args, env, "agent-session", "RN_ACCEPTANCE_AGENT_SESSION"),
    receiptPath: stringArg(args, env, "receipt", "RN_ACCEPTANCE_RECEIPT") ?? DEFAULT_RECEIPT_PATH,
    maxSpendMist: parseMist(stringArg(args, env, "max-spend-mist", "RN_ACCEPTANCE_MAX_SPEND_MIST"), 0n, "max-spend-mist"),
    gasReserveMist: parseMist(stringArg(args, env, "gas-reserve-mist", "RN_ACCEPTANCE_GAS_RESERVE_MIST"), DEFAULT_GAS_RESERVE_MIST, "gas-reserve-mist"),
    platformMembershipPriceMist: parseMist(stringArg(args, env, "platform-membership-mist", "RN_PLATFORM_MEMBERSHIP_PRICE_MIST"), 1_000_000n, "platform-membership-mist"),
    agentSubscriptionPriceMist: parseMist(stringArg(args, env, "agent-subscription-mist", "RN_AGENT_SUBSCRIPTION_PRICE_MIST"), 1_000_000n, "agent-subscription-mist"),
    delegationBudgetMist: parseMist(stringArg(args, env, "delegation-budget-mist", "RN_DELEGATION_BUDGET_MIST"), 1_000_000n, "delegation-budget-mist"),
    membershipSettlementShareMist: parseMist(stringArg(args, env, "membership-settlement-share-mist", "RN_MEMBERSHIP_SETTLEMENT_SHARE_MIST"), 800_000n, "membership-settlement-share-mist"),
    suiRpcUrl: stringArg(args, env, "sui-rpc-url", "RN_SUI_RPC_URL"),
    packageId: stringArg(args, env, "package-id", "RN_PACKAGE_ID"),
    settlementConfigId: stringArg(args, env, "settlement-config-id", "RN_SETTLEMENT_CONFIG_ID"),
    agentEarningsId: stringArg(args, env, "agent-earnings-id", "RN_AGENT_EARNINGS_ID"),
    membershipReceiptRegistryId: stringArg(args, env, "membership-receipt-registry-id", "RN_MEMBERSHIP_RECEIPT_REGISTRY_ID"),
    walrusPublisherUrl: stringArg(args, env, "walrus-publisher-url", "RN_WALRUS_PUBLISHER_URL"),
    walrusAggregatorUrl: stringArg(args, env, "walrus-aggregator-url", "RN_WALRUS_AGGREGATOR_URL"),
    walrusEpochs: numberArg(args, env, "walrus-epochs", "RN_WALRUS_EPOCHS"),
    sealKeyServerObjectId: stringArg(args, env, "seal-key-server-object-id", "RN_SEAL_KEY_SERVER_OBJECT_ID"),
    sealKeyServerAggregatorUrl: stringArg(args, env, "seal-key-server-aggregator-url", "RN_SEAL_KEY_SERVER_AGGREGATOR_URL"),
    sealThreshold: numberArg(args, env, "seal-threshold", "RN_SEAL_THRESHOLD")
  };
}

export function calculateProductionAcceptanceBudget(config: Pick<
  ProductionAcceptanceConfig,
  "platformMembershipPriceMist" | "agentSubscriptionPriceMist" | "delegationBudgetMist" | "membershipSettlementShareMist" | "gasReserveMist" | "maxSpendMist"
>): ProductionAcceptanceBudget {
  const committedSpendMist =
    config.platformMembershipPriceMist +
    config.agentSubscriptionPriceMist +
    config.delegationBudgetMist +
    config.membershipSettlementShareMist;
  const buyerMinimumMist = committedSpendMist + config.gasReserveMist;
  const agentMinimumMist = config.gasReserveMist;
  const totalBudgetMist = buyerMinimumMist + agentMinimumMist;
  return {
    committedSpendMist,
    gasReserveMist: config.gasReserveMist,
    buyerMinimumMist,
    agentMinimumMist,
    totalBudgetMist,
    maxSpendMist: config.maxSpendMist
  };
}

export function assertProductionAcceptanceCanExecute(config: ProductionAcceptanceConfig): ProductionAcceptanceBudget {
  const budget = calculateProductionAcceptanceBudget(config);
  if (config.network === "mainnet") {
    const missingMainnetConfig = [
      ["sui-rpc-url", config.suiRpcUrl],
      ["package-id", config.packageId],
      ["settlement-config-id", config.settlementConfigId],
      ["agent-earnings-id", config.agentEarningsId],
      ["membership-receipt-registry-id", config.membershipReceiptRegistryId],
      ["walrus-publisher-url", config.walrusPublisherUrl],
      ["walrus-aggregator-url", config.walrusAggregatorUrl],
      ["seal-key-server-object-id", config.sealKeyServerObjectId],
      ["seal-key-server-aggregator-url", config.sealKeyServerAggregatorUrl]
    ].filter(([, value]) => !value).map(([name]) => name);
    if (missingMainnetConfig.length) {
      throw new Error(`mainnet acceptance requires explicit ${missingMainnetConfig.join(", ")}`);
    }
    const testnetLeaks = mainnetTestnetLeaks(config);
    if (testnetLeaks.length) {
      throw new Error(`mainnet acceptance rejects testnet config in ${testnetLeaks.join(", ")}`);
    }
  }
  if (!config.execute && !config.preflight) return budget;
  const missing = [
    ["buyer-session", config.buyerSessionPath],
    ["agent-session", config.agentSessionPath]
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    throw new Error(`${config.preflight ? "--preflight" : "--execute"} requires ${missing.join(", ")}`);
  }
  if (config.preflight) return budget;
  if (config.maxSpendMist <= 0n) {
    throw new Error("--execute requires max-spend-mist");
  }
  if (budget.totalBudgetMist > config.maxSpendMist) {
    throw new Error(
      `configured spend ${budget.totalBudgetMist} MIST exceeds max-spend-mist ${config.maxSpendMist}`
    );
  }
  return budget;
}

export function normalizeProductionAcceptanceSession(
  label: string,
  raw: ProductionAcceptanceSessionInput
): ProductionAcceptanceSession {
  const session = {
    address: raw.address,
    ephemeralSecretKey: raw.ephemeralSecretKey ?? raw.secret ?? raw.rn_zk_eph?.secret,
    idToken: raw.idToken ?? raw.id_token ?? raw.rn_zk_session?.id_token,
    salt: raw.salt ?? raw.rn_zk_session?.salt,
    maxEpoch: Number(raw.maxEpoch ?? raw.max_epoch ?? raw.rn_zk_session?.maxEpoch ?? raw.rn_zk_eph?.maxEpoch ?? 0),
    randomness: raw.randomness ?? raw.rn_zk_session?.randomness ?? raw.rn_zk_eph?.randomness
  };
  const missing = [
    ["ephemeralSecretKey", session.ephemeralSecretKey],
    ["idToken", session.idToken],
    ["salt", session.salt],
    ["maxEpoch", session.maxEpoch > 0 ? String(session.maxEpoch) : undefined],
    ["randomness", session.randomness]
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    throw new Error(`${label} session is missing ${missing.join(", ")}`);
  }
  return session as ProductionAcceptanceSession;
}

export function assertProductionAcceptanceSessionFresh(
  label: string,
  session: Pick<ProductionAcceptanceSession, "maxEpoch">,
  currentEpoch: number,
  minEpochsRemaining = 2
): void {
  if (!Number.isFinite(currentEpoch) || currentEpoch < 0) {
    throw new Error("current epoch must be a non-negative number");
  }
  const remaining = session.maxEpoch - currentEpoch;
  if (remaining < minEpochsRemaining) {
    throw new Error(
      `${label} zkLogin session expires too soon: maxEpoch ${session.maxEpoch}, currentEpoch ${currentEpoch}, remaining ${remaining}`
    );
  }
}

export function productionAcceptanceFreshnessEvidence(
  session: Pick<ProductionAcceptanceSession, "maxEpoch">,
  currentEpoch: number
): ProductionAcceptanceFreshnessEvidence {
  return {
    maxEpoch: session.maxEpoch,
    currentEpoch,
    epochsRemaining: session.maxEpoch - currentEpoch
  };
}

export function assertProductionAcceptanceSessionAddress(
  label: string,
  session: Pick<ProductionAcceptanceSession, "address" | "idToken" | "salt">,
  deriveAddress: (idToken: string, salt: string) => string
): string {
  const derived = deriveAddress(session.idToken, session.salt);
  if (session.address && session.address.toLowerCase() !== derived.toLowerCase()) {
    throw new Error(`${label} zkLogin session address ${session.address} does not match derived address ${derived}`);
  }
  return derived;
}

export function zkProofEvidence(proof: Record<string, unknown>): ProductionAcceptanceProofEvidence {
  return {
    hasProofPoints: Boolean(proof.proofPoints ?? proof.proof_points),
    hasIssBase64Details: Boolean(proof.issBase64Details ?? proof.iss_base64_details),
    hasHeaderBase64: Boolean(proof.headerBase64 ?? proof.header_base64),
    hasAddressSeed: Boolean(proof.addressSeed ?? proof.address_seed)
  };
}

function mainnetTestnetLeaks(config: ProductionAcceptanceConfig): string[] {
  const checks = [
    ["sui-rpc-url", config.suiRpcUrl],
    ["package-id", config.packageId],
    ["settlement-config-id", config.settlementConfigId],
    ["agent-earnings-id", config.agentEarningsId],
    ["membership-receipt-registry-id", config.membershipReceiptRegistryId],
    ["walrus-publisher-url", config.walrusPublisherUrl],
    ["walrus-aggregator-url", config.walrusAggregatorUrl],
    ["seal-key-server-object-id", config.sealKeyServerObjectId],
    ["seal-key-server-aggregator-url", config.sealKeyServerAggregatorUrl]
  ];
  return checks
    .filter(([, value]) => typeof value === "string" && isKnownTestnetValue(value))
    .map(([name]) => String(name));
}

function isKnownTestnetValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  if (KNOWN_TESTNET_IDS.has(normalized)) return true;
  return normalized.includes("testnet") || normalized.includes("sui-testnet-rpc.publicnode.com");
}

export function createProductionAcceptanceReceipt(
  config: ProductionAcceptanceConfig,
  budget: ProductionAcceptanceBudget
): ProductionAcceptanceReceipt {
  return {
    network: config.network,
    execute: config.execute,
    preflight: config.preflight,
    startedAt: new Date().toISOString(),
    budget: {
      committedSpendMist: String(budget.committedSpendMist),
      gasReserveMist: String(budget.gasReserveMist),
      buyerMinimumMist: String(budget.buyerMinimumMist),
      agentMinimumMist: String(budget.agentMinimumMist),
      totalBudgetMist: String(budget.totalBudgetMist),
      maxSpendMist: String(budget.maxSpendMist)
    },
    config: {
      suiRpcUrl: config.suiRpcUrl,
      packageId: config.packageId,
      settlementConfigId: config.settlementConfigId,
      agentEarningsId: config.agentEarningsId,
      membershipReceiptRegistryId: config.membershipReceiptRegistryId,
      walrusPublisherUrl: config.walrusPublisherUrl,
      walrusAggregatorUrl: config.walrusAggregatorUrl,
      walrusEpochs: config.walrusEpochs,
      sealKeyServerObjectId: config.sealKeyServerObjectId,
      sealKeyServerAggregatorUrl: config.sealKeyServerAggregatorUrl,
      sealThreshold: config.sealThreshold
    },
    steps: [],
    conclusion: config.execute ? "failed" : "not_run"
  };
}

export async function writeProductionAcceptanceReceipt(filePath: string, receipt: ProductionAcceptanceReceipt): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(receipt, null, 2) + "\n", "utf8");
}

function stringArg(args: Map<string, string | boolean>, env: NodeJS.ProcessEnv, argName: string, envName: string): string | undefined {
  const arg = args.get(argName);
  if (typeof arg === "string") return arg;
  return env[envName];
}

function numberArg(args: Map<string, string | boolean>, env: NodeJS.ProcessEnv, argName: string, envName: string): number | undefined {
  const raw = stringArg(args, env, argName, envName);
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${argName} must be a non-negative integer`);
  }
  return value;
}
