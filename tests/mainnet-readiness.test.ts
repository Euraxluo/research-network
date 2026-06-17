import { describe, expect, it } from "vitest";
import {
  checkProductionAcceptanceReceipt,
  hasBlockingReadinessFailures,
  type ReceiptExpectation
} from "../src/core/mainnet-readiness.js";
import type { ProductionAcceptanceReceipt, ProductionAcceptanceStep } from "../src/core/production-acceptance.js";

const ALL_STEPS = [
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
];

const executeExpectation: ReceiptExpectation = {
  label: "testnet-execute",
  network: "testnet",
  execute: true,
  preflight: false,
  required: true
};

describe("mainnet readiness receipt checks", () => {
  it("does not accept missing receipts as ready evidence", () => {
    const checks = checkProductionAcceptanceReceipt(undefined, executeExpectation);

    expect(hasBlockingReadinessFailures(checks)).toBe(true);
    expect(checks[0].message).toMatch(/missing/);
  });

  it("accepts a full capped execute receipt with digests and object ids", () => {
    const receipt = makeExecuteReceipt();
    const checks = checkProductionAcceptanceReceipt(receipt, executeExpectation);

    expect(hasBlockingReadinessFailures(checks)).toBe(false);
  });

  it("rejects a dry-run receipt for execute readiness", () => {
    const receipt = makeExecuteReceipt({ execute: false, conclusion: "not_run" });
    const checks = checkProductionAcceptanceReceipt(receipt, executeExpectation);

    expect(hasBlockingReadinessFailures(checks)).toBe(true);
    expect(checks.some((check) => check.name.endsWith(".mode") && check.status === "failed")).toBe(true);
    expect(checks.some((check) => check.name.endsWith(".conclusion") && check.status === "failed")).toBe(true);
  });

  it("rejects execute receipts missing transaction digest evidence", () => {
    const receipt = makeExecuteReceipt({
      steps: executeSteps().map((step) =>
        step.name === "agent.claim_membership_earnings" ? { ...step, digest: undefined } : step
      )
    });
    const checks = checkProductionAcceptanceReceipt(receipt, executeExpectation);

    expect(hasBlockingReadinessFailures(checks)).toBe(true);
    expect(checks.some((check) => check.name.endsWith(".digests") && check.status === "failed")).toBe(true);
  });

  it("rejects execute receipts with placeholder-looking transaction digests", () => {
    const receipt = makeExecuteReceipt({
      steps: executeSteps().map((step) =>
        step.name === "buyer.buy_platform_membership" ? { ...step, digest: "tx-not-a-sui-digest" } : step
      )
    });
    const checks = checkProductionAcceptanceReceipt(receipt, executeExpectation);

    expect(hasBlockingReadinessFailures(checks)).toBe(true);
    expect(checks.some((check) => check.name.endsWith(".digests") && check.status === "failed")).toBe(true);
  });

  it("rejects execute receipts missing actual balance-change spend evidence", () => {
    const receipt = makeExecuteReceipt({ spend: undefined });
    const checks = checkProductionAcceptanceReceipt(receipt, executeExpectation);

    expect(hasBlockingReadinessFailures(checks)).toBe(true);
    expect(checks.some((check) => check.name.endsWith(".spend.present") && check.status === "failed")).toBe(true);
  });

  it("rejects execute receipts whose actual SUI spend exceeds the cap", () => {
    const receipt = makeExecuteReceipt({
      spend: {
        ...spendSummary(),
        totalSpentMist: "111000000",
        withinCap: false
      }
    });
    const checks = checkProductionAcceptanceReceipt(receipt, executeExpectation);

    expect(hasBlockingReadinessFailures(checks)).toBe(true);
    expect(checks.some((check) => check.name.endsWith(".spend.actual_cap") && check.status === "failed")).toBe(true);
  });

  it("rejects execute receipts whose spend summary does not cover every Sui transaction", () => {
    const receipt = makeExecuteReceipt({
      spend: {
        ...spendSummary(),
        transactionCount: 9
      }
    });
    const checks = checkProductionAcceptanceReceipt(receipt, executeExpectation);

    expect(hasBlockingReadinessFailures(checks)).toBe(true);
    expect(checks.some((check) => check.name.endsWith(".spend.transaction_count") && check.status === "failed")).toBe(true);
  });

  it("rejects execute receipts missing per-transaction spend metadata", () => {
    const receipt = makeExecuteReceipt({
      steps: executeSteps().map((step) =>
        step.name === "agent.claim_membership_earnings"
          ? { ...step, meta: { ...(step.meta ?? {}), suiSpentMist: undefined } }
          : step
      )
    });
    const checks = checkProductionAcceptanceReceipt(receipt, executeExpectation);

    expect(hasBlockingReadinessFailures(checks)).toBe(true);
    expect(checks.some((check) => check.name.endsWith(".transaction_spend_metadata") && check.status === "failed")).toBe(true);
  });

  it("rejects execute receipts missing balanceChanges behind spend metadata", () => {
    const receipt = makeExecuteReceipt({
      steps: executeSteps().map((step) =>
        step.name === "buyer.buy_platform_membership"
          ? { ...step, meta: { ...(step.meta ?? {}), balanceChanges: undefined } }
          : step
      )
    });
    const checks = checkProductionAcceptanceReceipt(receipt, executeExpectation);

    expect(hasBlockingReadinessFailures(checks)).toBe(true);
    expect(checks.some((check) => check.name.endsWith(".transaction_spend_metadata") && check.status === "failed")).toBe(true);
  });

  it("rejects execute receipts whose transaction spend metadata does not match balanceChanges", () => {
    const receipt = makeExecuteReceipt({
      steps: executeSteps().map((step) =>
        step.name === "buyer.buy_platform_membership"
          ? { ...step, meta: { ...(step.meta ?? {}), suiSpentMist: "999999" } }
          : step
      )
    });
    const checks = checkProductionAcceptanceReceipt(receipt, executeExpectation);

    expect(hasBlockingReadinessFailures(checks)).toBe(true);
    expect(checks.some((check) => check.name.endsWith(".transaction_spend_metadata") && check.status === "failed")).toBe(true);
  });

  it("rejects execute receipts missing Walrus/Seal/decrypt evidence", () => {
    const receipt = makeExecuteReceipt({
      steps: executeSteps().map((step) =>
        step.name === "buyer.decrypt_report" ? { ...step, meta: undefined } : step
      )
    });
    const checks = checkProductionAcceptanceReceipt(receipt, executeExpectation);

    expect(hasBlockingReadinessFailures(checks)).toBe(true);
    expect(checks.some((check) => check.name.endsWith(".decrypt_evidence") && check.status === "failed")).toBe(true);
  });

  it("accepts no-spend preflight receipts only when transaction steps are skipped", () => {
    const expectation: ReceiptExpectation = {
      label: "testnet-preflight",
      network: "testnet",
      execute: false,
      preflight: true,
      required: true
    };
    const receipt = makePreflightReceipt();

    expect(hasBlockingReadinessFailures(checkProductionAcceptanceReceipt(receipt, expectation))).toBe(false);

    const badReceipt = makePreflightReceipt({
      steps: preflightSteps().map((step) =>
        step.name === "agent.publish_encrypted_report" ? { ...step, status: "passed" as const, meta: undefined } : step
      )
    });
    const badChecks = checkProductionAcceptanceReceipt(badReceipt, expectation);
    expect(hasBlockingReadinessFailures(badChecks)).toBe(true);
  });

  it("rejects mainnet receipts that still contain testnet-looking config", () => {
    const expectation: ReceiptExpectation = {
      label: "mainnet-execute",
      network: "mainnet",
      execute: true,
      preflight: false,
      required: true
    };
    const receipt = makeExecuteReceipt({
      network: "mainnet",
      config: {
        ...baseConfig("mainnet"),
        walrusAggregatorUrl: "https://aggregator.walrus-testnet.walrus.space"
      }
    });
    const checks = checkProductionAcceptanceReceipt(receipt, expectation);

    expect(hasBlockingReadinessFailures(checks)).toBe(true);
    expect(checks.some((check) => check.name.endsWith(".config.no_testnet_values") && check.status === "failed")).toBe(true);
  });

  it("rejects mainnet receipts that reuse known testnet object ids even without testnet URLs", () => {
    const expectation: ReceiptExpectation = {
      label: "mainnet-execute",
      network: "mainnet",
      execute: true,
      preflight: false,
      required: true
    };
    const receipt = makeExecuteReceipt({
      network: "mainnet",
      config: {
        ...baseConfig("mainnet"),
        packageId: "0x5ecd097d8f13e995493d23c9b033c815bd6a8bf771331c389c027296e8b8231e"
      }
    });
    const checks = checkProductionAcceptanceReceipt(receipt, expectation);

    expect(hasBlockingReadinessFailures(checks)).toBe(true);
    expect(checks.some((check) => check.name.endsWith(".config.no_testnet_values") && check.status === "failed")).toBe(true);
  });

  it("rejects mainnet execute receipts whose explicit spend cap is too large for acceptance", () => {
    const expectation: ReceiptExpectation = {
      label: "mainnet-execute",
      network: "mainnet",
      execute: true,
      preflight: false,
      required: true,
      maxSpendMist: 110_000_000n
    };
    const receipt = makeExecuteReceipt({
      network: "mainnet",
      budget: {
        ...makeExecuteReceipt({ network: "mainnet" }).budget,
        maxSpendMist: "1000000000"
      }
    });
    const checks = checkProductionAcceptanceReceipt(receipt, expectation);

    expect(hasBlockingReadinessFailures(checks)).toBe(true);
    expect(checks.some((check) => check.name.endsWith(".budget.mainnet_cap") && check.status === "failed")).toBe(true);
  });
});

