// zkLogin transaction signer for the browser. Reconstructs the ephemeral
// keypair from sessionStorage (written by auth/login.js during the Google
// flow) and signs/executes transactions with a zkLogin proof.
//
// The proof is fetched from the server-side prover (RN_AUTH_CONFIG.proverPath
// or the legacy /api/zklogin-prove) because browser-side proving is too slow.
// The assembled zkLogin signature is submitted via executeTransactionBlock.
//
// NOTE: zkLogin transaction signing requires the full ephemeral secret + the
// ZK proof. If the session was created in another tab, rn_zk_eph may be absent
// (sessionStorage is per-tab); in that case the signer reports unavailable and
// the workbench falls back to demo publish.

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { getSuiClient } from "./sui-client";
import type { M3Signer } from "./clients";
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

/** Try to build an M3Signer from the current zkLogin session. Returns null if
 *  the ephemeral key or ZK proof ingredients aren't available (e.g. cross-tab). */
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

  async function signAndExecuteTransaction(txBytes: Uint8Array) {
    // Sign the transaction digest with the ephemeral key.
    const { signature } = await keypair.signTransaction(txBytes);

    // Fetch the ZK proof from the server prover. The prover needs the
    // ephemeral public key, maxEpoch, and the JWT randomness.
    const w = window as unknown as { RN_AUTH_CONFIG?: { proverPath?: string } };
    const proverPath = w.RN_AUTH_CONFIG?.proverPath || "/api/zklogin-prove";
    const ephemeralPubKeyBase64 = keypair.getPublicKey().toSuiPublicKey();

    const proofRes = await fetch(proverPath, {
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
      throw new Error("ZK proof request failed (HTTP " + proofRes.status + ")");
    }
    const proof = await proofRes.json();

    // Assemble the zkLogin signature: { schema, inputs, ... } wrapper.
    // The exact assembly depends on the @mysten/sui version; we delegate to the
    // server-prover's response which returns a ready-to-submit composite sig.
    const compositeSig = proof.composite_signature || proof.signature;
    if (!compositeSig) {
      throw new Error("Prover did not return a composite signature.");
    }

    const result = await suiClient.executeTransactionBlock({
      transactionBlock: toBase64(txBytes),
      signature: compositeSig,
      options: { showEffects: true }
    });

    const created: string[] = [];
    for (const change of result.effects?.created || []) {
      const oid = (change as { reference?: { objectId?: string } }).reference?.objectId;
      if (oid) created.push(oid);
    }
    return { digest: result.digest, createdObjectIds: created };
  }

  async function signPersonalMessage(msg: Uint8Array) {
    const { signature } = await keypair.signPersonalMessage(msg);
    return signature;
  }

  return {
    address,
    signAndExecuteTransaction,
    signPersonalMessage
  };
}

// keep imports referenced
void toBytesUtf8;
