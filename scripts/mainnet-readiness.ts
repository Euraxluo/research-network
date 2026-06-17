/**
 * Mainnet readiness audit.
 *
 * This script does not spend funds. It verifies whether the evidence needed to
 * approve real funds/mainnet is present: successful testnet receipts, explicit
 * mainnet config, no testnet-looking endpoints, and on-chain object/transaction
 * existence checks for final mainnet funding approval.
 */
import { readFile } from "node:fs/promises";
import {
  assertProductionAcceptanceCanExecute,
  parseProductionAcceptanceArgs,
  type ProductionAcceptanceReceipt
} from "../src/core/production-acceptance.js";
import {
  checkReceiptConfigMatchesAcceptanceConfig,
  checkBoolean,
  checkProductionAcceptanceReceipt,
  DEFAULT_MAINNET_ACCEPTANCE_MAX_SPEND_MIST,
  DEFAULT_MAINNET_RECEIPT_MAX_AGE_MS,
  fail,
  hasBlockingReadinessFailures,
  pass,
  warn,
  type MainnetReadinessStage,
  type ReadinessCheck
} from "../src/core/mainnet-readiness.js";
import { DEFAULT_M3_CONFIG, m3ConfigOverridesFromEnv, validateM3Config, type M3Config } from "../web/src/lib/config.ts";
import { resolveAuthSuiRpcUrl } from "../src/core/web-auth.js";
import { resolveWalrusProxyConfig } from "../api/walrus.js";
import { getWalrusSiteResourceByPath, walrusAggregatorResourceUrl } from "../src/core/walrus-sites.js";

interface ReadinessArgs {
  stage: MainnetReadinessStage;
  testnetPreflightReceipt?: string;
  testnetExecuteReceipt?: string;
  mainnetPreflightReceipt?: string;
  mainnetExecuteReceipt?: string;
  mainnetReceiptMaxAgeMs: number;
  json: boolean;
  skipChain: boolean;
}

interface Report {
  stage: MainnetReadinessStage;
  ready: boolean;
  generatedAt: string;
  checks: ReadinessCheck[];
}

interface ReceiptSet {
  testnetPreflight?: ProductionAcceptanceReceipt;
  testnetExecute?: ProductionAcceptanceReceipt;
  mainnetPreflight?: ProductionAcceptanceReceipt;
  mainnetExecute?: ProductionAcceptanceReceipt;
}

interface ReceiptTransactionEvidence {
  digest: string;
  expectedEventTypes: string[];
  expectedSenderAddress?: string;
}

interface ChainObjectExpectation {
  label: string;
  id: string;
  expectedTypeSuffix?: string;
  expectedPackageId?: string;
}

const REQUIRED_MAINNET_WALRUS_SITE_PATHS = [
  "/index.html",
  "/site-data.json",
  "/dashboard.html",
  "/membership.html",
  "/delegations.html"
];

async function main() {
  const args = parseArgs(process.argv.slice(2), process.env);
  const checks: ReadinessCheck[] = [];
  const receipts = await readReceipts(args);
  checks.push(...receiptChecks(args, receipts));
  const configResult = configChecks(process.env, args.stage);
  checks.push(...configResult.checks);
  checks.push(...receiptConfigChecks(args.stage, receipts, configResult.acceptance));
  if (args.stage === "mainnet-final" && args.skipChain) {
    checks.push(fail("chain.mainnet.required", "mainnet-final readiness requires live mainnet chain checks; --skip-chain is only allowed before final funding approval", true, {
      remediation: "Re-run readiness without --skip-chain so mainnet package/shared objects and receipt transactions are queried by RPC."
    }));
  } else if (!args.skipChain) {
    checks.push(...await chainChecks(process.env, args.stage, receipts));
  }
  const report: Report = {
    stage: args.stage,
    ready: !hasBlockingReadinessFailures(checks),
    generatedAt: new Date().toISOString(),
    checks
  };
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printTextReport(report);
  }
  if (!report.ready) {
    process.exitCode = 1;
  }
}

