import { ZSTDDecoder } from "zstddec/stream";

export const DEFAULT_LIVE_INDEX_RPC_URL = "https://sui-testnet-rpc.publicnode.com";
export const DEFAULT_LIVE_INDEX_PACKAGE_ID = "0x5ecd097d8f13e995493d23c9b033c815bd6a8bf771331c389c027296e8b8231e";
export const DEFAULT_LIVE_INDEX_WALRUS_AGGREGATOR_URL = "https://aggregator.walrus-testnet.walrus.space";

interface SuiEvent {
  id?: { txDigest?: string; eventSeq?: string };
  type?: string;
  packageId?: string;
  transactionModule?: string;
  sender?: string;
  parsedJson?: Record<string, unknown>;
  timestampMs?: string;
}

interface SuiObjectResponse {
  data?: {
    objectId?: string;
    type?: string;
    owner?: { AddressOwner?: string };
    content?: { fields?: Record<string, unknown> };
  };
}

interface SuiTxResponse {
  digest?: string;
  transaction?: {
    data?: {
      sender?: string;
      gasData?: { owner?: string };
    };
  };
  effects?: { status?: { status?: string } };
  balanceChanges?: Array<{
    owner?: string | { AddressOwner?: string; ObjectOwner?: string };
    coinType?: string;
    amount?: string;
  }>;
}

interface ReleaseSkill {
  id?: string;
  manifest_id?: string;
  source_asset_id?: string;
  path?: string;
  manifest?: {
    name?: string;
    version?: string;
    description?: string;
    capabilities?: string[];
    relation?: string;
    entry?: string;
    access?: { visibility?: string };
    tests?: string[];
    depends_on?: string[];
    derived_from?: string | null;
  };
}

interface ReleaseWorkflow {
  id?: string;
  manifest_id?: string;
  source_asset_id?: string;
  path?: string;
  manifest?: {
    name?: string;
    version?: string;
    description?: string;
    inputs?: string[];
    outputs?: string[];
    stages?: Array<{ id?: string; name?: string; instructions?: string }>;
    quality_gates?: Array<{ id?: string; check?: string }>;
    tools?: string[];
  };
}

interface ReleaseRelationship {
  src_id?: string;
  dst_id?: string;
  relation_type?: string;
  metadata?: Record<string, unknown>;
}

interface ReleaseManifest {
  repo?: string;
  commit?: string;
  created_at?: string;
  manifest_hash?: string;
  files?: Array<{ path?: string }>;
  assets?: {
    id?: string;
    title?: string;
    abstract?: string;
    types?: string[];
    authors?: Array<{ name?: string; github?: string; agent_id?: string; type?: string }>;
    assets?: {
      paper?: {
        path?: string;
        source?: string;
        bib?: string;
        html?: string;
        word?: string;
        doc?: string;
        docx?: string;
        ppt?: string;
        pptx?: string;
      };
    };
  };
  skills?: ReleaseSkill[];
  workflows?: ReleaseWorkflow[];
  relationships?: ReleaseRelationship[];
}

export interface LiveIndexAsset {
  id: string;
  title: string;
  authors: string;
  abstract: string;
  types: string[];
  created_at: string;
  manifest_hash: string;
  manifest_hash_verified: boolean;
  repo_url?: string;
  repo_commit: string;
  walrus_blob_id: string;
  sui_object_id: string;
  event_owner_address: string;
  creator_address: string;
  object_owner_address: string;
  tx_sender: string;
  gas_owner: string;
  sui_spent_mist: string;
  tx_digest: string;
  href?: string;
  release_manifest_status: "resolved" | "unavailable";
  release_error?: string;
  paper?: {
    html_path?: string;
    pdf_path?: string;
    source_path?: string;
    bib_path?: string;
    word_path?: string;
    ppt_path?: string;
    readme_path?: string;
  };
  skills: Array<{
    id: string;
    global_ref: string;
    manifest_id: string;
    source_asset_id: string;
    on_chain_status: "published" | "missing";
    name: string;
    version: string;
    description: string;
    capabilities: string[];
    path: string;
    relation: string;
    entry_path: string;
    access_visibility: string;
    depends_on: string[];
    derived_from: string | null;
  }>;
  workflows: Array<{
    id: string;
    global_ref: string;
    manifest_id: string;
    source_asset_id: string;
    name: string;
    version: string;
    description: string;
    path: string;
    inputs: string[];
    outputs: string[];
    stages: Array<{ id: string; name: string; instructions: string }>;
    quality_gates: Array<{ id: string; check: string }>;
    tools: string[];
  }>;
  relationships: Array<{
    src_id: string;
    dst_id: string;
    relation_type: string;
    metadata: Record<string, unknown>;
  }>;
  proof: {
    tx_success: boolean;
    sender_match: boolean;
    object_type_match: boolean;
    owner_match: boolean;
    gas_paid: boolean;
    blob_match: boolean;
    manifest_match: boolean;
    release_manifest_match: boolean;
  };
}

interface PublishedSkillRef {
  skillObjectId: string;
  sourceAssetId: string;
  manifestId: string;
}

export interface LiveIndexMembershipEvent {
  tx_digest: string;
  event_seq: string;
  event_type: string;
  module: string;
  timestamp_ms: string;
  created_at: string;
  signer: string;
  gas_owner: string;
  sui_spent_mist: string;
  subject_address: string;
  object_id: string;
  agent_address: string;
  report_id: string;
  period_id: string;
  access_type: string;
  tier: string;
  amount_mist: string;
  platform_fee_mist: string;
  duration_ms: string;
  started_at: string;
  expires_at: string;
}

