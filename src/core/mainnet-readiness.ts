import type {
  ProductionAcceptanceBalanceChange,
  ProductionAcceptanceConfig,
  ProductionAcceptanceNetwork,
  ProductionAcceptanceReceipt,
  ProductionAcceptanceStep
} from "./production-acceptance.js";
import { hasSignerSuiBalanceChange, productionAcceptanceSuiSpentMist } from "./production-acceptance.js";

export type MainnetReadinessStage = "testnet" | "mainnet-config" | "mainnet-final";
export type ReadinessStatus = "passed" | "failed" | "warning";

export interface ReadinessCheck {
  name: string;
  status: ReadinessStatus;
  message: string;
  required: boolean;
  evidence?: Record<string, unknown>;
  remediation?: string;
}

export interface ReceiptExpectation {
  label: string;
  network: ProductionAcceptanceNetwork;
  execute: boolean;
  preflight: boolean;
  required: boolean;
  maxSpendMist?: bigint;
  maxReceiptAgeMs?: number;
  nowMs?: number;
}

export const DEFAULT_MAINNET_ACCEPTANCE_MAX_SPEND_MIST = 110_000_000n;
export const DEFAULT_MAINNET_RECEIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const ACCEPTANCE_STEPS = [
  "config.validate",
  "accounts.validate",
  "balances.validate",
  "agent.publish_encrypted_report",
  "buyer.buy_platform_membership",
  "buyer.decrypt_report",
  "buyer.record_access_receipt",
  "buyer.buy_agent_subscription",
  "buyer.decrypt_report_with_subscription",
  "platform.settle_membership_receipt",
  "agent.claim_membership_earnings",
  "buyer.create_and_fund_delegation",
  "agent.publish_private_result",
  "buyer.decrypt_private_result",
  "buyer.complete_delegation",
  "budget.actual_spend_cap"
] as const;

const EXECUTE_DIGEST_STEPS = new Set([
  "agent.publish_encrypted_report",
  "buyer.buy_platform_membership",
  "buyer.record_access_receipt",
  "buyer.buy_agent_subscription",
  "platform.settle_membership_receipt",
  "agent.claim_membership_earnings",
  "buyer.create_and_fund_delegation",
  "agent.publish_private_result",
  "buyer.complete_delegation"
]);

const EXECUTE_OBJECT_STEPS = new Set([
  "agent.publish_encrypted_report",
  "buyer.buy_platform_membership",
  "buyer.record_access_receipt",
  "buyer.buy_agent_subscription",
  "buyer.create_and_fund_delegation",
  "agent.publish_private_result"
]);

const EXECUTE_SIGNER_ROLE: Record<string, "buyer" | "agent"> = {
  "agent.publish_encrypted_report": "agent",
  "buyer.buy_platform_membership": "buyer",
  "buyer.record_access_receipt": "buyer",
  "buyer.buy_agent_subscription": "buyer",
  "platform.settle_membership_receipt": "buyer",
  "agent.claim_membership_earnings": "agent",
  "buyer.create_and_fund_delegation": "buyer",
  "agent.publish_private_result": "agent",
  "buyer.complete_delegation": "buyer"
};

const EXECUTE_STEP_EVENTS: Record<string, string[]> = {
  "agent.publish_encrypted_report": ["ResearchReportPublished"],
  "buyer.buy_platform_membership": ["PlatformMembershipPurchased", "PlatformMembershipPaid"],
  "buyer.record_access_receipt": ["AccessReceiptRecorded"],
  "buyer.buy_agent_subscription": ["AgentSubscriptionPurchased", "AgentSubscriptionPaid"],
  "platform.settle_membership_receipt": ["MembershipReportSettled"],
  "agent.claim_membership_earnings": ["AgentEarningsClaimed"],
  "buyer.create_and_fund_delegation": ["DelegationCreated"],
  "agent.publish_private_result": ["ResearchReportPublished", "DelegationResultSubmitted"],
  "buyer.complete_delegation": ["DelegationCompleted"]
};

const KNOWN_TESTNET_VALUES = new Set([
  "0x5ecd097d8f13e995493d23c9b033c815bd6a8bf771331c389c027296e8b8231e",
  "0x612c971a021e8139e0cd4e63bfef162f4301e72532b808a840d3d16512125ea4",
  "0xb637059cb77aca697e36673afa2e8639f7f82d16b8f0eba8eb6a1f5bd12eda2b",
  "0x5a25a789a4032c8460afa68b26b839a081c770372fa04e567207c606b68ad748",
  "0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98"
]);

export function hasBlockingReadinessFailures(checks: ReadinessCheck[]): boolean {
  return checks.some((check) => check.required && check.status === "failed");
}

