// Real Walrus upload/read client. Per SUI_Walrus_SKILL.md:
//  - upload uses WalrusClient.writeBlob({ blob, deletable, epochs, signer }) which
//    internally does register -> upload -> certify (3 steps) to avoid wallet popup
//    blocking. On testnet the public publisher relay covers storage gas.
//  - read uses the aggregator: WalrusClient.readBlob({ blobId }).
// Returns the walrus blob id so it can be stored on-chain in the report.

import { WalrusClient } from "@mysten/walrus";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { loadM3Config } from "./config";
import { getSuiClient } from "./sui-client";

export interface WalrusUploadResult {
  blobId: string;
  blobObjectId?: string;
}

let walrusClient: WalrusClient | null = null;

export function getWalrusClient(): WalrusClient {
  if (!walrusClient) {
    const config = loadM3Config();
    walrusClient = new WalrusClient({
      network: config.network === "devnet" ? "testnet" : config.network,
      suiClient: getSuiClient(),
      storageNodeClientOptions: {
        aggregator: config.walrusAggregatorUrl,
        publisher: config.walrusPublisherUrl
      } as never
    });
  }
  return walrusClient;
}

/** Upload raw bytes to Walrus. Uses an ephemeral signer; on testnet the public
 *  publisher relay covers storage, so no real gas is needed. */
export async function uploadBlob(data: Uint8Array): Promise<WalrusUploadResult> {
  const config = loadM3Config();
  const client = getWalrusClient();
  const signer = new Ed25519Keypair();
  const result = await client.writeBlob({
    blob: data,
    deletable: false,
    epochs: config.walrusEpochs,
    signer
  });
  return {
    blobId: result.blobId,
    blobObjectId: result.blobObject?.id
  };
}

/** Read a blob from Walrus via the aggregator. */
export async function readBlob(blobId: string): Promise<Uint8Array | null> {
  const client = getWalrusClient();
  try {
    const blob = await client.readBlob({ blobId });
    return blob ?? null;
  } catch {
    return null;
  }
}

/** Convert a Walrus base64 blob id to bytes (for the vector<u8> Move arg). */
export function blobIdToBytes(blobIdBase64: string): Uint8Array {
  const binary = atob(blobIdBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