function makeExecuteReceipt(overrides: Partial<ProductionAcceptanceReceipt> = {}): ProductionAcceptanceReceipt {
  const network = overrides.network ?? "testnet";
  return {
    network,
    execute: true,
    preflight: false,
    startedAt: "2026-06-17T00:00:00.000Z",
    finishedAt: "2026-06-17T00:01:00.000Z",
    buyerAddress: "0x" + "aa".repeat(32),
    agentAddress: "0x" + "bb".repeat(32),
    budget: {
      committedSpendMist: "3800000",
      gasReserveMist: "50000000",
      buyerMinimumMist: "53800000",
      agentMinimumMist: "50000000",
      totalBudgetMist: "103800000",
      maxSpendMist: "110000000"
    },
    config: baseConfig(network),
    spend: spendSummary(),
    steps: executeSteps(),
    conclusion: "passed",
    ...overrides
  };
}

function makePreflightReceipt(overrides: Partial<ProductionAcceptanceReceipt> = {}): ProductionAcceptanceReceipt {
  const network = overrides.network ?? "testnet";
  return {
    network,
    execute: false,
    preflight: true,
    startedAt: "2026-06-17T00:00:00.000Z",
    finishedAt: "2026-06-17T00:01:00.000Z",
    buyerAddress: "0x" + "aa".repeat(32),
    agentAddress: "0x" + "bb".repeat(32),
    budget: {
      committedSpendMist: "3800000",
      gasReserveMist: "50000000",
      buyerMinimumMist: "53800000",
      agentMinimumMist: "50000000",
      totalBudgetMist: "103800000",
      maxSpendMist: "0"
    },
    config: baseConfig(network),
    spend: undefined,
    steps: preflightSteps(),
    conclusion: "passed",
    ...overrides
  };
}

