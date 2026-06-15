import fs from "node:fs/promises";
import path from "node:path";
import { type PackageResult, type ProtocolEvent, type PublishResult, type ResearchAccessVisibility } from "./types.js";
import { objectId, randomToken, sha256File, shortHash } from "./crypto.js";
import { appendEvents, ensureLocalStore, readIndex } from "./local-store.js";
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

// Asset-type bitmask used by the Move layer (asset_type_mask / included_mask).
const TYPE_BITS: Record<string, number> = {
  paper: 1,
  skill: 2,
  workflow: 4,
  dataset: 8,
  experiment: 16,
  benchmark: 32,
  code: 64,
  review: 128
};

// Manifest relation types that mean "this asset is derived from another" — projected as the
// canonical AssetForked event (parent -> child) rather than the local-only bridge event.
const FORK_RELATIONS = new Set(["fork", "forked", "extends", "derived_from"]);

function includedMask(metadata: unknown): number {
  const included = (metadata as { included?: unknown } | undefined)?.included;
  if (!Array.isArray(included)) {
    return 0;
  }
  return included.reduce<number>((mask, type) => mask | (TYPE_BITS[String(type)] ?? 0), 0);
}

function normalizeVisibility(value: unknown): ResearchAccessVisibility {
  return value === "encrypted" || value === "private_delegation" ? value : "public";
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

  const access = pkg.manifest.assets.access ?? {
    visibility: normalizeVisibility(pkg.manifest.assets.publish.visibility)
  };
  const visibility = normalizeVisibility(access.visibility);
  const reportId = `report:${shortHash(`${assetId}:${walrus.blobId}:${visibility}`, 20)}`;
  events.push({
    tx_digest: txDigest,
    event_seq: seq++,
    event_type: "ResearchReportPublished",
    checkpoint: createdMs,
    timestamp_ms: createdMs,
    payload: {
      report_id: reportId,
      sui_object_id: objectId("0x", `${txDigest}:report:${reportId}`),
      agent: owner,
      asset_id: assetId,
      title: pkg.manifest.assets.title,
      visibility,
      required_tier: access.required_tier ?? 0,
      walrus_blob_id: access.walrus_blob_id ?? walrus.blobId,
      seal_id: access.seal_id ?? "",
      ciphertext_hash: access.ciphertext_hash ?? "",
      plaintext_commitment: access.plaintext_commitment ?? pkg.manifest.content_hash,
      free_preview_hash: shortHash(access.free_preview ?? pkg.manifest.assets.abstract ?? pkg.manifest.assets.title, 32),
      free_preview: access.free_preview ?? pkg.manifest.assets.abstract ?? "",
      delegation_job_id: access.delegation_job_id,
      created_ms: createdMs,
      created_at: new Date(createdMs).toISOString()
    }
  });

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
        access: skill.manifest.access ?? access,
        owner_address: owner,
        created_at: new Date(createdMs).toISOString()
      }
    });
  }

  for (const relationship of pkg.manifest.relationships) {
    if (FORK_RELATIONS.has(relationship.relation_type)) {
      // src_id is this (child) asset; dst_id is the parent it derives from.
      events.push({
        tx_digest: txDigest,
        event_seq: seq++,
        event_type: "AssetForked",
        checkpoint: createdMs,
        timestamp_ms: createdMs,
        payload: {
          parent_asset_id: relationship.dst_id,
          child_asset_id: relationship.src_id,
          included_mask: includedMask(relationship.metadata),
          caller: owner,
          relation: relationship.relation_type,
          created_at: new Date(createdMs).toISOString()
        }
      });
      continue;
    }
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

export function createAccessIntent(kind: "platform_membership" | "agent_subscription" | "private_delegation", buyer: string, target?: string) {
  const orderId = `order_${shortHash(`${kind}:${buyer}:${target ?? ""}:${Date.now()}:${Math.random()}`, 18)}`;
  return {
    id: orderId,
    kind,
    buyer,
    target,
    status: "requires_payment",
    accepted: ["sui", "usdc:evm", "usdc:solana"],
    settlement_chain: "sui",
    replay_protection: randomToken("rn_order"),
    created_at: new Date().toISOString()
  };
}

export interface LocalProtocolActionResult {
  txDigest?: string;
  events: ProtocolEvent[];
  eventKeys: string[];
  index: Awaited<ReturnType<typeof replayIndexer>>;
  existing?: boolean;
}

async function appendLocalProtocolEvents(
  label: string,
  payloads: Array<{ event_type: string; payload: Record<string, unknown> }>,
  localnetRoot?: string
): Promise<LocalProtocolActionResult> {
  const createdMs = Date.now();
  const txDigest = `tx_${shortHash(`${label}:${createdMs}:${Math.random()}`, 32)}`;
  const events = payloads.map<ProtocolEvent>((item, event_seq) => ({
    tx_digest: txDigest,
    event_seq,
    event_type: item.event_type,
    checkpoint: createdMs,
    timestamp_ms: createdMs,
    payload: {
      ...item.payload,
      created_ms: item.payload.created_ms ?? createdMs,
      created_at: item.payload.created_at ?? new Date(createdMs).toISOString()
    }
  }));
  await appendEvents(events, localnetRoot);
  const index = await replayIndexer({ localnetRoot });
  return {
    txDigest,
    events,
    eventKeys: events.map((event) => eventKey(event.tx_digest, event.event_seq)),
    index
  };
}

export async function buyPlatformMembership(input: {
  ownerAddress: string;
  tier?: number;
  durationDays?: number;
  passId?: string;
  localnetRoot?: string;
}): Promise<LocalProtocolActionResult & { passId: string }> {
  const startedMs = Date.now();
  const durationMs = Math.max(1, input.durationDays ?? 30) * 24 * 60 * 60 * 1000;
  const passId = input.passId ?? `pm:${shortHash(`${input.ownerAddress}:${input.tier ?? 1}:${startedMs}`, 18)}`;
  const result = await appendLocalProtocolEvents("platform-membership", [{
    event_type: "PlatformMembershipPurchased",
    payload: {
      pass_id: passId,
      owner: input.ownerAddress,
      tier: input.tier ?? 1,
      started_ms: startedMs,
      expires_ms: startedMs + durationMs
    }
  }], input.localnetRoot);
  return { ...result, passId };
}

export async function subscribeAgent(input: {
  ownerAddress: string;
  agent: string;
  tier?: number;
  durationDays?: number;
  amount?: number;
  platformFeeBps?: number;
  passId?: string;
  localnetRoot?: string;
}): Promise<LocalProtocolActionResult & { passId: string }> {
  const startedMs = Date.now();
  const durationMs = Math.max(1, input.durationDays ?? 30) * 24 * 60 * 60 * 1000;
  const passId = input.passId ?? `sub:${shortHash(`${input.ownerAddress}:${input.agent}:${input.tier ?? 1}:${startedMs}`, 18)}`;
  const amount = Number(input.amount ?? 0);
  const platformFee = Math.floor(amount * (input.platformFeeBps ?? 1500) / 10_000);
  const payloads: Array<{ event_type: string; payload: Record<string, unknown> }> = [{
    event_type: "AgentSubscriptionPurchased",
    payload: {
      pass_id: passId,
      owner: input.ownerAddress,
      agent: input.agent,
      tier: input.tier ?? 1,
      started_ms: startedMs,
      expires_ms: startedMs + durationMs
    }
  }];
  if (amount > 0) {
    payloads.push({
      event_type: "AgentSubscriptionPaid",
      payload: {
        pass_id: passId,
        owner: input.ownerAddress,
        agent: input.agent,
        amount,
        platform_fee: platformFee
      }
    });
  }
  const result = await appendLocalProtocolEvents("agent-subscription", payloads, input.localnetRoot);
  return { ...result, passId };
}

export async function createDelegationJob(input: {
  buyer: string;
  agent: string;
  budget: number;
  deadlineMs?: number;
  jobId?: string;
  localnetRoot?: string;
}): Promise<LocalProtocolActionResult & { jobId: string }> {
  const jobId = input.jobId ?? `job:${shortHash(`${input.buyer}:${input.agent}:${input.budget}:${Date.now()}`, 18)}`;
  const result = await appendLocalProtocolEvents("delegation-create", [{
    event_type: "DelegationCreated",
    payload: {
      job_id: jobId,
      buyer: input.buyer,
      agent: input.agent,
      budget: input.budget,
      deadline_ms: input.deadlineMs
    }
  }], input.localnetRoot);
  return { ...result, jobId };
}

export async function acceptDelegationJob(input: {
  jobId: string;
  agent: string;
  localnetRoot?: string;
}): Promise<LocalProtocolActionResult> {
  return appendLocalProtocolEvents("delegation-accept", [{
    event_type: "DelegationAccepted",
    payload: { job_id: input.jobId, agent: input.agent }
  }], input.localnetRoot);
}

export async function submitPrivateResult(input: {
  jobId: string;
  agent: string;
  title?: string;
  reportId?: string;
  walrusBlobId: string;
  sealId: string;
  ciphertextHash: string;
  plaintextCommitment: string;
  freePreviewHash?: string;
  localnetRoot?: string;
}): Promise<LocalProtocolActionResult & { reportId: string }> {
  const reportId = input.reportId ?? `rep:${shortHash(`${input.jobId}:${input.agent}:${input.walrusBlobId}:${Date.now()}`, 18)}`;
  const result = await appendLocalProtocolEvents("delegation-submit", [
    {
      event_type: "ResearchReportPublished",
      payload: {
        report_id: reportId,
        sui_object_id: objectId("0x", reportId),
        agent: input.agent,
        title: input.title ?? `Private result ${input.jobId}`,
        visibility: "private_delegation",
        required_tier: 0,
        walrus_blob_id: input.walrusBlobId,
        seal_id: input.sealId,
        ciphertext_hash: input.ciphertextHash,
        plaintext_commitment: input.plaintextCommitment,
        free_preview_hash: input.freePreviewHash ?? "",
        delegation_job_id: input.jobId
      }
    },
    {
      event_type: "DelegationResultSubmitted",
      payload: { job_id: input.jobId, report_id: reportId, agent: input.agent }
    }
  ], input.localnetRoot);
  return { ...result, reportId };
}

export async function completeDelegationJob(input: {
  jobId: string;
  payout?: number;
  localnetRoot?: string;
}): Promise<LocalProtocolActionResult> {
  const index = await readIndex(input.localnetRoot);
  const job = index.delegations[input.jobId];
  return appendLocalProtocolEvents("delegation-complete", [{
    event_type: "DelegationCompleted",
    payload: {
      job_id: input.jobId,
      payout: input.payout ?? job?.budget ?? 0
    }
  }], input.localnetRoot);
}

export async function openDispute(input: {
  jobId: string;
  openedBy: string;
  arbitrator: string;
  localnetRoot?: string;
}): Promise<LocalProtocolActionResult> {
  return appendLocalProtocolEvents("delegation-dispute", [{
    event_type: "DelegationDisputeOpened",
    payload: {
      job_id: input.jobId,
      opened_by: input.openedBy,
      arbitrator: input.arbitrator
    }
  }], input.localnetRoot);
}

export async function recordAccessReceipt(input: {
  periodId: number;
  user: string;
  reportId: string;
  agent: string;
  accessType?: "platform_member" | "agent_subscription";
  receiptId?: string;
  localnetRoot?: string;
}): Promise<LocalProtocolActionResult & { receiptId: string }> {
  const index = await readIndex(input.localnetRoot);
  const existing = Object.values(index.access_receipts).find((receipt) =>
    receipt.period_id === input.periodId &&
    receipt.user === input.user &&
    receipt.report_id === input.reportId
  );
  if (existing) {
    return {
      events: [],
      eventKeys: [],
      index,
      existing: true,
      receiptId: existing.id
    };
  }
  const receiptId = input.receiptId ?? `read:${shortHash(`${input.periodId}:${input.user}:${input.reportId}`, 18)}`;
  const result = await appendLocalProtocolEvents("access-receipt", [{
    event_type: "AccessReceiptRecorded",
    payload: {
      receipt_id: receiptId,
      period_id: input.periodId,
      user: input.user,
      report_id: input.reportId,
      agent: input.agent,
      access_type: input.accessType ?? "platform_member"
    }
  }], input.localnetRoot);
  return { ...result, receiptId };
}

export async function settleMembershipPeriod(input: {
  periodId: number;
  user: string;
  grossAmount: number;
  platformFeeBps?: number;
  localnetRoot?: string;
}): Promise<LocalProtocolActionResult> {
  const index = await readIndex(input.localnetRoot);
  const existing = Object.values(index.membership_settlements).find((settlement) =>
    settlement.period_id === input.periodId &&
    settlement.user === input.user &&
    !settlement.report_id
  );
  if (existing) {
    return {
      events: [],
      eventKeys: [],
      index,
      existing: true
    };
  }
  const receiptsByReport = new Map<string, { report_id: string; agent: string }>();
  for (const receipt of Object.values(index.access_receipts)) {
    if (
      receipt.period_id === input.periodId &&
      receipt.user === input.user &&
      receipt.access_type === "platform_member"
    ) {
      receiptsByReport.set(receipt.report_id, { report_id: receipt.report_id, agent: receipt.agent });
    }
  }
  const reports = [...receiptsByReport.values()];
  const netAmount = Math.max(0, input.grossAmount - Math.floor(input.grossAmount * (input.platformFeeBps ?? 1500) / 10_000));
  const amountPerReport = reports.length > 0 ? Math.floor(netAmount / reports.length) : 0;
  const payloads: Array<{ event_type: string; payload: Record<string, unknown> }> = [{
    event_type: "MembershipSettlementCreated",
    payload: {
      period_id: input.periodId,
      user: input.user,
      report_count: reports.length,
      net_amount: netAmount,
      amount_per_report: amountPerReport
    }
  }];
  for (const report of reports) {
    payloads.push({
      event_type: "MembershipReportSettled",
      payload: {
        period_id: input.periodId,
        user: input.user,
        report_id: report.report_id,
        agent: report.agent,
        amount: amountPerReport
      }
    });
  }
  return appendLocalProtocolEvents("membership-settle", payloads, input.localnetRoot);
}