function parseArgs(argv: string[], env: NodeJS.ProcessEnv): ReadinessArgs {
  const map = new Map<string, string | boolean>();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--json" || item === "--skip-chain") {
      map.set(item.slice(2), true);
      continue;
    }
    if (!item.startsWith("--")) {
      throw new Error(`Unexpected argument: ${item}`);
    }
    const key = item.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    map.set(key, value);
    index += 1;
  }
  const stage = String(map.get("stage") ?? env.RN_READINESS_STAGE ?? "mainnet-config");
  if (stage !== "testnet" && stage !== "mainnet-config" && stage !== "mainnet-final") {
    throw new Error("--stage must be testnet, mainnet-config, or mainnet-final");
  }
  return {
    stage,
    testnetPreflightReceipt: stringArg(map, env, "testnet-preflight-receipt", "RN_TESTNET_PREFLIGHT_RECEIPT"),
    testnetExecuteReceipt: stringArg(map, env, "testnet-execute-receipt", "RN_TESTNET_EXECUTE_RECEIPT"),
    mainnetPreflightReceipt: stringArg(map, env, "mainnet-preflight-receipt", "RN_MAINNET_PREFLIGHT_RECEIPT"),
    mainnetExecuteReceipt: stringArg(map, env, "mainnet-execute-receipt", "RN_MAINNET_EXECUTE_RECEIPT"),
    mainnetReceiptMaxAgeMs: positiveIntegerArg(map, env, "mainnet-receipt-max-age-ms", "RN_MAINNET_RECEIPT_MAX_AGE_MS") ?? DEFAULT_MAINNET_RECEIPT_MAX_AGE_MS,
    json: map.get("json") === true || env.RN_READINESS_JSON === "1",
    skipChain: map.get("skip-chain") === true || env.RN_READINESS_SKIP_CHAIN === "1"
  };
}

async function readReceipts(args: ReadinessArgs): Promise<ReceiptSet> {
  return {
    testnetPreflight: await readReceipt(args.testnetPreflightReceipt),
    testnetExecute: await readReceipt(args.testnetExecuteReceipt),
    mainnetPreflight: await readReceipt(args.mainnetPreflightReceipt),
    mainnetExecute: await readReceipt(args.mainnetExecuteReceipt)
  };
}

function receiptChecks(args: ReadinessArgs, receipts: ReceiptSet): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];
  const needsTestnet = args.stage === "testnet" || args.stage === "mainnet-config" || args.stage === "mainnet-final";
  const needsMainnet = args.stage === "mainnet-final";
  const nowMs = Date.now();
  if (needsTestnet) {
    checks.push(...checkProductionAcceptanceReceipt(receipts.testnetPreflight, {
      label: "testnet-preflight",
      network: "testnet",
      execute: false,
      preflight: true,
      required: true
    }));
    checks.push(...checkProductionAcceptanceReceipt(receipts.testnetExecute, {
      label: "testnet-execute",
      network: "testnet",
      execute: true,
      preflight: false,
      required: true
    }));
  }
  if (needsMainnet) {
    checks.push(...checkProductionAcceptanceReceipt(receipts.mainnetPreflight, {
      label: "mainnet-preflight",
      network: "mainnet",
      execute: false,
      preflight: true,
      required: true,
      maxReceiptAgeMs: args.mainnetReceiptMaxAgeMs,
      nowMs
    }));
    checks.push(...checkProductionAcceptanceReceipt(receipts.mainnetExecute, {
      label: "mainnet-execute",
      network: "mainnet",
      execute: true,
      preflight: false,
      required: true,
      maxSpendMist: DEFAULT_MAINNET_ACCEPTANCE_MAX_SPEND_MIST,
      maxReceiptAgeMs: args.mainnetReceiptMaxAgeMs,
      nowMs
    }));
  }
  return checks;
}

