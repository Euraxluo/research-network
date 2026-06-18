import path from "node:path";
import {
  type AccessReceiptRecord,
  type AgentChannelRecord,
  type AgentEarningsRecord,
  type AgentPassport,
  type AgentSubscriptionRecord,
  type BadgeRecord,
  type CrossChainPaymentRecord,
  type DelegationJobRecord,
  type IndexState,
  type IndexedAsset,
  type IndexedRelationship,
  type IndexedSkill,
  type MembershipSettlementRecord,
  type PlatformMembershipRecord,
  type ProtocolEvent,
  type ReleaseManifest,
  type ResearchAccessVisibility,
  type ResearchReportRecord,
  type ReputationRecord,
  type RevenuePoolRecord
} from "./types.js";
import { readJsonFile } from "./fs.js";
import { emptyIndexState, ensureLocalStore, readEvents, readIndex, writeIndex } from "./local-store.js";
import { shortHash } from "./crypto.js";

export interface ReplayOptions {
  localnetRoot?: string;
  fromCheckpoint?: number;
  /** Deprecated: replay always does a deterministic full rebuild from the event log. */
  reset?: boolean;
}

/** Fetches the Walrus release manifest referenced by a publish event. Pluggable so a
 *  real-chain indexer can swap in a live Walrus fetcher while tests/local use the disk store. */
export type ManifestLoader = (event: ProtocolEvent) => Promise<ReleaseManifest | undefined>;

export interface ApplyOptions {
  localnetRoot?: string;
  manifestLoader?: ManifestLoader;
}

function eventKey(event: ProtocolEvent): string {
  return `${event.tx_digest}:${event.event_seq}`;
}

function isoFromEvent(event: ProtocolEvent): string {
  return String(event.payload.created_at ?? new Date(event.timestamp_ms).toISOString());
}

function isoFromMs(value: unknown, fallback: ProtocolEvent): string {
  const ms = Number(value);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : isoFromEvent(fallback);
}

/** Sui emits vector<u8> fields as byte arrays; local/test payloads use plain strings.
 *  Decode tolerantly so the same handler serves both sources. */
function bytesToText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    try {
      return Buffer.from(value as number[]).toString("utf8");
    } catch {
      return "";
    }
  }
  return String(value);
}

function bytesToBase64Url(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    try {
      return Buffer.from(value as number[]).toString("base64url");
    } catch {
      return "";
    }
  }
  return String(value);
}

function bytesToObjectId(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    try {
      const bytes = Buffer.from(value as number[]);
      return bytes.length ? `0x${bytes.toString("hex")}` : "";
    } catch {
      return "";
    }
  }
  return String(value);
}

function bytesToSha256Base64(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    try {
      const bytes = Buffer.from(value as number[]);
      return bytes.length ? `sha256:${bytes.toString("base64")}` : "";
    } catch {
      return "";
    }
  }
  return String(value);
}

function visibilityFromEvent(value: unknown): ResearchAccessVisibility {
  if (value === "encrypted" || value === 1 || value === "1") return "encrypted";
  if (value === "private_delegation" || value === 2 || value === "2") return "private_delegation";
  return "public";
}

function accessTypeFromEvent(value: unknown): AccessReceiptRecord["access_type"] {
  return value === "agent_subscription" || value === 1 || value === "1" ? "agent_subscription" : "platform_member";
}

function statusFromEvent(value: unknown): DelegationJobRecord["status"] {
  const text = String(value ?? "");
  if (["open", "accepted", "funded", "submitted", "completed", "refunded", "disputed", "resolved", "expired"].includes(text)) {
    return text as DelegationJobRecord["status"];
  }
  const byNumber: Record<string, DelegationJobRecord["status"]> = {
    "0": "open",
    "1": "accepted",
    "2": "funded",
    "3": "submitted",
    "4": "completed",
    "5": "refunded",
    "6": "disputed",
    "7": "resolved",
    "8": "expired"
  };
  return byNumber[text] ?? "open";
}

async function defaultManifestLoader(event: ProtocolEvent, localnetRoot?: string): Promise<ReleaseManifest | undefined> {
  const walrusBlobId = String(event.payload.walrus_blob_id ?? "");
  if (!walrusBlobId) {
    return undefined;
  }
  const paths = await ensureLocalStore(localnetRoot);
  const manifestPath = path.join(paths.walrusDir, walrusBlobId.replaceAll(":", "_"), "manifest.json");
  return readJsonFile<ReleaseManifest | undefined>(manifestPath, undefined);
}