export function checkProductionAcceptanceReceipt(
  receipt: unknown,
  expectation: ReceiptExpectation
): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];
  const baseName = `receipt.${expectation.label}`;
  if (!receipt) {
    return [fail(baseName, `${expectation.label} acceptance receipt is missing`, expectation.required, {
      remediation: `Run production acceptance for ${expectation.label} and keep the JSON receipt.`
    })];
  }
  if (!isReceipt(receipt)) {
    return [fail(baseName, `${expectation.label} acceptance receipt is malformed`, expectation.required)];
  }

  checks.push(checkBoolean(
    `${baseName}.mode`,
    receipt.network === expectation.network && receipt.execute === expectation.execute && receipt.preflight === expectation.preflight,
    `${expectation.label} receipt mode matches ${expectation.network}/${expectation.preflight ? "preflight" : expectation.execute ? "execute" : "dry-run"}`,
    `${expectation.label} receipt mode does not match the expected run`,
    expectation.required,
    { network: receipt.network, execute: receipt.execute, preflight: receipt.preflight }
  ));

  checks.push(checkBoolean(
    `${baseName}.conclusion`,
    receipt.conclusion === "passed",
    `${expectation.label} receipt passed`,
    `${expectation.label} receipt conclusion is ${receipt.conclusion}`,
    expectation.required,
    { conclusion: receipt.conclusion, startedAt: receipt.startedAt, finishedAt: receipt.finishedAt }
  ));

  checks.push(checkBoolean(
    `${baseName}.timing`,
    hasValidReceiptTiming(receipt),
    `${expectation.label} receipt records a valid completed run window`,
    `${expectation.label} receipt must include valid startedAt/finishedAt timestamps with finishedAt at or after startedAt`,
    expectation.required,
    { startedAt: receipt.startedAt, finishedAt: receipt.finishedAt }
  ));

  if (expectation.maxReceiptAgeMs !== undefined) {
    checks.push(checkReceiptFreshness(receipt, expectation));
  }

  checks.push(checkBoolean(
    `${baseName}.accounts`,
    Boolean(receipt.buyerAddress && receipt.agentAddress && receipt.buyerAddress.toLowerCase() !== receipt.agentAddress.toLowerCase()),
    `${expectation.label} receipt has distinct buyer and agent zkLogin addresses`,
    `${expectation.label} receipt must include distinct buyerAddress and agentAddress`,
    expectation.required,
    { buyerAddress: receipt.buyerAddress, agentAddress: receipt.agentAddress }
  ));

  checks.push(checkBoolean(
    `${baseName}.steps.present`,
    ACCEPTANCE_STEPS.every((name) => receipt.steps.some((step) => step.name === name)),
    `${expectation.label} receipt contains the full production acceptance step list`,
    `${expectation.label} receipt is missing one or more required production acceptance steps`,
    expectation.required,
    { expectedSteps: ACCEPTANCE_STEPS.length, actualSteps: receipt.steps.length }
  ));

  const failedOrPending = receipt.steps.filter((step) => step.status === "failed" || step.status === "pending");
  checks.push(checkBoolean(
    `${baseName}.steps.no_failed_or_pending`,
    failedOrPending.length === 0,
    `${expectation.label} receipt has no failed or pending steps`,
    `${expectation.label} receipt has failed or pending steps`,
    expectation.required,
    { steps: failedOrPending.map((step) => ({ name: step.name, status: step.status, error: step.error })) }
  ));

  if (expectation.preflight) {
    checks.push(...checkPreflightSteps(receipt, expectation));
  }
  if (expectation.execute) {
    checks.push(...checkExecuteSteps(receipt, expectation));
    checks.push(...checkExecuteBudget(receipt, expectation));
  }
  if (expectation.network === "mainnet") {
    checks.push(checkBoolean(
      `${baseName}.config.no_testnet_values`,
      !receiptHasKnownTestnetConfig(receipt),
      `${expectation.label} receipt config has no obvious testnet values`,
      `${expectation.label} receipt config still contains testnet-looking values`,
      expectation.required,
      { config: receipt.config }
    ));
  }
  return checks;
}

