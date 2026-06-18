import { describe, expect, it } from "vitest";
import {
  checkUiAcceptanceReceipt,
  UI_ACCEPTANCE_STEPS,
  type UiAcceptanceReceipt,
  type UiAcceptanceStep
} from "../src/core/ui-acceptance.js";
import { hasBlockingReadinessFailures } from "../src/core/mainnet-readiness.js";

const BUYER = "0x" + "aa".repeat(32);
const AGENT = "0x" + "bb".repeat(32);
const PACKAGE = "0x" + "11".repeat(32);
const TEST_COMMIT = "c".repeat(40);

describe("normal-user UI acceptance receipt checks", () => {
  it("requires a browser UI receipt before normal-user readiness can pass", () => {
    const checks = checkUiAcceptanceReceipt(undefined, {
      label: "testnet-ui",
      network: "testnet",
      required: true
    });

    expect(hasBlockingReadinessFailures(checks)).toBe(true);
    expect(checks[0].message).toMatch(/missing/);
  });

  it("accepts a complete automated two-account browser user-story receipt", () => {
    const checks = checkUiAcceptanceReceipt(makeUiReceipt(), {
      label: "testnet-ui",
      network: "testnet",
      required: true
    });

    expect(hasBlockingReadinessFailures(checks)).toBe(false);
  });

  it("rejects manual receipts because production readiness needs automated browser evidence", () => {
    const receipt = makeUiReceipt({
      browser: {
        name: "Chrome",
        userAgent: "Mozilla/5.0",
        automationTool: "manual"
      }
    });

    const checks = checkUiAcceptanceReceipt(receipt, {
      label: "testnet-ui",
      network: "testnet",
      required: true
    });

    expect(hasBlockingReadinessFailures(checks)).toBe(true);
    expect(checks.some((check) => check.name.endsWith(".browser.automation") && check.status === "failed")).toBe(true);
  });

  it("rejects UI receipts that only prove localStorage state instead of indexed buyer reload state", () => {
    const receipt = makeUiReceipt({
      steps: steps().map((step) =>
        step.name === "buyer.reloads_indexed_state"
          ? { ...step, meta: { ...(step.meta ?? {}), localStorageOnly: true } }
          : step
      )
    });

    const checks = checkUiAcceptanceReceipt(receipt, {
      label: "testnet-ui",
      network: "testnet",
      required: true
    });

    expect(hasBlockingReadinessFailures(checks)).toBe(true);
    expect(checks.some((check) => check.name.endsWith(".indexer.sync") && check.status === "failed")).toBe(true);
  });

  it("rejects UI receipts whose signer roles do not match the normal user story", () => {
    const receipt = makeUiReceipt({
      steps: steps().map((step) =>
        step.name === "agent.claim_earnings"
          ? { ...step, actor: "buyer", signerAddress: BUYER }
          : step
      )
    });

    const checks = checkUiAcceptanceReceipt(receipt, {
      label: "testnet-ui",
      network: "testnet",
      required: true
    });

    expect(hasBlockingReadinessFailures(checks)).toBe(true);
    expect(checks.some((check) => check.name.endsWith(".transactions.signer_roles") && check.status === "failed")).toBe(true);
  });

  it("rejects UI receipts missing Seal decrypt evidence", () => {
    const receipt = makeUiReceipt({
      steps: steps().map((step) =>
        step.name === "buyer.decrypt_private_result"
          ? { ...step, meta: { ...(step.meta ?? {}), plaintextMatched: false } }
          : step
      )
    });

    const checks = checkUiAcceptanceReceipt(receipt, {
      label: "testnet-ui",
      network: "testnet",
      required: true
    });

    expect(hasBlockingReadinessFailures(checks)).toBe(true);
    expect(checks.some((check) => check.name.endsWith(".seal.decrypts") && check.status === "failed")).toBe(true);
  });
});

function makeUiReceipt(overrides: Partial<UiAcceptanceReceipt> = {}): UiAcceptanceReceipt {
  return {
    kind: "normal-user-ui-acceptance/v1",
    network: "testnet",
    surface: "web-ui",
    startedAt: "2026-06-17T00:00:00.000Z",
    finishedAt: "2026-06-17T00:10:00.000Z",
    conclusion: "passed",
    provenance: {
      generatedBy: "normal-user-ui-acceptance",
      gitCommit: TEST_COMMIT,
      gitTreeState: "clean",
      packageName: "@research-network/protocol-kit",
      packageVersion: "0.1.0"
    },
    entrypointUrl: "https://testnet.example/workbench.html",
    browser: {
      name: "chromium",
      userAgent: "Mozilla/5.0 Playwright",
      automationTool: "playwright",
      headless: true
    },
    buyerAddress: BUYER,
    agentAddress: AGENT,
    config: {
      suiRpcUrl: "https://sui-testnet-rpc.publicnode.com",
      packageId: PACKAGE,
      settlementConfigId: objectId(21),
      agentEarningsId: objectId(22),
      membershipReceiptRegistryId: objectId(23),
      walrusPublisherUrl: "https://publisher.walrus-testnet.walrus.space",
      walrusAggregatorUrl: "https://aggregator.walrus-testnet.walrus.space",
      walrusEpochs: 5,
      sealKeyServerObjectId: objectId(24),
      sealKeyServerAggregatorUrl: "https://seal-aggregator-testnet.example",
      sealThreshold: 1,
      platformMembershipPriceMist: "1000000",
      agentSubscriptionPriceMist: "1000000",
      delegationBudgetMist: "1000000",
      membershipSettlementShareMist: "800000",
      accessDurationMs: 2592000000
    },
    steps: steps(),
    ...overrides
  };
}

