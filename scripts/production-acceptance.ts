/**
 * Production acceptance runner for capped real Sui + Walrus + Seal flows.
 *
 * Dry-run config check:
 *   npx tsx scripts/production-acceptance.ts --network testnet
 *
 * No-spend preflight (validates sessions/prover/balances, no transactions):
 *   ZKLOGIN_PROVER_URL=https://<prover> npx tsx scripts/production-acceptance.ts --network testnet --preflight \
 *     --buyer-session .research-network/secrets/acceptance-buyer.json \
 *     --agent-session .research-network/secrets/acceptance-agent.json
 *
 * Real testnet run (requires two zkLogin session files and an explicit spend cap):
 *   npx tsx scripts/production-acceptance.ts --network testnet --execute \
 *     --buyer-session .research-network/secrets/acceptance-buyer.json \
 *     --agent-session .research-network/secrets/acceptance-agent.json \
 *     --max-spend-mist 110000000
 *
 * Session file shape:
 *   {
 *     "address": "0x...",
 *     "ephemeralSecretKey": "suiprivkey...",
 *     "idToken": "<Google id_token>",
 *     "salt": "<zkLogin salt>",
 *     "maxEpoch": 123,
 *     "randomness": "..."
 *   }
 *
 * The file can also use browser storage names (`rn_zk_eph` and
 * `rn_zk_session`) as object keys. Keep these files under
 * `.research-network/secrets/` so git ignores them.
 */
import { readFile } from "node:fs/promises";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { getZkLoginSignature } from "@mysten/sui/zklogin";
import {
  assertProductionAcceptanceCanExecute,
  assertProductionAcceptanceSessionAddress,
  assertProductionAcceptanceSessionFresh,
  createProductionAcceptanceReceipt,
  normalizeProductionAcceptanceBalanceChanges,
  normalizeProductionAcceptanceSession,
  parseProductionAcceptanceArgs,
  productionAcceptanceFreshnessEvidence,
  productionAcceptanceProverEvidence,
  productionAcceptanceSuiSpentMist,
  summarizeProductionAcceptanceSpend,
  writeProductionAcceptanceReceipt,
  zkProofEvidence,
  type ProductionAcceptanceBalanceChange,
  type ProductionAcceptanceConfig,
  type ProductionAcceptanceTransactionSpendEvidence,
  type ProductionAcceptanceSessionInput,
  type ProductionAcceptanceReceipt,
  type ProductionAcceptanceStep
} from "../src/core/production-acceptance.js";
import { deriveZkLoginAddress, requestZkProof } from "../src/core/zklogin.js";
import {
  buyPlatformMembershipOnChain,
  claimAgentEarningsOnChain,
  completeDelegationJobOnChain,
  createDelegationJobOnChain,
  decryptReport,
  fundDelegationJobOnChain,
  buyAgentSubscriptionOnChain,
  publishPrivateResultOnChain,
  publishReport,
  recordPlatformAccessReceiptOnChain,
  settleMembershipReportOnChain,
  type M3Signer
} from "../web/src/lib/clients.ts";
import { DEFAULT_M3_CONFIG, type M3Config } from "../web/src/lib/config.ts";

type SessionFile = ProductionAcceptanceSessionInput;

interface AcceptanceSigner extends M3Signer {
  label: "buyer" | "agent";
  session: { maxEpoch: number };
  proof: () => Promise<Record<string, unknown>>;
}

interface AcceptanceTransactionLedgerEntry extends ProductionAcceptanceTransactionSpendEvidence {
  signerLabel: "buyer" | "agent";
  signerAddress: string;
  suiSpentMist: string;
  eventTypes: string[];
  txStatus: string;
  txError?: string;
}

const steps: ProductionAcceptanceStep[] = [
  { name: "config.validate", status: "pending" },
  { name: "accounts.validate", status: "pending" },
  { name: "balances.validate", status: "pending" },
  { name: "agent.publish_encrypted_report", status: "pending" },
  { name: "buyer.buy_platform_membership", status: "pending" },
  { name: "buyer.decrypt_report", status: "pending" },
  { name: "buyer.record_access_receipt", status: "pending" },
  { name: "buyer.buy_agent_subscription", status: "pending" },
  { name: "buyer.decrypt_report_with_subscription", status: "pending" },
  { name: "platform.settle_membership_receipt", status: "pending" },
  { name: "agent.claim_membership_earnings", status: "pending" },
  { name: "buyer.create_and_fund_delegation", status: "pending" },
  { name: "agent.publish_private_result", status: "pending" },
  { name: "buyer.decrypt_private_result", status: "pending" },
  { name: "buyer.complete_delegation", status: "pending" },
  { name: "budget.actual_spend_cap", status: "pending" }
];