function assetSearchBody(asset: IndexedAsset): string {
  const authors = asset.manifest.assets.authors?.map((author) => `${author.name} ${author.github ?? ""} ${author.agent_id ?? ""}`).join(" ");
  const skillText = asset.manifest.skills.map((skill) => `${skill.manifest.name} ${skill.manifest.description}`).join(" ");
  const workflowText = asset.manifest.workflows.map((workflow) => `${workflow.manifest.name} ${workflow.manifest.description ?? ""}`).join(" ");
  return [asset.abstract, authors, skillText, workflowText, asset.types.join(" "), asset.categories.join(" ")].filter(Boolean).join("\n");
}

function skillSearchBody(skill: IndexedSkill): string {
  return [
    skill.description,
    skill.manifest.capabilities.join(" "),
    skill.access?.visibility ?? skill.manifest.access?.visibility ?? "public",
    skill.manifest.relation
  ].join("\n");
}

function upsertRelationship(index: IndexState, relationship: Omit<IndexedRelationship, "id" | "created_at"> & { created_at?: string }): void {
  const id = shortHash(`${relationship.src_id}:${relationship.dst_id}:${relationship.relation_type}`, 24);
  index.relationships[id] = {
    id,
    src_id: relationship.src_id,
    dst_id: relationship.dst_id,
    relation_type: relationship.relation_type,
    weight: relationship.weight,
    metadata: relationship.metadata,
    created_at: relationship.created_at ?? new Date().toISOString()
  };
}

async function handleAssetPublished(index: IndexState, event: ProtocolEvent, options: ApplyOptions): Promise<void> {
  const loader = options.manifestLoader ?? ((evt) => defaultManifestLoader(evt, options.localnetRoot));
  const manifest = await loader(event);
  if (!manifest) {
    throw new Error(`Missing Walrus manifest for ${String(event.payload.walrus_blob_id)}`);
  }
  const asset: IndexedAsset = {
    id: String(event.payload.asset_id),
    sui_object_id: String(event.payload.sui_object_id),
    title: String(event.payload.title ?? manifest.assets.title),
    slug: manifest.assets.slug,
    version: String(event.payload.version ?? manifest.assets.version),
    types: manifest.assets.types,
    abstract: manifest.assets.abstract,
    tags: manifest.assets.tags ?? [],
    categories: manifest.assets.categories ?? [],
    walrus_blob_id: String(event.payload.walrus_blob_id),
    manifest_hash: String(event.payload.manifest_hash),
    content_hash: String(event.payload.content_hash ?? manifest.content_hash),
    repo_url: String(event.payload.repo_url ?? manifest.repo),
    repo_commit: String(event.payload.repo_commit ?? manifest.commit),
    owner_address: String(event.payload.owner ?? "0x0"),
    creator_address: String(event.payload.creator ?? event.payload.owner ?? "0x0"),
    created_at: String(event.payload.created_at ?? new Date(event.timestamp_ms).toISOString()),
    manifest
  };
  index.assets[asset.id] = asset;
  index.search_documents[asset.id] = {
    id: asset.id,
    entity_type: "asset",
    entity_id: asset.id,
    title: asset.title,
    body: assetSearchBody(asset),
    tags: asset.tags,
    metadata: {
      types: asset.types,
      walrus_blob_id: asset.walrus_blob_id,
      sui_object_id: asset.sui_object_id,
      content_hash: asset.content_hash
    },
    updated_at: new Date().toISOString()
  };
}

