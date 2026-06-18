import path from "node:path";
import { checkBoolean, fail, type ReadinessCheck } from "./mainnet-readiness.js";
import type {
  ProductionAcceptanceDelegationFundingEvidence,
  ProductionAcceptanceNetwork,
  ProductionAcceptanceReceipt,
  ProductionAcceptanceReceiptProvenance
} from "./production-acceptance.js";
import { productionAcceptanceDelegationFundingMeta } from "./production-acceptance.js";

export interface UiAcceptanceReceipt {
  kind: "normal-user-ui-acceptance/v1";
  network: ProductionAcceptanceNetwork;
  surface: "web-ui";
  startedAt: string;
  finishedAt?: string;
  conclusion: "passed" | "failed";
  provenance?: ProductionAcceptanceReceiptProvenance;
  entrypointUrl: string;
  browser: {
    name: string;
    userAgent: string;
    automationTool: string;
    headless?: boolean;
  };
  buyerAddress?: string;
  agentAddress?: string;
  config: ProductionAcceptanceReceipt["config"];
  steps: UiAcceptanceStep[];
}

export interface UiAcceptanceStep {
  name: string;
  status: "passed" | "failed" | "pending" | "skipped";
  actor?: "buyer" | "agent";
  route?: string;
  testId?: string;
  statusText?: string;
  signerAddress?: string;
  digest?: string;
  objectId?: string;
  error?: string;
  meta?: Record<string, unknown>;
}

export interface UiAcceptanceExpectation {
  label: string;
  network: ProductionAcceptanceNetwork;
  required: boolean;
  maxReceiptAgeMs?: number;
  nowMs?: number;
}

const DEFAULT_RECEIPT_DIR = ".research-network/acceptance";

export const UI_ACCEPTANCE_STEPS = [
  "ui.load",
  "agent.sign_in",
  "agent.publish_encrypted_report",
  "buyer.sign_in",
  "buyer.buy_platform_membership",
  "buyer.decrypt_report_with_membership",
  "buyer.record_access_receipt",
  "buyer.buy_agent_subscription",
  "buyer.decrypt_report_with_subscription",
  "buyer.create_and_fund_delegation",
  "agent.sign_in_for_private_result",
  "agent.publish_private_result",
  "buyer.sign_in_for_private_result",
  "buyer.decrypt_private_result",
  "buyer.settle_membership_receipt",
  "agent.sign_in_for_claim",
  "agent.claim_earnings",
  "buyer.sign_in_for_completion",
  "buyer.complete_delegation",
  "indexer.poll_and_publish",
  "buyer.reloads_indexed_state"
] as const;

const UI_TRANSACTION_STEPS = new Set([
  "agent.publish_encrypted_report",
  "buyer.buy_platform_membership",
  "buyer.record_access_receipt",
  "buyer.buy_agent_subscription",
  "buyer.create_and_fund_delegation",
  "agent.publish_private_result",
  "buyer.settle_membership_receipt",
  "agent.claim_earnings",
  "buyer.complete_delegation"
]);

const UI_OBJECT_STEPS = new Set([
  "agent.publish_encrypted_report",
  "buyer.buy_platform_membership",
  "buyer.record_access_receipt",
  "buyer.buy_agent_subscription",
  "buyer.create_and_fund_delegation",
  "agent.publish_private_result"
]);

const UI_DECRYPT_STEPS = new Set([
  "buyer.decrypt_report_with_membership",
  "buyer.decrypt_report_with_subscription",
  "buyer.decrypt_private_result"
]);

const UI_SIGNER_ROLE: Record<string, "buyer" | "agent"> = {
  "agent.publish_encrypted_report": "agent",
  "buyer.buy_platform_membership": "buyer",
  "buyer.record_access_receipt": "buyer",
  "buyer.buy_agent_subscription": "buyer",
  "buyer.create_and_fund_delegation": "buyer",
  "agent.publish_private_result": "agent",
  "buyer.settle_membership_receipt": "buyer",
  "agent.claim_earnings": "agent",
  "buyer.complete_delegation": "buyer"
};

export function defaultUiAcceptanceReceiptPath(network: ProductionAcceptanceNetwork): string {
  return path.join(DEFAULT_RECEIPT_DIR, `${network}-ui.json`);
}

