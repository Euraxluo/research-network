import {
  DEFAULT_LIVE_INDEX_WALRUS_AGGREGATOR_URL,
  readLiveReleaseArtifact,
  type LiveIndexAsset,
  type LiveIndexResult
} from "./live-index.js";

export type SkillArtifactKind = "entry" | "manifest";

export interface ResolvedLiveSkill {
  skill_object_id: string;
  canonical_id: string;
  manifest_id: string;
  source_asset_id: string;
  on_chain_status: "published";
  name: string;
  version: string;
  description: string;
  capabilities: string[];
  relation: string;
  access_visibility: string;
  source_asset: {
    id: string;
    sui_object_id: string;
    title: string;
    repo_url?: string;
    repo_commit: string;
    walrus_blob_id: string;
    manifest_hash: string;
    tx_digest: string;
  };
  paths: {
    skill_yaml: string;
    skill_entry: string;
  };
  artifact_urls: {
    skill_yaml: string;
    skill_entry: string;
  };
  install_command: string;
}

export function isSuiObjectId(value: string): boolean {
  return /^0x[0-9a-fA-F]+$/.test(value.trim());
}

function artifactUrl(input: {
  blobId: string;
  path: string;
  artifactApi?: string;
  aggregatorUrl?: string;
}): string {
  const params = new URLSearchParams({
    blob: input.blobId,
    path: input.path
  });
  if (input.aggregatorUrl && input.aggregatorUrl !== DEFAULT_LIVE_INDEX_WALRUS_AGGREGATOR_URL) {
    params.set("aggregator", input.aggregatorUrl);
  }
  return `${input.artifactApi ?? "/api/index/artifact"}?${params.toString()}`;
}

export function resolveSkillFromLiveIndex(
  index: LiveIndexResult,
  skillObjectId: string,
  options: { artifactApi?: string } = {}
): ResolvedLiveSkill | undefined {
  const requested = skillObjectId.trim().toLowerCase();
  if (!isSuiObjectId(requested)) return undefined;
  for (const asset of index.assets) {
    const skill = asset.skills.find((candidate) => candidate.id.toLowerCase() === requested);
    if (!skill || skill.on_chain_status !== "published") continue;
    return {
      skill_object_id: skill.id,
      canonical_id: skill.id,
      manifest_id: skill.manifest_id,
      source_asset_id: skill.source_asset_id,
      on_chain_status: "published",
      name: skill.name,
      version: skill.version,
      description: skill.description,
      capabilities: skill.capabilities,
      relation: skill.relation,
      access_visibility: skill.access_visibility,
      source_asset: {
        id: asset.id,
        sui_object_id: asset.sui_object_id,
        title: asset.title,
        repo_url: asset.repo_url,
        repo_commit: asset.repo_commit,
        walrus_blob_id: asset.walrus_blob_id,
        manifest_hash: asset.manifest_hash,
        tx_digest: asset.tx_digest
      },
      paths: {
        skill_yaml: skill.path,
        skill_entry: skill.entry_path
      },
      artifact_urls: {
        skill_yaml: artifactUrl({
          blobId: asset.walrus_blob_id,
          path: skill.path,
          artifactApi: options.artifactApi,
          aggregatorUrl: index.aggregator_url
        }),
        skill_entry: artifactUrl({
          blobId: asset.walrus_blob_id,
          path: skill.entry_path,
          artifactApi: options.artifactApi,
          aggregatorUrl: index.aggregator_url
        })
      },
      install_command: `research install ${skill.id}`
    };
  }
  return undefined;
}

export async function readResolvedSkillArtifact(
  resolution: ResolvedLiveSkill,
  kind: SkillArtifactKind,
  aggregatorUrl?: string
): Promise<{ path: string; filename: string; contentType: string; bytes: Uint8Array } | undefined> {
  return readLiveReleaseArtifact({
    blobId: resolution.source_asset.walrus_blob_id,
    path: kind === "manifest" ? resolution.paths.skill_yaml : resolution.paths.skill_entry,
    aggregatorUrl
  });
}
