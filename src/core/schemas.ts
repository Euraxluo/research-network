import path from "node:path";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { readJsonFile } from "./fs.js";
import { SCHEMA_DIR } from "./paths.js";

export interface SchemaValidators {
  asset: ValidateFunction;
  skill: ValidateFunction;
  workflow: ValidateFunction;
}

let cached: SchemaValidators | undefined;

export async function loadSchemaValidators(): Promise<SchemaValidators> {
  if (cached) {
    return cached;
  }
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    allowUnionTypes: true
  });
  const assetSchema = await readJsonFile<Record<string, unknown>>(path.join(SCHEMA_DIR, "asset.schema.json"), {});
  const skillSchema = await readJsonFile<Record<string, unknown>>(path.join(SCHEMA_DIR, "skill.schema.json"), {});
  const workflowSchema = await readJsonFile<Record<string, unknown>>(path.join(SCHEMA_DIR, "workflow.schema.json"), {});
  cached = {
    asset: ajv.compile(assetSchema),
    skill: ajv.compile(skillSchema),
    workflow: ajv.compile(workflowSchema)
  };
  return cached;
}

export function formatSchemaErrors(validate: ValidateFunction, prefix: string): string[] {
  return (validate.errors ?? []).map((error) => {
    const location = error.instancePath || "/";
    return `${prefix}${location}: ${error.message ?? "invalid value"}`;
  });
}
