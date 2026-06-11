import fs from "node:fs/promises";
import path from "node:path";
import { type PackageResult, type ProtocolEvent, type PublishResult } from "./types.js";
import { objectId, randomToken, sha256File, shortHash } from "./crypto.js";
import { appendEvents, ensureLocalStore } from "./local-store.js";
import { packageWorkspace } from "./packager.js";
import { validateWorkspace } from "./validator.js";
import { replayIndexer } from "./indexer.js";

export interface LocalWalrusUpload {
  blobId: string;
  objectId: string;
  size: number;
  contentHash: string;
  manifestPath: string;
  archivePath: string;
}

export async function uploadToLocalWalrus(pkg: PackageResult, localnetRoot?: string): Promise<LocalWalrusUpload> {
  const paths = await ensureLocalStore(localnetRoot);
  const contentHash = await sha256File(pkg.archivePath);
  const blobId = `walrus:local:${shortHash(contentHash, 24)}`;
  const object = objectId("0x", `${blobId}:${pkg.manifest.manifest_hash}`);
  const blobDir = path.join(paths.walrusDir, blobId.replaceAll(":", "_"));
  await fs.mkdir(blobDir, { recursive: true });
  const archivePath = path.join(blobDir, "release.tar.zst");
  const manifestPath = path.join(blobDir, "manifest.json");
  await fs.copyFile(pkg.archivePath, archivePath);
  await fs.copyFile(pkg.manifestPath, manifestPath);
  const stat = await fs.stat(archivePath);
  return {
    blobId,
    objectId: object,
    size: stat.size,
    contentHash,
    manifestPath,
    archivePath
  };
}

function eventKey(txDigest: string, seq: number): string {
  return `${txDigest}:${seq}`;
}

export async function registerOnLocalSui(pkg: PackageResult, walrus: LocalWalrusUpload, localnetRoot?: string) {
  const createdMs = Date.now();
  const txDigest = `tx_${shortHash(`${walrus.blobId}:${pkg.manifest.manifest_hash}:${createdMs}`, 32)}`;
  const object = objectId("0x", `${txDigest}:asset`);
  const assetId = String(pkg.manifest.assets.id ?? `ra:local:${object}`);
  const owner = String(pkg.manifest.assets.authors?.[0]?.wallet ?? "0x0");
  let seq = 0;
  const events: ProtocolEvent[] = [
    {
      tx_digest: txDigest,
      event_seq: seq++,
      event_type: "ResearchAssetPublished",
      checkpoint: createdMs,
      timestamp_ms: createdMs,
      payload: {
        asset_id: assetId,
        sui_object_id: object,
        owner,
        creator: owner,
        asset_type_mask: pkg.manifest.assets.types,
        version: pkg.manifest.assets.version,
        title: pkg.manifest.assets.title,
        manifest_hash: pkg.manifest.manifest_hash,
        content_hash: pkg.manifest.content_hash,
        walrus_blob_id: walrus.blobId,
        walrus_object_id: walrus.objectId,
        repo_url: pkg.manifest.repo,
        repo_commit: pkg.manifest.commit,
        created_at: new Date(createdMs).toISOString()
      }
    }
  ];

  for (const skill of pkg.manifest.skills) {
    const skillObject = objectId("0x", `${txDigest}:skill:${skill.id}`);
    events.push({
      tx_digest: txDigest,
      event_seq: seq++,
      event_type: "SkillPublished",
      checkpoint: createdMs,
      timestamp_ms: createdMs,
      payload: {
        skill_id: skill.id,
        sui_object_id: skillObject,
        source_asset_id: assetId,
        name: skill.manifest.name,
        version: skill.manifest.version,
        description: skill.manifest.description,
        relation: skill.manifest.relation,
        manifest_hash: pkg.manifest.manifest_hash,
        walrus_blob_id: walrus.blobId,
        license: skill.manifest.license,
        price_policy: skill.manifest.price_policy ?? pkg.manifest.assets.commerce?.price_policy,
        owner_address: owner,
        created_at: new Date(createdMs).toISOString()
      }
    });
  }

  for (const relationship of pkg.manifest.relationships) {
    events.push({
      tx_digest: txDigest,
      event_seq: seq++,
      event_type: "AssetRelationshipRegistered",
      checkpoint: createdMs,
      timestamp_ms: createdMs,
      payload: {
        ...relationship,
        source_asset_id: assetId
      }
    });
  }

  await appendEvents(events, localnetRoot);
  return {
    txDigest,
    assetId,
    objectId: object,
    events,
    eventKeys: events.map((event) => eventKey(event.tx_digest, event.event_seq))
  };
}

export async function publishWorkspace(rootInput = ".", localnetRoot?: string): Promise<PublishResult> {
  const validation = await validateWorkspace(rootInput);
  if (!validation.valid) {
    const messages = validation.errors.map((error) => `${error.code}: ${error.message}`).join("\n");
    throw new Error(`Cannot publish invalid workspace:\n${messages}`);
  }
  const pkg = await packageWorkspace(rootInput);
  const walrus = await uploadToLocalWalrus(pkg, localnetRoot);
  const sui = await registerOnLocalSui(pkg, walrus, localnetRoot);
  const index = await replayIndexer({ localnetRoot });
  return {
    validation,
    package: pkg,
    walrus,
    sui,
    index
  };
}

export function createPaymentIntent(skillId: string, buyer: string) {
  const orderId = `order_${shortHash(`${skillId}:${buyer}:${Date.now()}:${Math.random()}`, 18)}`;
  return {
    id: orderId,
    skill_id: skillId,
    buyer,
    status: "requires_payment",
    accepted: ["sui", "usdc:evm", "usdc:solana"],
    settlement_chain: "sui",
    replay_protection: randomToken("rn_order"),
    created_at: new Date().toISOString()
  };
}