export function checkUiAcceptanceReceipt(
  receipt: unknown,
  expectation: UiAcceptanceExpectation
): ReadinessCheck[] {
  const baseName = `receipt.${expectation.label}`;
  if (!receipt) {
    return [fail(baseName, `${expectation.label} UI acceptance receipt is missing`, expectation.required, {
      remediation: `Run normal-user browser UI acceptance for ${expectation.label} and keep the JSON receipt.`
    })];
  }
  if (!isUiAcceptanceReceipt(receipt)) {
    return [fail(baseName, `${expectation.label} UI acceptance receipt is malformed`, expectation.required)];
  }

  const checks: ReadinessCheck[] = [];
  checks.push(checkBoolean(
    `${baseName}.mode`,
    receipt.kind === "normal-user-ui-acceptance/v1" &&
      receipt.surface === "web-ui" &&
      receipt.network === expectation.network,
    `${expectation.label} UI receipt mode matches ${expectation.network}/web-ui`,
    `${expectation.label} UI receipt mode does not match the expected browser run`,
    expectation.required,
    { kind: receipt.kind, network: receipt.network, surface: receipt.surface }
  ));
  checks.push(checkBoolean(
    `${baseName}.conclusion`,
    receipt.conclusion === "passed",
    `${expectation.label} UI receipt passed`,
    `${expectation.label} UI receipt conclusion is ${receipt.conclusion}`,
    expectation.required,
    { conclusion: receipt.conclusion, startedAt: receipt.startedAt, finishedAt: receipt.finishedAt }
  ));
  checks.push(checkBoolean(
    `${baseName}.timing`,
    hasValidTiming(receipt),
    `${expectation.label} UI receipt records a valid completed run window`,
    `${expectation.label} UI receipt must include valid startedAt/finishedAt timestamps with finishedAt at or after startedAt`,
    expectation.required,
    { startedAt: receipt.startedAt, finishedAt: receipt.finishedAt }
  ));
  checks.push(checkBoolean(
    `${baseName}.provenance`,
    hasCleanProvenance(receipt.provenance),
    `${expectation.label} UI receipt provenance binds the browser run to a clean Git commit`,
    `${expectation.label} UI receipt must include generatedBy, a 40-character gitCommit, and gitTreeState=clean`,
    expectation.required,
    { provenance: receipt.provenance }
  ));
  if (expectation.maxReceiptAgeMs !== undefined) {
    checks.push(checkFreshness(receipt, expectation));
  }
  checks.push(checkBoolean(
    `${baseName}.accounts`,
    hasDistinctSuiAccounts(receipt),
    `${expectation.label} UI receipt has distinct buyer and agent zkLogin addresses`,
    `${expectation.label} UI receipt must include distinct buyerAddress and agentAddress`,
    expectation.required,
    { buyerAddress: receipt.buyerAddress, agentAddress: receipt.agentAddress }
  ));
  checks.push(checkBoolean(
    `${baseName}.browser.automation`,
    hasBrowserAutomationEvidence(receipt),
    `${expectation.label} UI receipt was produced through automated browser interaction`,
    `${expectation.label} UI receipt must record browser name, user agent, http(s) entrypointUrl, and a non-manual automationTool`,
    expectation.required,
    { entrypointUrl: receipt.entrypointUrl, browser: receipt.browser }
  ));
  checks.push(checkBoolean(
    `${baseName}.steps.present`,
    UI_ACCEPTANCE_STEPS.every((name) => receipt.steps.some((step) => step.name === name)),
    `${expectation.label} UI receipt contains the full normal-user story step list`,
    `${expectation.label} UI receipt is missing one or more normal-user story steps`,
    expectation.required,
    { expectedSteps: UI_ACCEPTANCE_STEPS.length, actualSteps: receipt.steps.length }
  ));
  const failedOrPending = receipt.steps.filter((step) => step.status === "failed" || step.status === "pending");
  checks.push(checkBoolean(
    `${baseName}.steps.no_failed_or_pending`,
    failedOrPending.length === 0,
    `${expectation.label} UI receipt has no failed or pending steps`,
    `${expectation.label} UI receipt has failed or pending steps`,
    expectation.required,
    { steps: failedOrPending.map((step) => ({ name: step.name, status: step.status, error: step.error })) }
  ));
  checks.push(checkBoolean(
    `${baseName}.steps.observable`,
    receipt.steps.every(hasUiObservationEvidence),
    `${expectation.label} UI receipt records route and visible UI evidence for every step`,
    `${expectation.label} UI receipt is missing route/status/test-id evidence for one or more steps`,
    expectation.required
  ));
  checks.push(checkBoolean(
    `${baseName}.transactions.digests`,
    [...UI_TRANSACTION_STEPS].every((name) => isSuiDigest(step(receipt, name)?.digest)),
    `${expectation.label} UI receipt records transaction digests for every UI transaction`,
    `${expectation.label} UI receipt is missing one or more valid Sui transaction digests`,
    expectation.required
  ));
  checks.push(checkBoolean(
    `${baseName}.transactions.objects`,
    [...UI_OBJECT_STEPS].every((name) => isSuiObjectId(step(receipt, name)?.objectId)),
    `${expectation.label} UI receipt records created object ids for every object-producing UI transaction`,
    `${expectation.label} UI receipt is missing one or more valid created object ids`,
    expectation.required
  ));
  checks.push(checkBoolean(
    `${baseName}.transactions.signer_roles`,
    [...UI_TRANSACTION_STEPS].every((name) => stepSignerMatchesRole(receipt, name)) &&
      delegationFundSignerMatchesBuyer(receipt),
    `${expectation.label} UI signer evidence matches the buyer/agent browser roles`,
    `${expectation.label} UI signer evidence does not match the expected buyer/agent roles`,
    expectation.required,
    { buyerAddress: receipt.buyerAddress, agentAddress: receipt.agentAddress }
  ));
  checks.push(checkBoolean(
    `${baseName}.transactions.fund_evidence`,
    hasDelegationFundingEvidence(receipt),
    `${expectation.label} UI receipt proves the delegation funding transaction succeeded on-chain`,
    `${expectation.label} UI receipt is missing successful delegation funding transaction evidence`,
    expectation.required,
    { funding: step(receipt, "buyer.create_and_fund_delegation")?.meta }
  ));
  checks.push(checkBoolean(
    `${baseName}.seal.decrypts`,
    [...UI_DECRYPT_STEPS].every((name) => hasDecryptEvidence(step(receipt, name)?.meta)),
    `${expectation.label} UI receipt records successful Seal decrypt evidence for every UI decrypt path`,
    `${expectation.label} UI receipt is missing successful Seal decrypt evidence`,
    expectation.required
  ));
  checks.push(checkBoolean(
    `${baseName}.indexer.sync`,
    hasIndexerEvidence(step(receipt, "indexer.poll_and_publish")?.meta) &&
      hasBuyerReloadEvidence(step(receipt, "buyer.reloads_indexed_state")?.meta),
    `${expectation.label} UI receipt proves indexer/Walrus Site sync and buyer reload visibility`,
    `${expectation.label} UI receipt is missing indexer sync or buyer reload evidence`,
    expectation.required,
    {
      indexer: step(receipt, "indexer.poll_and_publish")?.meta,
      buyerReload: step(receipt, "buyer.reloads_indexed_state")?.meta
    }
  ));
  return checks;
}

