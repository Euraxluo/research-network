import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { applyEvents } from "../src/core/indexer.js";
import { emptyIndexState } from "../src/core/local-store.js";
import { objectId, sha256Bytes, sha256File, shortHash } from "../src/core/crypto.js";
import { listFiles, writeJsonFile } from "../src/core/fs.js";
import type {
  AssetType,
  IndexState,
  ProtocolEvent,
  ReleaseFile,
  ReleaseManifest,
  ResearchAssetManifest,
  ResearchSkillManifest,
  ResearchWorkflowManifest
} from "../src/core/types.js";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const SHOWCASE_ROOT = path.join(PROJECT_ROOT, "fixtures", "public-showcase");
const WORKSPACES_ROOT = path.join(SHOWCASE_ROOT, "workspaces");
const LOCALNET_ROOT = path.join(SHOWCASE_ROOT, "localnet");
const FIXED_NOW = "2026-06-23T00:00:00.000Z";
const OWNER = "0x4f1c7a9d83b25e7610d9a4b8c6e2f13a4d59b7c8";

type ShowcaseSkill = {
  name: string;
  version: string;
  description: string;
  capabilities: string[];
  guide: string[];
};

type ShowcaseAsset = {
  id: string;
  slug: string;
  title: string;
  version: string;
  types: AssetType[];
  abstract: string;
  tags: string[];
  categories: string[];
  author: string;
  authorType: "human" | "agent" | "organization";
  agentId: string;
  skill: ShowcaseSkill;
  workflowName: string;
  workflowDescription: string;
  access: "public" | "encrypted" | "private_delegation";
  requiredTier?: number;
  derivedFrom?: Array<{ asset_id: string; relation: string; included: string[] }>;
  cites?: string[];
  sections: Array<{ title: string; paragraphs: string[] }>;
};

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "research-asset";
}

function yaml(value: unknown): string {
  return YAML.stringify(value, { lineWidth: 92 });
}

function texEscape(input: string): string {
  return input
    .replaceAll("\\", "\\textbackslash{}")
    .replaceAll("&", "\\&")
    .replaceAll("%", "\\%")
    .replaceAll("$", "\\$")
    .replaceAll("#", "\\#")
    .replaceAll("_", "\\_")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}");
}

async function writeText(filePath: string, body: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body, "utf8");
}

function paperTex(asset: ShowcaseAsset): string {
  const sections = asset.sections.map((section) => {
    const paragraphs = section.paragraphs.map((paragraph) => texEscape(paragraph)).join("\n\n");
    return `\\section{${texEscape(section.title)}}\n${paragraphs}`;
  }).join("\n\n");
  return `\\documentclass{article}
\\usepackage{amsmath}
\\usepackage{hyperref}
\\title{${texEscape(asset.title)}}
\\author{${texEscape(asset.author)}}
\\date{June 2026}
\\begin{document}
\\maketitle
\\begin{abstract}
${texEscape(asset.abstract)}
\\end{abstract}

${sections}

\\bibliographystyle{plain}
\\bibliography{references}
\\end{document}
`;
}

function readme(asset: ShowcaseAsset): string {
  return `# ${asset.title}

${asset.abstract}

## What ships in this asset

- Paper source and rendered PDF for human reading.
- Agent skill: \`${asset.skill.name}\`.
- Workflow: \`${asset.workflowName}\`.
- Verifiable manifest with Walrus, Sui, Git, license, and access metadata.

## Why it matters

Research Network treats a paper as one node inside a larger executable asset graph. A reader can inspect the argument, an agent can install the skill, and an indexer can replay the protocol events that made the release visible.

## Reuse path

1. Read the abstract page.
2. Inspect the manifest and graph.
3. Install the skill into a new workspace.
4. Fork the asset and publish a derived release with preserved provenance.
`;
}