function handleSkillPublished(index: IndexState, event: ProtocolEvent): void {
  const manifestAsset = index.assets[String(event.payload.source_asset_id)]?.manifest;
  const manifestSkill = manifestAsset?.skills.find((skill) => skill.id === event.payload.skill_id)?.manifest;
  const skill: IndexedSkill = {
    id: String(event.payload.skill_id),
    sui_object_id: String(event.payload.sui_object_id),
    source_asset_id: String(event.payload.source_asset_id),
    name: String(event.payload.name),
    version: String(event.payload.version),
    description: String(event.payload.description ?? ""),
    relation: String(event.payload.relation ?? "owned") as IndexedSkill["relation"],
    walrus_blob_id: String(event.payload.walrus_blob_id),
    manifest_hash: String(event.payload.manifest_hash),
    access: manifestSkill?.access ?? manifestAsset?.assets.access,
    owner_address: String(event.payload.owner_address ?? "0x0"),
    created_at: String(event.payload.created_at ?? new Date(event.timestamp_ms).toISOString()),
    manifest: manifestSkill ?? {
      schema: "research-skill/v0.1",
      name: String(event.payload.name),
      version: String(event.payload.version),
      description: String(event.payload.description ?? ""),
      capabilities: [],
      relation: String(event.payload.relation ?? "owned") as IndexedSkill["relation"],
      access: manifestAsset?.assets.access
    }
  };
  index.skills[skill.id] = skill;
  index.search_documents[skill.id] = {
    id: skill.id,
    entity_type: "skill",
    entity_id: skill.id,
    title: skill.name,
    body: skillSearchBody(skill),
    tags: skill.manifest.capabilities,
    metadata: {
      source_asset_id: skill.source_asset_id,
      walrus_blob_id: skill.walrus_blob_id,
      relation: skill.relation
    },
    updated_at: new Date().toISOString()
  };
  upsertRelationship(index, {
    src_id: skill.source_asset_id,
    dst_id: skill.id,
    relation_type: "contains_skill",
    weight: 1,
    metadata: { indexed_from: "SkillPublished" }
  });
}

function handleSkillInstalled(index: IndexState, event: ProtocolEvent): void {
  upsertRelationship(index, {
    src_id: String(event.payload.workspace_asset_id),
    dst_id: String(event.payload.skill_id),
    relation_type: "installs_skill",
    weight: 1,
    metadata: {
      indexed_from: "SkillInstalled",
      install_mode: Number(event.payload.install_mode ?? 0),
      installer: String(event.payload.installer ?? "")
    },
    created_at: isoFromEvent(event)
  });
}

// Canonical on-chain relationship events (replace the local-only AssetRelationshipRegistered
// bridge when consuming a real Sui event stream — see docs/17 裁决 2).
function handleAssetCited(index: IndexState, event: ProtocolEvent): void {
  upsertRelationship(index, {
    src_id: String(event.payload.src_asset_id ?? event.payload.src_id),
    dst_id: String(event.payload.dst_asset_id ?? event.payload.dst_id),
    relation_type: "cites",
    weight: 1,
    metadata: { indexed_from: "AssetCited", relation: bytesToText(event.payload.relation_type), caller: String(event.payload.caller ?? "") },
    created_at: isoFromEvent(event)
  });
}

function handleAssetForked(index: IndexState, event: ProtocolEvent): void {
  upsertRelationship(index, {
    src_id: String(event.payload.parent_asset_id),
    dst_id: String(event.payload.child_asset_id),
    relation_type: "fork",
    weight: 1,
    metadata: { indexed_from: "AssetForked", included_mask: Number(event.payload.included_mask ?? 0), caller: String(event.payload.caller ?? "") },
    created_at: isoFromEvent(event)
  });
}

function handleRelationship(index: IndexState, event: ProtocolEvent): void {
  const payload = event.payload;
  upsertRelationship(index, {
    src_id: String(payload.src_id ?? payload.source_asset_id),
    dst_id: String(payload.dst_id),
    relation_type: String(payload.relation_type),
    weight: Number(payload.weight ?? 1),
    metadata: (payload.metadata as Record<string, unknown> | undefined) ?? {},
    created_at: new Date(event.timestamp_ms).toISOString()
  });
}

