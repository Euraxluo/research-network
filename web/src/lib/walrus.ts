// Real Walrus upload/read client.
//  - upload uses the publisher HTTP relay (PUT /v1/blobs) which certifies storage
//    without requiring client Sui gas — verified reliable on testnet in M4.
//    The SDK's writeBlob path (needs a Sui tx per upload) was flaky.
//  - read uses the aggregator HTTP endpoint: GET /v1/blobs/<id>.

import { WalrusClient } from "@mysten/walrus";
import { loadM3Config } from "./config.js";
import { getSuiClient } from "./sui-client.js";

export interface WalrusUploadResult {
  blobId: string;
  blobObjectId?: string;
}

let walrusClient: WalrusClient | null = null;

function shouldUseWalrusProxy(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

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

/** Upload raw bytes to Walrus via the publisher relay. The relay certifies
 *  storage (no client gas needed on testnet), which is more reliable than the
 *  SDK's writeBlob path that needs a Sui tx per upload. Verified in M4. */
export async function uploadBlob(data: Uint8Array): Promise<WalrusUploadResult> {
  const config = loadM3Config();
  if (shouldUseWalrusProxy()) {
    const res = await fetch(`/api/walrus-blob?epochs=${encodeURIComponent(String(config.walrusEpochs))}`, {
      method: "PUT",
      body: data as unknown as BodyInit
    });
    if (!res.ok) throw new Error("Walrus upload failed: HTTP " + res.status);
    const json = (await res.json()) as {
      newlyCreated?: { blobObject?: { blobId?: string; id?: string } };
      alreadyCertified?: { blobId?: string };
    };
    const entry = json.newlyCreated?.blobObject || json.alreadyCertified;
    const blobId = entry?.blobId;
    if (!blobId) throw new Error("No blobId in upload response");
    return { blobId, blobObjectId: json.newlyCreated?.blobObject?.id };
  }
  const res = await fetch(`${config.walrusPublisherUrl}/v1/blobs?epochs=${config.walrusEpochs}`, {
    method: "PUT",
    body: data as unknown as BodyInit
  });
  if (!res.ok) throw new Error("Walrus upload failed: HTTP " + res.status);
  const json = (await res.json()) as {
    newlyCreated?: { blobObject?: { blobId?: string; id?: string } };
    alreadyCertified?: { blobId?: string };
  };
  const entry = json.newlyCreated?.blobObject || json.alreadyCertified;
  const blobId = entry?.blobId;
  if (!blobId) throw new Error("No blobId in upload response");
  return { blobId, blobObjectId: json.newlyCreated?.blobObject?.id };
}

/** Read a blob from Walrus via the aggregator. */
export async function readBlob(blobId: string): Promise<Uint8Array | null> {
  if (shouldUseWalrusProxy()) {
    try {
      const res = await fetch(`/api/walrus-blob?blobId=${encodeURIComponent(blobId)}`);
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      return null;
    }
  }
  const client = getWalrusClient();
  try {
    const blob = await client.readBlob({ blobId });
    return blob ?? null;
  } catch {
    return null;
  }
}

/** Convert a Walrus base64url blob id to bytes (for the vector<u8> Move arg). */
export function blobIdToBytes(blobIdBase64: string): Uint8Array {
  const b64 = blobIdBase64.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