function skillMarkdown(skill: ShowcaseSkill): string {
  const guide = skill.guide.map((line) => `- ${line}`).join("\n");
  return `# ${skill.name}

${skill.description}

## Operator Notes

${guide}
`;
}

function workflow(asset: ShowcaseAsset): ResearchWorkflowManifest {
  return {
    schema: "research-workflow/v0.1",
    name: asset.workflowName,
    version: asset.version,
    description: asset.workflowDescription,
    inputs: ["repository", "paper source", "agent run log", "evaluation evidence"],
    outputs: ["asset manifest", "static abstract page", "skill package", "workflow graph"],
    stages: [
      {
        id: "profile",
        name: "Profile the contribution",
        instructions: "Identify the scientific claim, executable components, access model, and provenance anchors."
      },
      {
        id: "package",
        name: "Package the asset",
        instructions: "Assemble paper, skill, workflow, checksums, license terms, and dependency metadata."
      },
      {
        id: "verify",
        name: "Verify and index",
        instructions: "Validate the manifest, render the paper, replay protocol events, and inspect graph edges."
      },
      {
        id: "reuse",
        name: "Prepare reuse",
        instructions: "Expose install, fork, citation, and settlement paths for downstream humans and agents."
      }
    ],
    quality_gates: [
      { id: "manifest-complete", check: "asset.yaml validates and declares paper, skill, and workflow paths" },
      { id: "rendered-paper", check: "abstract page includes HTML rendering or PDF preview" },
      { id: "agent-assets-visible", check: "skill cards and graph edges are visible in the static site" }
    ],
    tools: ["research validate", "research web:build", "Research Network indexer"]
  };
}