function configChecks(env: NodeJS.ProcessEnv, stage: MainnetReadinessStage): {
  checks: ReadinessCheck[];
  acceptance?: ReturnType<typeof parseProductionAcceptanceArgs>;
} {
  const checks: ReadinessCheck[] = [];
  if (stage === "testnet") {
    checks.push(warn(
      "config.mainnet.skipped",
      "Mainnet config checks skipped for testnet stage",
      undefined,
      "Run --stage mainnet-config before approving mainnet deployment."
    ));
    return { checks };
  }

  const mainnetAcceptanceEnv = {
    ...env,
    RN_ACCEPTANCE_NETWORK: "mainnet"
  };
  const configSet: {
    acceptance?: ReturnType<typeof parseProductionAcceptanceArgs>;
    web?: Partial<M3Config>;
    walrus?: ReturnType<typeof resolveWalrusProxyConfig>;
    authRpc?: string;
  } = {};
  try {
    const config = parseProductionAcceptanceArgs([], mainnetAcceptanceEnv);
    assertProductionAcceptanceCanExecute(config);
    configSet.acceptance = config;
    checks.push(pass("config.acceptance.mainnet", "Mainnet acceptance config is explicit and has no known testnet values", {
      packageId: config.packageId,
      suiRpcUrl: config.suiRpcUrl,
      walrusAggregatorUrl: config.walrusAggregatorUrl
    }));
  } catch (error) {
    checks.push(fail("config.acceptance.mainnet", message(error), true, {
      remediation: "Set RN_SUI_RPC_URL, RN_PACKAGE_ID, RN_SETTLEMENT_CONFIG_ID, RN_AGENT_EARNINGS_ID, RN_MEMBERSHIP_RECEIPT_REGISTRY_ID, RN_WALRUS_PUBLISHER_URL, RN_WALRUS_AGGREGATOR_URL, RN_SEAL_KEY_SERVER_OBJECT_ID, and RN_SEAL_KEY_SERVER_AGGREGATOR_URL to mainnet values."
    }));
  }

  try {
    const overrides = m3ConfigOverridesFromEnv(env);
    const requiredWebKeys = [
      "network",
      "suiRpcUrl",
      "packageId",
      "settlementConfigId",
      "agentEarningsId",
      "membershipReceiptRegistryId",
      "walrusPublisherUrl",
      "walrusAggregatorUrl",
      "sealKeyServers",
      "walrusEpochs",
      "sealThreshold",
      "platformMembershipPriceMist",
      "agentSubscriptionPriceMist",
      "delegationBudgetMist",
      "membershipSettlementShareMist",
      "accessDurationMs"
    ] as const;
    const missing = requiredWebKeys.filter((key) => overrides[key] === undefined);
    if (missing.length) {
      throw new Error(`mainnet Web config requires VITE_RN_* overrides for ${missing.join(", ")}`);
    }
    validateM3Config({ ...DEFAULT_M3_CONFIG, ...overrides } as M3Config);
    configSet.web = overrides;
    checks.push(pass("config.web.mainnet", "Vite Web mainnet config is explicit and has no known testnet values", {
      network: overrides.network,
      packageId: overrides.packageId,
      walrusAggregatorUrl: overrides.walrusAggregatorUrl
    }));
  } catch (error) {
    checks.push(fail("config.web.mainnet", message(error), true, {
      remediation: "Set the VITE_RN_* production variables documented in web/README.md before building the mainnet Web bundle."
    }));
  }

  try {
    const walrus = resolveWalrusProxyConfig({ ...env, RN_WEB_NETWORK: "mainnet" });
    configSet.walrus = walrus;
    checks.push(pass("config.vercel.walrus.mainnet", "Vercel Walrus proxy mainnet config is explicit", {
      siteObjectId: walrus.siteObjectId,
      rpcUrl: walrus.rpcUrl,
      aggregatorUrl: walrus.aggregatorUrl
    }));
  } catch (error) {
    checks.push(fail("config.vercel.walrus.mainnet", message(error), true, {
      remediation: "Set WALRUS_SITE_OBJECT_ID, WALRUS_SUI_RPC_URL or SUI_RPC_URL, and WALRUS_AGGREGATOR_URL to mainnet values."
    }));
  }

  try {
    const rpc = resolveAuthSuiRpcUrl({ ...env, RN_WEB_NETWORK: "mainnet" });
    configSet.authRpc = rpc;
    checks.push(pass("config.auth.mainnet", "Auth shell uses explicit mainnet Sui RPC", { authSuiRpcUrl: rpc }));
  } catch (error) {
    checks.push(fail("config.auth.mainnet", message(error), true, {
      remediation: "Set AUTH_SUI_RPC_URL to a mainnet Sui RPC endpoint so zkLogin maxEpoch is fetched from mainnet."
    }));
  }

  checks.push(checkBoolean(
    "config.prover",
    Boolean(env.ZKLOGIN_PROVER_URL),
    "ZKLOGIN_PROVER_URL is configured",
    "ZKLOGIN_PROVER_URL is missing",
    true,
    env.ZKLOGIN_PROVER_URL ? { proverConfigured: true } : undefined
  ));
  checks.push(...configConsistencyChecks(configSet));
  return { checks, acceptance: configSet.acceptance };
}

