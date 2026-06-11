import fs from "node:fs/promises";
import path from "node:path";
import {
  type ResearchAssetManifest,
  type ResearchSkillManifest,
  type ResearchWorkflowManifest,
  type ValidationIssue,
  type ValidationReport
} from "./types.js";
import { pathExists, readYamlFile } from "./fs.js";
import { formatSchemaErrors, loadSchemaValidators } from "./schemas.js";

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/, "private-key"],
  [/\bgh[pousr]_[A-Za-z0-9_]{30,}\b/, "github-token"],
  [/\bsk-[A-Za-z0-9]{20,}\b/, "openai-token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "aws-access-key"],
  [/\bSUI_PRIVATE_KEY\s*=/, "sui-private-key"]
];

function issue(
  severity: ValidationIssue["severity"],
  code: string,
  message: string,
  pathValue?: string
): ValidationIssue {
  return { severity, code, message, path: pathValue };
}

function pushSchemaIssues(target: ValidationIssue[], messages: string[], filePath: string): void {
  for (const message of messages) {
    target.push(issue("error", "schema.invalid", message, filePath));
  }
}

async function maybeReadYaml<T>(root: string, relativePath: string, errors: ValidationIssue[]): Promise<T | undefined> {
  const fullPath = path.join(root, relativePath);
  if (!(await pathExists(fullPath))) {
    errors.push(issue("error", "file.missing", `Required file does not exist: ${relativePath}`, relativePath));
    return undefined;
  }
  try {
    return await readYamlFile<T>(fullPath);
  } catch (error) {
    errors.push(
      issue(
        "error",
        "yaml.invalid",
        `Cannot parse YAML in ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
        relativePath
      )
    );
    return undefined;
  }
}

async function scanSecrets(root: string, relativeFiles: string[], warnings: ValidationIssue[]): Promise<void> {
  for (const relativeFile of relativeFiles) {
    const extension = path.extname(relativeFile).toLowerCase();
    if (![".yaml", ".yml", ".md", ".tex", ".json", ".ts", ".js", ".py", ".env"].includes(extension)) {
      continue;
    }
    const fullPath = path.join(root, relativeFile);
    let text: string;
    try {
      text = await fs.readFile(fullPath, "utf8");
    } catch {
      continue;
    }
    for (const [pattern, code] of SECRET_PATTERNS) {
      if (pattern.test(text)) {
        warnings.push(issue("warning", `secret.${code}`, `Possible secret detected in ${relativeFile}`, relativeFile));
      }
    }
  }
}

async function listProtocolFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if ([".git", "node_modules", "dist", ".research-network"].includes(entry.name)) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        output.push(path.relative(root, fullPath));
      }
    }
  }
  await walk(root);
  return output;
}

export async function validateWorkspace(rootInput = "."): Promise<ValidationReport> {
  const root = path.resolve(rootInput);
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const detected_assets = {
    papers: 0,
    skills: 0,
    workflows: 0,
    datasets: 0,
    code: 0
  };

  const validators = await loadSchemaValidators();
  const asset = await maybeReadYaml<ResearchAssetManifest>(root, "asset.yaml", errors);
  if (!asset) {
    return { valid: false, root, detected_assets, errors, warnings };
  }

  if (!validators.asset(asset)) {
    pushSchemaIssues(errors, formatSchemaErrors(validators.asset, "asset"), "asset.yaml");
  }

  if (asset.types.includes("paper")) {
    const paper = asset.assets?.paper;
    const paperSource = paper?.source;
    const paperPdf = paper?.path;
    const sourceExists = paperSource ? await pathExists(path.join(root, paperSource)) : false;
    const pdfExists = paperPdf ? await pathExists(path.join(root, paperPdf)) : false;
    if (!sourceExists && !pdfExists) {
      errors.push(
        issue(
          "error",
          "paper.missing",
          "Asset declares type paper but neither assets.paper.source nor assets.paper.path exists",
          paperSource ?? paperPdf ?? "asset.yaml"
        )
      );
    } else {
      detected_assets.papers = 1;
      if (!pdfExists && paperPdf) {
        warnings.push(issue("warning", "paper.pdf_missing", `PDF not found yet: ${paperPdf}`, paperPdf));
      }
    }
  }

  if (asset.types.includes("skill")) {
    const skills = asset.assets?.skills ?? [];
    if (skills.length === 0) {
      errors.push(issue("error", "skill.none", "Asset declares type skill but assets.skills is empty", "asset.yaml"));
    }
    for (const skillRef of skills) {
      const skillDir = skillRef.path.replace(/\/$/, "");
      const skillYaml = path.join(skillDir, "skill.yaml");
      const skill = await maybeReadYaml<ResearchSkillManifest>(root, skillYaml, errors);
      if (!skill) {
        continue;
      }
      if (!validators.skill(skill)) {
        pushSchemaIssues(errors, formatSchemaErrors(validators.skill, "skill"), skillYaml);
      }
      if (skillRef.relation && skillRef.relation !== skill.relation) {
        errors.push(
          issue(
            "error",
            "skill.relation_mismatch",
            `Skill relation mismatch for ${skill.name}: asset.yaml says ${skillRef.relation}, skill.yaml says ${skill.relation}`,
            skillYaml
          )
        );
      }
      if (skill.relation === "forked" && !skill.derived_from) {
        errors.push(issue("error", "skill.fork_missing_source", `Forked skill ${skill.name} must declare derived_from`, skillYaml));
      }
      if (skill.relation === "owned" && skill.derived_from) {
        warnings.push(issue("warning", "skill.owned_has_source", `Owned skill ${skill.name} declares derived_from`, skillYaml));
      }
      const entry = path.join(skillDir, skill.entry ?? "SKILL.md");
      if (!(await pathExists(path.join(root, entry)))) {
        errors.push(issue("error", "skill.entry_missing", `Skill entry file does not exist: ${entry}`, entry));
      }
      detected_assets.skills += 1;
    }
  }

  if (asset.types.includes("workflow")) {
    const workflowPath = asset.assets?.workflow?.path;
    if (!workflowPath) {
      errors.push(issue("error", "workflow.path_missing", "Asset declares workflow but assets.workflow.path is missing", "asset.yaml"));
    } else {
      const workflow = await maybeReadYaml<ResearchWorkflowManifest>(root, workflowPath, errors);
      if (workflow) {
        if (!validators.workflow(workflow)) {
          pushSchemaIssues(errors, formatSchemaErrors(validators.workflow, "workflow"), workflowPath);
        }
        detected_assets.workflows = 1;
      }
    }
  }

  if (asset.types.includes("dataset")) {
    detected_assets.datasets = await pathExists(path.join(root, "data")) ? 1 : 0;
    if (!detected_assets.datasets) {
      warnings.push(issue("warning", "dataset.dir_missing", "Asset declares dataset but data/ is missing", "data"));
    }
  }

  if (asset.types.includes("code")) {
    detected_assets.code = await pathExists(path.join(root, "code")) ? 1 : 0;
    if (!detected_assets.code) {
      warnings.push(issue("warning", "code.dir_missing", "Asset declares code but code/ is missing", "code"));
    }
  }

  if (!asset.license || Object.keys(asset.license).length === 0) {
    errors.push(issue("error", "license.missing", "All publishable assets must declare license terms", "asset.yaml"));
  }
  if (asset.commerce?.purchasable && !asset.commerce.price_policy) {
    errors.push(issue("error", "commerce.price_policy_missing", "Purchasable assets must declare commerce.price_policy", "asset.yaml"));
  }
  const split = asset.commerce?.revenue_split;
  if (split && split.length > 0) {
    const sum = split.reduce((total, row) => total + Number(row.weight_bps ?? 0), 0);
    if (sum !== 10_000) {
      errors.push(issue("error", "commerce.revenue_split_sum", `Revenue split must equal 10000 bps; got ${sum}`, "asset.yaml"));
    }
  }

  for (const author of asset.authors ?? []) {
    if (author.type === "agent" && !author.agent_id) {
      errors.push(issue("error", "agent.author_id_missing", `Agent author ${author.name} must declare agent_id`, "asset.yaml"));
    }
  }

  await scanSecrets(root, await listProtocolFiles(root), warnings);

  return {
    valid: errors.length === 0,
    root,
    asset,
    detected_assets,
    errors,
    warnings
  };
}