const ASSETS: ShowcaseAsset[] = [
  {
    id: "ra:showcase:research-network-protocol",
    slug: "research-network-protocol",
    title: "Research Network: Agent-Native Asset Protocol",
    version: "0.4.0",
    types: ["paper", "skill", "workflow", "code"],
    abstract: "Research Network turns a research release into a verifiable asset graph: a paper, agent skill, workflow, code, access policy, Walrus snapshot, and Sui registry record travel together. The protocol keeps reading open by default while giving agents a native way to install, fork, cite, and settle reuse.",
    tags: ["agent-native", "walrus", "sui", "research-assets", "reproducibility"],
    categories: ["cs.DL", "cs.AI", "econ.GN"],
    author: "Research Network Core",
    authorType: "organization",
    agentId: "agent:research-network-core",
    skill: {
      name: "protocol-cartographer",
      version: "0.3.0",
      description: "Inspects a repository and emits a Research Asset manifest, graph edges, reuse hints, and verification notes.",
      capabilities: ["manifest-authoring", "provenance-graph", "walrus-sites-export", "sui-registry"],
      guide: [
        "Map every paper claim to concrete files, skills, workflows, and external references.",
        "Flag missing licenses, empty abstracts, and unverifiable generated artifacts before publish.",
        "Emit graph edges that make downstream forks and citations machine-readable."
      ]
    },
    workflowName: "publish-verifiable-research",
    workflowDescription: "A public workflow for turning a Git repository into a readable, installable, and indexable Research Network asset.",
    access: "public",
    sections: [
      {
        title: "Problem",
        paragraphs: [
          "AI research is no longer a PDF-only medium. Useful results increasingly contain prompts, agent skills, notebooks, datasets, browser traces, provenance receipts, and reusable workflows. A conventional archive can host the prose, but it does not make these execution surfaces first-class.",
          "The missing primitive is an asset that can be read by humans, installed by agents, forked with attribution, and settled when commercial reuse happens."
        ]
      },
      {
        title: "Protocol Shape",
        paragraphs: [
          "Research Network keeps Git as the authoring environment, stores immutable release snapshots on Walrus, records registry and settlement events on Sui, and exports static pages for open reading. The same manifest powers the web page, search index, graph, skill install command, and economic dashboard.",
          "This split makes the system practical: authors keep normal repositories, readers get arXiv-like pages, and agents receive typed entry points instead of scraping a PDF for operational knowledge."
        ]
      },
      {
        title: "Reader and Agent Experience",
        paragraphs: [
          "A public visitor can search assets, open an abstract page, read the rendered paper, inspect the README, verify Sui and Walrus identifiers, and follow the graph. Login is reserved for write actions, account binding, paid access, and private delegation.",
          "An agent can install the declared skill, replay the workflow, preserve provenance in a fork, and publish a new asset whose ancestry is indexed as a relationship rather than hidden in prose."
        ]
      },
      {
        title: "Implication",
        paragraphs: [
          "The protocol makes research composable without turning it into a closed marketplace. Open reading remains the default; value capture is attached to reusable agent assets, encrypted reports, and delegated work where settlement actually matters."
        ]
      }
    ]
  },
  {
    id: "ra:showcase:citation-liquidity",
    slug: "citation-liquidity",
    title: "Citation Liquidity: Settlement Rails for Agent Reuse",
    version: "0.2.0",
    types: ["paper", "skill", "workflow", "experiment", "benchmark", "code"],
    abstract: "This asset models how agent-readable citations can become settlement rails. Instead of treating citations as static text, the workflow records reuse edges, membership reads, access receipts, and agent earnings so useful research components can be discovered and compensated without blocking open discovery.",
    tags: ["citation-graph", "settlement", "seal-access", "agent-economy"],
    categories: ["cs.MA", "econ.TH", "cs.DL"],
    author: "RN Market Lab",
    authorType: "organization",
    agentId: "agent:rn-market-lab",
    skill: {
      name: "citation-market-simulator",
      version: "0.2.0",
      description: "Simulates citation, membership, access receipt, and agent earning events for a Research Network asset graph.",
      capabilities: ["economic-simulation", "citation-routing", "membership-settlement", "dashboard-evidence"],
      guide: [
        "Load an indexed asset graph and choose which edges should carry economic attribution.",
        "Generate read receipts and settlement rows without making public abstracts private.",
        "Compare open discovery against encrypted report monetization."
      ]
    },
    workflowName: "simulate-citation-liquidity",
    workflowDescription: "A workflow for testing whether reuse edges can carry settlement data while preserving open reading.",
    access: "encrypted",
    requiredTier: 1,
    derivedFrom: [
      { asset_id: "ra:showcase:research-network-protocol", relation: "extends", included: ["paper", "workflow", "code"] }
    ],
    cites: ["ra:showcase:research-network-protocol"],
    sections: [
      {
        title: "Thesis",
        paragraphs: [
          "Citation is the original liquidity layer of science: it routes attention, reputation, and future work. Agents make this loop faster, but they also make reuse harder to audit unless citations become structured protocol events.",
          "Research Network can preserve public reading while letting reusable assets expose economic relationships in a dashboard that is replayed from registry events."
        ]
      },
      {
        title: "Mechanism",
        paragraphs: [
          "The simulator projects three event families: public citation edges, encrypted report access receipts, and agent earnings. Public edges improve discovery and provenance. Encrypted report events demonstrate how membership or subscription access can settle to the agents and authors whose work was actually opened.",
          "The important constraint is that search and abstracts remain public. The monetized layer is attached to premium reports and delegated outputs, not to the existence of the research record."
        ]
      },
      {
        title: "Evaluation",
        paragraphs: [
          "A useful settlement rail must be transparent enough for trust and narrow enough to avoid surveillance. The benchmark therefore records aggregate receipts, report identifiers, and agent earnings while keeping private delegation payloads encrypted on Walrus and gated through Seal.",
          "The generated dashboard is not a marketing chart. It is a replay of events that can be independently indexed."
        ]
      }
    ]
  },
  {
    id: "ra:showcase:browse-to-publish-benchmark",
    slug: "browse-to-publish-benchmark",
    title: "Browse-to-Publish Benchmark for Autonomous Researchers",
    version: "0.1.0",
    types: ["paper", "benchmark", "workflow", "skill", "dataset"],
    abstract: "This benchmark specifies a full agent path from browsing evidence to publishing a verifiable research asset. It captures sources, browser observations, extracted claims, generated artifacts, reviewer checks, and the final graph edges that make the result reusable by another agent.",
    tags: ["browser-agent", "benchmark", "evidence", "publish-workflow"],
    categories: ["cs.AI", "cs.SE", "cs.DL"],
    author: "Autonomous Research Bench",
    authorType: "organization",
    agentId: "agent:autonomous-research-bench",
    skill: {
      name: "browser-evidence-recorder",
      version: "0.1.0",
      description: "Captures browser evidence, source metadata, claim extraction notes, and publication checks for autonomous research runs.",
      capabilities: ["browser-evidence", "claim-ledger", "artifact-qc", "publish-readiness"],
      guide: [
        "Record source URLs, timestamps, and extracted claims before drafting.",
        "Attach evidence to workflow stages so reviewers can inspect the path from source to asset.",
        "Reject publication when rendered pages, skill cards, or graph edges are missing."
      ]
    },
    workflowName: "browse-evidence-publish-asset",
    workflowDescription: "A benchmark workflow for turning browser-grounded agent research into a reusable public asset.",
    access: "public",
    derivedFrom: [
      { asset_id: "ra:showcase:research-network-protocol", relation: "benchmarks", included: ["workflow", "skill"] }
    ],
    cites: ["ra:showcase:research-network-protocol", "ra:showcase:citation-liquidity"],
    sections: [
      {
        title: "Benchmark Contract",
        paragraphs: [
          "A browser-capable research agent should not merely summarize sources. It should leave behind a package that another reader can inspect and another agent can reuse. This benchmark measures that end-to-end path.",
          "The output is a Research Asset with evidence notes, a workflow ledger, a reusable skill, and static pages that expose the result without requiring login."
        ]
      },
      {
        title: "Tasks",
        paragraphs: [
          "The agent must browse a target domain, identify claims, capture source evidence, draft a short paper, declare a skill, run quality gates, and publish an indexed asset. Each step produces artifacts that become part of the final release.",
          "The evaluation fails if any public page falls back to placeholder content, if the skill is not installable, or if the graph does not connect the benchmark to its source protocol."
        ]
      },
      {
        title: "Why It Is Different",
        paragraphs: [
          "Most agent benchmarks stop at answer quality. This one checks whether the agent can produce a durable research object with provenance, readable pages, and reuse mechanics. That is the difference between a clever answer and a contribution that can survive outside the chat window."
        ]
      }
    ]
  }
];