export interface LiveIndexMembershipSummary {
  source: "live-sui-testnet-events";
  event_types: string[];
  counts: {
    platform_membership_passes: number;
    platform_membership_payments: number;
    agent_subscription_passes: number;
    agent_subscription_payments: number;
    access_receipts: number;
    membership_settlements: number;
    agent_earnings_claims: number;
    total_events: number;
  };
  recent_events: LiveIndexMembershipEvent[];
}

export interface LiveIndexDelegationEvent {
  tx_digest: string;
  event_seq: string;
  event_type: string;
  timestamp_ms: string;
  created_at: string;
  signer: string;
  gas_owner: string;
  sui_spent_mist: string;
  job_id: string;
  buyer: string;
  agent: string;
  arbitrator: string;
  report_id: string;
  amount_mist: string;
  budget_mist: string;
  deadline_at: string;
}

export interface LiveIndexDelegationSummary {
  source: "live-sui-testnet-events";
  event_types: string[];
  counts: {
    created: number;
    accepted: number;
    funded: number;
    submitted: number;
    completed: number;
    refunded: number;
    disputed: number;
    resolved: number;
    total_events: number;
  };
  recent_events: LiveIndexDelegationEvent[];
}

export interface LiveIndexResult {
  generated_at: string;
  source: "live-sui-testnet+walrus-release-manifest";
  rpc_url: string;
  package_id: string;
  event_type: string;
  aggregator_url: string;
  limit: number;
  query?: string;
  assets: LiveIndexAsset[];
  membership: LiveIndexMembershipSummary;
  delegations: LiveIndexDelegationSummary;
}

export interface BuildLiveIndexOptions {
  rpcUrl?: string;
  packageId?: string;
  aggregatorUrl?: string;
  limit?: number;
  query?: string;
}

let zstdDecoderPromise: Promise<ZSTDDecoder> | undefined;

export function liveIndexConfig(options: BuildLiveIndexOptions = {}) {
  const rpcUrl = options.rpcUrl ?? process.env.RN_TESTNET_SUI_RPC_URL ?? process.env.RN_SUI_RPC_URL ?? DEFAULT_LIVE_INDEX_RPC_URL;
  const packageId = options.packageId ?? process.env.RN_PACKAGE_ID ?? DEFAULT_LIVE_INDEX_PACKAGE_ID;
  const aggregatorUrl = options.aggregatorUrl ?? process.env.RN_WALRUS_AGGREGATOR_URL ?? process.env.WALRUS_AGGREGATOR_URL ?? DEFAULT_LIVE_INDEX_WALRUS_AGGREGATOR_URL;
  const limit = Math.max(1, Math.min(20, Number(options.limit ?? process.env.RN_SHOWCASE_EVENT_LIMIT ?? 6) || 6));
  const eventType = `${packageId}::research_asset::ResearchAssetPublished`;
  return { rpcUrl, packageId, aggregatorUrl, limit, eventType };
}

function routeSegment(id: string): string {
  if (/^[A-Za-z0-9._~-]+$/.test(id)) {
    return id;
  }
  return Buffer.from(id, "utf8").toString("base64url");
}

function bytesToString(value: unknown): string {
  if (Array.isArray(value)) {
    return String.fromCharCode(...value);
  }
  return typeof value === "string" ? value : "";
}

function normalizeRepoUrl(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  if (!/^https?:\/\//.test(text)) {
    return undefined;
  }
  return text.replace(/\.git$/, "").replace(/\/$/, "");
}

function authorLine(authors?: Array<{ name?: string; github?: string; agent_id?: string; type?: string }>): string {
  if (!Array.isArray(authors) || !authors.length) {
    return "Unknown";
  }
  return authors.map((author) => {
    const suffix = author?.agent_id ? ` (${author.agent_id})` : author?.github ? ` (@${author.github})` : author?.type ? ` (${author.type})` : "";
    return `${author?.name ?? "Unknown"}${suffix}`;
  }).join(", ");
}

async function rpcCall<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  if (!response.ok) {
    throw new Error(`RPC HTTP ${response.status}`);
  }
  const json = await response.json() as { error?: { message?: string }; result: T };
  if (json.error) {
    throw new Error(json.error.message ?? "RPC error");
  }
  return json.result;
}

async function zstdDecoder(): Promise<ZSTDDecoder> {
  zstdDecoderPromise ??= (async () => {
    const decoder = new ZSTDDecoder();
    await decoder.init();
    return decoder;
  })();
  return zstdDecoderPromise;
}

function tarString(bytes: Uint8Array, start: number, length: number): string {
  let end = start;
  while (end < start + length && bytes[end] !== 0) {
    end += 1;
  }
  return new TextDecoder().decode(bytes.slice(start, end)).trim();
}

function tarSize(bytes: Uint8Array, start: number): number {
  const raw = tarString(bytes, start + 124, 12).replace(/\0/g, "").trim();
  return raw ? Number.parseInt(raw, 8) || 0 : 0;
}