function receiptConfigChecks(
  stage: MainnetReadinessStage,
  receipts: ReceiptSet,
  acceptance: ReturnType<typeof parseProductionAcceptanceArgs> | undefined
): ReadinessCheck[] {
  if (stage !== "mainnet-final" || !acceptance) return [];
  return [
    ...checkReceiptConfigMatchesAcceptanceConfig(receipts.mainnetPreflight, "mainnet-preflight", acceptance, true),
    ...checkReceiptConfigMatchesAcceptanceConfig(receipts.mainnetExecute, "mainnet-execute", acceptance, true)
  ];
}

function configConsistencyChecks(configSet: {
  acceptance?: ReturnType<typeof parseProductionAcceptanceArgs>;
  web?: Partial<M3Config>;
  walrus?: ReturnType<typeof resolveWalrusProxyConfig>;
  authRpc?: string;
}): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];
  const acceptance = configSet.acceptance;
  const web = configSet.web;
  const walrus = configSet.walrus;
  const authRpc = configSet.authRpc;
  if (acceptance && web) {
    checks.push(compareConfigValue(
      "config.consistency.package_id",
      "Acceptance RN_PACKAGE_ID matches Web VITE_RN_PACKAGE_ID",
      "Acceptance RN_PACKAGE_ID does not match Web VITE_RN_PACKAGE_ID",
      acceptance.packageId,
      web.packageId
    ));
    checks.push(compareConfigValue(
      "config.consistency.settlement_config_id",
      "Acceptance settlement config id matches Web config",
      "Acceptance settlement config id does not match Web config",
      acceptance.settlementConfigId,
      web.settlementConfigId
    ));
    checks.push(compareConfigValue(
      "config.consistency.agent_earnings_id",
      "Acceptance agent earnings id matches Web config",
      "Acceptance agent earnings id does not match Web config",
      acceptance.agentEarningsId,
      web.agentEarningsId
    ));
    checks.push(compareConfigValue(
      "config.consistency.receipt_registry_id",
      "Acceptance receipt registry id matches Web config",
      "Acceptance receipt registry id does not match Web config",
      acceptance.membershipReceiptRegistryId,
      web.membershipReceiptRegistryId
    ));
    checks.push(compareConfigValue(
      "config.consistency.sui_rpc",
      "Acceptance Sui RPC matches Web Sui RPC",
      "Acceptance Sui RPC does not match Web Sui RPC",
      acceptance.suiRpcUrl,
      web.suiRpcUrl
    ));
    checks.push(compareConfigValue(
      "config.consistency.walrus_publisher",
      "Acceptance Walrus publisher matches Web publisher",
      "Acceptance Walrus publisher does not match Web publisher",
      acceptance.walrusPublisherUrl,
      web.walrusPublisherUrl
    ));
    checks.push(compareConfigValue(
      "config.consistency.walrus_aggregator",
      "Acceptance Walrus aggregator matches Web aggregator",
      "Acceptance Walrus aggregator does not match Web aggregator",
      acceptance.walrusAggregatorUrl,
      web.walrusAggregatorUrl
    ));
    checks.push(compareConfigValue(
      "config.consistency.seal_key_server",
      "Acceptance Seal key server matches Web Seal key server",
      "Acceptance Seal key server does not match Web Seal key server",
      acceptance.sealKeyServerObjectId,
      web.sealKeyServers?.[0]?.objectId
    ));
    checks.push(compareConfigValue(
      "config.consistency.seal_aggregator",
      "Acceptance Seal aggregator matches Web Seal aggregator",
      "Acceptance Seal aggregator does not match Web Seal aggregator",
      acceptance.sealKeyServerAggregatorUrl,
      web.sealKeyServers?.[0]?.aggregatorUrl
    ));
    checks.push(compareConfigValue(
      "config.consistency.platform_membership_price",
      "Acceptance platform membership price matches Web config",
      "Acceptance platform membership price does not match Web config",
      String(acceptance.platformMembershipPriceMist),
      web.platformMembershipPriceMist
    ));
    checks.push(compareConfigValue(
      "config.consistency.agent_subscription_price",
      "Acceptance agent subscription price matches Web config",
      "Acceptance agent subscription price does not match Web config",
      String(acceptance.agentSubscriptionPriceMist),
      web.agentSubscriptionPriceMist
    ));
    checks.push(compareConfigValue(
      "config.consistency.delegation_budget",
      "Acceptance delegation budget matches Web config",
      "Acceptance delegation budget does not match Web config",
      String(acceptance.delegationBudgetMist),
      web.delegationBudgetMist
    ));
    checks.push(compareConfigValue(
      "config.consistency.membership_settlement_share",
      "Acceptance membership settlement share matches Web config",
      "Acceptance membership settlement share does not match Web config",
      String(acceptance.membershipSettlementShareMist),
      web.membershipSettlementShareMist
    ));
    checks.push(compareConfigValue(
      "config.consistency.access_duration",
      "Acceptance access duration matches Web config",
      "Acceptance access duration does not match Web config",
      String(acceptance.accessDurationMs),
      web.accessDurationMs === undefined ? undefined : String(web.accessDurationMs)
    ));
    checks.push(compareConfigValue(
      "config.consistency.walrus_epochs",
      "Acceptance Walrus epochs matches Web config",
      "Acceptance Walrus epochs does not match Web config",
      acceptance.walrusEpochs === undefined ? undefined : String(acceptance.walrusEpochs),
      web.walrusEpochs === undefined ? undefined : String(web.walrusEpochs)
    ));
    checks.push(compareConfigValue(
      "config.consistency.seal_threshold",
      "Acceptance Seal threshold matches Web config",
      "Acceptance Seal threshold does not match Web config",
      acceptance.sealThreshold === undefined ? undefined : String(acceptance.sealThreshold),
      web.sealThreshold === undefined ? undefined : String(web.sealThreshold)
    ));
  }
  if (acceptance && walrus) {
    checks.push(compareConfigValue(
      "config.consistency.vercel_walrus_rpc",
      "Acceptance Sui RPC matches Vercel Walrus proxy RPC",
      "Acceptance Sui RPC does not match Vercel Walrus proxy RPC",
      acceptance.suiRpcUrl,
      walrus.rpcUrl
    ));
    checks.push(compareConfigValue(
      "config.consistency.vercel_walrus_aggregator",
      "Acceptance Walrus aggregator matches Vercel Walrus proxy aggregator",
      "Acceptance Walrus aggregator does not match Vercel Walrus proxy aggregator",
      acceptance.walrusAggregatorUrl,
      walrus.aggregatorUrl
    ));
  }
  if (acceptance && authRpc) {
    checks.push(compareConfigValue(
      "config.consistency.auth_rpc",
      "Acceptance Sui RPC matches auth shell Sui RPC",
      "Acceptance Sui RPC does not match auth shell Sui RPC",
      acceptance.suiRpcUrl,
      authRpc
    ));
  }
  return checks;
}