async function compilePdf(workspace: string): Promise<void> {
  const paperDir = path.join(workspace, "paper");
  const result = spawnSync("pdflatex", ["-interaction=nonstopmode", "main.tex"], {
    cwd: paperDir,
    encoding: "utf8",
    env: { ...process.env, SOURCE_DATE_EPOCH: "1782000000", FORCE_SOURCE_DATE: "1" }
  });
  if (result.status !== 0) {
    throw new Error(`pdflatex failed in ${paperDir}:\n${result.stdout}\n${result.stderr}`);
  }
  await Promise.all(["main.aux", "main.log", "main.out"].map((file) => fs.rm(path.join(paperDir, file), { force: true })));
}

async function writeWorkspace(asset: ShowcaseAsset): Promise<string> {
  const workspace = path.join(WORKSPACES_ROOT, asset.slug);
  await fs.rm(workspace, { recursive: true, force: true });

  const skillDir = `skill/${asset.skill.name}/`;
  const manifest: ResearchAssetManifest = {
    schema: "research-asset/v0.1",
    id: asset.id,
    title: asset.title,
    slug: asset.slug,
    version: asset.version,
    types: asset.types,
    abstract: asset.abstract,
    tags: asset.tags,
    categories: asset.categories,
    authors: [
      {
        name: asset.author,
        type: asset.authorType,
        wallet: OWNER,
        github: "research-network",
        agent_id: asset.agentId
      }
    ],
    assets: {
      paper: {
        path: "paper/main.pdf",
        source: "paper/main.tex",
        bib: "paper/references.bib"
      },
      skills: [
        {
          name: asset.skill.name,
          path: skillDir,
          relation: "owned"
        }
      ],
      workflow: {
        path: "workflow/workflow.yaml"
      }
    },
    generated_by: {
      agent: asset.agentId,
      skills: [asset.skill.name],
      workflow: "workflow/workflow.yaml",
      models: ["codex", "review-agents"]
    },
    derived_from: asset.derivedFrom ?? [],
    references: {
      papers: [],
      skills: [],
      datasets: [],
      workflows: [],
      assets: asset.cites ?? []
    },
    dependencies: {
      skills: [],
      datasets: [],
      packages: {
        "@research-network/protocol-kit": "0.1.0"
      }
    },
    legal_terms: {
      paper: "CC-BY-4.0",
      code: "MIT",
      data: "CC-BY-4.0"
    },
    access: {
      visibility: asset.access,
      required_tier: asset.requiredTier ?? 0,
      seal_id: asset.access === "public" ? undefined : "0x5ea1000000000000000000000000000000000000",
      ciphertext_hash: asset.access === "public" ? undefined : sha256Bytes(`${asset.id}:showcase-ciphertext`),
      plaintext_commitment: asset.access === "public" ? undefined : sha256Bytes(`${asset.id}:showcase-plaintext`),
      free_preview: asset.abstract
    },
    commerce: {
      purchasable: asset.access !== "public",
      price_policy: asset.access === "public" ? { model: "open" } : { model: "membership_or_subscription", tier: asset.requiredTier ?? 1 },
      revenue_split: [
        { recipient: OWNER, role: "creator", weight_bps: 8500 },
        { recipient: "treasury", role: "platform_treasury", weight_bps: 1500 }
      ]
    },
    publish: {
      storage: "walrus",
      chain: "sui",
      visibility: asset.access,
      register_on_chain: true
    }
  };

  const skill: ResearchSkillManifest = {
    schema: "research-skill/v0.1",
    name: asset.skill.name,
    version: asset.skill.version,
    description: asset.skill.description,
    capabilities: asset.skill.capabilities,
    relation: "owned",
    derived_from: null,
    depends_on: [],
    entry: "SKILL.md",
    access: { visibility: "public" },
    tests: ["research validate", "research web:build"]
  };

  await writeText(path.join(workspace, "asset.yaml"), yaml(manifest));
  await writeText(path.join(workspace, "README.md"), readme(asset));
  await writeText(path.join(workspace, "LICENSE"), "CC-BY-4.0 for prose and MIT for code unless a file states otherwise.\n");
  await writeText(path.join(workspace, "paper", "main.tex"), paperTex(asset));
  await writeText(path.join(workspace, "paper", "references.bib"), "@misc{research_network_2026,\n  title={Research Network Protocol Kit},\n  year={2026},\n  howpublished={Research Network public showcase}\n}\n");
  await writeText(path.join(workspace, skillDir, "skill.yaml"), yaml(skill));
  await writeText(path.join(workspace, skillDir, "SKILL.md"), skillMarkdown(asset.skill));
  await writeText(path.join(workspace, "workflow", "workflow.yaml"), yaml(workflow(asset)));
  await writeText(path.join(workspace, "code", "README.md"), `# Code Surface\n\nThis asset exposes reusable protocol logic through the declared skill \`${asset.skill.name}\` and the Research Network CLI.\n`);
  await writeText(path.join(workspace, "data", "README.md"), "# Data Surface\n\nThis showcase uses synthetic protocol events and public metadata only.\n");
  await writeText(path.join(workspace, "experiments", "README.md"), "# Experiments\n\nThe public site is the acceptance target: homepage listing, abstract page, skill card, graph page, and dashboard must render without placeholder content.\n");
  await compilePdf(workspace);
  return workspace;
}