function readTarMember(bytes: Uint8Array, wanted: string): Uint8Array | undefined {
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const name = tarString(bytes, offset, 100);
    if (!name) {
      return undefined;
    }
    const prefix = tarString(bytes, offset + 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const size = tarSize(bytes, offset);
    const bodyStart = offset + 512;
    const normalized = fullName.replace(/^\.\//, "");
    if (fullName === wanted || normalized === wanted) {
      return bytes.slice(bodyStart, bodyStart + size);
    }
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  return undefined;
}

async function readReleaseArchive(blobId: string, aggregatorUrl: string): Promise<Uint8Array> {
  const response = await fetch(`${aggregatorUrl.replace(/\/$/, "")}/v1/blobs/${encodeURIComponent(blobId)}`, {
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`Walrus blob ${blobId} HTTP ${response.status}`);
  }
  const decoder = await zstdDecoder();
  return decoder.decode(new Uint8Array(await response.arrayBuffer()));
}

async function readReleaseManifest(blobId: string, aggregatorUrl: string): Promise<ReleaseManifest> {
  const tarBytes = await readReleaseArchive(blobId, aggregatorUrl);
  const manifestBytes = readTarMember(tarBytes, "manifest.json");
  if (!manifestBytes) {
    throw new Error(`Walrus blob ${blobId} does not contain manifest.json`);
  }
  return JSON.parse(new TextDecoder().decode(manifestBytes)) as ReleaseManifest;
}

function normalizeReleaseArtifactPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "").trim();
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.includes("\0") ||
    normalized.split("/").some((part) => part === "..")
  ) {
    throw new Error("invalid release artifact path");
  }
  return normalized;
}

export function releaseHasDeclaredFile(
  release: Pick<ReleaseManifest, "assets" | "files"> | undefined,
  artifactPath: string | undefined
): boolean {
  if (!release?.assets || !artifactPath) return false;
  let normalized: string;
  try {
    normalized = normalizeReleaseArtifactPath(artifactPath);
  } catch {
    return false;
  }
  if (!Array.isArray(release.files)) {
    return true;
  }
  return release.files.some((file) => {
    if (typeof file.path !== "string") return false;
    try {
      return normalizeReleaseArtifactPath(file.path) === normalized;
    } catch {
      return false;
    }
  });
}

function releaseArtifactPath(
  release: Pick<ReleaseManifest, "assets" | "files"> | undefined,
  artifactPath: string | undefined
): string | undefined {
  return typeof artifactPath === "string" && artifactPath && releaseHasDeclaredFile(release, artifactPath)
    ? artifactPath
    : undefined;
}

function contentTypeForArtifact(path: string): string {
  if (/\.html?$/i.test(path)) return "text/html; charset=utf-8";
  if (/\.pdf$/i.test(path)) return "application/pdf";
  if (/\.md$/i.test(path)) return "text/markdown; charset=utf-8";
  if (/\.tex$/i.test(path)) return "application/x-tex; charset=utf-8";
  if (/\.pptx$/i.test(path)) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (/\.ppt$/i.test(path)) return "application/vnd.ms-powerpoint";
  if (/\.json$/i.test(path)) return "application/json; charset=utf-8";
  if (/\.ya?ml$/i.test(path)) return "application/yaml; charset=utf-8";
  if (/\.bib$/i.test(path)) return "text/plain; charset=utf-8";
  if (/\.word$/i.test(path)) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (/\.docx$/i.test(path)) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (/\.doc$/i.test(path)) return "application/msword";
  return "application/octet-stream";
}

export async function readLiveReleaseArtifact(input: {
  blobId: string;
  path: string;
  aggregatorUrl?: string;
}): Promise<{ path: string; filename: string; contentType: string; bytes: Uint8Array } | undefined> {
  const artifactPath = normalizeReleaseArtifactPath(input.path);
  const tarBytes = await readReleaseArchive(input.blobId, input.aggregatorUrl ?? DEFAULT_LIVE_INDEX_WALRUS_AGGREGATOR_URL);
  const bytes = readTarMember(tarBytes, artifactPath);
  if (!bytes) return undefined;
  return {
    path: artifactPath,
    filename: artifactPath.split("/").pop() || "artifact",
    contentType: contentTypeForArtifact(artifactPath),
    bytes
  };
}

function createdAt(release: ReleaseManifest, parsed: Record<string, unknown>): string {
  if (release.created_at) {
    return release.created_at;
  }
  const ms = Number(parsed.created_ms);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : "";
}

export function matchesLiveIndexQuery(asset: LiveIndexAsset, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) {
    return true;
  }
  return [
    asset.id,
    asset.title,
    asset.authors,
    asset.abstract,
    asset.types.join(" "),
    (asset.skills ?? []).map((skill) => [skill.id, skill.name, skill.description, skill.relation].join(" ")).join("\n"),
    (asset.workflows ?? []).map((workflow) => [workflow.id, workflow.name, workflow.description, workflow.inputs.join(" "), workflow.outputs.join(" ")].join(" ")).join("\n"),
    (asset.relationships ?? []).map((relationship) => [relationship.src_id, relationship.dst_id, relationship.relation_type].join(" ")).join("\n"),
    asset.sui_object_id,
    asset.tx_digest,
    asset.walrus_blob_id,
    asset.manifest_hash,
    asset.event_owner_address,
    asset.creator_address,
    asset.object_owner_address,
    asset.tx_sender,
    asset.gas_owner,
    asset.sui_spent_mist,
    asset.repo_url ?? "",
    asset.repo_commit
  ].join("\n").toLowerCase().includes(q);
}

function ownerAddress(owner: unknown): string {
  if (typeof owner === "string") {
    return owner;
  }
  if (owner && typeof owner === "object") {
    const record = owner as { AddressOwner?: unknown; ObjectOwner?: unknown };
    if (typeof record.AddressOwner === "string") return record.AddressOwner;
    if (typeof record.ObjectOwner === "string") return record.ObjectOwner;
  }
  return "";
}

