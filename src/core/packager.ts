import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  type PackageResult,
  type ReleaseFile,
  type ReleaseManifest,
  type ResearchSkillManifest,
  type ResearchWorkflowManifest
} from "./types.js";
import { sha256Bytes, sha256File, shortHash } from "./crypto.js";
import { copyListedFiles, gitValue, listFiles, pathExists, readYamlFile, writeJsonFile } from "./fs.js";
import { DEFAULT_RELEASE_DIR } from "./paths.js";
import { validateWorkspace } from "./validator.js";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "research-asset";
}

async function collectReleaseFiles(root: string): Promise<ReleaseFile[]> {
  const files = await listFiles(root);
  const releaseFiles: ReleaseFile[] = [];
  for (const file of files) {
    const fullPath = path.join(root, file);
    const stat = await fs.stat(fullPath);
    releaseFiles.push({
      path: file,
      size: stat.size,
      sha256: await sha256File(fullPath)
    });
  }
  return releaseFiles;
}

function computeContentHash(files: ReleaseFile[]): string {
  const body = files.map((file) => `${file.path}\0${file.size}\0${file.sha256}`).join("\n");
  return sha256Bytes(body);
}

function relationId(src: string, dst: string, relation: string): string {
  return `${src}->${relation}->${dst}`;
}

async function collectNestedManifests(root: string, assetId: string, asset: NonNullable<ReleaseManifest["assets"]>) {
  const skills: ReleaseManifest["skills"] = [];
  const workflows: ReleaseManifest["workflows"] = [];
  const relationships: ReleaseManifest["relationships"] = [];

  for (const skillRef of asset.assets?.skills ?? []) {
    const skillPath = path.join(skillRef.path.replace(/\/$/, ""), "skill.yaml");
    if (!(await pathExists(path.join(root, skillPath)))) {
      continue;
    }
    const manifest = await readYamlFile<ResearchSkillManifest>(path.join(root, skillPath));
    const id = `skill:${slugify(manifest.name)}@${manifest.version}`;
    skills.push({ id, path: skillPath, manifest });
    relationships.push({
      src_id: assetId,
      dst_id: id,
      relation_type: "contains_skill",
      metadata: { path: skillRef.path, relation: manifest.relation }
    });
    for (const dependency of manifest.depends_on ?? []) {
      const dependencyId = String(dependency.id ?? dependency.name ?? dependency.skill ?? "");
      if (dependencyId) {
        relationships.push({
          src_id: id,
          dst_id: dependencyId,
          relation_type: "depends_on",
          metadata: dependency
        });
      }
    }
  }

  const workflowPath = asset.assets?.workflow?.path;
  if (workflowPath && (await pathExists(path.join(root, workflowPath)))) {
    const manifest = await readYamlFile<ResearchWorkflowManifest>(path.join(root, workflowPath));
    const id = `workflow:${slugify(manifest.name)}@${manifest.version}`;
    workflows.push({ id, path: workflowPath, manifest });
    relationships.push({
      src_id: assetId,
      dst_id: id,
      relation_type: "contains_workflow",
      metadata: { path: workflowPath }
    });
  }

  for (const derived of asset.derived_from ?? []) {
    const dst = String(derived.asset_id ?? derived.id ?? "");
    if (dst) {
      relationships.push({
        src_id: assetId,
        dst_id: dst,
        relation_type: String(derived.relation ?? "derived_from"),
        metadata: derived
      });
    }
  }

  return {
    skills,
    workflows,
    relationships: relationships.map((relationship) => ({
      ...relationship,
      metadata: {
        relationship_id: relationId(relationship.src_id, relationship.dst_id, relationship.relation_type),
        ...(relationship.metadata ?? {})
      }
    }))
  };
}

function createArchive(stagingDir: string, archivePath: string): void {
  const tarPath = archivePath.replace(/\.zst$/, "");
  const tar = spawnSync("tar", ["-cf", tarPath, "-C", stagingDir, "."], { encoding: "utf8" });
  if (tar.status !== 0) {
    throw new Error(`tar failed: ${tar.stderr || tar.stdout}`);
  }
  const zstd = spawnSync("zstd", ["-q", "-f", "-19", tarPath, "-o", archivePath], { encoding: "utf8" });
  if (zstd.status !== 0) {
    throw new Error(`zstd failed: ${zstd.stderr || zstd.stdout}`);
  }
}

export async function packageWorkspace(rootInput = ".", releaseRoot = DEFAULT_RELEASE_DIR): Promise<PackageResult> {
  const root = path.resolve(rootInput);
  const validation = await validateWorkspace(root);
  if (!validation.valid || !validation.asset) {
    const messages = validation.errors.map((error) => `${error.code}: ${error.message}`).join("\n");
    throw new Error(`Cannot package invalid workspace:\n${messages}`);
  }

  const files = await collectReleaseFiles(root);
  const asset = validation.asset;
  const contentHash = computeContentHash(files);
  const assetYamlHash = files.find((file) => file.path === "asset.yaml")?.sha256 ?? (await sha256File(path.join(root, "asset.yaml")));
  const assetId = asset.id ?? `ra:local:${shortHash(`${asset.title}:${asset.version}:${contentHash}`, 20)}`;
  const nested = await collectNestedManifests(root, assetId, asset);
  const repo = gitValue(root, ["config", "--get", "remote.origin.url"], `file://${root}`);
  const commit = gitValue(root, ["rev-parse", "HEAD"], "working-tree");
  const createdAt = new Date().toISOString();
  const manifestWithoutHash: Omit<ReleaseManifest, "manifest_hash"> = {
    schema: "research-asset-manifest/v0.1",
    repo,
    commit,
    asset_yaml_hash: assetYamlHash,
    content_hash: contentHash,
    created_at: createdAt,
    files,
    assets: {
      ...asset,
      id: assetId
    },
    skills: nested.skills,
    workflows: nested.workflows,
    relationships: nested.relationships
  };
  const manifestHash = sha256Bytes(JSON.stringify(manifestWithoutHash));
  const manifest: ReleaseManifest = {
    ...manifestWithoutHash,
    manifest_hash: manifestHash
  };

  const releaseId = `${slugify(asset.slug ?? asset.title)}-${shortHash(`${contentHash}:${createdAt}`, 12)}`;
  const releaseDir = path.join(releaseRoot, releaseId);
  const stagingDir = path.join(releaseDir, "staging");
  await fs.mkdir(releaseDir, { recursive: true });
  await copyListedFiles(root, files.map((file) => file.path), stagingDir);
  const manifestPath = path.join(releaseDir, "manifest.json");
  const checksumsPath = path.join(releaseDir, "checksums.json");
  await writeJsonFile(manifestPath, manifest);
  await writeJsonFile(checksumsPath, {
    schema: "research-asset-checksums/v0.1",
    content_hash: contentHash,
    manifest_hash: manifestHash,
    files
  });
  await fs.copyFile(manifestPath, path.join(stagingDir, "manifest.json"));
  await fs.copyFile(checksumsPath, path.join(stagingDir, "checksums.json"));
  const archivePath = path.join(releaseDir, "release.tar.zst");
  createArchive(stagingDir, archivePath);

  return {
    releaseDir,
    stagingDir,
    manifestPath,
    checksumsPath,
    archivePath,
    manifest
  };
}