function handleResearchReportPublished(index: IndexState, event: ProtocolEvent): void {
  const id = String(event.payload.report_id);
  const visibility = visibilityFromEvent(event.payload.visibility);
  const assetId = event.payload.asset_id ? String(event.payload.asset_id) : undefined;
  const asset = assetId ? index.assets[assetId] : undefined;
  const record: ResearchReportRecord = {
    id,
    sui_object_id: String(event.payload.sui_object_id ?? id),
    agent: String(event.payload.agent ?? event.payload.owner ?? "0x0"),
    visibility,
    required_tier: Number(event.payload.required_tier ?? 0),
    walrus_blob_id: bytesToBase64Url(event.payload.walrus_blob_id),
    seal_id: bytesToObjectId(event.payload.seal_id) || undefined,
    ciphertext_hash: bytesToSha256Base64(event.payload.ciphertext_hash) || undefined,
    plaintext_commitment: bytesToSha256Base64(event.payload.plaintext_commitment) || undefined,
    free_preview_hash: bytesToSha256Base64(event.payload.free_preview_hash) || undefined,
    delegation_job_id: event.payload.delegation_job_id ? String(event.payload.delegation_job_id) : undefined,
    asset_id: assetId,
    title: String(event.payload.title ?? asset?.title ?? `Report ${id}`),
    free_preview: String(event.payload.free_preview ?? asset?.abstract ?? ""),
    created_at: isoFromMs(event.payload.created_ms, event)
  };
  index.reports[id] = record;
  if (visibility !== "private_delegation") {
    index.search_documents[id] = {
      id,
      entity_type: "report",
      entity_id: id,
      title: record.title ?? `Report ${id}`,
      body: record.free_preview ?? "",
      tags: ["report", visibility],
      metadata: {
        visibility,
        agent: record.agent,
        asset_id: assetId,
        required_tier: record.required_tier
      },
      updated_at: new Date().toISOString()
    };
  } else {
    delete index.search_documents[id];
  }
  if (assetId) {
    upsertRelationship(index, {
      src_id: assetId,
      dst_id: id,
      relation_type: "has_report",
      weight: 1,
      metadata: { indexed_from: "ResearchReportPublished", visibility },
      created_at: record.created_at
    });
  }
}

function handleAgentChannelCreated(index: IndexState, event: ProtocolEvent): void {
  const id = String(event.payload.channel_id);
  const record: AgentChannelRecord = {
    id,
    agent: String(event.payload.agent ?? "0x0"),
    metadata_hash: bytesToText(event.payload.metadata_hash),
    created_at: isoFromMs(event.payload.created_ms, event)
  };
  index.agent_channels[id] = record;
  index.search_documents[id] = {
    id,
    entity_type: "channel",
    entity_id: id,
    title: `Agent channel ${record.agent}`,
    body: record.metadata_hash,
    tags: ["channel", "agent"],
    metadata: { agent: record.agent },
    updated_at: new Date().toISOString()
  };
}

function handlePlatformMembershipPurchased(index: IndexState, event: ProtocolEvent): void {
  const pass_id = String(event.payload.pass_id);
  const record: PlatformMembershipRecord = {
    pass_id,
    owner_address: String(event.payload.owner ?? "0x0"),
    tier: Number(event.payload.tier ?? 0),
    started_at: isoFromMs(event.payload.started_ms, event),
    expires_at: isoFromMs(event.payload.expires_ms, event)
  };
  index.platform_memberships[pass_id] = record;
}

function handleAgentSubscriptionPurchased(index: IndexState, event: ProtocolEvent): void {
  const pass_id = String(event.payload.pass_id);
  const record: AgentSubscriptionRecord = {
    pass_id,
    owner_address: String(event.payload.owner ?? "0x0"),
    agent: String(event.payload.agent ?? "0x0"),
    tier: Number(event.payload.tier ?? 0),
    started_at: isoFromMs(event.payload.started_ms, event),
    expires_at: isoFromMs(event.payload.expires_ms, event)
  };
  index.agent_subscriptions[pass_id] = record;
}

function handleAccessReceiptRecorded(index: IndexState, event: ProtocolEvent): void {
  const id = String(event.payload.receipt_id);
  const record: AccessReceiptRecord = {
    id,
    period_id: Number(event.payload.period_id ?? 0),
    user: String(event.payload.user ?? "0x0"),
    report_id: String(event.payload.report_id ?? ""),
    agent: String(event.payload.agent ?? "0x0"),
    access_type: accessTypeFromEvent(event.payload.access_type),
    created_at: isoFromMs(event.payload.created_ms, event)
  };
  index.access_receipts[id] = record;
}

function ensureDelegation(index: IndexState, id: string, event: ProtocolEvent): DelegationJobRecord {
  const existing = index.delegations[id];
  if (existing) return existing;
  const created_at = isoFromMs(event.payload.created_ms, event);
  const record: DelegationJobRecord = {
    id,
    buyer: String(event.payload.buyer ?? "0x0"),
    agent: String(event.payload.agent ?? "0x0"),
    budget: Number(event.payload.budget ?? 0),
    deadline_at: event.payload.deadline_ms ? isoFromMs(event.payload.deadline_ms, event) : undefined,
    status: "open",
    created_at,
    updated_at: created_at
  };
  index.delegations[id] = record;
  return record;
}