function steps(): UiAcceptanceStep[] {
  return UI_ACCEPTANCE_STEPS.map((name, index) => {
    const base: UiAcceptanceStep = {
      name,
      status: "passed",
      route: "/workbench.html",
      testId: name.replaceAll(".", "-"),
      statusText: "passed " + name
    };
    if (name === "agent.sign_in" || name === "agent.sign_in_for_private_result" || name === "agent.sign_in_for_claim") {
      return { ...base, actor: "agent", signerAddress: AGENT };
    }
    if (name.startsWith("buyer.sign_in")) {
      return { ...base, actor: "buyer", signerAddress: BUYER };
    }
    if (isTransactionStep(name)) {
      const actor = name.startsWith("agent.") ? "agent" : "buyer";
      const signerAddress = actor === "agent" ? AGENT : BUYER;
      const transactionStep: UiAcceptanceStep = {
        ...base,
        actor,
        signerAddress,
        digest: digest(index),
        meta: {
          eventTypes: [`${PACKAGE}::acceptance::${name.split(".").pop()}`]
        }
      };
      if (isObjectStep(name)) transactionStep.objectId = objectId(index + 1);
      if (name === "buyer.create_and_fund_delegation") {
        transactionStep.meta = {
          ...(transactionStep.meta ?? {}),
          fundDigest: digest(index + 100),
          fundSigner: "buyer",
          fundSignerAddress: BUYER,
          fundSuiSpentMist: "1000",
          fundBalanceChanges: [{ owner: BUYER, coinType: "0x2::sui::SUI", amount: "-1000" }],
          fundEventTypes: [`${PACKAGE}::delegation::DelegationFunded`],
          fundTxStatus: "success"
        };
      }
      return transactionStep;
    }
    if (name.startsWith("buyer.decrypt_")) {
      return {
        ...base,
        actor: "buyer",
        signerAddress: BUYER,
        meta: {
          plaintextMatched: true,
          accessPath: name.includes("subscription")
            ? "agent_subscription"
            : name.includes("private")
              ? "private_delegation"
              : "platform_member",
          sealId: objectId(index + 40),
          walrusBlobId: "walrus-blob-" + index,
          plaintextBytes: 128
        }
      };
    }
    if (name === "indexer.poll_and_publish") {
      return {
        ...base,
        meta: {
          eventsIngested: 10,
          reportsIndexed: 2,
          walrusSiteObjectId: objectId(80)
        }
      };
    }
    if (name === "buyer.reloads_indexed_state") {
      return {
        ...base,
        actor: "buyer",
        signerAddress: BUYER,
        meta: {
          indexedReportObjectId: objectId(1),
          indexedAccessReceiptObjectId: objectId(3),
          indexedDelegationObjectId: objectId(5),
          localStorageOnly: false
        }
      };
    }
    return base;
  });
}

function isTransactionStep(name: string): boolean {
  return [
    "agent.publish_encrypted_report",
    "buyer.buy_platform_membership",
    "buyer.record_access_receipt",
    "buyer.buy_agent_subscription",
    "buyer.create_and_fund_delegation",
    "agent.publish_private_result",
    "buyer.settle_membership_receipt",
    "agent.claim_earnings",
    "buyer.complete_delegation"
  ].includes(name);
}

function isObjectStep(name: string): boolean {
  return [
    "agent.publish_encrypted_report",
    "buyer.buy_platform_membership",
    "buyer.record_access_receipt",
    "buyer.buy_agent_subscription",
    "buyer.create_and_fund_delegation",
    "agent.publish_private_result"
  ].includes(name);
}

function objectId(seed: number): string {
  return "0x" + seed.toString(16).padStart(2, "0").repeat(32);
}

function digest(seed: number): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let out = "";
  for (let index = 0; index < 44; index += 1) {
    out += alphabet[(seed + index) % alphabet.length];
  }
  return out;
}
