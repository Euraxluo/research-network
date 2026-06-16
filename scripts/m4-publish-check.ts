/**
 * M4 round-trip check: publishes a REAL public report on testnet using a plain
 * Ed25519 keypair (no zkLogin — that path needs a browser + Google login).
 * Verifies the on-chain half of M3: Walrus upload + Sui publish + object creation.
 *
 * Run: npx tsx scripts/m4-publish-check.ts
 */
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PACKAGE_ID = "0x97ea53589f599affc946b747ca71e1918cfadc10ca1313d453671f033fc2c5aa";
const CLOCK_ID = "0x6";

async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = new ArrayBuffer(data.byteLength);
  new Uint8Array(buf).set(data);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(digest);
  return "0x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, "");
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < h.length; i += 2) bytes[i / 2] = parseInt(h.slice(i, i + 2), 16);
  return bytes;
}

function b64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

async function main() {
  // Load the funded active keypair from the Sui CLI keystore (has testnet SUI).
  // keystore entries are base64 of [flag:u8 (0=Ed25519) | seed:32 bytes].
  const keystorePath = join(homedir(), ".sui", "sui_config", "sui.keystore");
  const keystore = JSON.parse(readFileSync(keystorePath, "utf8")) as string[];
  const flagAndSeed = Buffer.from(keystore[0], "base64");
  const scheme = flagAndSeed[0]; // 0 = Ed25519
  const seed = flagAndSeed.subarray(1);
  if (scheme !== 0) throw new Error("keystore key is not Ed25519 (scheme " + scheme + ")");
  const keypair = Ed25519Keypair.fromSecretKey(seed);
  const address = keypair.getPublicKey().toSuiAddress();
  console.log("Test address:", address);

  const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl("testnet"), network: "testnet" });

  // Check gas
  const coins = await client.getCoins({ owner: address });
  const balance = coins.data.reduce((sum, c) => sum + BigInt(c.balance), 0n);
  console.log("SUI balance:", balance.toString());
  if (balance === 0n) {
    console.log("ERROR: no gas.");
    process.exit(1);
  }

  // 1. Walrus upload via publisher relay (no gas needed; relay certifies).
  console.log("\n1. Uploading report body to Walrus (publisher relay)...");
  const body = new TextEncoder().encode("M4 round-trip test report body. " + new Date().toISOString());
  const pubRes = await fetch("https://publisher.walrus-testnet.walrus.space/v1/blobs?epochs=5", {
    method: "PUT",
    body
  });
  if (!pubRes.ok) throw new Error("Walrus upload failed: " + pubRes.status);
  const upload = await pubRes.json();
  const entry = upload.newlyCreated?.blobObject || upload.alreadyCertified;
  const blobId = entry?.blobId;
  if (!blobId) throw new Error("No blobId in upload response: " + JSON.stringify(upload));
  console.log("   Walrus blobId:", blobId);

  // 2. Build commitments
  const plaintextCommitment = await sha256Hex(body);
  const preview = new TextEncoder().encode("M4 public preview");
  const freePreviewHash = await sha256Hex(preview);

  // 3. Build + sign + execute publish_public_report
  console.log("\n2. Publishing on Sui (report::publish_public_report)...");
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::report::publish_public_report`,
    arguments: [
      tx.pure.vector("u8", Array.from(b64urlToBytes(blobId))),
      tx.pure.vector("u8", Array.from(hexToBytes(plaintextCommitment))),
      tx.pure.vector("u8", Array.from(hexToBytes(freePreviewHash))),
      tx.object(CLOCK_ID)
    ]
  });
  tx.setSender(address);

  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showEffects: true, showObjectChanges: true }
  });
  console.log("   tx digest:", result.digest);
  console.log("   status:", result.effects?.status?.status);

  const created = (result.objectChanges || []).filter((c) => c.type === "created");
  console.log("   created objects:", created.length);
  for (const c of created) {
    if (c.type === "created") {
      console.log("     -", c.objectType, c.objectId);
    }
  }

  // 4. Verify: read the report back from chain
  if (created.length > 0) {
    const reportId = (created[0] as { objectId: string }).objectId;
    console.log("\n3. Verifying report on chain...");
    const obj = await client.getObject({ id: reportId, options: { showContent: true, showType: true } });
    console.log("   type:", obj.data?.type);
    console.log("   content present:", !!obj.data?.content);
    console.log("\n✅ M4 round-trip SUCCESS: Walrus upload + Sui publish verified.");
  }
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
