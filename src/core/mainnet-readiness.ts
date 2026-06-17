import type {
  ProductionAcceptanceNetwork,
  ProductionAcceptanceReceipt,
  ProductionAcceptanceStep
} from "./production-acceptance.js";

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
}

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
  "buyer.complete_delegation"
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
  checks.push(checkBoolean(
    `receipt.${expectation.label}.preflight.core_steps`,
    passedCore.every((name) => stepStatus(receipt, name) === "passed"),
    `${expectation.label} preflight validated config, accounts, and balances`,
    `${expectation.label} preflight must pass config, account, and balance checks`,
    expectation.required
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
    [...EXECUTE_DIGEST_STEPS].every((name) => Boolean(receipt.steps.find((step) => step.name === name)?.digest)),
    `${expectation.label} execute records transaction digests for all transaction steps`,
    `${expectation.label} execute is missing one or more transaction digests`,
    expectation.required
  ));
  checks.push(checkBoolean(
    `receipt.${expectation.label}.execute.objects`,
    [...EXECUTE_OBJECT_STEPS].every((name) => Boolean(receipt.steps.find((step) => step.name === name)?.objectId)),
    `${expectation.label} execute records created object ids for object-producing steps`,
    `${expectation.label} execute is missing one or more created object ids`,
    expectation.required
  ));
  checks.push(checkBoolean(
    `receipt.${expectation.label}.execute.delegation_funded`,
    typeof receipt.steps.find((step) => step.name === "buyer.create_and_fund_delegation")?.meta?.fundDigest === "string",
    `${expectation.label} execute records the delegation funding digest`,
    `${expectation.label} execute is missing the delegation funding digest`,
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
  return [
    checkBoolean(
      `receipt.${expectation.label}.budget.cap`,
      maxSpend > 0n && totalBudget <= maxSpend,
      `${expectation.label} execute budget is covered by the explicit spend cap`,
      `${expectation.label} execute budget exceeds or omits the explicit spend cap`,
      expectation.required,
      { totalBudgetMist: String(totalBudget), maxSpendMist: String(maxSpend) }
    )
  ];
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
  return normalized.includes("testnet") || normalized.includes("sui-testnet-rpc.publicnode.com");
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
