/**
 * M4-2 encrypted round-trip on the M4-2 package (seal_approve asserts
 * id == report::seal_id, the publisher-chosen field).
 *
 * Flow (no chicken-and-egg — seal_id is chosen before publish):
 *   1. generate a deterministic seal_id (random 32 bytes)
 *   2. SealClient.encrypt(plaintext, id = seal_id)
 *   3. upload ciphertext to Walrus
 *   4. publish_encrypted_report(walrus_blob_id, seal_id, ...) on Sui
 *   5. SessionKey + seal_approve PTB(id=seal_id, report) + fetchKeys + decrypt
 *
 * Run: npx tsx scripts/m4-encrypted-check.ts
 */
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { SealClient, SessionKey, EncryptedObject } from "@mysten/seal";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_M3_CONFIG } from "../web/src/lib/config.ts";

const NETWORK = env("RN_NETWORK", DEFAULT_M3_CONFIG.network);
const PACKAGE_ID = env("RN_PACKAGE_ID", DEFAULT_M3_CONFIG.packageId);
const CLOCK_ID = "0x6";
const SEAL_KEY_SERVER = env("RN_SEAL_KEY_SERVER_OBJECT_ID", DEFAULT_M3_CONFIG.sealKeyServers[0]?.objectId || "");
const SEAL_KEY_SERVER_URL = env(
  "RN_SEAL_KEY_SERVER_AGGREGATOR_URL",
  DEFAULT_M3_CONFIG.sealKeyServers[0]?.aggregatorUrl || ""
);
const SEAL_THRESHOLD = Number(env("RN_SEAL_THRESHOLD", String(DEFAULT_M3_CONFIG.sealThreshold)));
const WALRUS_PUBLISHER = env("RN_WALRUS_PUBLISHER_URL", DEFAULT_M3_CONFIG.walrusPublisherUrl);
const WALRUS_AGGREGATOR = env("RN_WALRUS_AGGREGATOR_URL", DEFAULT_M3_CONFIG.walrusAggregatorUrl);
const WALRUS_EPOCHS = Number(env("RN_WALRUS_EPOCHS", String(DEFAULT_M3_CONFIG.walrusEpochs)));
const SUI_RPC_URL = env("RN_SUI_RPC_URL", DEFAULT_M3_CONFIG.suiRpcUrl);