function handleDelegationCreated(index: IndexState, event: ProtocolEvent): void {
  const id = String(event.payload.job_id);
  const record = ensureDelegation(index, id, event);
  record.buyer = String(event.payload.buyer ?? record.buyer);
  record.agent = String(event.payload.agent ?? record.agent);
  record.budget = Number(event.payload.budget ?? record.budget);
  record.deadline_at = event.payload.deadline_ms ? isoFromMs(event.payload.deadline_ms, event) : record.deadline_at;
  record.status = "open";
  record.updated_at = isoFromMs(event.payload.created_ms, event);
  index.search_documents[id] = {
    id,
    entity_type: "delegation",
    entity_id: id,
    title: `Delegation ${id}`,
    body: `${record.buyer} ${record.agent}`,
    tags: ["delegation", record.status],
    metadata: { buyer: record.buyer, agent: record.agent },
    updated_at: new Date().toISOString()
  };
}

function updateDelegation(index: IndexState, event: ProtocolEvent, status: DelegationJobRecord["status"]): DelegationJobRecord {
  const id = String(event.payload.job_id);
  const record = ensureDelegation(index, id, event);
  record.status = status;
  record.updated_at = isoFromMs(event.payload.created_ms, event);
  return record;
}

function handleDelegationResultSubmitted(index: IndexState, event: ProtocolEvent): void {
  const record = updateDelegation(index, event, "submitted");
  record.result_report_id = String(event.payload.report_id ?? record.result_report_id ?? "");
}

function handleDelegationCompleted(index: IndexState, event: ProtocolEvent): void {
  const record = updateDelegation(index, event, "completed");
  record.payout = Number(event.payload.payout ?? 0);
}

function handleDelegationRefunded(index: IndexState, event: ProtocolEvent): void {
  const record = updateDelegation(index, event, Number(event.payload.amount ?? 0) > 0 ? "refunded" : "expired");
  record.refund = Number(event.payload.amount ?? 0);
}

function handleDelegationDisputeOpened(index: IndexState, event: ProtocolEvent): void {
  const record = updateDelegation(index, event, "disputed");
  record.arbitrator = String(event.payload.arbitrator ?? "");
}

function handleDelegationDisputeResolved(index: IndexState, event: ProtocolEvent): void {
  const record = updateDelegation(index, event, "resolved");
  record.refund = Number(event.payload.buyer_amount ?? 0);
  record.payout = Number(event.payload.agent_amount ?? 0);
}

function ensureAgentEarnings(index: IndexState, agent: string, event: ProtocolEvent): AgentEarningsRecord {
  const existing = index.agent_earnings[agent];
  if (existing) return existing;
  const record: AgentEarningsRecord = {
    agent,
    total_earned: 0,
    total_claimed: 0,
    updated_at: isoFromEvent(event)
  };
  index.agent_earnings[agent] = record;
  return record;
}

function handleAgentSubscriptionPaid(index: IndexState, event: ProtocolEvent): void {
  const agent = String(event.payload.agent ?? "0x0");
  const amount = Number(event.payload.amount ?? 0);
  const platformFee = Number(event.payload.platform_fee ?? 0);
  const earnings = ensureAgentEarnings(index, agent, event);
  earnings.total_earned += Math.max(0, amount - platformFee);
  earnings.updated_at = isoFromMs(event.payload.created_ms, event);
}

function handleMembershipSettlementCreated(index: IndexState, event: ProtocolEvent): void {
  const id = `${eventKey(event)}:membership`;
  const record: MembershipSettlementRecord = {
    id,
    period_id: Number(event.payload.period_id ?? 0),
    user: String(event.payload.user ?? "0x0"),
    report_count: Number(event.payload.report_count ?? 0),
    net_amount: Number(event.payload.net_amount ?? 0),
    amount_per_report: Number(event.payload.amount_per_report ?? 0),
    created_at: isoFromMs(event.payload.created_ms, event)
  };
  index.membership_settlements[id] = record;
}

