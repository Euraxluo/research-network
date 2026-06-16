// Shared Sui JSON-RPC client + Transaction helpers for the M3 client layer.
// Targets @mysten/sui@2.18.0 (gRPC-core refactor): SuiJsonRpcClient replaces the
// old SuiClient, and the new Transaction builder uses {package, module, function}
// moveCall args and a `pure` builder (tx.pure.vector("u8", arr)).

import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { loadM3Config } from "./config";

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

/** Build a publish_encrypted_report PTB. sealId = report object id bytes
 *  (the M3-0 id = report object id decision). */
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

/** Build a Seal approve PTB. The key server committee re-executes the policy
 *  function (seal_approve_*) from this transaction to derive key shares. */
export function buildSealApprove(args: {
  packageId: string;
  moduleFn:
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
  if (args.passObjectId) callArgs.push(tx.object(args.passObjectId));
  if (args.delegationJobId) callArgs.push(tx.object(args.delegationJobId));
  callArgs.push(tx.object("0x6"));
  tx.moveCall({
    target: `${args.packageId}::access::${args.moduleFn}`,
    arguments: callArgs
  });
  return tx;
}
