// Shared Sui JSON-RPC client + Transaction helpers for the M3 client layer.
// Targets @mysten/sui@2.18.0 (gRPC-core refactor): SuiJsonRpcClient replaces the
// old SuiClient, and the new Transaction builder uses {package, module, function}
// moveCall args and a `pure` builder (tx.pure.vector("u8", arr)).

import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { loadM3Config } from "./config.js";

let cachedClient: SuiJsonRpcClient | null = null;

export function getSuiClient(): SuiJsonRpcClient {
  if (!cachedClient) {
    const config = loadM3Config();
    const network = config.network === "devnet" ? "testnet" : config.network;
    cachedClient = new SuiJsonRpcClient({
      url: config.suiRpcUrl || getJsonRpcFullnodeUrl(network),
      network
    } as ConstructorParameters<typeof SuiJsonRpcClient>[0]);
  }
  return cachedClient;
}

/** Build a publish_public_report PTB. */
export function buildPublishPublicReport(args: {
  walrusBlobId: Uint8Array;
  plaintextCommitment: Uint8Array;
  freePreviewHash: Uint8Array;
  packageId: string;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${args.packageId}::report::publish_public_report`,
    arguments: [
      tx.pure.vector("u8", Array.from(args.walrusBlobId)),
      tx.pure.vector("u8", Array.from(args.plaintextCommitment)),
      tx.pure.vector("u8", Array.from(args.freePreviewHash)),
      tx.object("0x6")
    ]
  });
  return tx;
}

/** Build a publish_encrypted_report PTB. sealId is the publisher-chosen Seal
 *  identity stored in the report and embedded in the ciphertext. */
export function buildPublishEncryptedReport(args: {
  walrusBlobId: Uint8Array;
  sealId: Uint8Array;
  ciphertextHash: Uint8Array;
  plaintextCommitment: Uint8Array;
  freePreviewHash: Uint8Array;
  requiredTier: number;
  packageId: string;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${args.packageId}::report::publish_encrypted_report`,
    arguments: [
      tx.pure.vector("u8", Array.from(args.walrusBlobId)),
      tx.pure.vector("u8", Array.from(args.sealId)),
      tx.pure.vector("u8", Array.from(args.ciphertextHash)),
      tx.pure.vector("u8", Array.from(args.plaintextCommitment)),
      tx.pure.vector("u8", Array.from(args.freePreviewHash)),
      tx.pure.u8(args.requiredTier),
      tx.object("0x6")
    ]
  });
  return tx;
}

/** Publish a private delegation result. */
export function buildPublishPrivateResult(args: {
  jobObjectId: string;
  walrusBlobId: Uint8Array;
  sealId: Uint8Array;
  ciphertextHash: Uint8Array;
  plaintextCommitment: Uint8Array;
  freePreviewHash: Uint8Array;
  packageId: string;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${args.packageId}::report::publish_private_result`,
    arguments: [
      tx.object(args.jobObjectId),
      tx.pure.vector("u8", Array.from(args.walrusBlobId)),
      tx.pure.vector("u8", Array.from(args.sealId)),
      tx.pure.vector("u8", Array.from(args.ciphertextHash)),
      tx.pure.vector("u8", Array.from(args.plaintextCommitment)),
      tx.pure.vector("u8", Array.from(args.freePreviewHash)),
      tx.object("0x6")
    ]
  });
  return tx;
}

export function buildBuyPlatformMembership(args: {
  configObjectId: string;
  paymentMist: string | number | bigint;
  tier: number;
  durationMs: number;
  packageId: string;
}): Transaction {
  const tx = new Transaction();
  const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(args.paymentMist)]);
  tx.moveCall({
    target: `${args.packageId}::settlement::buy_platform_membership`,
    arguments: [
      tx.object(args.configObjectId),
      payment,
      tx.pure.u8(args.tier),
      tx.pure.u64(args.durationMs),
      tx.object("0x6")
    ]
  });
  return tx;
}

export function buildBuyAgentSubscription(args: {
  configObjectId: string;
  earningsObjectId: string;
  agent: string;
  paymentMist: string | number | bigint;
  tier: number;
  durationMs: number;
  packageId: string;
}): Transaction {
  const tx = new Transaction();
  const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(args.paymentMist)]);
  tx.moveCall({
    target: `${args.packageId}::settlement::buy_agent_subscription`,
    arguments: [
      tx.object(args.configObjectId),
      tx.object(args.earningsObjectId),
      tx.pure.address(args.agent),
      payment,
      tx.pure.u8(args.tier),
      tx.pure.u64(args.durationMs),
      tx.object("0x6")
    ]
  });
  return tx;
}

export function buildCreateDelegationJob(args: {
  agent: string;
  questionHash: Uint8Array;
  sourceArtifactHash: Uint8Array;
  budgetMist: string | number | bigint;
  deadlineMs: number;
  packageId: string;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${args.packageId}::delegation::create_delegation_job`,
    arguments: [
      tx.pure.address(args.agent),
      tx.pure.vector("u8", Array.from(args.questionHash)),
      tx.pure.vector("u8", Array.from(args.sourceArtifactHash)),
      tx.pure.u64(args.budgetMist),
      tx.pure.u64(args.deadlineMs),
      tx.object("0x6")
    ]
  });
  return tx;
}