function handleMembershipReportSettled(index: IndexState, event: ProtocolEvent): void {
  const id = `${event.payload.period_id ?? 0}:${event.payload.user ?? "0x0"}:${event.payload.report_id ?? ""}:${eventKey(event)}`;
  const agent = String(event.payload.agent ?? "0x0");
  const amount = Number(event.payload.amount ?? 0);
  const record: MembershipSettlementRecord = {
    id,
    period_id: Number(event.payload.period_id ?? 0),
    user: String(event.payload.user ?? "0x0"),
    report_id: String(event.payload.report_id ?? ""),
    agent,
    report_count: 1,
    net_amount: amount,
    amount_per_report: amount,
    created_at: isoFromMs(event.payload.created_ms, event)
  };
  index.membership_settlements[id] = record;
  const earnings = ensureAgentEarnings(index, agent, event);
  earnings.total_earned += amount;
  earnings.updated_at = record.created_at;
}

function handleAgentEarningsClaimed(index: IndexState, event: ProtocolEvent): void {
  const agent = String(event.payload.agent ?? "0x0");
  const earnings = ensureAgentEarnings(index, agent, event);
  earnings.total_claimed += Number(event.payload.amount ?? 0);
  earnings.updated_at = isoFromMs(event.payload.created_ms, event);
}

function ensurePool(index: IndexState, id: string, event: ProtocolEvent): RevenuePoolRecord {
  const existing = index.revenue_pools[id];
  if (existing) {
    return existing;
  }
  const pool: RevenuePoolRecord = {
    id,
    asset_id: String(event.payload.asset_id ?? ""),
    recipients: (event.payload.recipients as string[] | undefined) ?? [],
    weights_bps: (event.payload.weights_bps as number[] | undefined) ?? [],
    total_received: 0,
    total_claimed: 0,
    claimed_by: {},
    created_at: isoFromEvent(event),
    updated_at: isoFromEvent(event)
  };
  index.revenue_pools[id] = pool;
  return pool;
}

function handleRevenuePoolCreated(index: IndexState, event: ProtocolEvent): void {
  ensurePool(index, String(event.payload.pool_id), event);
}

function handleRevenueDeposited(index: IndexState, event: ProtocolEvent): void {
  const pool = ensurePool(index, String(event.payload.pool_id), event);
  // The event carries the authoritative cumulative total after this deposit.
  pool.total_received = Number(event.payload.total_received ?? pool.total_received + Number(event.payload.amount ?? 0));
  pool.updated_at = isoFromEvent(event);
}

function handleRevenueClaimed(index: IndexState, event: ProtocolEvent): void {
  const pool = ensurePool(index, String(event.payload.pool_id), event);
  const amount = Number(event.payload.amount ?? 0);
  const claimer = String(event.payload.claimer ?? "0x0");
  pool.total_claimed += amount;
  pool.claimed_by[claimer] = (pool.claimed_by[claimer] ?? 0) + amount;
  pool.updated_at = isoFromEvent(event);
}

function handleAgentPassportCreated(index: IndexState, event: ProtocolEvent): void {
  const id = String(event.payload.passport_id);
  const agent: AgentPassport = {
    id,
    sui_object_id: String(event.payload.sui_object_id ?? id),
    owner_address: String(event.payload.owner ?? "0x0"),
    name: bytesToText(event.payload.name ?? event.payload.name_hash) || id,
    metadata: {
      github_hash: bytesToText(event.payload.github_hash),
      scopes_hash: bytesToText(event.payload.scopes_hash)
    },
    reputation: 0,
    created_at: isoFromEvent(event)
  };
  index.agents[id] = agent;
  index.search_documents[id] = {
    id,
    entity_type: "agent",
    entity_id: id,
    title: agent.name,
    body: `${agent.owner_address}`,
    tags: ["agent"],
    metadata: { owner_address: agent.owner_address },
    updated_at: new Date().toISOString()
  };
}

function handleReputationCreated(index: IndexState, event: ProtocolEvent): void {
  const id = String(event.payload.reputation_id);
  const record: ReputationRecord = {
    id,
    owner_address: String(event.payload.owner ?? "0x0"),
    score: Number(event.payload.score ?? 0),
    created_at: isoFromEvent(event),
    updated_at: isoFromEvent(event)
  };
  index.reputations[id] = record;
}

