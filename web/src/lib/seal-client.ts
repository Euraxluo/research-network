// Real Seal encrypt/decrypt client. Per SUI_Seal_SKILL.md:
//  - encrypt on publish: SealClient.encrypt({ threshold, packageId, id, data }) ->
//    returns { encryptedObject, key } (bcs ciphertext + 256-bit symmetric key).
//  - decrypt on read: build a SessionKey (signs the personal message that
//    authorizes the ephemeral session), build a seal_approve PTB, then call
//    SealClient.decrypt({ data, txBytes, sessionKey }).
// The PTB calls the policy function in access.move; the key-server committee
// re-executes it and only returns shares if it does not abort.

import { SealClient, SessionKey, EncryptedObject } from "@mysten/seal";
import { loadM3Config } from "./config";
import { getSuiClient, buildSealApprove } from "./sui-client";

let sealClient: SealClient | null = null;

export function getSealClient(): SealClient {
  if (!sealClient) {
    const config = loadM3Config();
    sealClient = new SealClient({
      suiClient: getSuiClient(),
      serverConfigs: config.sealKeyServers.map((s) => ({
        objectId: s.objectId,
        aggregatorUrl: s.aggregatorUrl,
        weight: s.weight
      }))
    } as ConstructorParameters<typeof SealClient>[0]);
  }
  return sealClient;
}

export interface SealEncryptResult {
  ciphertext: Uint8Array;
  symmetricKey: Uint8Array;
}

/** Encrypt plaintext under a Seal identity. `id` is the identity bytes (hex
 *  string form is what the SDK expects). */
export async function sealEncrypt(plaintext: Uint8Array, idHex: string): Promise<SealEncryptResult> {
  const config = loadM3Config();
  const client = getSealClient();
  const { encryptedObject, key } = await client.encrypt({
    threshold: config.sealThreshold,
    packageId: config.packageId,
    id: idHex,
    data: plaintext
  });
  return { ciphertext: encryptedObject, symmetricKey: key };
}

/** Decrypt a Seal ciphertext. Follows the official two-step pattern from
 *  MystenLabs/seal examples/frontend/src/utils.ts:
 *   1. fetchKeys — asks the key-server committee to run seal_approve and cache shares.
 *   2. decrypt  — local AES-GCM decryption using the cached derived key.
 *  Both steps use the same txBytes (the seal_approve PTB, built with
 *  onlyTransactionKind:true so the key server doesn't need gas/sender). */
export async function sealDecrypt(args: {
  ciphertext: Uint8Array;
  reportObjectId: string;
  moduleFn: Parameters<typeof buildSealApprove>[0]["moduleFn"];
  passObjectId?: string;
  delegationJobId?: string;
  expectedSealId?: string;
  signerAddress: string;
  signPersonalMessage: (msg: Uint8Array) => Promise<string>;
}): Promise<Uint8Array | null> {
  const config = loadM3Config();
  const client = getSealClient();
  const suiClient = getSuiClient();

  // The Seal identity is embedded in the encrypted object by sealEncrypt.
  // We read it so the PTB passes the same id that was used at encryption time.
  const encryptedObject = EncryptedObject.parse(args.ciphertext);
  const sealIdHex = encryptedObject.id;
  if (args.expectedSealId && normalizeHex(args.expectedSealId) !== normalizeHex(sealIdHex)) {
    return null;
  }

  // SessionKey authorizes an ephemeral decryption session for this package.
  const sessionKey = await SessionKey.create({
    address: args.signerAddress,
    packageId: config.packageId,
    ttlMin: 10,
    suiClient
  });
  await sessionKey.setPersonalMessageSignature(await args.signPersonalMessage(sessionKey.getPersonalMessage()));

  // Build the seal_approve PTB with the Seal identity embedded in the ciphertext.
  // The Move policy asserts this id equals report::seal_id(report).
  const idBytes = objectIdToBytes(sealIdHex);
  const tx = buildSealApprove({
    packageId: config.packageId,
    moduleFn: args.moduleFn,
    reportObjectId: args.reportObjectId,
    id: idBytes,
    passObjectId: args.passObjectId,
    delegationJobId: args.delegationJobId
  });
  // Key servers only need the transaction kind, not a sender/gas budget.
  const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });

  try {
    // Step 1: fetch + cache the derived key shares from the committee.
    await client.fetchKeys({
      ids: [sealIdHex],
      txBytes,
      sessionKey,
      threshold: config.sealThreshold
    });
    // Step 2: local decryption with the cached key.
    const plaintext = await client.decrypt({
      data: args.ciphertext,
      txBytes,
      sessionKey
    });
    return plaintext as Uint8Array;
  } catch {
    return null; // committee denied (shares < threshold) or network error
  }
}

function normalizeHex(value: string): string {
  const raw = value.trim().toLowerCase();
  const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
  return "0x" + hex.padStart(64, "0");
}

/** hex string (0x...) -> byte array for object ids. */
export function objectIdToBytes(objectIdHex: string): Uint8Array {
  const hex = objectIdHex.replace(/^0x/, "");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/** byte array -> hex string with 0x prefix (Seal id format). */
export function bytesToObjectId(bytes: Uint8Array): string {
  return "0x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