function compareConfigValue(
  name: string,
  passedMessage: string,
  failedMessage: string,
  left: string | undefined,
  right: string | undefined
): ReadinessCheck {
  const normalizedLeft = normalizeConfigValue(left);
  const normalizedRight = normalizeConfigValue(right);
  return checkBoolean(
    name,
    Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight),
    passedMessage,
    failedMessage,
    true,
    { left, right }
  );
}

async function chainChecks(env: NodeJS.ProcessEnv, stage: MainnetReadinessStage, receipts: ReceiptSet): Promise<ReadinessCheck[]> {
  if (stage === "testnet") {
    return [warn("chain.mainnet.skipped", "Mainnet chain object checks skipped for testnet stage")];
  }
  const checks: ReadinessCheck[] = [];
  const rpcUrl = env.RN_SUI_RPC_URL;
  const packageId = env.RN_PACKAGE_ID;
  const ids = [
    { label: "package", id: env.RN_PACKAGE_ID },
    { label: "settlement-config", id: env.RN_SETTLEMENT_CONFIG_ID, expectedTypeSuffix: "::settlement::SettlementConfig", expectedPackageId: packageId },
    { label: "agent-earnings", id: env.RN_AGENT_EARNINGS_ID, expectedTypeSuffix: "::settlement::AgentEarnings", expectedPackageId: packageId },
    {
      label: "membership-receipt-registry",
      id: env.RN_MEMBERSHIP_RECEIPT_REGISTRY_ID,
      expectedTypeSuffix: "::settlement::MembershipReceiptRegistry",
      expectedPackageId: packageId
    },
    { label: "seal-key-server", id: env.RN_SEAL_KEY_SERVER_OBJECT_ID, expectedTypeSuffix: "::key_server::KeyServer" }
  ].filter((item): item is ChainObjectExpectation => Boolean(item.id));
  if (!rpcUrl) {
    return [fail("chain.mainnet.rpc", "Cannot query mainnet objects because RN_SUI_RPC_URL is missing")];
  }
  if (!ids.length) {
    checks.push(fail("chain.mainnet.objects", "Cannot query mainnet objects because no RN_* object ids are configured"));
  } else {
    checks.push(...await chainObjectChecks(rpcUrl, ids));
  }
  if (stage === "mainnet-final") {
    checks.push(...await chainWalrusSiteChecks(env));
    checks.push(...await chainReceiptTransactionChecks(rpcUrl, receipts.mainnetExecute));
  }
  return checks;
}

