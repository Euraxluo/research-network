import path from "node:path";
import { type IndexState, type IndexedAsset, type IndexedRelationship, type IndexedSkill, type ProtocolEvent, type ReleaseManifest } from "./types.js";
import { readJsonFile } from "./fs.js";
import { emptyIndexState, ensureLocalStore, readEvents, writeIndex } from "./local-store.js";
import { shortHash } from "./crypto.js";

export interface ReplayOptions {
  localnetRoot?: string;
  fromCheckpoint?: number;
  reset?: boolean;
}

function eventKey(event: ProtocolEvent): string {
  return `${event.tx_digest}:${event.event_seq}`;
}

async function loadManifestForEvent(event: ProtocolEvent, localnetRoot?: string): Promise<ReleaseManifest | undefined> {
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
    skill.manifest.license,
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

async function handleAssetPublished(index: IndexState, event: ProtocolEvent, localnetRoot?: string): Promise<void> {
  const manifest = await loadManifestForEvent(event, localnetRoot);
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
    license: String(event.payload.license ?? ""),
    price_policy: event.payload.price_policy as Record<string, unknown> | undefined,
    owner_address: String(event.payload.owner_address ?? "0x0"),
    created_at: String(event.payload.created_at ?? new Date(event.timestamp_ms).toISOString()),
    manifest: manifestSkill ?? {
      schema: "research-skill/v0.1",
      name: String(event.payload.name),
      version: String(event.payload.version),
      description: String(event.payload.description ?? ""),
      capabilities: [],
      relation: String(event.payload.relation ?? "owned") as IndexedSkill["relation"],
      license: String(event.payload.license ?? "")
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

export async function replayIndexer(options: ReplayOptions = {}): Promise<IndexState> {
  const events = await readEvents(options.localnetRoot);
  const fromCheckpoint = options.fromCheckpoint ?? 0;
  const index = options.reset ? emptyIndexState() : emptyIndexState();
  for (const event of events.filter((candidate) => candidate.checkpoint >= fromCheckpoint)) {
    const key = eventKey(event);
    if (index.processed_event_keys.includes(key)) {
      continue;
    }
    if (event.event_type === "ResearchAssetPublished") {
      await handleAssetPublished(index, event, options.localnetRoot);
    } else if (event.event_type === "SkillPublished") {
      handleSkillPublished(index, event);
    } else if (event.event_type === "AssetRelationshipRegistered") {
      handleRelationship(index, event);
    }
    index.events.push(event);
    index.processed_event_keys.push(key);
  }
  index.updated_at = new Date().toISOString();
  await writeIndex(index, options.localnetRoot);
  return index;
}

export async function searchIndex(query = "", type?: string, localnetRoot?: string) {
  const paths = await ensureLocalStore(localnetRoot);
  const index = await readJsonFile<IndexState>(paths.indexPath, emptyIndexState());
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
  const paths = await ensureLocalStore(localnetRoot);
  const index = await readJsonFile<IndexState>(paths.indexPath, emptyIndexState());
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