async function releaseFiles(root: string): Promise<ReleaseFile[]> {
  const files = await listFiles(root);
  const out: ReleaseFile[] = [];
  for (const file of files.sort()) {
    const fullPath = path.join(root, file);
    const stat = await fs.stat(fullPath);
    out.push({ path: file, size: stat.size, sha256: await sha256File(fullPath) });
  }
  return out;
}

function contentHash(files: ReleaseFile[]): string {
  return sha256Bytes(files.map((file) => `${file.path}\0${file.size}\0${file.sha256}`).join("\n"));
}

async function releaseManifest(asset: ShowcaseAsset, workspace: string): Promise<ReleaseManifest> {
  const files = await releaseFiles(workspace);
  const assetYamlHash = files.find((file) => file.path === "asset.yaml")?.sha256 ?? await sha256File(path.join(workspace, "asset.yaml"));
  const skillId = `skill:${slugify(asset.skill.name)}@${asset.skill.version}`;
  const workflowId = `workflow:${slugify(asset.workflowName)}@${asset.version}`;
  const skill = YAML.parse(await fs.readFile(path.join(workspace, "skill", asset.skill.name, "skill.yaml"), "utf8")) as ResearchSkillManifest;
  const workflowManifest = YAML.parse(await fs.readFile(path.join(workspace, "workflow", "workflow.yaml"), "utf8")) as ResearchWorkflowManifest;
  const assetManifest = YAML.parse(await fs.readFile(path.join(workspace, "asset.yaml"), "utf8")) as ResearchAssetManifest;
  const base: Omit<ReleaseManifest, "manifest_hash"> = {
    schema: "research-asset-manifest/v0.1",
    repo: `file://${workspace}`,
    commit: "public-showcase-2026-06-23",
    asset_yaml_hash: assetYamlHash,
    content_hash: contentHash(files),
    created_at: FIXED_NOW,
    files,
    assets: assetManifest,
    skills: [{ id: skillId, path: `skill/${asset.skill.name}/skill.yaml`, manifest: skill }],
    workflows: [{ id: workflowId, path: "workflow/workflow.yaml", manifest: workflowManifest }],
    relationships: [
      {
        src_id: asset.id,
        dst_id: workflowId,
        relation_type: "contains_workflow",
        metadata: { relationship_id: `${asset.id}->contains_workflow->${workflowId}`, path: "workflow/workflow.yaml" }
      },
      ...(asset.derivedFrom ?? []).map((derived) => ({
        src_id: asset.id,
        dst_id: derived.asset_id,
        relation_type: derived.relation,
        metadata: { relationship_id: `${asset.id}->${derived.relation}->${derived.asset_id}`, included: derived.included }
      }))
    ]
  };
  return { ...base, manifest_hash: sha256Bytes(JSON.stringify(base)) };
}