async function chainObjectChecks(
  rpcUrl: string,
  ids: ChainObjectExpectation[]
): Promise<ReadinessCheck[]> {
  try {
    const responses = await suiRpc<Array<{ data?: { objectId?: string; type?: string }; error?: unknown }>>(rpcUrl, "sui_multiGetObjects", [
      ids.map((item) => item.id),
      { showType: true, showOwner: true }
    ]);
    return ids.flatMap(({ label, id, expectedTypeSuffix, expectedPackageId }, index) => {
      const response = responses[index];
      if (response?.data?.objectId) {
        const objectChecks: ReadinessCheck[] = [pass(`chain.mainnet.${label}`, `Mainnet ${label} object exists`, {
          objectId: response.data.objectId,
          type: response.data.type
        })];
        if (expectedTypeSuffix) {
          objectChecks.push(checkBoolean(
            `chain.mainnet.${label}.type`,
            matchesChainObjectType(response.data.type, expectedTypeSuffix, expectedPackageId),
            `Mainnet ${label} object type matches ${expectedTypeSuffix}`,
            `Mainnet ${label} object type does not match ${expectedTypeSuffix}`,
            true,
            { objectId: response.data.objectId, type: response.data.type, expectedTypeSuffix, expectedPackageId }
          ));
        }
        return objectChecks;
      }
      return [fail(`chain.mainnet.${label}`, `Mainnet ${label} object was not found by RPC`, true, {
        evidence: { objectId: id, error: response?.error }
      })];
    });
  } catch (error) {
    return [fail("chain.mainnet.rpc", `Mainnet object query failed: ${message(error)}`)];
  }
}

function matchesChainObjectType(
  type: unknown,
  expectedTypeSuffix: string,
  expectedPackageId: string | undefined
): boolean {
  if (typeof type !== "string" || !type.endsWith(expectedTypeSuffix)) return false;
  if (!expectedPackageId) return true;
  return normalizeSuiObjectId(type.split("::", 1)[0]) === normalizeSuiObjectId(expectedPackageId);
}