function checkPreflightSteps(receipt: ProductionAcceptanceReceipt, expectation: ReceiptExpectation): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];
  const passedCore = ["config.validate", "accounts.validate", "balances.validate"];
  const transactionSteps = ACCEPTANCE_STEPS.filter((name) => !passedCore.includes(name));
  const accountMeta = receipt.steps.find((step) => step.name === "accounts.validate")?.meta;
  const balanceMeta = receipt.steps.find((step) => step.name === "balances.validate")?.meta;
  checks.push(checkBoolean(
    `receipt.${expectation.label}.preflight.core_steps`,
    passedCore.every((name) => stepStatus(receipt, name) === "passed"),
    `${expectation.label} preflight validated config, accounts, and balances`,
    `${expectation.label} preflight must pass config, account, and balance checks`,
    expectation.required
  ));
  checks.push(checkBoolean(
    `receipt.${expectation.label}.preflight.balance_evidence`,
    hasAcceptanceBalanceEvidence(balanceMeta),
    `${expectation.label} preflight records buyer/agent balances covering required minimums`,
    `${expectation.label} preflight is missing buyer/agent balance evidence covering required minimums`,
    expectation.required,
    { balances: balanceMeta }
  ));
  checks.push(checkBoolean(
    `receipt.${expectation.label}.preflight.no_transactions`,
    transactionSteps.every((name) => {
      const step = receipt.steps.find((item) => item.name === name);
      return step?.status === "skipped" && step.meta?.reason === "preflight_no_transactions";
    }),
    `${expectation.label} preflight skipped all transaction steps without spending funds`,
    `${expectation.label} preflight should skip transaction steps with preflight_no_transactions`,
    expectation.required
  ));
  checks.push(checkBoolean(
    `receipt.${expectation.label}.preflight.zkproof_evidence`,
    hasProverEvidence(accountMeta?.prover) &&
      hasProofEvidence(accountMeta?.buyerProof) &&
      hasProofEvidence(accountMeta?.agentProof),
    `${expectation.label} preflight records non-sensitive zkLogin prover evidence for both accounts`,
    `${expectation.label} preflight is missing zkLogin prover evidence`,
    expectation.required,
    { prover: accountMeta?.prover, buyerProof: accountMeta?.buyerProof, agentProof: accountMeta?.agentProof }
  ));
  checks.push(checkBoolean(
    `receipt.${expectation.label}.preflight.zkproof_address_binding`,
    proofMatchesReceiptAddress(accountMeta?.buyerProof, receipt.buyerAddress) &&
      proofMatchesReceiptAddress(accountMeta?.agentProof, receipt.agentAddress),
    `${expectation.label} preflight binds zkLogin proof address seeds to the receipt buyer/agent addresses`,
    `${expectation.label} preflight is missing zkLogin proof address binding evidence`,
    expectation.required,
    { buyerProof: accountMeta?.buyerProof, agentProof: accountMeta?.agentProof, buyerAddress: receipt.buyerAddress, agentAddress: receipt.agentAddress }
  ));
  checks.push(checkBoolean(
    `receipt.${expectation.label}.preflight.epoch_freshness`,
    hasPositiveNumber(accountMeta?.buyerFreshness, "epochsRemaining") &&
      hasPositiveNumber(accountMeta?.agentFreshness, "epochsRemaining"),
    `${expectation.label} preflight records positive zkLogin epoch freshness for both accounts`,
    `${expectation.label} preflight is missing positive zkLogin epoch freshness evidence`,
    expectation.required,
    { buyerFreshness: accountMeta?.buyerFreshness, agentFreshness: accountMeta?.agentFreshness }
  ));
  return checks;
}