function executeSteps(): ProductionAcceptanceStep[] {
  return ALL_STEPS.map((name) => {
    const step: ProductionAcceptanceStep = { name, status: "passed" };
    if ([
      "agent.publish_encrypted_report",
      "buyer.buy_platform_membership",
      "buyer.record_access_receipt",
      "buyer.buy_agent_subscription",
      "platform.settle_membership_receipt",
      "agent.claim_membership_earnings",
      "buyer.create_and_fund_delegation",
      "agent.publish_private_result",
      "buyer.complete_delegation"
    ].includes(name)) {
      step.digest = digestFor(name);
    }
    if ([
      "agent.publish_encrypted_report",
      "buyer.buy_platform_membership",
      "buyer.record_access_receipt",
      "buyer.buy_agent_subscription",
      "buyer.create_and_fund_delegation",
      "agent.publish_private_result"
    ].includes(name)) {
      step.objectId = "0x" + "cc".repeat(32);
    }
    if (name === "buyer.create_and_fund_delegation") {
      step.meta = {
        fundDigest: digestFor("fund"),
        fundSignerAddress: "0x" + "aa".repeat(32),
        fundSuiSpentMist: "2000000",
        fundBalanceChanges: [{ owner: "0x" + "aa".repeat(32), coinType: "0x2::sui::SUI", amount: "-2000000" }]
      };
    }
    if (name === "agent.publish_encrypted_report" || name === "agent.publish_private_result") {
      step.meta = reportMeta(name);
    }
    if (name === "buyer.decrypt_report") {
      step.meta = decryptMeta("platform_member");
    }
    if (name === "buyer.decrypt_report_with_subscription") {
      step.meta = decryptMeta("agent_subscription");
    }
    if (name === "buyer.decrypt_private_result") {
      step.meta = decryptMeta("private_delegation");
    }
    if (step.digest) {
      step.meta = { ...(step.meta ?? {}), ...spendMeta(name) };
    }
    if (name === "budget.actual_spend_cap") {
      step.meta = spendSummary();
    }
    return step;
  });
}

