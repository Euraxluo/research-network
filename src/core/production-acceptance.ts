import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type ProductionAcceptanceNetwork = "testnet" | "mainnet";

export interface ProductionAcceptanceConfig {
  network: ProductionAcceptanceNetwork;
  execute: boolean;
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

const DEFAULT_RECEIPT_PATH = ".research-network/acceptance/production-acceptance.json";
const DEFAULT_GAS_RESERVE_MIST = 50_000_000n;

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
    if (item === "--execute") {
      args.set("execute", true);
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

  return {
    network,
    execute: args.get("execute") === true || env.RN_ACCEPTANCE_EXECUTE === "1",
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
  }
  if (!config.execute) return budget;
  const missing = [
    ["buyer-session", config.buyerSessionPath],
    ["agent-session", config.agentSessionPath],
    ["max-spend-mist", config.maxSpendMist > 0n ? String(config.maxSpendMist) : undefined]
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    throw new Error(`--execute requires ${missing.join(", ")}`);
  }
  if (budget.totalBudgetMist > config.maxSpendMist) {
    throw new Error(
      `configured spend ${budget.totalBudgetMist} MIST exceeds max-spend-mist ${config.maxSpendMist}`
    );
  }
  return budget;
}

export function createProductionAcceptanceReceipt(
  config: ProductionAcceptanceConfig,
  budget: ProductionAcceptanceBudget
): ProductionAcceptanceReceipt {
  return {
    network: config.network,
    execute: config.execute,
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
