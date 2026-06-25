import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyDirectory, pathExists, readYamlFile, writeYamlFile } from "./fs.js";
import { TEMPLATE_DIR, DEMO_PDF_PATH } from "./paths.js";
import { readIndex } from "./local-store.js";
import { type ResearchAssetManifest, type ResearchSkillManifest } from "./types.js";

export interface InitOptions {
  target: string;
  title?: string;
  slug?: string;
  author?: string;
  agentId?: string;
  force?: boolean;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "research-asset";
}

async function updatePaperSourceMetadata(target: string, manifest: ResearchAssetManifest): Promise<void> {
  const sourcePath = manifest.assets?.paper?.source;
  if (!sourcePath) {
    return;
  }
  const paperPath = path.join(target, sourcePath);
  if (!(await pathExists(paperPath))) {
    return;
  }
  const author = manifest.authors?.map((item) => item.name).join(", ") || "Human / Agent";
  const abstract = manifest.abstract?.trim() || "Describe the research problem, contribution, generated assets, and reproducibility status.";
  const original = await fs.readFile(paperPath, "utf8");
  const updated = original
    .replace(/\\title\{[^}]*\}/, `\\title{${manifest.title}}`)
    .replace(/\\author\{[^}]*\}/, `\\author{${author}}`)
    .replace(/\\begin\{abstract\}[\s\S]*?\\end\{abstract\}/, `\\begin{abstract}\n${abstract}\n\\end{abstract}`);
  await fs.writeFile(paperPath, updated, "utf8");
}

export async function initWorkspace(options: InitOptions): Promise<string> {
  const target = path.resolve(options.target);
  if ((await pathExists(target)) && !options.force) {
    const entries = await fs.readdir(target);
    if (entries.length > 0) {
      throw new Error(`Target directory is not empty: ${target}. Pass --force to overwrite template files.`);
    }
  }
  await copyDirectory(TEMPLATE_DIR, target);
  const manifestPath = path.join(target, "asset.yaml");
  const manifest = await readYamlFile<ResearchAssetManifest>(manifestPath);
  const title = options.title ?? manifest.title;
  manifest.title = title;
  manifest.slug = options.slug ?? slugify(title);
  if (options.author) {
    manifest.authors = [
      {
        name: options.author,
        type: options.agentId ? "agent" : "human",
        agent_id: options.agentId
      }
    ];
  }
  await writeYamlFile(manifestPath, manifest);
  await updatePaperSourceMetadata(target, manifest);
  await installProjectSkill({ workspace: target });
  return target;
}

export async function initPdfOnlyWorkspace(options: InitOptions): Promise<string> {
  const target = await initWorkspace({ ...options, force: true });
  const manifestPath = path.join(target, "asset.yaml");
  const manifest = await readYamlFile<ResearchAssetManifest>(manifestPath);
  manifest.types = ["paper"];
  manifest.abstract = "A PDF-only research asset without LaTeX source, used to verify PDF preview and download flows.";
  if (manifest.assets?.paper) {
    delete manifest.assets.paper.source;
    delete manifest.assets.paper.bib;
  }
  await fs.unlink(path.join(target, "paper/main.tex")).catch(() => {});
  await fs.unlink(path.join(target, "paper/references.bib")).catch(() => {});
  const pdfPath = path.join(target, "paper/main.pdf");
  if (!(await pathExists(pdfPath))) {
    await fs.copyFile(DEMO_PDF_PATH, pdfPath);
  }
  await writeYamlFile(manifestPath, manifest);
  return target;
}

export interface ForkOptions {
  assetId: string;
  target: string;
  include?: string[];
  localnetRoot?: string;
}

export async function forkWorkspace(options: ForkOptions): Promise<string> {
  const index = await readIndex(options.localnetRoot);
  const source = index.assets[options.assetId];
  if (!source) {
    throw new Error(`Asset not found in local index: ${options.assetId}`);
  }
  const target = await initWorkspace({
    target: options.target,
    title: `${source.title} Fork`,
    slug: `${source.slug ?? slugify(source.title)}-fork`,
    force: true
  });
  const manifestPath = path.join(target, "asset.yaml");
  const manifest = await readYamlFile<ResearchAssetManifest>(manifestPath);
  manifest.types = source.types;
  manifest.abstract = `Forked from ${source.id}. ${source.abstract ?? ""}`.trim();
  manifest.derived_from = [
    ...(manifest.derived_from ?? []),
    {
      asset_id: source.id,
      relation: "extends",
      included: options.include ?? ["paper", "skill", "workflow", "code"]
    }
  ];
  manifest.references = {
    ...(manifest.references ?? {}),
    assets: [source.id]
  };
  await writeYamlFile(manifestPath, manifest);
  return target;
}

export interface InstallSkillOptions {
  skillId: string;
  workspace: string;
  mode: "referenced" | "vendored";
  localnetRoot?: string;
}