function handleReputationAdjusted(index: IndexState, event: ProtocolEvent): void {
  const id = String(event.payload.reputation_id);
  const record = index.reputations[id] ?? {
    id,
    owner_address: String(event.payload.owner ?? "0x0"),
    score: 0,
    created_at: isoFromEvent(event),
    updated_at: isoFromEvent(event)
  };
  record.score = Number(event.payload.new_score ?? record.score);
  record.updated_at = isoFromEvent(event);
  index.reputations[id] = record;
}

function handleBadgeIssued(index: IndexState, event: ProtocolEvent): void {
  const id = String(event.payload.badge_id);
  const record: BadgeRecord = {
    id,
    asset_id: String(event.payload.asset_id ?? ""),
    recipient: String(event.payload.recipient ?? "0x0"),
    issuer: String(event.payload.issuer ?? "0x0"),
    badge_type: Number(event.payload.badge_type ?? 0),
    metadata_hash: bytesToText(event.payload.metadata_hash),
    created_at: isoFromEvent(event)
  };
  index.badges[id] = record;
}

function handleCrossChainPayment(index: IndexState, event: ProtocolEvent): void {
  const orderHash = bytesToText(event.payload.order_hash) || String(event.payload.order_hash);
  const record: CrossChainPaymentRecord = {
    order_hash: orderHash,
    source_chain: bytesToText(event.payload.source_chain),
    source_tx: bytesToText(event.payload.source_tx),
    buyer: String(event.payload.buyer ?? "0x0"),
    amount: Number(event.payload.amount ?? 0),
    created_at: isoFromEvent(event)
  };
  index.payments[orderHash] = record;
}

/** Apply a single protocol event to the index. Idempotent: an already-processed event
 *  (same tx_digest:event_seq) is a no-op, so replays and at-least-once delivery are safe. */
export async function applyEvent(index: IndexState, event: ProtocolEvent, options: ApplyOptions = {}): Promise<IndexState> {
  const key = eventKey(event);
  if (index.processed_event_keys.includes(key)) {
    return index;
  }
  switch (event.event_type) {
    case "ResearchAssetPublished":
      await handleAssetPublished(index, event, options);
      break;
    case "SkillPublished":
      handleSkillPublished(index, event);
      break;
    case "SkillInstalled":
      handleSkillInstalled(index, event);
      break;
    case "AssetCited":
      handleAssetCited(index, event);
      break;
    case "AssetForked":
      handleAssetForked(index, event);
      break;
    case "AssetRelationshipRegistered":
      handleRelationship(index, event);
      break;
    case "ResearchReportPublished":
      handleResearchReportPublished(index, event);
      break;
    case "AgentChannelCreated":
      handleAgentChannelCreated(index, event);
      break;
    case "PlatformMembershipPurchased":
      handlePlatformMembershipPurchased(index, event);
      break;
    case "AgentSubscriptionPurchased":
      handleAgentSubscriptionPurchased(index, event);
      break;
    case "AccessReceiptRecorded":
      handleAccessReceiptRecorded(index, event);
      break;
    case "DelegationCreated":
      handleDelegationCreated(index, event);
      break;
    case "DelegationAccepted":
      updateDelegation(index, event, "accepted");
      break;
    case "DelegationFunded":
      updateDelegation(index, event, "funded");
      break;
    case "DelegationResultSubmitted":
      handleDelegationResultSubmitted(index, event);
      break;
    case "DelegationCompleted":
      handleDelegationCompleted(index, event);
      break;
    case "DelegationRefunded":
      handleDelegationRefunded(index, event);
      break;
    case "DelegationDisputeOpened":
      handleDelegationDisputeOpened(index, event);
      break;
    case "DelegationDisputeResolved":
      handleDelegationDisputeResolved(index, event);
      break;
    case "AgentSubscriptionPaid":
      handleAgentSubscriptionPaid(index, event);
      break;
    case "MembershipSettlementCreated":
      handleMembershipSettlementCreated(index, event);
      break;
    case "MembershipReportSettled":
      handleMembershipReportSettled(index, event);
      break;
    case "AgentEarningsClaimed":
      handleAgentEarningsClaimed(index, event);
      break;
    case "RevenuePoolCreated":
      handleRevenuePoolCreated(index, event);
      break;
    case "RevenueDeposited":
      handleRevenueDeposited(index, event);
      break;
    case "RevenueClaimed":
      handleRevenueClaimed(index, event);
      break;
    case "AgentPassportCreated":
      handleAgentPassportCreated(index, event);
      break;
    case "ReputationCreated":
      handleReputationCreated(index, event);
      break;
    case "ReputationAdjusted":
      handleReputationAdjusted(index, event);
      break;
    case "BadgeIssued":
      handleBadgeIssued(index, event);
      break;
    case "CrossChainPaymentReceived":
      handleCrossChainPayment(index, event);
      break;
    default:
      // Unknown event types are still recorded in the log below for forward compatibility.
      break;
  }
  index.events.push(event);
  index.processed_event_keys.push(key);
  return index;
}