const transactionLedger = new Map<string, AcceptanceTransactionLedgerEntry>();

async function main() {
  const config = parseProductionAcceptanceArgs(process.argv.slice(2));
  const budget = assertProductionAcceptanceCanExecute(config);
  installRuntimeConfig(config);
  const receipt = createProductionAcceptanceReceipt(config, budget);
  receipt.config = {
    suiRpcUrl: activeConfig().suiRpcUrl,
    packageId: activeConfig().packageId,
    settlementConfigId: activeConfig().settlementConfigId,
    agentEarningsId: activeConfig().agentEarningsId,
    membershipReceiptRegistryId: activeConfig().membershipReceiptRegistryId,
    walrusPublisherUrl: activeConfig().walrusPublisherUrl,
    walrusAggregatorUrl: activeConfig().walrusAggregatorUrl,
    walrusEpochs: activeConfig().walrusEpochs,
    sealKeyServerObjectId: activeConfig().sealKeyServers[0]?.objectId,
    sealKeyServerAggregatorUrl: activeConfig().sealKeyServers[0]?.aggregatorUrl,
    sealThreshold: activeConfig().sealThreshold,
    platformMembershipPriceMist: activeConfig().platformMembershipPriceMist,
    agentSubscriptionPriceMist: activeConfig().agentSubscriptionPriceMist,
    delegationBudgetMist: activeConfig().delegationBudgetMist,
    membershipSettlementShareMist: activeConfig().membershipSettlementShareMist,
    accessDurationMs: activeConfig().accessDurationMs
  };
  receipt.steps = steps;

  try {
    pass("config.validate", {
      network: config.network,
      execute: config.execute,
      preflight: config.preflight,
      totalBudgetMist: String(budget.totalBudgetMist),
      packageId: activeConfig().packageId
    });

    if (!config.execute && !config.preflight) {
      for (const step of receipt.steps.filter((step) => step.status === "pending")) {
        step.status = "skipped";
        step.meta = { reason: "dry_run" };
      }
      receipt.conclusion = "not_run";
      receipt.finishedAt = new Date().toISOString();
      return;
    }

    const buyer = await loadAcceptanceSigner("buyer", required(config.buyerSessionPath, "buyer-session"), config);
    const agent = await loadAcceptanceSigner("agent", required(config.agentSessionPath, "agent-session"), config);
    if (buyer.address.toLowerCase() === agent.address.toLowerCase()) {
      throw new Error("buyer and agent zkLogin addresses must be different");
    }
    receipt.buyerAddress = buyer.address;
    receipt.agentAddress = agent.address;
    const currentEpoch = await getCurrentEpoch();
    const buyerFreshness = productionAcceptanceFreshnessEvidence(buyer.session, currentEpoch);
    const agentFreshness = productionAcceptanceFreshnessEvidence(agent.session, currentEpoch);
    pass("accounts.validate", {
      buyer: buyer.address,
      agent: agent.address,
      currentEpoch,
      buyerMaxEpoch: buyer.session.maxEpoch,
      agentMaxEpoch: agent.session.maxEpoch,
      buyerEpochsRemaining: buyerFreshness.epochsRemaining,
      agentEpochsRemaining: agentFreshness.epochsRemaining
    });

    const buyerBalance = await validateBalance("buyer", buyer.address, budget.buyerMinimumMist);
    const agentBalance = await validateBalance("agent", agent.address, budget.agentMinimumMist);
    pass("balances.validate", {
      buyerBalanceMist: String(buyerBalance.balanceMist),
      buyerMinimumMist: String(buyerBalance.minimumMist),
      agentBalanceMist: String(agentBalance.balanceMist),
      agentMinimumMist: String(agentBalance.minimumMist)
    });

    if (config.preflight) {
      assertProductionAcceptanceSessionFresh("buyer", buyer.session, currentEpoch);
      assertProductionAcceptanceSessionFresh("agent", agent.session, currentEpoch);
      const proverEvidence = await productionAcceptanceProverEvidence(required(process.env.ZKLOGIN_PROVER_URL, "ZKLOGIN_PROVER_URL"));
      const buyerProof = await buyer.proof();
      const agentProof = await agent.proof();
      pass("accounts.validate", {
        buyer: buyer.address,
        agent: agent.address,
        currentEpoch,
        buyerFreshness,
        agentFreshness,
        prover: proverEvidence,
        buyerProof: await zkProofEvidence(buyerProof, buyer.session, buyer.address),
        agentProof: await zkProofEvidence(agentProof, agent.session, agent.address)
      });
      for (const step of receipt.steps.filter((step) => step.status === "pending")) {
        step.status = "skipped";
        step.meta = { reason: "preflight_no_transactions" };
      }
      receipt.conclusion = "passed";
      return;
    }

    const encrypted = await publishReport({
      title: "Production acceptance encrypted report",
      visibility: "encrypted",
      requiredTier: 1,
      freePreview: "Production acceptance preview.",
      plaintext: "Production acceptance encrypted plaintext " + new Date().toISOString(),
      agent: agent.address,
      sourceRepo: "production-acceptance/test"
    }, agent);
    pass("agent.publish_encrypted_report", {
      digest: encrypted.txDigest,
      objectId: encrypted.report.sui_object_id,
      meta: reportEvidence(encrypted.report)
    });

    const membership = await buyPlatformMembershipOnChain({
      signer: buyer,
      paymentMist: config.platformMembershipPriceMist
    });
    pass("buyer.buy_platform_membership", membership);

    const memberPlaintext = await decryptReport(
      encrypted.report,
      "seal_approve_report_with_platform_membership",
      buyer,
      membership.objectId
    );
    if (!memberPlaintext || memberPlaintext !== encrypted.plaintext) {
      throw new Error("buyer platform membership decrypt did not return the encrypted report plaintext");
    }
    pass("buyer.decrypt_report", {
      meta: decryptEvidence(encrypted.report, "platform_member", memberPlaintext)
    });

    const periodId = currentPeriod();
    const accessReceipt = await recordPlatformAccessReceiptOnChain({
      signer: buyer,
      passObjectId: membership.objectId,
      reportObjectId: encrypted.report.sui_object_id || encrypted.report.id,
      periodId
    });
    pass("buyer.record_access_receipt", accessReceipt);

    const subscription = await buyAgentSubscriptionOnChain({
      signer: buyer,
      agent: agent.address,
      paymentMist: config.agentSubscriptionPriceMist
    });
    pass("buyer.buy_agent_subscription", subscription);

    const subscriberPlaintext = await decryptReport(
      encrypted.report,
      "seal_approve_report_with_agent_subscription",
      buyer,
      subscription.objectId
    );
    if (!subscriberPlaintext || subscriberPlaintext !== encrypted.plaintext) {
      throw new Error("buyer agent subscription decrypt did not return the encrypted report plaintext");
    }
    pass("buyer.decrypt_report_with_subscription", {
      meta: decryptEvidence(encrypted.report, "agent_subscription", subscriberPlaintext)
    });

    const settleDigest = await settleMembershipReportOnChain({
      signer: buyer,
      receiptObjectId: accessReceipt.objectId,
      amountMist: config.membershipSettlementShareMist
    });
    pass("platform.settle_membership_receipt", { digest: settleDigest });

    const claimDigest = await claimAgentEarningsOnChain({ signer: agent });
    pass("agent.claim_membership_earnings", { digest: claimDigest });

    const job = await createDelegationJobOnChain({
      signer: buyer,
      agent: agent.address,
      question: "Production acceptance private delegation request",
      sourceArtifact: encrypted.report.sui_object_id || encrypted.report.id,
      budgetMist: config.delegationBudgetMist
    });
    const fundDigest = await fundDelegationJobOnChain({
      signer: buyer,
      jobObjectId: job.objectId,
      budgetMist: config.delegationBudgetMist
    });
    const fundSpend = transactionLedger.get(fundDigest);
    pass("buyer.create_and_fund_delegation", {
      digest: job.digest,
      objectId: job.objectId,
      meta: {
        fundDigest,
        ...(fundSpend ? {
          fundSigner: fundSpend.signerLabel,
          fundSignerAddress: fundSpend.signerAddress,
          fundSuiSpentMist: fundSpend.suiSpentMist,
          fundBalanceChanges: fundSpend.balanceChanges,
          fundEventTypes: fundSpend.eventTypes,
          fundTxStatus: fundSpend.txStatus,
          ...(fundSpend.txError ? { fundTxError: fundSpend.txError } : {})
        } : {})
      }
    });

    const privateResult = await publishPrivateResultOnChain({
      signer: agent,
      jobObjectId: job.objectId,
      title: "Production acceptance private result",
      freePreview: "Private delegation metadata.",
      plaintext: "Production acceptance private delegation plaintext " + new Date().toISOString(),
      sourceRepo: "production-acceptance/test"
    });
    pass("agent.publish_private_result", {
      digest: privateResult.txDigest,
      objectId: privateResult.report.sui_object_id,
      meta: reportEvidence(privateResult.report)
    });

    const privatePlaintext = await decryptReport(
      privateResult.report,
      "seal_approve_private_result",
      buyer,
      undefined,
      job.objectId
    );
    if (!privatePlaintext || privatePlaintext !== privateResult.plaintext) {
      throw new Error("buyer private delegation decrypt did not return the private result plaintext");
    }
    pass("buyer.decrypt_private_result", {
      meta: decryptEvidence(privateResult.report, "private_delegation", privatePlaintext)
    });

    const completeDigest = await completeDelegationJobOnChain({ signer: buyer, jobObjectId: job.objectId });
    pass("buyer.complete_delegation", { digest: completeDigest });

    receipt.spend = summarizeProductionAcceptanceSpend({
      transactions: [...transactionLedger.values()].map(({ digest, signerAddress, suiSpentMist, balanceChanges }) => ({
        digest,
        signerAddress,
        suiSpentMist,
        balanceChanges
      })),
      buyerAddress: buyer.address,
      agentAddress: agent.address,
      maxSpendMist: config.maxSpendMist
    });
    if (!receipt.spend.withinCap) {
      throw new Error(
        `actual SUI spend ${receipt.spend.totalSpentMist} MIST exceeds max-spend-mist ${receipt.spend.maxSpendMist}`
      );
    }
    pass("budget.actual_spend_cap", { meta: receipt.spend });

    receipt.conclusion = "passed";
  } catch (error) {
    const pending = receipt.steps.find((step) => step.status === "pending");
    if (pending) {
      pending.status = "failed";
      pending.error = String((error as Error)?.message || error);
    }
    receipt.conclusion = "failed";
    throw error;
  } finally {
    receipt.finishedAt = new Date().toISOString();
    await writeProductionAcceptanceReceipt(config.receiptPath, receipt);
    console.log(JSON.stringify(receipt, null, 2));
  }
}