function checkExecuteSteps(receipt: ProductionAcceptanceReceipt, expectation: ReceiptExpectation): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];
  checks.push(checkBoolean(
    `receipt.${expectation.label}.execute.all_steps_passed`,
    ACCEPTANCE_STEPS.every((name) => stepStatus(receipt, name) === "passed"),
    `${expectation.label} execute passed every user-story transaction/decrypt step`,
    `${expectation.label} execute must pass every production acceptance step`,
    expectation.required
  ));
  checks.push(checkBoolean(
    `receipt.${expectation.label}.execute.digests`,
    [...EXECUTE_DIGEST_STEPS].every((name) => isSuiDigest(receipt.steps.find((step) => step.name === name)?.digest)),
    `${expectation.label} execute records transaction digests for all transaction steps`,
    `${expectation.label} execute is missing one or more valid Sui transaction digests`,
    expectation.required
  ));
  checks.push(checkBoolean(
    `receipt.${expectation.label}.execute.objects`,
    [...EXECUTE_OBJECT_STEPS].every((name) => isSuiObjectId(receipt.steps.find((step) => step.name === name)?.objectId)),
    `${expectation.label} execute records created object ids for object-producing steps`,
    `${expectation.label} execute is missing one or more valid created object ids`,
    expectation.required
  ));
  checks.push(checkBoolean(
    `receipt.${expectation.label}.execute.delegation_funded`,
    isSuiDigest(receipt.steps.find((step) => step.name === "buyer.create_and_fund_delegation")?.meta?.fundDigest),
    `${expectation.label} execute records the delegation funding digest`,
    `${expectation.label} execute is missing a valid delegation funding digest`,
    expectation.required
  ));
  checks.push(checkBoolean(
    `receipt.${expectation.label}.execute.publish_metadata`,
    ["agent.publish_encrypted_report", "agent.publish_private_result"].every((name) => {
      const meta = receipt.steps.find((step) => step.name === name)?.meta;
      return hasString(meta?.sealId) && hasString(meta?.walrusBlobId) && hasString(meta?.ciphertextHash);
    }),
    `${expectation.label} execute records Walrus/Seal/hash metadata for encrypted publish steps`,
    `${expectation.label} execute is missing Walrus/Seal/hash metadata for encrypted publish steps`,
    expectation.required
  ));
  checks.push(checkBoolean(
    `receipt.${expectation.label}.execute.walrus_readback`,
    ["agent.publish_encrypted_report", "agent.publish_private_result"].every((name) => {
      const meta = receipt.steps.find((step) => step.name === name)?.meta;
      return hasWalrusReadbackEvidence(meta);
    }),
    `${expectation.label} execute records verified Walrus readback evidence for encrypted publish blobs`,
    `${expectation.label} execute is missing verified Walrus readback evidence for encrypted publish blobs`,
    expectation.required
  ));
  checks.push(checkBoolean(
    `receipt.${expectation.label}.execute.decrypt_evidence`,
    ["buyer.decrypt_report", "buyer.decrypt_report_with_subscription", "buyer.decrypt_private_result"].every((name) => {
      const meta = receipt.steps.find((step) => step.name === name)?.meta;
      return meta?.plaintextMatched === true &&
        hasString(meta?.accessPath) &&
        hasString(meta?.sealId) &&
        hasString(meta?.walrusBlobId) &&
        hasPositiveNumber(meta, "plaintextBytes");
    }),
    `${expectation.label} execute records successful Seal decrypt evidence for all decrypt paths`,
    `${expectation.label} execute is missing successful Seal decrypt evidence`,
    expectation.required
  ));
  checks.push(checkBoolean(
    `receipt.${expectation.label}.execute.transaction_spend_metadata`,
    [...EXECUTE_DIGEST_STEPS].every((name) => {
      const meta = receipt.steps.find((step) => step.name === name)?.meta;
      if (!hasTransactionSpendEvidence(meta, "suiSpentMist", "balanceChanges", "signerAddress")) return false;
      if (name === "buyer.create_and_fund_delegation") {
        if (!meta) return false;
        return hasString(meta.fundDigest) &&
          hasTransactionSpendEvidence(meta, "fundSuiSpentMist", "fundBalanceChanges", "fundSignerAddress");
      }
      return true;
    }),
    `${expectation.label} execute records balance-change SUI spend metadata for every transaction step`,
    `${expectation.label} execute is missing per-transaction SUI spend metadata`,
    expectation.required
  ));
  checks.push(checkBoolean(
    `receipt.${expectation.label}.execute.transaction_statuses`,
    [...EXECUTE_DIGEST_STEPS].every((name) => stepHasSuccessfulTransactionStatus(receipt, name)) &&
      delegationFundHasSuccessfulTransactionStatus(receipt),
    `${expectation.label} execute records successful Sui effects status for every transaction`,
    `${expectation.label} execute is missing successful Sui effects status evidence for one or more transactions`,
    expectation.required
  ));
  checks.push(checkBoolean(
    `receipt.${expectation.label}.execute.unique_digests`,
    receiptTransactionDigestCount(receipt) === expectedReceiptTransactionCount(receipt),
    `${expectation.label} execute records a distinct digest for every Sui transaction`,
    `${expectation.label} execute reuses one or more transaction digests across distinct Sui transactions`,
    expectation.required,
    {
      uniqueDigestCount: receiptTransactionDigestCount(receipt),
      expectedTransactionCount: expectedReceiptTransactionCount(receipt)
    }
  ));
  checks.push(checkBoolean(
    `receipt.${expectation.label}.execute.signer_roles`,
    [...EXECUTE_DIGEST_STEPS].every((name) => stepSignerMatchesRole(receipt, name)) &&
      delegationFundSignerMatchesBuyer(receipt),
    `${expectation.label} execute signer evidence matches the buyer/agent user-story roles`,
    `${expectation.label} execute signer evidence does not match the expected buyer/agent roles`,
    expectation.required,
    { buyerAddress: receipt.buyerAddress, agentAddress: receipt.agentAddress }
  ));
  checks.push(checkBoolean(
    `receipt.${expectation.label}.execute.move_events`,
    [...EXECUTE_DIGEST_STEPS].every((name) => stepHasExpectedEvents(receipt, name)) &&
      delegationFundHasExpectedEvents(receipt),
    `${expectation.label} execute records expected Move event evidence for every transaction`,
    `${expectation.label} execute is missing expected Move event evidence for one or more transactions`,
    expectation.required
  ));
  return checks;
}