/** Fold a batch of events into the index, in log order. */
export async function applyEvents(index: IndexState, events: ProtocolEvent[], options: ApplyOptions = {}): Promise<IndexState> {
  for (const event of events) {
    await applyEvent(index, event, options);
  }
  return index;
}

export async function replayIndexer(options: ReplayOptions = {}): Promise<IndexState> {
  const events = await readEvents(options.localnetRoot);
  const fromCheckpoint = options.fromCheckpoint ?? 0;
  const index = emptyIndexState();
  const filtered = events.filter((candidate) => candidate.checkpoint >= fromCheckpoint);
  await applyEvents(index, filtered, { localnetRoot: options.localnetRoot });
  index.updated_at = new Date().toISOString();
  await writeIndex(index, options.localnetRoot);
  return index;
}

export async function searchIndex(query = "", type?: string, localnetRoot?: string) {
  const index = await readIndex(localnetRoot);
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

  return Object.values(index.search_documents)
    .filter((document) => !type || type === "asset" && document.entity_type === "asset" || document.entity_type === type)
    .map((document) => {
      const haystack = `${document.title}\n${document.body}\n${document.tags.join(" ")}`.toLowerCase();
      const score = terms.length === 0 ? 1 : terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      return { ...document, score };
    })
    .filter((document) => document.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

export async function getGraph(assetId: string, localnetRoot?: string) {
  const index = await readIndex(localnetRoot);
  const edges = Object.values(index.relationships).filter((edge) => edge.src_id === assetId || edge.dst_id === assetId);
  const nodeIds = new Set([assetId]);
  for (const edge of edges) {
    nodeIds.add(edge.src_id);
    nodeIds.add(edge.dst_id);
  }
  const nodes = [...nodeIds].map((id) => ({
    id,
    label: index.assets[id]?.title ?? index.skills[id]?.name ?? id,
    type: index.assets[id] ? "asset" : index.skills[id] ? "skill" : "external"
  }));
  return { nodes, edges };
}

export interface AssetEconomics {
  asset_id: string;
  revenue_pools: RevenuePoolRecord[];
  reports: ResearchReportRecord[];
  access_receipts: AccessReceiptRecord[];
  membership_settlements: MembershipSettlementRecord[];
  agent_earnings: AgentEarningsRecord[];
  report_count: number;
  access_count: number;
  total_received: number;
  total_claimed: number;
  unclaimed: number;
}

/** Aggregate the economic state for an asset: legacy revenue pools plus the Seal Access
 *  report/read/settlement state. NOTE: reflects indexed events only. */
export function summarizeAssetEconomics(index: IndexState, assetId: string): AssetEconomics {
  const revenue_pools = Object.values(index.revenue_pools).filter((pool) => pool.asset_id === assetId);
  const reports = Object.values(index.reports).filter((report) => report.asset_id === assetId);
  const reportIds = new Set(reports.map((report) => report.id));
  const access_receipts = Object.values(index.access_receipts).filter((receipt) => reportIds.has(receipt.report_id));
  const membership_settlements = Object.values(index.membership_settlements).filter((settlement) =>
    settlement.report_id ? reportIds.has(settlement.report_id) : false
  );
  const agentIds = new Set(reports.map((report) => report.agent));
  const agent_earnings = Object.values(index.agent_earnings).filter((earnings) => agentIds.has(earnings.agent));
  const total_received = revenue_pools.reduce((sum, pool) => sum + pool.total_received, 0);
  const total_claimed = revenue_pools.reduce((sum, pool) => sum + pool.total_claimed, 0);
  return {
    asset_id: assetId,
    revenue_pools,
    reports,
    access_receipts,
    membership_settlements,
    agent_earnings,
    report_count: reports.length,
    access_count: access_receipts.length,
    total_received,
    total_claimed,
    unclaimed: total_received - total_claimed
  };
}