function pass(name: string, result?: { digest?: string; objectId?: string; meta?: Record<string, unknown> } | Record<string, unknown>) {
  const step = steps.find((item) => item.name === name);
  if (!step) throw new Error(`unknown acceptance step ${name}`);
  step.status = "passed";
  const digest = result && "digest" in result && typeof result.digest === "string" ? result.digest : undefined;
  if (digest) step.digest = digest;
  if (result && "objectId" in result && typeof result.objectId === "string") step.objectId = result.objectId;
  let meta: Record<string, unknown> | undefined;
  if (result && "meta" in result && typeof result.meta === "object") {
    meta = result.meta as Record<string, unknown>;
  } else if (result) {
    meta = result as Record<string, unknown>;
  }
  if (digest) {
    meta = {
      ...(meta ?? {}),
      ...transactionSpendMeta(digest)
    };
  }
  if (meta && Object.keys(meta).length) {
    step.meta = meta;
  }
}

async function loadAcceptanceSigner(label: "buyer" | "agent", filePath: string, config: ProductionAcceptanceConfig): Promise<AcceptanceSigner> {
  const raw = JSON.parse(await readFile(filePath, "utf8")) as SessionFile;
  const session = normalizeProductionAcceptanceSession(label, raw);
  const keypair = Ed25519Keypair.fromSecretKey(session.ephemeralSecretKey);
  const address = assertProductionAcceptanceSessionAddress(label, session, deriveZkLoginAddress);

  async function proof() {
    const proverUrl = process.env.ZKLOGIN_PROVER_URL;
    if (!proverUrl) throw new Error("ZKLOGIN_PROVER_URL is required for --preflight/--execute");
    return await requestZkProof(proverUrl, {
      jwt: session.idToken,
      extendedEphemeralPublicKey: keypair.getPublicKey().toSuiPublicKey(),
      maxEpoch: session.maxEpoch,
      jwtRandomness: session.randomness,
      salt: session.salt,
      keyClaimName: "sub"
    });
  }

  function composite(proofInputs: Record<string, unknown>, userSignature: string) {
    return getZkLoginSignature({
      inputs: {
        proofPoints: proofInputs.proofPoints ?? proofInputs.proof_points,
        issBase64Details: proofInputs.issBase64Details ?? proofInputs.iss_base64_details,
        headerBase64: proofInputs.headerBase64 ?? proofInputs.header_base64,
        addressSeed: proofInputs.addressSeed ?? proofInputs.address_seed
      },
      maxEpoch: session.maxEpoch,
      userSignature
    });
  }

  return {
    label,
    session,
    proof,
    address,
    signAndExecuteTransaction: async (txBytes: Uint8Array) => {
      const { getSuiClient } = await import("../web/src/lib/sui-client.ts");
      const { signature: userSignature } = await keypair.signTransaction(txBytes);
      const result = await getSuiClient().executeTransactionBlock({
        transactionBlock: toBase64(txBytes),
        signature: composite(await proof(), userSignature),
        options: { showEffects: true, showObjectChanges: true, showBalanceChanges: true, showEvents: true }
      });
      if (!Array.isArray(result.balanceChanges)) {
        throw new Error(`Sui transaction ${result.digest} did not include balanceChanges`);
      }
      const txStatus = result.effects?.status?.status ?? "unknown";
      const txError = result.effects?.status?.error;
      const balanceChanges = normalizeProductionAcceptanceBalanceChanges(result.balanceChanges);
      const events = normalizeAcceptanceEvents(result.events);
      recordAcceptanceTransaction(label, address, result.digest, balanceChanges, events.map((event) => event.type), txStatus, txError);
      const createdObjects: Array<{ objectId: string; objectType?: string }> = [];
      const createdObjectIds: string[] = [];
      for (const change of result.objectChanges || []) {
        const item = change as { type?: string; objectId?: string; objectType?: string };
        if (item.type === "created" && item.objectId) {
          createdObjects.push({ objectId: item.objectId, objectType: item.objectType });
          createdObjectIds.push(item.objectId);
        }
      }
      return {
        digest: result.digest,
        status: txStatus,
        error: txError,
        createdObjectIds,
        createdObjects,
        balanceChanges,
        events
      };
    },
    signPersonalMessage: async (message: Uint8Array) => {
      const { signature: userSignature } = await keypair.signPersonalMessage(message);
      return composite(await proof(), userSignature);
    }
  };
}