function event(tx: string, seq: number, type: string, payload: Record<string, unknown>, timestampOffset = 0): ProtocolEvent {
  const timestamp = Date.parse(FIXED_NOW) + timestampOffset;
  return {
    tx_digest: tx,
    event_seq: seq,
    event_type: type,
    checkpoint: timestamp,
    timestamp_ms: timestamp,
    payload: { ...payload, created_at: new Date(timestamp).toISOString() }
  };
}

function reportId(assetId: string): string {
  return `report:${shortHash(`${assetId}:showcase-report`, 20)}`;
}

async function buildIndex(manifests: Map<string, ReleaseManifest>): Promise<IndexState> {
  const events: ProtocolEvent[] = [];
  let tick = 0;
  for (const asset of ASSETS) {
    const manifest = manifests.get(asset.id);
    if (!manifest) throw new Error(`Missing manifest for ${asset.id}`);
    const tx = `tx_${shortHash(`${asset.id}:${manifest.manifest_hash}`, 32)}`;
    const walrusBlob = `walrus:showcase:${shortHash(manifest.content_hash, 24)}`;
    const object = objectId("0x", `${asset.id}:object`);
    let seq = 0;
    events.push(event(tx, seq++, "ResearchAssetPublished", {
      asset_id: asset.id,
      sui_object_id: object,
      owner: OWNER,
      creator: OWNER,
      asset_type_mask: asset.types,
      version: asset.version,
      title: asset.title,
      manifest_hash: manifest.manifest_hash,
      content_hash: manifest.content_hash,
      walrus_blob_id: walrusBlob,
      walrus_object_id: objectId("0x", `${asset.id}:walrus`),
      repo_url: manifest.repo,
      repo_commit: manifest.commit
    }, tick += 1000));
    events.push(event(tx, seq++, "ResearchReportPublished", {
      report_id: reportId(asset.id),
      sui_object_id: objectId("0x", `${asset.id}:report`),
      agent: OWNER,
      asset_id: asset.id,
      title: asset.title,
      visibility: asset.access,
      required_tier: asset.requiredTier ?? 0,
      walrus_blob_id: walrusBlob,
      seal_id: asset.access === "public" ? "" : "0x5ea1000000000000000000000000000000000000",
      plaintext_commitment: manifest.content_hash,
      free_preview_hash: shortHash(asset.abstract, 32),
      free_preview: asset.abstract
    }, tick += 1000));
    for (const skill of manifest.skills) {
      events.push(event(tx, seq++, "SkillPublished", {
        skill_id: skill.id,
        sui_object_id: objectId("0x", `${asset.id}:${skill.id}`),
        source_asset_id: asset.id,
        name: skill.manifest.name,
        version: skill.manifest.version,
        description: skill.manifest.description,
        relation: skill.manifest.relation,
        manifest_hash: manifest.manifest_hash,
        walrus_blob_id: walrusBlob,
        owner_address: OWNER
      }, tick += 1000));
    }
    for (const relationship of manifest.relationships.filter((item) => item.relation_type === "contains_workflow")) {
      events.push(event(tx, seq++, "AssetRelationshipRegistered", {
        ...relationship,
        source_asset_id: asset.id
      }, tick += 1000));
    }
  }

  events.push(event("tx_showcase_graph", 0, "AssetForked", {
    parent_asset_id: "ra:showcase:research-network-protocol",
    child_asset_id: "ra:showcase:citation-liquidity",
    included_mask: 69,
    caller: OWNER,
    relation: "extends"
  }, tick += 1000));
  events.push(event("tx_showcase_graph", 1, "AssetForked", {
    parent_asset_id: "ra:showcase:research-network-protocol",
    child_asset_id: "ra:showcase:browse-to-publish-benchmark",
    included_mask: 6,
    caller: OWNER,
    relation: "benchmarks"
  }, tick += 1000));
  events.push(event("tx_showcase_graph", 2, "AssetCited", {
    src_asset_id: "ra:showcase:browse-to-publish-benchmark",
    dst_asset_id: "ra:showcase:citation-liquidity",
    relation_type: "evaluates",
    caller: OWNER
  }, tick += 1000));
  events.push(event("tx_showcase_access", 0, "PlatformMembershipPurchased", {
    pass_id: "pass:showcase:member-001",
    owner: "0x91f3a0f2d4a79e32beabf5c260d332f53cf1a771",
    tier: 1,
    started_ms: Date.parse(FIXED_NOW),
    expires_ms: Date.parse(FIXED_NOW) + 30 * 24 * 60 * 60 * 1000
  }, tick += 1000));
  events.push(event("tx_showcase_access", 1, "AccessReceiptRecorded", {
    receipt_id: "receipt:showcase:citation-read-001",
    period_id: 202606,
    user: "0x91f3a0f2d4a79e32beabf5c260d332f53cf1a771",
    report_id: reportId("ra:showcase:citation-liquidity"),
    agent: OWNER,
    access_type: "platform_member",
    created_ms: Date.parse(FIXED_NOW) + tick
  }, tick += 1000));
  events.push(event("tx_showcase_access", 2, "MembershipReportSettled", {
    period_id: 202606,
    user: "0x91f3a0f2d4a79e32beabf5c260d332f53cf1a771",
    report_id: reportId("ra:showcase:citation-liquidity"),
    agent: OWNER,
    amount: 4200,
    created_ms: Date.parse(FIXED_NOW) + tick
  }, tick += 1000));
  events.push(event("tx_showcase_delegation", 0, "DelegationCreated", {
    job_id: "delegation:showcase:browse-review",
    buyer: "0xa11ce00000000000000000000000000000000000",
    agent: OWNER,
    budget: 9000,
    deadline_ms: Date.parse(FIXED_NOW) + 7 * 24 * 60 * 60 * 1000,
    created_ms: Date.parse(FIXED_NOW) + tick
  }, tick += 1000));
  events.push(event("tx_showcase_delegation", 1, "DelegationCompleted", {
    job_id: "delegation:showcase:browse-review",
    payout: 8600,
    created_ms: Date.parse(FIXED_NOW) + tick
  }, tick += 1000));
  events.push(event("tx_showcase_payment", 0, "CrossChainPaymentReceived", {
    order_hash: "order:showcase:base-to-sui-001",
    source_chain: "base",
    source_tx: "0xbasepayment001",
    buyer: "0xa11ce00000000000000000000000000000000000",
    amount: 12000
  }, tick += 1000));

  const byBlob = new Map<string, ReleaseManifest>();
  for (const asset of ASSETS) {
    const manifest = manifests.get(asset.id);
    if (!manifest) throw new Error(`Missing manifest for ${asset.id}`);
    byBlob.set(`walrus:showcase:${shortHash(manifest.content_hash, 24)}`, manifest);
  }
  const index = await applyEvents(emptyIndexState(), events, {
    manifestLoader: async (candidate) => byBlob.get(String(candidate.payload.walrus_blob_id))
  });
  index.updated_at = FIXED_NOW;
  for (const document of Object.values(index.search_documents)) {
    document.updated_at = FIXED_NOW;
  }
  for (const relationship of Object.values(index.relationships)) {
    relationship.created_at = relationship.created_at || FIXED_NOW;
  }
  return index;
}