function preflightSteps(): ProductionAcceptanceStep[] {
  return ALL_STEPS.map((name) => {
    if (["config.validate", "accounts.validate", "balances.validate"].includes(name)) {
      if (name === "accounts.validate") {
        return {
          name,
          status: "passed",
          meta: {
            buyerProof: proofMeta(),
            agentProof: proofMeta(),
            buyerFreshness: { maxEpoch: 123, currentEpoch: 120, epochsRemaining: 3 },
            agentFreshness: { maxEpoch: 123, currentEpoch: 120, epochsRemaining: 3 }
          }
        };
      }
      return { name, status: "passed" };
    }
    return { name, status: "skipped", meta: { reason: "preflight_no_transactions" } };
  });
}

function proofMeta(): Record<string, boolean> {
  return {
    hasProofPoints: true,
    hasIssBase64Details: true,
    hasHeaderBase64: true,
    hasAddressSeed: true
  };
}

function reportMeta(name: string): Record<string, string> {
  return {
    reportObjectId: "0x" + "cc".repeat(32),
    txDigest: digestFor(name),
    sealId: "0x" + "dd".repeat(32),
    walrusBlobId: "walrus-blob",
    ciphertextHash: "sha256:cipher",
    plaintextCommitment: "sha256:plain",
    visibility: name === "agent.publish_private_result" ? "private_delegation" : "encrypted"
  };
}

function digestFor(seed: string): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  let digest = "";
  for (let index = 0; index < 44; index += 1) {
    hash = (hash * 1664525 + 1013904223) >>> 0;
    digest += alphabet[hash % alphabet.length];
  }
  return digest;
}

function decryptMeta(accessPath: string): Record<string, string | number | boolean> {
  return {
    ...reportMeta("agent.publish_encrypted_report"),
    accessPath,
    plaintextBytes: 42,
    plaintextMatched: true
  };
}

function spendMeta(name: string): Record<string, string | Array<Record<string, string | undefined>>> {
  const signerAddress = name.startsWith("agent.") ? "0x" + "bb".repeat(32) : "0x" + "aa".repeat(32);
  const suiSpentMist = name.startsWith("agent.") ? "1500000" : "5000000";
  return {
    signer: name.startsWith("agent.") ? "agent" : "buyer",
    signerAddress,
    suiSpentMist,
    balanceChanges: [{ owner: signerAddress, coinType: "0x2::sui::SUI", amount: `-${suiSpentMist}` }]
  };
}

function spendSummary() {
  return {
    buyerSpentMist: "50000000",
    agentSpentMist: "10000000",
    totalSpentMist: "60000000",
    maxSpendMist: "110000000",
    withinCap: true,
    transactionCount: 10
  };
}

function baseConfig(network: "testnet" | "mainnet"): ProductionAcceptanceReceipt["config"] {
  if (network === "mainnet") {
    return {
      suiRpcUrl: "https://fullnode.mainnet.sui.io:443",
      packageId: "0x" + "11".repeat(32),
      settlementConfigId: "0x" + "22".repeat(32),
      agentEarningsId: "0x" + "33".repeat(32),
      membershipReceiptRegistryId: "0x" + "44".repeat(32),
      walrusPublisherUrl: "https://publisher.walrus.space",
      walrusAggregatorUrl: "https://aggregator.walrus.space",
      walrusEpochs: 5,
      sealKeyServerObjectId: "0x" + "55".repeat(32),
      sealKeyServerAggregatorUrl: "https://seal-aggregator.mainnet.example",
      sealThreshold: 1,
      platformMembershipPriceMist: "1000000",
      agentSubscriptionPriceMist: "1000000",
      delegationBudgetMist: "1000000",
      membershipSettlementShareMist: "800000",
      accessDurationMs: 2592000000
    };
  }
  return {
    suiRpcUrl: "https://sui-testnet-rpc.publicnode.com",
    packageId: "0x5ecd097d8f13e995493d23c9b033c815bd6a8bf771331c389c027296e8b8231e",
    settlementConfigId: "0x612c971a021e8139e0cd4e63bfef162f4301e72532b808a840d3d16512125ea4",
    agentEarningsId: "0xb637059cb77aca697e36673afa2e8639f7f82d16b8f0eba8eb6a1f5bd12eda2b",
    membershipReceiptRegistryId: "0x5a25a789a4032c8460afa68b26b839a081c770372fa04e567207c606b68ad748",
    walrusPublisherUrl: "https://publisher.walrus-testnet.walrus.space",
    walrusAggregatorUrl: "https://aggregator.walrus-testnet.walrus.space",
    walrusEpochs: 5,
    sealKeyServerObjectId: "0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98",
    sealKeyServerAggregatorUrl: "https://seal-aggregator-testnet.mystenlabs.com",
    sealThreshold: 1,
    platformMembershipPriceMist: "1000000",
    agentSubscriptionPriceMist: "1000000",
    delegationBudgetMist: "1000000",
    membershipSettlementShareMist: "800000",
    accessDurationMs: 2592000000
  };
}
