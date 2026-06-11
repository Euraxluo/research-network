import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import { toPosixPath } from "./paths.js";

const DEFAULT_IGNORES = new Set([
  ".git",
  "node_modules",
  "dist",
  ".research-network",
  ".DS_Store"
]);

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readYamlFile<T>(filePath: string): Promise<T> {
  return YAML.parse(await fs.readFile(filePath, "utf8")) as T;
}

export async function writeYamlFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, YAML.stringify(value), "utf8");
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  if (!(await pathExists(filePath))) {
    return fallback;
  }
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function listFiles(root: string, ignores = DEFAULT_IGNORES): Promise<string[]> {
  const output: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (ignores.has(entry.name)) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        output.push(toPosixPath(path.relative(root, fullPath)));
      }
    }
  }

  await walk(root);
  return output.sort();
}

export function gitValue(root: string, args: string[], fallback: string): string {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  const value = result.status === 0 ? result.stdout.trim() : "";
  return value || fallback;
}

export async function copyDirectory(src: string, dst: string): Promise<void> {
  await fs.rm(dst, { recursive: true, force: true });
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.cp(src, dst, {
    recursive: true,
    filter: (source) => !source.split(path.sep).some((part) => DEFAULT_IGNORES.has(part))
  });
}

export async function copyListedFiles(root: string, files: string[], dst: string): Promise<void> {
  await fs.rm(dst, { recursive: true, force: true });
  for (const file of files) {
    const source = path.join(root, file);
    const target = path.join(dst, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
  }
}
