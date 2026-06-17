// zkLogin transaction signer for the browser. Reconstructs the ephemeral
// keypair from sessionStorage (written by auth/login.js during the Google
// flow), fetches the ZK proof from the server prover, assembles the composite
// zkLogin signature via @mysten/sui getZkLoginSignature, and submits via
// executeTransactionBlock.
//
// Two-step composite signature (per @mysten/sui zklogin):
//   1. prover returns { proofPoints, ... } (the ZK proof)
//   2. getZkLoginSignature({ inputs: proof, maxEpoch, userSignature: ephemeralSig })
//      -> base64 composite signature string for executeTransactionBlock.

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { getZkLoginSignature } from "@mysten/sui/zklogin";
import { getSuiClient } from "./sui-client";
import type { M3BalanceChange, M3Event, M3Signer } from "./clients";
import { readSession } from "./storage";
import { toBase64, toBytesUtf8 } from "./crypto";

interface ZkEph {
  secret: string;
  randomness: string;
  maxEpoch: number;
  nonce: string;
}

interface ZkSession {
  id_token: string;
  salt: string;
  maxEpoch: number;
  randomness: string;
}

type ZkProofResponse = Record<string, any>;

/** Try to build an M3Signer from the current zkLogin session. Returns null if
 *  the ephemeral key or ZK session aren't available (e.g. cross-tab redirect). */
export async function buildZkLoginSigner(): Promise<M3Signer | null> {
  const session = readSession();
  if (!session?.address) return null;

  let eph: ZkEph | null = null;
  try {
    eph = JSON.parse(sessionStorage.getItem("rn_zk_eph") || "null");
  } catch {
    eph = null;
  }
  let zk: ZkSession | null = null;
  try {
    zk = JSON.parse(sessionStorage.getItem("rn_zk_session") || "null");
  } catch {
    zk = null;
  }
  if (!eph?.secret || !zk?.id_token) return null;

  const keypair = Ed25519Keypair.fromSecretKey(eph.secret);
  const address = session.address;
  const suiClient = getSuiClient();

  async function fetchZkProof(): Promise<ZkProofResponse> {
    const ephemeralPubKeyBase64 = keypair.getPublicKey().toSuiPublicKey();
    const proofRes = await fetch("/api/zklogin-prove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jwt: zk!.id_token,
        extended_ephemeral_public_key: ephemeralPubKeyBase64,
        max_epoch: String(zk!.maxEpoch),
        jwt_randomness: zk!.randomness,
        salt: zk!.salt
      })
    });
    if (!proofRes.ok) {
      const err = await proofRes.text().catch(() => "");
      throw new Error("ZK proof request failed (HTTP " + proofRes.status + "): " + err);
    }
    return await proofRes.json();
  }

  function toCompositeSignature(proof: ZkProofResponse, userSignature: string) {
    // Prover returns the full proof inputs object ({ proofPoints, issBase64Details,
    // headerBase64, addressSeed }). Pass it straight to getZkLoginSignature.
    return getZkLoginSignature({
      inputs: {
        proofPoints: proof.proofPoints ?? proof.proof_points,
        issBase64Details: proof.issBase64Details ?? proof.iss_base64_details,
        headerBase64: proof.headerBase64 ?? proof.header_base64,
        addressSeed: proof.addressSeed ?? proof.address_seed
      },
      maxEpoch: zk!.maxEpoch,
      userSignature
    });
  }

  async function signAndExecuteTransaction(txBytes: Uint8Array) {
    // 1. Sign the transaction bytes with the ephemeral key.
    const { signature: userSignature } = await keypair.signTransaction(txBytes);

    // 2. Fetch the ZK proof from the server prover (URL kept server-side), then
    // combine it with the ephemeral transaction signature.
    const compositeSig = toCompositeSignature(await fetchZkProof(), userSignature);

    // 3. Execute the signed transaction.
    const result = await suiClient.executeTransactionBlock({
      transactionBlock: toBase64(txBytes),
      signature: compositeSig,
      options: { showEffects: true, showObjectChanges: true, showBalanceChanges: true, showEvents: true }
    });

    const created: string[] = [];
    const createdObjects: Array<{ objectId: string; objectType?: string }> = [];
    for (const change of result.objectChanges || []) {
      const item = change as { type?: string; objectId?: string; objectType?: string };
      if (item.type === "created" && item.objectId) {
        createdObjects.push({ objectId: item.objectId, objectType: item.objectType });
      }
    }
    for (const change of result.effects?.created || []) {
      const oid = (change as { reference?: { objectId?: string } }).reference?.objectId;
      if (oid) created.push(oid);
    }
    return {
      digest: result.digest,
      status: result.effects?.status?.status ?? "unknown",
      error: result.effects?.status?.error,
      createdObjectIds: createdObjects.map((obj) => obj.objectId).concat(created),
      createdObjects,
      balanceChanges: normalizeBalanceChanges(result.balanceChanges),
      events: normalizeEvents(result.events)
    };
  }

  async function signPersonalMessage(msg: Uint8Array) {
    const { signature: userSignature } = await keypair.signPersonalMessage(msg);
    return toCompositeSignature(await fetchZkProof(), userSignature);
  }

  return { address, signAndExecuteTransaction, signPersonalMessage };
}

function normalizeBalanceChanges(raw: unknown): M3BalanceChange[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((change) => {
    if (!change || typeof change !== "object") return [];
    const item = change as Record<string, unknown>;
    const coinType = item.coinType;
    const amount = item.amount;
    if (typeof coinType !== "string" || typeof amount !== "string") return [];
    return [{
      owner: balanceChangeOwner(item.owner ?? item.address),
      coinType,
      amount
    }];
  });
}

function balanceChangeOwner(owner: unknown): string | undefined {
  if (typeof owner === "string") return owner;
  if (!owner || typeof owner !== "object") return undefined;
  const record = owner as Record<string, unknown>;
  if (typeof record.AddressOwner === "string") return record.AddressOwner;
  if (typeof record.ObjectOwner === "string") return record.ObjectOwner;
  if (record.ConsensusAddressOwner && typeof record.ConsensusAddressOwner === "object") {
    const consensus = record.ConsensusAddressOwner as Record<string, unknown>;
    if (typeof consensus.owner === "string") return consensus.owner;
  }
  if (typeof record.address === "string") return record.address;
  if (typeof record.owner === "string") return record.owner;
  return undefined;
}

function normalizeEvents(raw: unknown): M3Event[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((event) => {
    if (!event || typeof event !== "object") return [];
    const item = event as Record<string, unknown>;
    if (typeof item.type !== "string") return [];
    return [{ type: item.type, parsedJson: item.parsedJson }];
  });
}

void toBytesUtf8;