function isUiAcceptanceReceipt(value: unknown): value is UiAcceptanceReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Partial<UiAcceptanceReceipt>;
  return receipt.kind === "normal-user-ui-acceptance/v1" &&
    (receipt.network === "testnet" || receipt.network === "mainnet") &&
    receipt.surface === "web-ui" &&
    typeof receipt.startedAt === "string" &&
    (receipt.conclusion === "passed" || receipt.conclusion === "failed") &&
    typeof receipt.entrypointUrl === "string" &&
    typeof receipt.browser === "object" &&
    typeof receipt.config === "object" &&
    Array.isArray(receipt.steps);
}

function hasValidTiming(receipt: UiAcceptanceReceipt): boolean {
  if (typeof receipt.startedAt !== "string" || typeof receipt.finishedAt !== "string") return false;
  const started = Date.parse(receipt.startedAt);
  const finished = Date.parse(receipt.finishedAt);
  return Number.isFinite(started) && Number.isFinite(finished) && finished >= started;
}

function hasCleanProvenance(provenance: unknown): boolean {
  if (!provenance || typeof provenance !== "object") return false;
  const item = provenance as Record<string, unknown>;
  return typeof item.generatedBy === "string" &&
    item.generatedBy.length > 0 &&
    typeof item.gitCommit === "string" &&
    /^[0-9a-f]{40}$/i.test(item.gitCommit) &&
    item.gitTreeState === "clean";
}

function checkFreshness(receipt: UiAcceptanceReceipt, expectation: UiAcceptanceExpectation): ReadinessCheck {
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
    `${expectation.label} UI receipt is fresh enough for final funding approval`,
    `${expectation.label} UI receipt is stale or timestamped in the future for final funding approval`,
    expectation.required,
    {
      finishedAt: receipt.finishedAt,
      ageMs: Number.isFinite(ageMs) ? ageMs : undefined,
      maxReceiptAgeMs: maxAgeMs
    }
  );
}

function hasDistinctSuiAccounts(receipt: UiAcceptanceReceipt): boolean {
  return isSuiObjectId(receipt.buyerAddress) &&
    isSuiObjectId(receipt.agentAddress) &&
    normalizeSui(receipt.buyerAddress) !== normalizeSui(receipt.agentAddress);
}

function hasBrowserAutomationEvidence(receipt: UiAcceptanceReceipt): boolean {
  return /^https?:\/\//i.test(receipt.entrypointUrl) &&
    hasString(receipt.browser?.name) &&
    hasString(receipt.browser?.userAgent) &&
    hasString(receipt.browser?.automationTool) &&
    receipt.browser.automationTool.toLowerCase() !== "manual";
}

