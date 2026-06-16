// Real Seal encrypt/decrypt client. Per SUI_Seal_SKILL.md:
//  - encrypt on publish: SealClient.encrypt({ threshold, packageId, id, data }) ->
//    returns { encryptedObject, key } (bcs ciphertext + 256-bit symmetric key).
//  - decrypt on read: build a SessionKey (signs the personal message that
//    authorizes the ephemeral session), build a seal_approve PTB, then call
//    SealClient.decrypt({ data, txBytes, sessionKey }).
// The PTB calls the policy function in access.move; the key-server committee
// re-executes it and only returns shares if it does not abort.
//
// id = report object id bytes (the M3-0 decision). At publish time the report
// object doesn't exist yet, so publish does a dry-run to reserve the object id,
// encrypts under that id, then publishes for real.

import { SealClient } from "@mysten/seal";
import { SessionKey } from "@mysten/seal";
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

/** Decrypt a Seal ciphertext. Creates a SessionKey (signed by the caller),
 *  builds the seal_approve PTB, and asks the committee for key shares.
 *  Returns null if access is denied (shares < threshold). */
export async function sealDecrypt(args: {
  ciphertext: Uint8Array;
  reportObjectId: string;
  moduleFn: Parameters<typeof buildSealApprove>[0]["moduleFn"];
  passObjectId?: string;
  delegationJobId?: string;
  signerAddress: string;
  signPersonalMessage: (msg: Uint8Array) => Promise<string>;
}): Promise<Uint8Array | null> {
  const config = loadM3Config();
  const client = getSealClient();
  const suiClient = getSuiClient();

  // SessionKey authorizes an ephemeral decryption session for this package.
  const sessionKey = await SessionKey.create({
    address: args.signerAddress,
    packageId: config.packageId,
    ttlMin: 10,
    suiClient
  });
  // Sign the session personal message with the user's zkLogin key.
  await sessionKey.setPersonalMessageSignature(await args.signPersonalMessage(sessionKey.getPersonalMessage()));

  // id = report object id bytes; the policy asserts id == report.id.to_bytes().
  const idBytes = objectIdToBytes(args.reportObjectId);
  const tx = buildSealApprove({
    packageId: config.packageId,
    moduleFn: args.moduleFn,
    reportObjectId: args.reportObjectId,
    id: idBytes,
    passObjectId: args.passObjectId,
    delegationJobId: args.delegationJobId
  });
  tx.setSender(args.signerAddress);
  const txBytes = await tx.build({ client: suiClient });

  try {
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