async function chainWalrusSiteChecks(env: NodeJS.ProcessEnv): Promise<ReadinessCheck[]> {
  let config: ReturnType<typeof resolveWalrusProxyConfig>;
  try {
    config = resolveWalrusProxyConfig({ ...env, RN_WEB_NETWORK: "mainnet" });
  } catch (error) {
    return [fail("chain.mainnet.walrus_site.config", `Cannot query mainnet Walrus Site because proxy config is invalid: ${message(error)}`)];
  }

  const checks: ReadinessCheck[] = [];
  for (const path of REQUIRED_MAINNET_WALRUS_SITE_PATHS) {
    try {
      const resource = await getWalrusSiteResourceByPath({
        siteObjectId: config.siteObjectId,
        path,
        rpcUrl: config.rpcUrl
      });
      checks.push(checkBoolean(
        `chain.mainnet.walrus_site.${path.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "")}`,
        Boolean(resource?.blobId),
        `Mainnet Walrus Site serves ${path}`,
        `Mainnet Walrus Site is missing required resource ${path}`,
        true,
        {
          siteObjectId: config.siteObjectId,
          path,
          blobId: resource?.blobId,
          aggregatorUrl: resource ? walrusAggregatorResourceUrl(resource, config.aggregatorUrl) : undefined
        }
      ));
    } catch (error) {
      checks.push(fail(
        `chain.mainnet.walrus_site.${path.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "")}`,
        `Mainnet Walrus Site resource check failed for ${path}: ${message(error)}`,
        true,
        { evidence: { siteObjectId: config.siteObjectId, path } }
      ));
    }
  }
  return checks;
}

async function chainReceiptTransactionChecks(
  rpcUrl: string,
  receipt: ProductionAcceptanceReceipt | undefined
): Promise<ReadinessCheck[]> {
  const evidence = receipt ? receiptTransactionEvidence(receipt) : [];
  if (!evidence.length) {
    return [fail("chain.mainnet.transactions", "Cannot query mainnet receipt transactions because no execute receipt digests are available")];
  }
  const digests = evidence.map((item) => item.digest);
  const startedMs = receiptTimestampMs(receipt?.startedAt);
  const finishedMs = receiptTimestampMs(receipt?.finishedAt);
  try {
    const responses = await suiRpc<Array<{
      digest?: string;
      timestampMs?: string;
      transaction?: { data?: { sender?: string } };
      effects?: { status?: { status?: string; error?: string } };
      events?: Array<{ type?: string }>;
      error?: unknown;
    } | null>>(
      rpcUrl,
      "sui_multiGetTransactionBlocks",
      [
        digests,
        { showEffects: true, showEvents: true, showInput: true }
      ]
    );
    return digests.map((digest, index) => {
      const response = responses[index];
      const status = response?.effects?.status?.status;
      const chainSenderAddress = response?.transaction?.data?.sender;
      const expectedSenderAddress = evidence[index]?.expectedSenderAddress;
      const timestampMs = integerMs(response?.timestampMs);
      const chainEventTypes = Array.isArray(response?.events)
        ? response.events.map((event) => event.type).filter((type): type is string => typeof type === "string")
        : [];
      const expectedEventTypes = evidence[index]?.expectedEventTypes ?? [];
      const eventsMatch = expectedEventTypes.every((type) => chainEventTypes.includes(type));
      const senderMatches = sameSuiAddress(chainSenderAddress, expectedSenderAddress);
      const timestampMatches = timestampMs !== undefined &&
        startedMs !== undefined &&
        finishedMs !== undefined &&
        timestampMs >= startedMs &&
        timestampMs <= finishedMs;
      return checkBoolean(
        `chain.mainnet.transaction.${index + 1}`,
        response?.digest === digest && status === "success" && senderMatches && eventsMatch && timestampMatches,
        `Mainnet receipt transaction ${digest} exists, succeeded, sender matches the receipt role, emitted receipt events, and falls within the receipt window`,
        `Mainnet receipt transaction ${digest} was not found, did not succeed, sender did not match the receipt role, emitted different events, or falls outside the receipt window`,
        true,
        {
          digest,
          returnedDigest: response?.digest,
          status,
          expectedSenderAddress,
          chainSenderAddress,
          expectedEventTypes,
          chainEventTypes,
          timestampMs,
          receiptStartedMs: startedMs,
          receiptFinishedMs: finishedMs,
          error: response?.effects?.status?.error ?? response?.error
        }
      );
    });
  } catch (error) {
    return [fail("chain.mainnet.transactions", `Mainnet receipt transaction query failed: ${message(error)}`)];
  }
}

