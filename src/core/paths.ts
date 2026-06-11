import path from "node:path";
import { existsSync } from "node:fs";

function findProjectRoot(): string {
  let cursor = path.resolve(new URL("../..", import.meta.url).pathname);
  for (let i = 0; i < 6; i += 1) {
    if (
      existsSync(path.join(cursor, "schemas", "asset.schema.json")) &&
      existsSync(path.join(cursor, "templates", "research-asset-template"))
    ) {
      return cursor;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }
  return path.resolve(process.cwd());
}

export const PROJECT_ROOT = findProjectRoot();
export const SCHEMA_DIR = path.join(PROJECT_ROOT, "schemas");
export const TEMPLATE_DIR = path.join(PROJECT_ROOT, "templates", "research-asset-template");
export const DEFAULT_LOCALNET_DIR = path.join(PROJECT_ROOT, ".research-network", "localnet");
export const DEFAULT_RELEASE_DIR = path.join(PROJECT_ROOT, ".research-network", "releases");
export const WEB_DIST_DIR = path.join(PROJECT_ROOT, "web", "dist");
export const DEMO_PDF_PATH = path.join(PROJECT_ROOT, "resources", "demo-paper-only.pdf");

export function resolveWorkspace(input = "."): string {
  return path.resolve(input);
}

export function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}