function msIso(value: unknown): string {
  const ms = Number(value);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : "";
}

function suiSpentMist(txData: SuiTxResponse | undefined, owner: string): string {
  const target = owner.toLowerCase();
  if (!target || !Array.isArray(txData?.balanceChanges)) {
    return "";
  }
  let spent = 0n;
  for (const change of txData.balanceChanges) {
    if (change.coinType !== "0x2::sui::SUI") continue;
    if (ownerAddress(change.owner).toLowerCase() !== target) continue;
    const amount = BigInt(change.amount ?? "0");
    if (amount < 0n) {
      spent += -amount;
    }
  }
  return spent > 0n ? spent.toString() : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function releaseSkillManifestId(skill: ReleaseSkill): string {
  const manifest = skill.manifest ?? {};
  const name = String(manifest.name ?? skill.id ?? "Unnamed skill");
  const version = String(manifest.version ?? "");
  return String(skill.manifest_id ?? skill.id ?? (version ? `skill:${name}@${version}` : `skill:${name}`));
}

function releaseWorkflowManifestId(workflow: ReleaseWorkflow): string {
  const manifest = workflow.manifest ?? {};
  const name = String(manifest.name ?? workflow.id ?? "Unnamed workflow");
  const version = String(manifest.version ?? "");
  return String(workflow.manifest_id ?? workflow.id ?? (version ? `workflow:${name}@${version}` : `workflow:${name}`));
}

function scopedLiveChildRef(kind: "skill" | "workflow", sourceAssetId: string, manifestId: string): string {
  return `rn:${kind}:sui-testnet:${sourceAssetId}:${manifestId}`;
}

function normalizeReleaseSkills(
  release: ReleaseManifest,
  sourceAssetId: string,
  publishedSkills: Map<string, PublishedSkillRef>
): LiveIndexAsset["skills"] {
  return (Array.isArray(release.skills) ? release.skills : []).map((skill) => {
    const manifest = skill.manifest ?? {};
    const name = String(manifest.name ?? skill.id ?? "Unnamed skill");
    const version = String(manifest.version ?? "");
    const manifestId = releaseSkillManifestId(skill);
    const globalRef = scopedLiveChildRef("skill", sourceAssetId, manifestId);
    const published = publishedSkills.get(`${sourceAssetId}\n${manifestId}`);
    const entry = String(manifest.entry ?? "SKILL.md").replace(/^\/+/, "");
    const rawPath = String(skill.path ?? "").replace(/^\/+/, "");
    const basePath = /\.ya?ml$/i.test(rawPath)
      ? rawPath.split("/").slice(0, -1).join("/")
      : rawPath.replace(/\/?$/, "");
    return {
      id: published?.skillObjectId ?? globalRef,
      global_ref: globalRef,
      manifest_id: manifestId,
      source_asset_id: sourceAssetId,
      on_chain_status: published ? "published" : "missing",
      name,
      version,
      description: String(manifest.description ?? ""),
      capabilities: stringArray(manifest.capabilities),
      path: String(skill.path ?? ""),
      relation: String(manifest.relation ?? "owned"),
      entry_path: basePath ? `${basePath}/${entry}` : entry,
      access_visibility: String(manifest.access?.visibility ?? "public"),
      depends_on: stringArray(manifest.depends_on),
      derived_from: manifest.derived_from ? String(manifest.derived_from) : null
    };
  });
}

function normalizeReleaseWorkflows(release: ReleaseManifest, sourceAssetId: string): LiveIndexAsset["workflows"] {
  return (Array.isArray(release.workflows) ? release.workflows : []).map((workflow) => {
    const manifest = workflow.manifest ?? {};
    const name = String(manifest.name ?? workflow.id ?? "Unnamed workflow");
    const version = String(manifest.version ?? "");
    const manifestId = releaseWorkflowManifestId(workflow);
    const globalRef = scopedLiveChildRef("workflow", sourceAssetId, manifestId);
    return {
      id: globalRef,
      global_ref: globalRef,
      manifest_id: manifestId,
      source_asset_id: sourceAssetId,
      name,
      version,
      description: String(manifest.description ?? ""),
      path: String(workflow.path ?? ""),
      inputs: stringArray(manifest.inputs),
      outputs: stringArray(manifest.outputs),
      stages: (Array.isArray(manifest.stages) ? manifest.stages : []).map((stage) => ({
        id: String(stage?.id ?? ""),
        name: String(stage?.name ?? stage?.id ?? "Workflow stage"),
        instructions: String(stage?.instructions ?? "")
      })),
      quality_gates: (Array.isArray(manifest.quality_gates) ? manifest.quality_gates : []).map((gate) => ({
        id: String(gate?.id ?? ""),
        check: String(gate?.check ?? "")
      })),
      tools: stringArray(manifest.tools)
    };
  });
}

function releaseChildIdMap(
  release: ReleaseManifest,
  sourceAssetId: string,
  publishedSkills: Map<string, PublishedSkillRef>
): Map<string, string> {
  const map = new Map<string, string>();
  const manifestAssetId = release.assets?.id ? String(release.assets.id) : "";
  if (manifestAssetId) map.set(manifestAssetId, sourceAssetId);
  for (const skill of Array.isArray(release.skills) ? release.skills : []) {
    const manifestId = releaseSkillManifestId(skill);
    const published = publishedSkills.get(`${sourceAssetId}\n${manifestId}`);
    const id = published?.skillObjectId ?? scopedLiveChildRef("skill", sourceAssetId, manifestId);
    if (skill.id) map.set(String(skill.id), id);
    map.set(manifestId, id);
  }
  for (const workflow of Array.isArray(release.workflows) ? release.workflows : []) {
    const manifestId = releaseWorkflowManifestId(workflow);
    const id = scopedLiveChildRef("workflow", sourceAssetId, manifestId);
    if (workflow.id) map.set(String(workflow.id), id);
    map.set(manifestId, id);
  }
  return map;
}

function normalizeReleaseRelationships(
  release: ReleaseManifest,
  sourceAssetId: string,
  publishedSkills: Map<string, PublishedSkillRef>
): LiveIndexAsset["relationships"] {
  const idMap = releaseChildIdMap(release, sourceAssetId, publishedSkills);
  return (Array.isArray(release.relationships) ? release.relationships : [])
    .map((relationship) => ({
      src_id: idMap.get(String(relationship.src_id ?? "")) ?? String(relationship.src_id ?? ""),
      dst_id: idMap.get(String(relationship.dst_id ?? "")) ?? String(relationship.dst_id ?? ""),
      relation_type: String(relationship.relation_type ?? ""),
      metadata: relationship.metadata && typeof relationship.metadata === "object" ? relationship.metadata : {}
    }))
    .filter((relationship) => relationship.src_id && relationship.dst_id && relationship.relation_type);
}

function buildAsset(input: {
  event: SuiEvent;
  objectData?: NonNullable<SuiObjectResponse["data"]>;
  txData?: SuiTxResponse;
  release?: ReleaseManifest;
  releaseError?: string;
  packageId: string;
  publishedSkills: Map<string, PublishedSkillRef>;
}): LiveIndexAsset {
  const parsed = input.event.parsedJson ?? {};
  const fields = input.objectData?.content?.fields ?? {};
  const release = input.release ?? {};
  const releaseAsset = release.assets ?? {};
  const paper = releaseAsset.assets?.paper ?? {};
  const manifestHash = bytesToString(parsed.manifest_hash);
  const objectManifestHash = bytesToString(fields.manifest_hash);
  const blobId = bytesToString(parsed.walrus_blob_id);
  const objectBlobId = bytesToString(fields.walrus_blob_id);
  const objectId = String(parsed.asset_id ?? input.objectData?.objectId ?? "");
  const txDigest = String(input.event.id?.txDigest ?? "");
  const eventOwner = String(parsed.owner ?? parsed.creator ?? "");
  const creator = String(parsed.creator ?? "");
  const objectOwner = String(input.objectData?.owner?.AddressOwner ?? "");
  const txSender = String(input.txData?.transaction?.data?.sender ?? "");
  const gasOwner = String(input.txData?.transaction?.data?.gasData?.owner ?? "");
  const spentMist = suiSpentMist(input.txData, gasOwner || txSender);
  const repoCommit = bytesToString(parsed.repo_commit) || String(release.commit ?? "");
  const assetId = objectId;
  const expectedType = `${input.packageId}::research_asset::ResearchAsset`;
  const eventOwnerLower = eventOwner.toLowerCase();
  const objectOwnerLower = objectOwner.toLowerCase();
  const txSenderLower = txSender.toLowerCase();
  const proof = {
    tx_success: input.txData?.effects?.status?.status === "success",
    sender_match: Boolean(txSenderLower && eventOwnerLower && txSenderLower === eventOwnerLower),
    object_type_match: input.objectData?.type === expectedType,
    owner_match: Boolean(eventOwnerLower && objectOwnerLower && eventOwnerLower === objectOwnerLower),
    gas_paid: Boolean(spentMist),
    blob_match: Boolean(blobId && objectBlobId && blobId === objectBlobId),
    manifest_match: Boolean(manifestHash && objectManifestHash && manifestHash === objectManifestHash),
    release_manifest_match: Boolean(release.manifest_hash && manifestHash && release.manifest_hash === manifestHash)
  };
  return {
    id: assetId,
    title: String(releaseAsset.title ?? `On-chain Research Asset v${String(parsed.version ?? fields.version ?? "?")}`),
    authors: authorLine(releaseAsset.authors),
    abstract: String(releaseAsset.abstract ?? ""),
    types: Array.isArray(releaseAsset.types) && releaseAsset.types.length ? releaseAsset.types : ["sui-testnet"],
    created_at: createdAt(release, parsed),
    manifest_hash: manifestHash,
    manifest_hash_verified: proof.release_manifest_match,
    repo_url: normalizeRepoUrl(release.repo),
    repo_commit: repoCommit,
    walrus_blob_id: blobId,
    sui_object_id: objectId,
    event_owner_address: eventOwner,
    creator_address: creator,
    object_owner_address: objectOwner,
    tx_sender: txSender,
    gas_owner: gasOwner,
    sui_spent_mist: spentMist,
    tx_digest: txDigest,
    href: `/asset.html?id=${routeSegment(assetId)}`,
    release_manifest_status: input.release ? "resolved" : "unavailable",
    release_error: input.releaseError,
    paper: {
      html_path: releaseArtifactPath(release, paper.html),
      pdf_path: releaseArtifactPath(release, paper.path),
      source_path: releaseArtifactPath(release, paper.source),
      bib_path: releaseArtifactPath(release, paper.bib),
      word_path: releaseArtifactPath(release, paper.word)
        ?? releaseArtifactPath(release, paper.docx)
        ?? releaseArtifactPath(release, paper.doc),
      ppt_path: releaseArtifactPath(release, paper.pptx)
        ?? releaseArtifactPath(release, paper.ppt),
      readme_path: releaseArtifactPath(release, "README.md")
    },
    skills: normalizeReleaseSkills(release, assetId, input.publishedSkills),
    workflows: normalizeReleaseWorkflows(release, assetId),
    relationships: normalizeReleaseRelationships(release, assetId, input.publishedSkills),
    proof
  };
}

const LIVE_MEMBERSHIP_EVENTS = [
  { module: "access", name: "PlatformMembershipPurchased" },
  { module: "settlement", name: "PlatformMembershipPaid" },
  { module: "access", name: "AgentSubscriptionPurchased" },
  { module: "settlement", name: "AgentSubscriptionPaid" },
  { module: "access", name: "AccessReceiptRecorded" },
  { module: "settlement", name: "MembershipSettlementCreated" },
  { module: "settlement", name: "MembershipReportSettled" },
  { module: "settlement", name: "AgentEarningsClaimed" }
] as const;

function zeroMembershipCounts(): LiveIndexMembershipSummary["counts"] {
  return {
    platform_membership_passes: 0,
    platform_membership_payments: 0,
    agent_subscription_passes: 0,
    agent_subscription_payments: 0,
    access_receipts: 0,
    membership_settlements: 0,
    agent_earnings_claims: 0,
    total_events: 0
  };
}

export function emptyLiveMembershipSummary(packageId: string): LiveIndexMembershipSummary {
  return {
    source: "live-sui-testnet-events",
    event_types: LIVE_MEMBERSHIP_EVENTS.map((entry) => `${packageId}::${entry.module}::${entry.name}`),
    counts: zeroMembershipCounts(),
    recent_events: []
  };
}

const LIVE_DELEGATION_EVENTS = [
  "DelegationCreated",
  "DelegationAccepted",
  "DelegationFunded",
  "DelegationResultSubmitted",
  "DelegationCompleted",
  "DelegationRefunded",
  "DelegationDisputeOpened",
  "DelegationDisputeResolved"
] as const;

function zeroDelegationCounts(): LiveIndexDelegationSummary["counts"] {
  return {
    created: 0,
    accepted: 0,
    funded: 0,
    submitted: 0,
    completed: 0,
    refunded: 0,
    disputed: 0,
    resolved: 0,
    total_events: 0
  };
}

export function emptyLiveDelegationSummary(packageId: string): LiveIndexDelegationSummary {
  return {
    source: "live-sui-testnet-events",
    event_types: LIVE_DELEGATION_EVENTS.map((name) => `${packageId}::delegation::${name}`),
    counts: zeroDelegationCounts(),
    recent_events: []
  };
}

function countMembershipEvent(counts: LiveIndexMembershipSummary["counts"], eventName: string): void {
  if (eventName === "PlatformMembershipPurchased") counts.platform_membership_passes += 1;
  else if (eventName === "PlatformMembershipPaid") counts.platform_membership_payments += 1;
  else if (eventName === "AgentSubscriptionPurchased") counts.agent_subscription_passes += 1;
  else if (eventName === "AgentSubscriptionPaid") counts.agent_subscription_payments += 1;
  else if (eventName === "AccessReceiptRecorded") counts.access_receipts += 1;
  else if (eventName === "MembershipSettlementCreated" || eventName === "MembershipReportSettled") counts.membership_settlements += 1;
  else if (eventName === "AgentEarningsClaimed") counts.agent_earnings_claims += 1;
  counts.total_events += 1;
}

function countDelegationEvent(counts: LiveIndexDelegationSummary["counts"], eventName: string): void {
  if (eventName === "DelegationCreated") counts.created += 1;
  else if (eventName === "DelegationAccepted") counts.accepted += 1;
  else if (eventName === "DelegationFunded") counts.funded += 1;
  else if (eventName === "DelegationResultSubmitted") counts.submitted += 1;
  else if (eventName === "DelegationCompleted") counts.completed += 1;
  else if (eventName === "DelegationRefunded") counts.refunded += 1;
  else if (eventName === "DelegationDisputeOpened") counts.disputed += 1;
  else if (eventName === "DelegationDisputeResolved") counts.resolved += 1;
  counts.total_events += 1;
}

function accessTypeName(value: unknown): string {
  if (value === 1 || value === "1" || value === "agent_subscription") return "agent_subscription";
  if (value === 0 || value === "0" || value === "platform_member") return "platform_member";
  return String(value ?? "");
}

function buildMembershipEvent(input: {
  event: SuiEvent;
  eventName: string;
  module: string;
  txData?: SuiTxResponse;
}): LiveIndexMembershipEvent {
  const parsed = input.event.parsedJson ?? {};
  const txDigest = String(input.event.id?.txDigest ?? "");
  const eventSeq = String(input.event.id?.eventSeq ?? "");
  const signer = String(input.txData?.transaction?.data?.sender ?? input.event.sender ?? "");
  const gasOwner = String(input.txData?.transaction?.data?.gasData?.owner ?? signer);
  const createdMs = parsed.created_ms ?? parsed.started_ms ?? input.event.timestampMs;
  return {
    tx_digest: txDigest,
    event_seq: eventSeq,
    event_type: input.eventName,
    module: input.module,
    timestamp_ms: String(input.event.timestampMs ?? createdMs ?? ""),
    created_at: msIso(createdMs),
    signer,
    gas_owner: gasOwner,
    sui_spent_mist: suiSpentMist(input.txData, gasOwner || signer),
    subject_address: String(parsed.owner ?? parsed.buyer ?? parsed.user ?? parsed.agent ?? ""),
    object_id: String(parsed.pass_id ?? parsed.receipt_id ?? ""),
    agent_address: String(parsed.agent ?? ""),
    report_id: String(parsed.report_id ?? ""),
    period_id: String(parsed.period_id ?? ""),
    access_type: accessTypeName(parsed.access_type),
    tier: parsed.tier == null ? "" : String(parsed.tier),
    amount_mist: parsed.amount == null ? "" : String(parsed.amount),
    platform_fee_mist: parsed.platform_fee == null ? "" : String(parsed.platform_fee),
    duration_ms: parsed.duration_ms == null ? "" : String(parsed.duration_ms),
    started_at: msIso(parsed.started_ms),
    expires_at: msIso(parsed.expires_ms)
  };
}

function buildDelegationEvent(input: {
  event: SuiEvent;
  eventName: string;
  txData?: SuiTxResponse;
}): LiveIndexDelegationEvent {
  const parsed = input.event.parsedJson ?? {};
  const signer = String(input.txData?.transaction?.data?.sender ?? input.event.sender ?? "");
  const gasOwner = String(input.txData?.transaction?.data?.gasData?.owner ?? signer);
  const createdMs = parsed.created_ms ?? input.event.timestampMs;
  return {
    tx_digest: String(input.event.id?.txDigest ?? ""),
    event_seq: String(input.event.id?.eventSeq ?? ""),
    event_type: input.eventName,
    timestamp_ms: String(input.event.timestampMs ?? createdMs ?? ""),
    created_at: msIso(createdMs),
    signer,
    gas_owner: gasOwner,
    sui_spent_mist: suiSpentMist(input.txData, gasOwner || signer),
    job_id: String(parsed.job_id ?? ""),
    buyer: String(parsed.buyer ?? ""),
    agent: String(parsed.agent ?? ""),
    arbitrator: String(parsed.arbitrator ?? ""),
    report_id: String(parsed.report_id ?? ""),
    amount_mist: parsed.amount == null ? (parsed.payout == null ? "" : String(parsed.payout)) : String(parsed.amount),
    budget_mist: parsed.budget == null ? "" : String(parsed.budget),
    deadline_at: msIso(parsed.deadline_ms)
  };
}

async function buildLiveMembershipSummary(input: {
  rpcUrl: string;
  packageId: string;
  limit: number;
}): Promise<LiveIndexMembershipSummary> {
  const eventTypes = LIVE_MEMBERSHIP_EVENTS.map((entry) => ({
    ...entry,
    type: `${input.packageId}::${entry.module}::${entry.name}`
  }));
  const pages = await Promise.all(eventTypes.map(async (entry) => {
    const page = await rpcCall<{ data?: SuiEvent[] }>(input.rpcUrl, "suix_queryEvents", [{ MoveEventType: entry.type }, null, input.limit, true]);
    return (page.data ?? []).map((event) => ({ event, entry }));
  }));
  const indexed = pages.flat().filter((item) => item.event.id?.txDigest);
  const txDigests = [...new Set(indexed.map((item) => String(item.event.id?.txDigest ?? "")).filter(Boolean))];
  let txResponses: SuiTxResponse[] = [];
  if (txDigests.length) {
    try {
      txResponses = await rpcCall<SuiTxResponse[]>(input.rpcUrl, "sui_multiGetTransactionBlocks", [
        txDigests,
        { showInput: true, showEffects: true, showEvents: true, showBalanceChanges: true }
      ]);
    } catch {
      txResponses = [];
    }
  }
  const txByDigest = new Map(txResponses.map((entry) => [entry.digest, entry]));
  const counts = zeroMembershipCounts();
  const recent_events = indexed.map((item) => {
    countMembershipEvent(counts, item.entry.name);
    return buildMembershipEvent({
      event: item.event,
      eventName: item.entry.name,
      module: item.entry.module,
      txData: txByDigest.get(String(item.event.id?.txDigest ?? ""))
    });
  }).sort((a, b) => Number(b.timestamp_ms || 0) - Number(a.timestamp_ms || 0)).slice(0, input.limit);

  return {
    source: "live-sui-testnet-events",
    event_types: eventTypes.map((entry) => entry.type),
    counts,
    recent_events
  };
}

async function buildLiveDelegationSummary(input: {
  rpcUrl: string;
  packageId: string;
  limit: number;
}): Promise<LiveIndexDelegationSummary> {
  const eventTypes = LIVE_DELEGATION_EVENTS.map((name) => ({
    name,
    type: `${input.packageId}::delegation::${name}`
  }));
  const pages = await Promise.all(eventTypes.map(async (entry) => {
    const page = await rpcCall<{ data?: SuiEvent[] }>(input.rpcUrl, "suix_queryEvents", [{ MoveEventType: entry.type }, null, input.limit, true]);
    return (page.data ?? []).map((event) => ({ event, entry }));
  }));
  const indexed = pages.flat().filter((item) => item.event.id?.txDigest);
  const txDigests = [...new Set(indexed.map((item) => String(item.event.id?.txDigest ?? "")).filter(Boolean))];
  let txResponses: SuiTxResponse[] = [];
  if (txDigests.length) {
    try {
      txResponses = await rpcCall<SuiTxResponse[]>(input.rpcUrl, "sui_multiGetTransactionBlocks", [
        txDigests,
        { showInput: true, showEffects: true, showEvents: true, showBalanceChanges: true }
      ]);
    } catch {
      txResponses = [];
    }
  }
  const txByDigest = new Map(txResponses.map((entry) => [entry.digest, entry]));
  const counts = zeroDelegationCounts();
  const recent_events = indexed.map((item) => {
    countDelegationEvent(counts, item.entry.name);
    return buildDelegationEvent({
      event: item.event,
      eventName: item.entry.name,
      txData: txByDigest.get(String(item.event.id?.txDigest ?? ""))
    });
  }).sort((a, b) => Number(b.timestamp_ms || 0) - Number(a.timestamp_ms || 0)).slice(0, input.limit);

  return {
    source: "live-sui-testnet-events",
    event_types: eventTypes.map((entry) => entry.type),
    counts,
    recent_events
  };
}

export async function buildLiveIndex(options: BuildLiveIndexOptions = {}): Promise<LiveIndexResult> {
  const { rpcUrl, packageId, aggregatorUrl, limit, eventType } = liveIndexConfig(options);
  const skillEventType = `${packageId}::skill::SkillPublished`;
  const [page, skillPage, membership, delegations] = await Promise.all([
    rpcCall<{ data?: SuiEvent[] }>(rpcUrl, "suix_queryEvents", [{ MoveEventType: eventType }, null, limit, true]),
    rpcCall<{ data?: SuiEvent[] }>(rpcUrl, "suix_queryEvents", [{ MoveEventType: skillEventType }, null, limit * 10, true]).catch(() => ({ data: [] })),
    buildLiveMembershipSummary({ rpcUrl, packageId, limit }).catch(() => emptyLiveMembershipSummary(packageId)),
    buildLiveDelegationSummary({ rpcUrl, packageId, limit }).catch(() => emptyLiveDelegationSummary(packageId))
  ]);
  const events = (page.data ?? []).filter((event) => event.id?.txDigest && event.parsedJson?.asset_id);
  const skillEvents = (skillPage.data ?? []).filter((event) => event.parsedJson?.skill_id && event.parsedJson?.source_asset_id);
  const objectIds = events.map((event) => String(event.parsedJson?.asset_id ?? ""));
  const skillObjectIds = skillEvents.map((event) => String(event.parsedJson?.skill_id ?? ""));
  const txDigests = events.map((event) => String(event.id?.txDigest ?? ""));
  const [objectResponses, skillObjectResponses, txResponses, releases] = await Promise.all([
    objectIds.length ? rpcCall<SuiObjectResponse[]>(rpcUrl, "sui_multiGetObjects", [objectIds, { showType: true, showOwner: true, showContent: true }]) : Promise.resolve([]),
    skillObjectIds.length ? rpcCall<SuiObjectResponse[]>(rpcUrl, "sui_multiGetObjects", [skillObjectIds, { showType: true, showOwner: true, showContent: true }]) : Promise.resolve([]),
    txDigests.length ? rpcCall<SuiTxResponse[]>(rpcUrl, "sui_multiGetTransactionBlocks", [txDigests, { showInput: true, showEffects: true, showEvents: true, showBalanceChanges: true }]) : Promise.resolve([]),
    Promise.all(events.map(async (event) => {
      const blobId = bytesToString(event.parsedJson?.walrus_blob_id);
      if (!blobId) return { release: undefined, error: "missing walrus_blob_id" };
      try {
        return { release: await readReleaseManifest(blobId, aggregatorUrl), error: undefined };
      } catch (error) {
        return { release: undefined, error: error instanceof Error ? error.message : String(error) };
      }
    }))
  ]);
  const objectById = new Map(objectResponses.map((entry) => [entry.data?.objectId, entry.data]));
  const skillObjectById = new Map(skillObjectResponses.map((entry) => [entry.data?.objectId, entry.data]));
  const publishedSkills = new Map<string, PublishedSkillRef>();
  for (const event of skillEvents) {
    const skillObjectId = String(event.parsedJson?.skill_id ?? "");
    const sourceAssetId = String(event.parsedJson?.source_asset_id ?? "");
    const skillObject = skillObjectById.get(skillObjectId);
    const manifestId = bytesToString(skillObject?.content?.fields?.name_hash);
    if (skillObjectId && sourceAssetId && manifestId) {
      publishedSkills.set(`${sourceAssetId}\n${manifestId}`, { skillObjectId, sourceAssetId, manifestId });
    }
  }
  const txByDigest = new Map(txResponses.map((entry) => [entry.digest, entry]));
  const assets = events
    .map((event, index) => buildAsset({
      event,
      objectData: objectById.get(String(event.parsedJson?.asset_id ?? "")),
      txData: txByDigest.get(String(event.id?.txDigest ?? "")),
      release: releases[index]?.release,
      releaseError: releases[index]?.error,
      packageId,
      publishedSkills
    }))
    .filter((asset) => matchesLiveIndexQuery(asset, options.query ?? ""));

  return {
    generated_at: new Date().toISOString(),
    source: "live-sui-testnet+walrus-release-manifest",
    rpc_url: rpcUrl,
    package_id: packageId,
    event_type: eventType,
    aggregator_url: aggregatorUrl,
    limit,
    query: options.query,
    assets,
    membership,
    delegations
  };
}