function hasUiObservationEvidence(step: UiAcceptanceStep): boolean {
  if (step.status === "skipped") return true;
  return step.status === "passed" &&
    hasString(step.route) &&
    (hasString(step.testId) || hasString(step.statusText) || hasString(step.meta?.screenshotSha256));
}

function step(receipt: UiAcceptanceReceipt, name: string): UiAcceptanceStep | undefined {
  return receipt.steps.find((item) => item.name === name);
}

function stepSignerMatchesRole(receipt: UiAcceptanceReceipt, name: string): boolean {
  const expected = UI_SIGNER_ROLE[name];
  if (!expected) return false;
  const expectedAddress = expected === "buyer" ? receipt.buyerAddress : receipt.agentAddress;
  const item = step(receipt, name);
  return item?.actor === expected && sameSuiAddress(item.signerAddress, expectedAddress);
}

function delegationFundSignerMatchesBuyer(receipt: UiAcceptanceReceipt): boolean {
  const item = step(receipt, "buyer.create_and_fund_delegation");
  return sameSuiAddress(item?.meta?.fundSignerAddress, receipt.buyerAddress);
}

function hasDelegationFundingEvidence(receipt: UiAcceptanceReceipt): boolean {
  const meta = step(receipt, "buyer.create_and_fund_delegation")?.meta;
  if (!meta || typeof meta !== "object") return false;
  const item = meta as Record<string, unknown>;
  const fundDigest = item.fundDigest;
  const fundSignerAddress = item.fundSignerAddress;
  const fundSuiSpentMist = item.fundSuiSpentMist;
  const fundBalanceChanges = item.fundBalanceChanges;
  const fundEventTypes = item.fundEventTypes;
  const fundTxStatus = item.fundTxStatus;
  const fundTxError = item.fundTxError;
  if (!isSuiDigest(fundDigest) ||
      !isSuiObjectId(fundSignerAddress) ||
      typeof fundSuiSpentMist !== "string" ||
      !Array.isArray(fundBalanceChanges) ||
      !Array.isArray(fundEventTypes) ||
      typeof fundTxStatus !== "string" ||
      (fundTxError !== undefined && typeof fundTxError !== "string")) {
    return false;
  }
  try {
    productionAcceptanceDelegationFundingMeta({
      fundDigest,
      fundSpend: {
        digest: fundDigest,
        signerLabel: typeof item.fundSigner === "string" ? item.fundSigner : undefined,
        signerAddress: fundSignerAddress,
        suiSpentMist: fundSuiSpentMist,
        balanceChanges: fundBalanceChanges as ProductionAcceptanceDelegationFundingEvidence["balanceChanges"],
        eventTypes: fundEventTypes.filter((value): value is string => typeof value === "string"),
        txStatus: fundTxStatus,
        ...(typeof fundTxError === "string" ? { txError: fundTxError } : {})
      },
      buyerAddress: receipt.buyerAddress ?? "",
      packageId: receipt.config.packageId
    });
    return true;
  } catch {
    return false;
  }
}

function hasDecryptEvidence(meta: unknown): boolean {
  if (!meta || typeof meta !== "object") return false;
  const item = meta as Record<string, unknown>;
  return item.plaintextMatched === true &&
    hasString(item.accessPath) &&
    isSuiObjectId(item.sealId) &&
    hasString(item.walrusBlobId) &&
    hasPositiveNumber(item, "plaintextBytes");
}

function hasIndexerEvidence(meta: unknown): boolean {
  if (!meta || typeof meta !== "object") return false;
  const item = meta as Record<string, unknown>;
  return hasPositiveNumber(item, "eventsIngested") &&
    hasPositiveNumber(item, "reportsIndexed") &&
    hasString(item.walrusSiteObjectId);
}

function hasBuyerReloadEvidence(meta: unknown): boolean {
  if (!meta || typeof meta !== "object") return false;
  const item = meta as Record<string, unknown>;
  return isSuiObjectId(item.indexedReportObjectId) &&
    isSuiObjectId(item.indexedAccessReceiptObjectId) &&
    isSuiObjectId(item.indexedDelegationObjectId) &&
    item.localStorageOnly === false;
}

function hasPositiveNumber(value: unknown, key: string): boolean {
  if (!value || typeof value !== "object") return false;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0;
}

function isSuiDigest(value: unknown): value is string {
  return typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(value);
}

function isSuiObjectId(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function sameSuiAddress(left: unknown, right: unknown): boolean {
  return typeof left === "string" && typeof right === "string" && normalizeSui(left) === normalizeSui(right);
}

function normalizeSui(value: string | undefined): string | undefined {
  return value?.trim().toLowerCase();
}

function hasString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