const PROJECT_SKILL_NAME = "research-network-builder";
const PROJECT_SKILL_ENTRY = "SKILL.md";
const PROJECT_SKILL_FALLBACK = `# Agent Research Network Builder Skill

## Purpose

Operate the Agent-Native Research Asset Protocol from a local workspace.

This is a CLI-bundled local builder skill. It is not a published on-chain
SkillAsset from another user.

## Workflow

1. Initialize or open a Research Asset workspace.
2. Use Git for source control, Walrus for immutable snapshots, and Sui for registry evidence.
3. Use this bundled builder guidance to construct the user's own asset.
4. Resolve live SkillAsset object ids through the Research CLI when inspecting
   published asset-specific skills.
5. Install referenced or vendored skills into the current workspace.
6. Package, validate, and publish assets with reproducible paper, skill, workflow, code, data, and experiment files.
`;

function packageRootCandidates(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.resolve(here, "../.."),
    path.resolve(here, "../../.."),
    process.cwd()
  ];
}

async function readProjectSkillContent(): Promise<string> {
  for (const root of packageRootCandidates()) {
    const candidate = path.join(root, PROJECT_SKILL_ENTRY);
    if (await pathExists(candidate)) {
      return fs.readFile(candidate, "utf8");
    }
  }
  return PROJECT_SKILL_FALLBACK;
}

function projectSkillManifest(): ResearchSkillManifest {
  return {
    schema: "research-skill/v0.1",
    name: PROJECT_SKILL_NAME,
    version: "0.1.0",
    description: "Research Network protocol operating skill for initializing, validating, packaging, installing, and publishing agent-native research assets.",
    capabilities: [
      "research-asset-workspace",
      "skill-installation",
      "walrus-sui-publishing",
      "live-index-verification"
    ],
    relation: "vendored",
    entry: PROJECT_SKILL_ENTRY,
    access: { visibility: "public" },
    depends_on: [],
    tests: []
  };
}

export interface InstallProjectSkillOptions {
  workspace: string;
}

export async function installProjectSkill(options: InstallProjectSkillOptions) {
  const workspace = path.resolve(options.workspace);
  const manifestPath = path.join(workspace, "asset.yaml");
  const manifest = await readYamlFile<ResearchAssetManifest>(manifestPath);
  const vendorPath = `vendor/skills/${PROJECT_SKILL_NAME}/`;
  const vendorDir = path.join(workspace, vendorPath);
  await fs.mkdir(vendorDir, { recursive: true });
  await writeYamlFile(path.join(vendorDir, "skill.yaml"), projectSkillManifest());
  await fs.writeFile(path.join(vendorDir, PROJECT_SKILL_ENTRY), await readProjectSkillContent(), "utf8");
  const existingSkills = manifest.assets?.skills ?? [];
  manifest.assets = {
    ...(manifest.assets ?? {}),
    skills: [
      ...existingSkills.filter((skill) => skill.name !== PROJECT_SKILL_NAME && skill.path !== vendorPath),
      {
        name: PROJECT_SKILL_NAME,
        path: vendorPath,
        relation: "vendored"
      }
    ]
  };
  await writeYamlFile(manifestPath, manifest);
  return {
    skill_name: PROJECT_SKILL_NAME,
    mode: "vendored",
    workspace,
    path: vendorPath
  };
}

export async function installSkill(options: InstallSkillOptions) {
  const index = await readIndex(options.localnetRoot);
  const skill = index.skills[options.skillId];
  if (!skill) {
    throw new Error(`Skill not found in local index: ${options.skillId}`);
  }
  const workspace = path.resolve(options.workspace);
  const manifestPath = path.join(workspace, "asset.yaml");
  const manifest = await readYamlFile<ResearchAssetManifest>(manifestPath);
  if (options.mode === "referenced") {
    const references = manifest.references as Record<string, unknown> | undefined;
    const skills = Array.isArray(references?.skills) ? references.skills as unknown[] : [];
    manifest.references = {
      ...(references ?? {}),
      skills: [
        ...skills,
        {
          skill_id: skill.id,
          source_asset_id: skill.source_asset_id,
          relation: "referenced",
          manifest_hash: skill.manifest_hash
        }
      ]
    };
  } else {
    const vendorDir = path.join(workspace, "vendor", "skills", skill.name);
    await fs.mkdir(vendorDir, { recursive: true });
    await writeYamlFile(path.join(vendorDir, "skill.yaml"), {
      ...skill.manifest,
      relation: "vendored",
      derived_from: {
        skill_id: skill.id,
        source_asset_id: skill.source_asset_id,
        manifest_hash: skill.manifest_hash
      }
    });
    await fs.writeFile(path.join(vendorDir, skill.manifest.entry ?? "SKILL.md"), `# ${skill.name}\n\n${skill.description}\n`, "utf8");
    manifest.assets = {
      ...(manifest.assets ?? {}),
      skills: [
        ...(manifest.assets?.skills ?? []),
        {
          name: skill.name,
          path: `vendor/skills/${skill.name}/`,
          relation: "vendored"
        }
      ]
    };
  }
  await writeYamlFile(manifestPath, manifest);
  return {
    skill_id: skill.id,
    mode: options.mode,
    workspace,
    manifest_hash: skill.manifest_hash
  };
}