function recordAcceptanceTransaction(
  signerLabel: "buyer" | "agent",
  signerAddress: string,
  digest: string,
  balanceChanges: ProductionAcceptanceBalanceChange[],
  eventTypes: string[],
  txStatus: string,
  txError?: string
) {
  transactionLedger.set(digest, {
    digest,
    signerLabel,
    signerAddress,
    balanceChanges,
    suiSpentMist: String(productionAcceptanceSuiSpentMist(balanceChanges, signerAddress)),
    eventTypes,
    txStatus,
    ...(txError ? { txError } : {})
  });
}

function transactionSpendMeta(digest: string): Record<string, unknown> {
  const entry = transactionLedger.get(digest);
  if (!entry) return {};
  return {
    signer: entry.signerLabel,
    signerAddress: entry.signerAddress,
    suiSpentMist: entry.suiSpentMist,
    balanceChanges: entry.balanceChanges,
    eventTypes: entry.eventTypes,
    txStatus: entry.txStatus,
    ...(entry.txError ? { txError: entry.txError } : {})
  };
}

function normalizeAcceptanceEvents(raw: unknown): Array<{ type: string; parsedJson?: unknown }> {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((event) => {
    if (!event || typeof event !== "object") return [];
    const item = event as Record<string, unknown>;
    if (typeof item.type !== "string") return [];
    return [{ type: item.type, parsedJson: item.parsedJson }];
  });
}