function checkExecuteBudget(receipt: ProductionAcceptanceReceipt, expectation: ReceiptExpectation): ReadinessCheck[] {
  let totalBudget = 0n;
  let maxSpend = 0n;
  try {
    totalBudget = BigInt(receipt.budget.totalBudgetMist);
    maxSpend = BigInt(receipt.budget.maxSpendMist);
  } catch {
    return [fail(`receipt.${expectation.label}.budget`, `${expectation.label} receipt has malformed budget strings`, expectation.required)];
  }
  const actualTotalSpend = isNonNegativeIntegerString(receipt.spend?.totalSpentMist)
    ? BigInt(receipt.spend.totalSpentMist)
    : undefined;
  const receiptSpendMax = isNonNegativeIntegerString(receipt.spend?.maxSpendMist)
    ? BigInt(receipt.spend.maxSpendMist)
    : undefined;
  const expectedTransactionCount = receiptTransactionDigestCount(receipt);
  const checks = [
    checkBoolean(
      `receipt.${expectation.label}.budget.cap`,
      maxSpend > 0n && totalBudget <= maxSpend,
      `${expectation.label} execute budget is covered by the explicit spend cap`,
      `${expectation.label} execute budget exceeds or omits the explicit spend cap`,
      expectation.required,
      { totalBudgetMist: String(totalBudget), maxSpendMist: String(maxSpend) }
    ),
    checkBoolean(
      `receipt.${expectation.label}.spend.present`,
      hasSpendSummary(receipt.spend),
      `${expectation.label} execute records actual balance-change spend evidence`,
      `${expectation.label} execute is missing actual balance-change spend evidence`,
      expectation.required,
      { spend: receipt.spend }
    ),
    checkBoolean(
      `receipt.${expectation.label}.spend.cap_match`,
      receiptSpendMax === maxSpend,
      `${expectation.label} actual spend evidence uses the same explicit spend cap as the receipt budget`,
      `${expectation.label} actual spend evidence cap does not match the receipt budget cap`,
      expectation.required,
      { budgetMaxSpendMist: String(maxSpend), spendMaxSpendMist: receipt.spend?.maxSpendMist }
    ),
    checkBoolean(
      `receipt.${expectation.label}.spend.actual_cap`,
      receipt.spend?.withinCap === true && actualTotalSpend !== undefined && actualTotalSpend <= maxSpend,
      `${expectation.label} actual SUI spend stayed within the explicit cap`,
      `${expectation.label} actual SUI spend exceeds or omits the explicit cap`,
      expectation.required,
      { totalSpentMist: receipt.spend?.totalSpentMist, maxSpendMist: String(maxSpend), spend: receipt.spend }
    ),
    checkBoolean(
      `receipt.${expectation.label}.spend.transaction_count`,
      receipt.spend?.transactionCount === expectedTransactionCount,
      `${expectation.label} actual spend summary covers every executed Sui transaction`,
      `${expectation.label} actual spend summary transaction count does not match executed Sui transactions`,
      expectation.required,
      { transactionCount: receipt.spend?.transactionCount, expectedTransactionCount }
    )
  ];
  if (expectation.network === "mainnet") {
    const allowedMaxSpend = expectation.maxSpendMist ?? DEFAULT_MAINNET_ACCEPTANCE_MAX_SPEND_MIST;
    checks.push(checkBoolean(
      `receipt.${expectation.label}.budget.mainnet_cap`,
      maxSpend > 0n && maxSpend <= allowedMaxSpend,
      `${expectation.label} execute uses a small explicit mainnet spend cap`,
      `${expectation.label} execute max-spend-mist exceeds the allowed mainnet acceptance cap`,
      expectation.required,
      { maxSpendMist: String(maxSpend), allowedMaxSpendMist: String(allowedMaxSpend) }
    ));
  }
  return checks;
}

function stepStatus(receipt: ProductionAcceptanceReceipt, name: string): ProductionAcceptanceStep["status"] | undefined {
  return receipt.steps.find((step) => step.name === name)?.status;
}

function receiptHasKnownTestnetConfig(receipt: ProductionAcceptanceReceipt): boolean {
  return Object.values(receipt.config).some((value) =>
    typeof value === "string" && isKnownTestnetValue(value)
  );
}

export function isKnownTestnetValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return KNOWN_TESTNET_VALUES.has(normalized) ||
    normalized.includes("testnet") ||
    normalized.includes("sui-testnet-rpc.publicnode.com");
}