export function buildAcceptDelegationJob(args: { jobObjectId: string; packageId: string }): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${args.packageId}::delegation::accept_delegation_job`,
    arguments: [tx.object(args.jobObjectId), tx.object("0x6")]
  });
  return tx;
}

export function buildFundDelegationJob(args: {
  jobObjectId: string;
  budgetMist: string | number | bigint;
  packageId: string;
}): Transaction {
  const tx = new Transaction();
  const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(args.budgetMist)]);
  tx.moveCall({
    target: `${args.packageId}::delegation::fund_delegation_job`,
    arguments: [
      tx.object(args.jobObjectId),
      payment,
      tx.pure.u64(args.budgetMist),
      tx.object("0x6")
    ]
  });
  return tx;
}

export function buildCompleteDelegationJob(args: { jobObjectId: string; packageId: string }): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${args.packageId}::delegation::complete_delegation_job`,
    arguments: [tx.object(args.jobObjectId), tx.object("0x6")]
  });
  return tx;
}

export function buildOpenDispute(args: {
  jobObjectId: string;
  arbitrator: string;
  reasonHash: Uint8Array;
  packageId: string;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${args.packageId}::delegation::open_dispute`,
    arguments: [
      tx.object(args.jobObjectId),
      tx.pure.address(args.arbitrator),
      tx.pure.vector("u8", Array.from(args.reasonHash)),
      tx.object("0x6")
    ]
  });
  return tx;
}

export function buildRecordPlatformAccessReceipt(args: {
  registryObjectId: string;
  passObjectId: string;
  reportObjectId: string;
  periodId: number;
  packageId: string;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${args.packageId}::settlement::record_platform_access_receipt`,
    arguments: [
      tx.object(args.registryObjectId),
      tx.object(args.passObjectId),
      tx.object(args.reportObjectId),
      tx.pure.u64(args.periodId),
      tx.object("0x6")
    ]
  });
  return tx;
}

export function buildSettleMembershipReport(args: {
  earningsObjectId: string;
  receiptObjectId: string;
  amountMist: string | number | bigint;
  reportCount: number;
  packageId: string;
}): Transaction {
  const tx = new Transaction();
  const [share] = tx.splitCoins(tx.gas, [tx.pure.u64(args.amountMist)]);
  tx.moveCall({
    target: `${args.packageId}::settlement::settle_membership_report`,
    arguments: [
      tx.object(args.earningsObjectId),
      tx.object(args.receiptObjectId),
      share,
      tx.pure.u64(args.reportCount),
      tx.object("0x6")
    ]
  });
  return tx;
}

export function buildClaimAgentEarnings(args: { earningsObjectId: string; packageId: string }): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${args.packageId}::settlement::claim_agent_earnings`,
    arguments: [tx.object(args.earningsObjectId), tx.object("0x6")]
  });
  return tx;
}

/** Build a Seal approve PTB. The key server committee re-executes the policy
 *  function (seal_approve_*) from this transaction to derive key shares. */
export function buildSealApprove(args: {
  packageId: string;
  moduleFn:
    | "seal_approve_report_author"
    | "seal_approve_report_with_platform_membership"
    | "seal_approve_report_with_agent_subscription"
    | "seal_approve_private_result";
  reportObjectId: string;
  id: Uint8Array;
  passObjectId?: string;
  delegationJobId?: string;
}): Transaction {
  const tx = new Transaction();
  const callArgs = [
    tx.pure.vector("u8", Array.from(args.id)),
    tx.object(args.reportObjectId)
  ];
  if (
    args.moduleFn === "seal_approve_report_with_platform_membership" ||
    args.moduleFn === "seal_approve_report_with_agent_subscription"
  ) {
    if (!args.passObjectId) throw new Error(`${args.moduleFn} requires passObjectId`);
    callArgs.push(tx.object(args.passObjectId), tx.object("0x6"));
  } else if (args.moduleFn === "seal_approve_private_result") {
    if (!args.delegationJobId) throw new Error("seal_approve_private_result requires delegationJobId");
    callArgs.push(tx.object(args.delegationJobId));
  }
  tx.moveCall({
    target: `${args.packageId}::access::${args.moduleFn}`,
    arguments: callArgs
  });
  return tx;
}