async function validateBalance(
  label: string,
  owner: string,
  minimumMist: bigint
): Promise<{ balanceMist: bigint; minimumMist: bigint }> {
  const { getSuiClient } = await import("../web/src/lib/sui-client.ts");
  const coins = await getSuiClient().getCoins({ owner });
  const balance = coins.data.reduce((sum, coin) => sum + BigInt(coin.balance), 0n);
  if (balance < minimumMist) {
    throw new Error(`${label} balance ${balance} MIST is below required ${minimumMist} MIST`);
  }
  return { balanceMist: balance, minimumMist };
}

async function getCurrentEpoch(): Promise<number> {
  const { getSuiClient } = await import("../web/src/lib/sui-client.ts");
  const state = await getSuiClient().getLatestSuiSystemState({});
  return Number(state.epoch);
}

function installRuntimeConfig(config: ProductionAcceptanceConfig) {
  const defaults = DEFAULT_M3_CONFIG;
  const merged: M3Config = {
    ...defaults,
    network: config.network,
    suiRpcUrl: config.suiRpcUrl ?? defaults.suiRpcUrl,
    packageId: config.packageId ?? defaults.packageId,
    settlementConfigId: config.settlementConfigId ?? defaults.settlementConfigId,
    agentEarningsId: config.agentEarningsId ?? defaults.agentEarningsId,
    membershipReceiptRegistryId: config.membershipReceiptRegistryId ?? defaults.membershipReceiptRegistryId,
    walrusPublisherUrl: config.walrusPublisherUrl ?? defaults.walrusPublisherUrl,
    walrusAggregatorUrl: config.walrusAggregatorUrl ?? defaults.walrusAggregatorUrl,
    walrusEpochs: config.walrusEpochs ?? defaults.walrusEpochs,
    sealKeyServers: config.sealKeyServerObjectId
      ? [{
          objectId: config.sealKeyServerObjectId,
          weight: 1,
          aggregatorUrl: config.sealKeyServerAggregatorUrl
        }]
      : defaults.sealKeyServers,
    sealThreshold: config.sealThreshold ?? defaults.sealThreshold,
    platformMembershipPriceMist: String(config.platformMembershipPriceMist),
    agentSubscriptionPriceMist: String(config.agentSubscriptionPriceMist),
    delegationBudgetMist: String(config.delegationBudgetMist),
    membershipSettlementShareMist: String(config.membershipSettlementShareMist),
    accessDurationMs: config.accessDurationMs
  };
  (globalThis as unknown as { __RN_M3_CONFIG__: M3Config }).__RN_M3_CONFIG__ = merged;
}