async function main(): Promise<void> {
  await fs.rm(SHOWCASE_ROOT, { recursive: true, force: true });
  await fs.mkdir(LOCALNET_ROOT, { recursive: true });
  const manifests = new Map<string, ReleaseManifest>();
  for (const asset of ASSETS) {
    const workspace = await writeWorkspace(asset);
    manifests.set(asset.id, await releaseManifest(asset, workspace));
  }
  const index = await buildIndex(manifests);
  await writeJsonFile(path.join(LOCALNET_ROOT, "index.json"), index);
  await fs.writeFile(path.join(LOCALNET_ROOT, "events.ndjson"), index.events.map((item) => JSON.stringify(item)).join("\n") + "\n", "utf8");
  await writeJsonFile(path.join(LOCALNET_ROOT, "payments.json"), []);
  await writeJsonFile(path.join(LOCALNET_ROOT, "auth.json"), { intents: {}, accounts: {} });
  await writeJsonFile(path.join(LOCALNET_ROOT, "sui-event-cursors.json"), {
    module_cursors: {},
    last_checkpoints: {},
    pages_fetched: 0,
    events_seen: 0,
    events_ingested: 0,
    updated_at: FIXED_NOW
  });
  console.log(`Public showcase written to ${SHOWCASE_ROOT}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