export function checkReceiptConfigMatchesAcceptanceConfig(
  receipt: unknown,
  label: string,
  config: ProductionAcceptanceConfig,
  required: boolean
): ReadinessCheck[] {
  if (!isReceipt(receipt)) return [];
  const fields: Array<[string, string | number | undefined, string | number | undefined]> = [
    ["sui_rpc", receipt.config.suiRpcUrl, config.suiRpcUrl],
    ["package_id", receipt.config.packageId, config.packageId],
    ["settlement_config_id", receipt.config.settlementConfigId, config.settlementConfigId],
    ["agent_earnings_id", receipt.config.agentEarningsId, config.agentEarningsId],
    ["receipt_registry_id", receipt.config.membershipReceiptRegistryId, config.membershipReceiptRegistryId],
    ["walrus_publisher", receipt.config.walrusPublisherUrl, config.walrusPublisherUrl],
    ["walrus_aggregator", receipt.config.walrusAggregatorUrl, config.walrusAggregatorUrl],
    ["seal_key_server", receipt.config.sealKeyServerObjectId, config.sealKeyServerObjectId],
    ["seal_aggregator", receipt.config.sealKeyServerAggregatorUrl, config.sealKeyServerAggregatorUrl],
    ["platform_membership_price", receipt.config.platformMembershipPriceMist, String(config.platformMembershipPriceMist)],
    ["agent_subscription_price", receipt.config.agentSubscriptionPriceMist, String(config.agentSubscriptionPriceMist)],
    ["delegation_budget", receipt.config.delegationBudgetMist, String(config.delegationBudgetMist)],
    ["membership_settlement_share", receipt.config.membershipSettlementShareMist, String(config.membershipSettlementShareMist)],
    ["access_duration", receipt.config.accessDurationMs, config.accessDurationMs]
  ];
  if (config.walrusEpochs !== undefined) {
    fields.push(["walrus_epochs", receipt.config.walrusEpochs, config.walrusEpochs]);
  }
  if (config.sealThreshold !== undefined) {
    fields.push(["seal_threshold", receipt.config.sealThreshold, config.sealThreshold]);
  }
  return fields.map(([field, receiptValue, expectedValue]) => checkBoolean(
    `receipt.${label}.config.${field}`,
    valuesMatch(receiptValue, expectedValue),
    `${label} receipt ${field} matches the current mainnet acceptance config`,
    `${label} receipt ${field} does not match the current mainnet acceptance config`,
    required,
    { receiptValue, expectedValue }
  ));
}

function isReceipt(value: unknown): value is ProductionAcceptanceReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Partial<ProductionAcceptanceReceipt>;
  return (receipt.network === "testnet" || receipt.network === "mainnet") &&
    typeof receipt.execute === "boolean" &&
    typeof receipt.preflight === "boolean" &&
    typeof receipt.startedAt === "string" &&
    typeof receipt.budget === "object" &&
    typeof receipt.config === "object" &&
    Array.isArray(receipt.steps) &&
    (receipt.conclusion === "not_run" || receipt.conclusion === "passed" || receipt.conclusion === "failed");
}

function hasValidReceiptTiming(receipt: ProductionAcceptanceReceipt): boolean {
  if (typeof receipt.startedAt !== "string" || typeof receipt.finishedAt !== "string") return false;
  const started = Date.parse(receipt.startedAt);
  const finished = Date.parse(receipt.finishedAt);
  return Number.isFinite(started) && Number.isFinite(finished) && finished >= started;
}

function checkReceiptFreshness(receipt: ProductionAcceptanceReceipt, expectation: ReceiptExpectation): ReadinessCheck {
  const nowMs = expectation.nowMs ?? Date.now();
  const maxAgeMs = expectation.maxReceiptAgeMs;
  const finishedMs = typeof receipt.finishedAt === "string" ? Date.parse(receipt.finishedAt) : Number.NaN;
  const ageMs = finishedMs <= nowMs ? nowMs - finishedMs : Number.NaN;
  return checkBoolean(
    `receipt.${expectation.label}.freshness`,
    Number.isFinite(finishedMs) &&
      Number.isFinite(nowMs) &&
      maxAgeMs !== undefined &&
      ageMs >= 0 &&
      ageMs <= maxAgeMs,
    `${expectation.label} receipt is fresh enough for final mainnet funding approval`,
    `${expectation.label} receipt is stale or timestamped in the future for final mainnet funding approval`,
    expectation.required,
    {
      finishedAt: receipt.finishedAt,
      ageMs: Number.isFinite(ageMs) ? ageMs : undefined,
      maxReceiptAgeMs: maxAgeMs
    }
  );
}