function receiptTransactionEvidence(receipt: ProductionAcceptanceReceipt): ReceiptTransactionEvidence[] {
  const evidence = new Map<string, ReceiptTransactionEvidence>();
  for (const step of receipt.steps) {
    if (typeof step.digest === "string") {
      mergeReceiptTransactionEvidence(
        evidence,
        step.digest,
        stringArray(step.meta?.eventTypes),
        stringValue(step.meta?.signerAddress)
      );
    }
    const fundDigest = step.meta?.fundDigest;
    if (typeof fundDigest === "string") {
      mergeReceiptTransactionEvidence(
        evidence,
        fundDigest,
        stringArray(step.meta?.fundEventTypes),
        stringValue(step.meta?.fundSignerAddress)
      );
    }
  }
  return [...evidence.values()];
}

function mergeReceiptTransactionEvidence(
  evidence: Map<string, ReceiptTransactionEvidence>,
  digest: string,
  eventTypes: string[],
  expectedSenderAddress: string | undefined
) {
  const item = evidence.get(digest) ?? { digest, expectedEventTypes: [] };
  for (const type of eventTypes) {
    if (!item.expectedEventTypes.includes(type)) item.expectedEventTypes.push(type);
  }
  if (expectedSenderAddress) {
    if (item.expectedSenderAddress && !sameSuiAddress(item.expectedSenderAddress, expectedSenderAddress)) {
      item.expectedSenderAddress = "receipt-signer-conflict";
    } else {
      item.expectedSenderAddress = expectedSenderAddress;
    }
  }
  evidence.set(digest, item);
}

function receiptTimestampMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function integerMs(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const timestamp = Number(value);
  return Number.isInteger(timestamp) && timestamp >= 0 ? timestamp : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function sameSuiAddress(left: unknown, right: unknown): boolean {
  return typeof left === "string" &&
    typeof right === "string" &&
    normalizeSuiAddress(left) === normalizeSuiAddress(right);
}

async function suiRpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const body = await response.json() as { result?: T; error?: { message?: string } };
  if (body.error) {
    throw new Error(body.error.message ?? JSON.stringify(body.error));
  }
  return body.result as T;
}

async function readReceipt(filePath: string | undefined): Promise<ProductionAcceptanceReceipt | undefined> {
  if (!filePath) return undefined;
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as ProductionAcceptanceReceipt;
  } catch {
    return undefined;
  }
}

function printTextReport(report: Report): void {
  console.log(`Mainnet readiness stage: ${report.stage}`);
  console.log(`Ready: ${report.ready ? "yes" : "no"}`);
  for (const check of report.checks) {
    const mark = check.status === "passed" ? "PASS" : check.status === "warning" ? "WARN" : "FAIL";
    console.log(`[${mark}] ${check.name}: ${check.message}`);
    if (check.remediation && check.status !== "passed") {
      console.log(`      remediation: ${check.remediation}`);
    }
  }
}

function stringArg(args: Map<string, string | boolean>, env: NodeJS.ProcessEnv, argName: string, envName: string): string | undefined {
  const value = args.get(argName);
  return typeof value === "string" ? value : env[envName];
}

function positiveIntegerArg(args: Map<string, string | boolean>, env: NodeJS.ProcessEnv, argName: string, envName: string): number | undefined {
  const raw = stringArg(args, env, argName, envName);
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--${argName} must be a positive integer`);
  }
  return value;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeConfigValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/, "").toLowerCase();
  }
  if (/^0x[0-9a-f]+$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

function normalizeSuiObjectId(value: string | undefined): string | undefined {
  return normalizeConfigValue(value);
}

function normalizeSuiAddress(value: string): string {
  const normalized = normalizeConfigValue(value) ?? "";
  if (!normalized.startsWith("0x")) return normalized;
  return `0x${normalized.slice(2).replace(/^0+/, "") || "0"}`;
}

main().catch((error) => {
  console.error("mainnet readiness audit failed:", error);
  process.exit(1);
});