async function sha256Hex(d: Uint8Array): Promise<string> {
  const b = new ArrayBuffer(d.byteLength); new Uint8Array(b).set(d);
  const dig = await crypto.subtle.digest("SHA-256", b);
  return "0x" + Array.from(new Uint8Array(dig)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
function hexToBytes(h: string): Uint8Array {
  const s = h.replace(/^0x/, ""); const b = new Uint8Array(s.length / 2);
  for (let i = 0; i < s.length; i += 2) b[i / 2] = parseInt(s.slice(i, i + 2), 16);
  return b;
}
function b64urlToBytes(u: string): Uint8Array {
  return Uint8Array.from(Buffer.from(u.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
}
function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}
function normalizePackageId(packageId: string | undefined): string | undefined {
  return packageId?.trim().toLowerCase();
}
function movePackageId(type: string | undefined): string | undefined {
  if (!type) return undefined;
  return normalizePackageId(type.split("::", 1)[0]);
}
function moveStructName(type: string | undefined): string | undefined {
  if (!type) return undefined;
  return type.split("<", 1)[0]?.split("::").pop();
}
function createdObjectId(
  changes: unknown[] | undefined,
  typeHint: string,
  packageId: string
): string {
  const typed = changes?.find((change) => {
    const item = change as { type?: string; objectType?: string; objectId?: string };
    return item.type === "created" &&
      typeof item.objectId === "string" &&
      moveStructName(item.objectType) === typeHint &&
      movePackageId(item.objectType) === normalizePackageId(packageId);
  }) as { objectId?: string } | undefined;
  if (!typed?.objectId) {
    throw new Error(`Sui transaction succeeded but did not return a typed ${typeHint} object from configured package ${packageId}`);
  }
  return typed.objectId;
}
function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
async function readWalrusBlob(blobId: string): Promise<Uint8Array> {
  const res = await fetch(`${WALRUS_AGGREGATOR}/v1/blobs/${blobId}`);
  if (!res.ok) throw new Error(`Walrus readback failed: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function main() {
  if (NETWORK !== "testnet" && process.env.RN_ALLOW_M4_MAINNET !== "1") {
    throw new Error("m4-encrypted-check defaults to testnet; set RN_ALLOW_M4_MAINNET=1 for non-testnet smoke only");
  }
  if (!PACKAGE_ID || !SEAL_KEY_SERVER || !SEAL_KEY_SERVER_URL) {
    throw new Error("missing package or Seal key-server config");
  }
  const ks = JSON.parse(readFileSync(join(homedir(), ".sui", "sui_config", "sui.keystore"), "utf8")) as string[];
  const fas = Buffer.from(ks[0], "base64");
  const keypair = Ed25519Keypair.fromSecretKey(fas.subarray(1));
  const address = keypair.getPublicKey().toSuiAddress();
  console.log("Author address:", address);
  console.log("Network:", NETWORK);
  console.log("Package:", PACKAGE_ID);
  console.log("Sui RPC:", SUI_RPC_URL);
  console.log("Walrus publisher:", WALRUS_PUBLISHER);

  const client = new SuiJsonRpcClient({
    url: SUI_RPC_URL || getJsonRpcFullnodeUrl(NETWORK),
    network: NETWORK === "devnet" ? "testnet" : NETWORK
  } as ConstructorParameters<typeof SuiJsonRpcClient>[0]);
  const coins = await client.getCoins({ owner: address });
  const balance = coins.data.reduce((s, c) => s + BigInt(c.balance), 0n);
  console.log("SUI balance:", balance.toString());
  if (balance === 0n) { console.log("ERROR: no gas"); process.exit(1); }

  const seal = new SealClient({
    suiClient: client,
    serverConfigs: [{ objectId: SEAL_KEY_SERVER, weight: 1, aggregatorUrl: SEAL_KEY_SERVER_URL }]
  } as ConstructorParameters<typeof SealClient>[0]);

  const plaintext = new TextEncoder().encode("M4-2 ENCRYPTED secret research body. " + new Date().toISOString());
  const preview = new TextEncoder().encode("M4-2 encrypted preview (public)");

  // 1. Publisher-chosen deterministic seal_id (32 random bytes -> hex string id for Seal SDK).
  const sealIdBytes = crypto.getRandomValues(new Uint8Array(32));
  const sealIdHex = "0x" + Array.from(sealIdBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  console.log("\n1. Publisher seal_id:", sealIdHex);

  // 2. Seal encrypt under id = seal_id
  console.log("2. Seal-encrypting plaintext...");
  const { encryptedObject: ciphertext } = await seal.encrypt({
    threshold: SEAL_THRESHOLD, packageId: PACKAGE_ID, id: sealIdHex, data: plaintext
  });
  console.log("   ciphertext bytes:", ciphertext.length);

  // 3. Upload ciphertext to Walrus
  console.log("3. Uploading ciphertext to Walrus...");
  const pubRes = await fetch(`${WALRUS_PUBLISHER}/v1/blobs?epochs=${WALRUS_EPOCHS}`, {
    method: "PUT", body: ciphertext as unknown as BodyInit
  });
  if (!pubRes.ok) throw new Error("Walrus upload failed: " + pubRes.status);
  const upload = await pubRes.json();
  const blobId = (upload.newlyCreated?.blobObject || upload.alreadyCertified)?.blobId;
  if (!blobId) throw new Error("No blobId");
  console.log("   Walrus blobId:", blobId);
  const uploadedCipher = await readWalrusBlob(blobId);
  if (!bytesEqual(uploadedCipher, ciphertext)) {
    throw new Error(`Walrus encrypted blob ${blobId} readback did not match uploaded ciphertext`);
  }
  console.log("   Walrus readback verified:", uploadedCipher.length, "bytes");

  // 4. Publish encrypted report
  console.log("4. Publishing encrypted report on Sui...");
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::report::publish_encrypted_report`,
    arguments: [
      tx.pure.vector("u8", Array.from(b64urlToBytes(blobId))),
      tx.pure.vector("u8", Array.from(sealIdBytes)),
      tx.pure.vector("u8", Array.from(hexToBytes(await sha256Hex(ciphertext)))),
      tx.pure.vector("u8", Array.from(hexToBytes(await sha256Hex(plaintext)))),
      tx.pure.vector("u8", Array.from(hexToBytes(await sha256Hex(preview)))),
      tx.pure.u8(1),
      tx.object(CLOCK_ID)
    ]
  });
  tx.setSender(address);
  const result = await client.signAndExecuteTransaction({ transaction: tx, signer: keypair, options: { showEffects: true, showObjectChanges: true } });
  console.log("   tx digest:", result.digest, "| status:", result.effects?.status?.status);
  const created = (result.objectChanges || []).filter((c) => c.type === "created");
  const reportId = createdObjectId(created, "ResearchReport", PACKAGE_ID);
  console.log("   ResearchReport object:", reportId);

  // 5. Seal decrypt
  console.log("\n5. Seal decrypting (author path: caller == agent)...");
  const fetchedCipher = uploadedCipher;
  console.log("   fetched ciphertext bytes:", fetchedCipher.length);

  const sessionKey = await SessionKey.create({
    address, packageId: PACKAGE_ID, ttlMin: 10, signer: keypair, suiClient: client
  });
  const encObj = EncryptedObject.parse(fetchedCipher);
  console.log("   Seal id from ciphertext:", encObj.id, "(should match seal_id)");

  const approveTx = new Transaction();
  approveTx.moveCall({
    target: `${PACKAGE_ID}::access::seal_approve_report_author`,
    arguments: [
      approveTx.pure.vector("u8", Array.from(sealIdBytes)),
      approveTx.object(reportId)
    ]
  });
  const txBytes = await approveTx.build({ client, onlyTransactionKind: true });

  await seal.fetchKeys({ ids: [encObj.id], txBytes, sessionKey, threshold: SEAL_THRESHOLD });
  const decrypted = await seal.decrypt({ data: fetchedCipher, sessionKey, txBytes });
  const decryptedText = new TextDecoder().decode(decrypted);
  console.log("   decrypted:", decryptedText.slice(0, 80) + "...");

  if (decryptedText === new TextDecoder().decode(plaintext)) {
    console.log("\n✅ M4-2 ENCRYPTED round-trip SUCCESS: Seal encrypt → publish → decrypt verified.");
    console.log("   key server", SEAL_KEY_SERVER, "authorized decryption (author path).");
  } else {
    console.log("\n❌ MISMATCH"); process.exit(1);
  }
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