function valuesMatch(left: string | number | undefined, right: string | number | undefined): boolean {
  const normalizedLeft = normalizeReadinessValue(left);
  const normalizedRight = normalizeReadinessValue(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function normalizeReadinessValue(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return String(value);
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/, "").toLowerCase();
  }
  if (/^0x[0-9a-f]+$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

function hasProofEvidence(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const proof = value as Record<string, unknown>;
  return proof.hasProofPoints === true &&
    proof.hasIssBase64Details === true &&
    proof.hasHeaderBase64 === true &&
    proof.hasAddressSeed === true;
}

function proofMatchesReceiptAddress(value: unknown, address: unknown): boolean {
  if (!value || typeof value !== "object" || !hasString(address)) return false;
  const proof = value as Record<string, unknown>;
  return proof.addressSeedMatchesDerivedAddress === true &&
    typeof proof.addressSeedSha256 === "string" &&
    /^[0-9a-f]{64}$/.test(proof.addressSeedSha256) &&
    sameSuiAddress(proof.derivedAddress, address);
}

function hasProverEvidence(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const prover = value as Record<string, unknown>;
  return prover.configured === true &&
    typeof prover.urlSha256 === "string" &&
    /^[0-9a-f]{64}$/.test(prover.urlSha256);
}

function hasString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSuiDigest(value: unknown): value is string {
  return typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(value);
}

function isSuiObjectId(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function hasPositiveNumber(value: unknown, key: string): boolean {
  if (!value || typeof value !== "object") return false;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0;
}

function hasSpendSummary(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const spend = value as Record<string, unknown>;
  return isNonNegativeIntegerString(spend.buyerSpentMist) &&
    isNonNegativeIntegerString(spend.agentSpentMist) &&
    isNonNegativeIntegerString(spend.totalSpentMist) &&
    isNonNegativeIntegerString(spend.maxSpendMist) &&
    spend.withinCap === true &&
    typeof spend.transactionCount === "number" &&
    Number.isInteger(spend.transactionCount) &&
    spend.transactionCount > 0;
}

function hasWalrusReadbackEvidence(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const meta = value as Record<string, unknown>;
  return meta.walrusReadbackVerified === true &&
    hasPositiveNumber(meta, "walrusReadbackBytes") &&
    hasSha256Evidence(meta.walrusReadbackHash);
}

function hasSha256Evidence(value: unknown): boolean {
  return typeof value === "string" && /^sha256:[A-Za-z0-9+/=_-]+$/.test(value);
}

function hasAcceptanceBalanceEvidence(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const balances = value as Record<string, unknown>;
  const buyerBalance = parseNonNegativeIntegerString(balances.buyerBalanceMist);
  const buyerMinimum = parseNonNegativeIntegerString(balances.buyerMinimumMist);
  const agentBalance = parseNonNegativeIntegerString(balances.agentBalanceMist);
  const agentMinimum = parseNonNegativeIntegerString(balances.agentMinimumMist);
  return buyerBalance !== undefined &&
    buyerMinimum !== undefined &&
    agentBalance !== undefined &&
    agentMinimum !== undefined &&
    buyerBalance >= buyerMinimum &&
    agentBalance >= agentMinimum;
}

function parseNonNegativeIntegerString(value: unknown): bigint | undefined {
  if (!isNonNegativeIntegerString(value)) return undefined;
  return BigInt(value);
}

function receiptTransactionDigestCount(receipt: ProductionAcceptanceReceipt): number {
  const digests = new Set<string>();
  for (const name of EXECUTE_DIGEST_STEPS) {
    const digest = receipt.steps.find((step) => step.name === name)?.digest;
    if (typeof digest === "string") digests.add(digest);
  }
  const fundDigest = receipt.steps.find((step) => step.name === "buyer.create_and_fund_delegation")?.meta?.fundDigest;
  if (typeof fundDigest === "string") digests.add(fundDigest);
  return digests.size;
}

function expectedReceiptTransactionCount(receipt: ProductionAcceptanceReceipt): number {
  let count = 0;
  for (const name of EXECUTE_DIGEST_STEPS) {
    if (isSuiDigest(receipt.steps.find((step) => step.name === name)?.digest)) count += 1;
  }
  if (isSuiDigest(receipt.steps.find((step) => step.name === "buyer.create_and_fund_delegation")?.meta?.fundDigest)) {
    count += 1;
  }
  return count;
}

function stepSignerMatchesRole(receipt: ProductionAcceptanceReceipt, name: string): boolean {
  const expected = EXECUTE_SIGNER_ROLE[name];
  if (!expected) return false;
  const address = expected === "buyer" ? receipt.buyerAddress : receipt.agentAddress;
  const signerAddress = receipt.steps.find((step) => step.name === name)?.meta?.signerAddress;
  return sameSuiAddress(signerAddress, address);
}

function delegationFundSignerMatchesBuyer(receipt: ProductionAcceptanceReceipt): boolean {
  const fundSignerAddress = receipt.steps.find((step) => step.name === "buyer.create_and_fund_delegation")?.meta?.fundSignerAddress;
  return sameSuiAddress(fundSignerAddress, receipt.buyerAddress);
}

function stepHasSuccessfulTransactionStatus(receipt: ProductionAcceptanceReceipt, name: string): boolean {
  const meta = receipt.steps.find((step) => step.name === name)?.meta;
  return hasSuccessfulTransactionStatus(meta, "txStatus", "txError");
}

function delegationFundHasSuccessfulTransactionStatus(receipt: ProductionAcceptanceReceipt): boolean {
  const meta = receipt.steps.find((step) => step.name === "buyer.create_and_fund_delegation")?.meta;
  return hasSuccessfulTransactionStatus(meta, "fundTxStatus", "fundTxError");
}

function hasSuccessfulTransactionStatus(
  meta: unknown,
  statusKey: "txStatus" | "fundTxStatus",
  errorKey: "txError" | "fundTxError"
): boolean {
  if (!meta || typeof meta !== "object") return false;
  const record = meta as Record<string, unknown>;
  return record[statusKey] === "success" && record[errorKey] === undefined;
}

function stepHasExpectedEvents(receipt: ProductionAcceptanceReceipt, name: string): boolean {
  const expected = EXECUTE_STEP_EVENTS[name];
  if (!expected?.length) return false;
  return hasExpectedEventTypes(receipt.steps.find((step) => step.name === name)?.meta?.eventTypes, expected, receipt.config.packageId);
}

function delegationFundHasExpectedEvents(receipt: ProductionAcceptanceReceipt): boolean {
  return hasExpectedEventTypes(
    receipt.steps.find((step) => step.name === "buyer.create_and_fund_delegation")?.meta?.fundEventTypes,
    ["DelegationFunded"],
    receipt.config.packageId
  );
}

function hasExpectedEventTypes(value: unknown, expected: string[], packageId: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (!hasString(packageId)) return false;
  const packagePrefix = `${packageId.toLowerCase()}::`;
  const eventTypes = value.filter((item): item is string => typeof item === "string");
  return expected.every((eventName) =>
    eventTypes.some((type) => {
      const normalized = type.toLowerCase();
      return normalized.startsWith(packagePrefix) && type.endsWith(`::${eventName}`);
    })
  );
}

function sameSuiAddress(left: unknown, right: unknown): boolean {
  return typeof left === "string" &&
    typeof right === "string" &&
    normalizeReadinessValue(left) === normalizeReadinessValue(right);
}

function hasBalanceChanges(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((change) => {
    if (!change || typeof change !== "object") return false;
    const item = change as Record<string, unknown>;
    return typeof item.coinType === "string" &&
      isIntegerString(item.amount) &&
      (item.owner === undefined || typeof item.owner === "string");
  });
}

function hasTransactionSpendEvidence(
  meta: unknown,
  spendKey: "suiSpentMist" | "fundSuiSpentMist",
  balanceChangesKey: "balanceChanges" | "fundBalanceChanges",
  signerAddressKey: "signerAddress" | "fundSignerAddress"
): boolean {
  if (!meta || typeof meta !== "object") return false;
  const record = meta as Record<string, unknown>;
  const expectedSpend = record[spendKey];
  const signerAddress = record[signerAddressKey];
  if (!isNonNegativeIntegerString(expectedSpend)) return false;
  if (!hasString(signerAddress)) return false;
  if (!hasBalanceChanges(record[balanceChangesKey])) return false;
  const balanceChanges = record[balanceChangesKey] as ProductionAcceptanceBalanceChange[];
  try {
    return hasSignerSuiBalanceChange(balanceChanges, signerAddress) &&
      String(productionAcceptanceSuiSpentMist(balanceChanges, signerAddress)) === expectedSpend;
  } catch {
    return false;
  }
}

function isNonNegativeIntegerString(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
}

function isIntegerString(value: unknown): value is string {
  return typeof value === "string" && /^-?(0|[1-9][0-9]*)$/.test(value);
}

export function pass(
  name: string,
  message: string,
  evidence?: Record<string, unknown>
): ReadinessCheck {
  return { name, status: "passed", message, required: true, evidence };
}

export function warn(
  name: string,
  message: string,
  evidence?: Record<string, unknown>,
  remediation?: string
): ReadinessCheck {
  return { name, status: "warning", message, required: false, evidence, remediation };
}

export function fail(
  name: string,
  message: string,
  required = true,
  extra: Pick<ReadinessCheck, "evidence" | "remediation"> = {}
): ReadinessCheck {
  return { name, status: "failed", message, required, ...extra };
}

export function checkBoolean(
  name: string,
  condition: boolean,
  passedMessage: string,
  failedMessage: string,
  required: boolean,
  evidence?: Record<string, unknown>
): ReadinessCheck {
  return condition
    ? { name, status: "passed", message: passedMessage, required, evidence }
    : { name, status: "failed", message: failedMessage, required, evidence };
}