function activeConfig(): M3Config {
  return (globalThis as unknown as { __RN_M3_CONFIG__: M3Config }).__RN_M3_CONFIG__;
}

function currentPeriod(): number {
  const d = new Date();
  return d.getUTCFullYear() * 100 + d.getUTCMonth() + 1;
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function reportEvidence(report: {
  id?: string;
  sui_object_id?: string;
  tx_digest?: string;
  seal_id?: string;
  walrus_blob_id?: string;
  walrus_readback_verified?: boolean;
  walrus_readback_bytes?: number;
  walrus_readback_hash?: string;
  ciphertext_hash?: string;
  plaintext_commitment?: string;
  visibility?: string;
}) {
  return {
    reportObjectId: report.sui_object_id || report.id,
    txDigest: report.tx_digest,
    sealId: report.seal_id,
    walrusBlobId: report.walrus_blob_id,
    walrusReadbackVerified: report.walrus_readback_verified,
    walrusReadbackBytes: report.walrus_readback_bytes,
    walrusReadbackHash: report.walrus_readback_hash,
    ciphertextHash: report.ciphertext_hash,
    plaintextCommitment: report.plaintext_commitment,
    visibility: report.visibility
  };
}

function decryptEvidence(
  report: Parameters<typeof reportEvidence>[0],
  accessPath: string,
  plaintext: string
) {
  return {
    ...reportEvidence(report),
    accessPath,
    plaintextBytes: new TextEncoder().encode(plaintext).length,
    plaintextMatched: true
  };
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

main().catch((error) => {
  console.error("production acceptance failed:", error);
  process.exit(1);
});
