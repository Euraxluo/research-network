import { ZSTDDecoder } from "zstddec/stream";

export const DEFAULT_LIVE_INDEX_RPC_URL = "https://sui-testnet-rpc.publicnode.com";
export const DEFAULT_LIVE_INDEX_PACKAGE_ID = "0x5ecd097d8f13e995493d23c9b033c815bd6a8bf771331c389c027296e8b8231e";
export const DEFAULT_LIVE_INDEX_WALRUS_AGGREGATOR_URL = "https://aggregator.walrus-testnet.walrus.space";

interface SuiEvent {
  id?: { txDigest?: string; eventSeq?: string };
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

interface ReleaseManifest {
  repo?: string;
  commit?: string;
  created_at?: string;
  manifest_hash?: string;
  assets?: {
    id?: string;
    title?: string;
    abstract?: string;
    types?: string[];
    tags?: string[];
    authors?: Array<{ name?: string; github?: string; agent_id?: string; type?: string }>;
  };
}

export interface LiveIndexAsset {
  id: string;
  title: string;
  authors: string;
  abstract: string;
  types: string[];
  tags: string[];
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

async function readReleaseManifest(blobId: string, aggregatorUrl: string): Promise<ReleaseManifest> {
  const response = await fetch(`${aggregatorUrl.replace(/\/$/, "")}/v1/blobs/${encodeURIComponent(blobId)}`, {
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`Walrus blob ${blobId} HTTP ${response.status}`);
  }
  const decoder = await zstdDecoder();
  const tarBytes = decoder.decode(new Uint8Array(await response.arrayBuffer()));
  const manifestBytes = readTarMember(tarBytes, "manifest.json");
  if (!manifestBytes) {
    throw new Error(`Walrus blob ${blobId} does not contain manifest.json`);
  }
  return JSON.parse(new TextDecoder().decode(manifestBytes)) as ReleaseManifest;
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
    asset.tags.join(" "),
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

function buildAsset(input: {
  event: SuiEvent;
  objectData?: NonNullable<SuiObjectResponse["data"]>;
  txData?: SuiTxResponse;
  release?: ReleaseManifest;
  packageId: string;
}): LiveIndexAsset {
  const parsed = input.event.parsedJson ?? {};
  const fields = input.objectData?.content?.fields ?? {};
  const release = input.release ?? {};
  const releaseAsset = release.assets ?? {};
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
  const assetId = String(releaseAsset.id ?? objectId);
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
    tags: Array.isArray(releaseAsset.tags) ? releaseAsset.tags : [],
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
    href: releaseAsset.id ? `/abs/${routeSegment(String(releaseAsset.id))}.html` : undefined,
    proof
  };
}

export async function buildLiveIndex(options: BuildLiveIndexOptions = {}): Promise<LiveIndexResult> {
  const { rpcUrl, packageId, aggregatorUrl, limit, eventType } = liveIndexConfig(options);
  const page = await rpcCall<{ data?: SuiEvent[] }>(rpcUrl, "suix_queryEvents", [{ MoveEventType: eventType }, null, limit, true]);
  const events = (page.data ?? []).filter((event) => event.id?.txDigest && event.parsedJson?.asset_id);
  const objectIds = events.map((event) => String(event.parsedJson?.asset_id ?? ""));
  const txDigests = events.map((event) => String(event.id?.txDigest ?? ""));
  const [objectResponses, txResponses, releases] = await Promise.all([
    objectIds.length ? rpcCall<SuiObjectResponse[]>(rpcUrl, "sui_multiGetObjects", [objectIds, { showType: true, showOwner: true, showContent: true }]) : Promise.resolve([]),
    txDigests.length ? rpcCall<SuiTxResponse[]>(rpcUrl, "sui_multiGetTransactionBlocks", [txDigests, { showInput: true, showEffects: true, showEvents: true, showBalanceChanges: true }]) : Promise.resolve([]),
    Promise.all(events.map(async (event) => {
      const blobId = bytesToString(event.parsedJson?.walrus_blob_id);
      return blobId ? readReleaseManifest(blobId, aggregatorUrl).catch(() => undefined) : undefined;
    }))
  ]);
  const objectById = new Map(objectResponses.map((entry) => [entry.data?.objectId, entry.data]));
  const txByDigest = new Map(txResponses.map((entry) => [entry.digest, entry]));
  const assets = events
    .map((event, index) => buildAsset({
      event,
      objectData: objectById.get(String(event.parsedJson?.asset_id ?? "")),
      txData: txByDigest.get(String(event.id?.txDigest ?? "")),
      release: releases[index],
      packageId
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
    assets
  };
}
