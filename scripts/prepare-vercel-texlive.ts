import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TINYTEX_VERSION = "2026.06";
const TINYTEX_URL =
  process.env.RN_TINYTEX_URL ||
  `https://github.com/rstudio/tinytex-releases/releases/download/v${TINYTEX_VERSION}/TinyTeX-1-linux-x86_64-v${TINYTEX_VERSION}.tar.xz`;
const ROOT = path.resolve(".vercel", "texlive");
const CACHE_DIR = path.resolve(".vercel", "cache");
const ARCHIVE = path.join(CACHE_DIR, `TinyTeX-1-linux-x86_64-v${TINYTEX_VERSION}.tar.xz`);
const TLMGR_REPOSITORY = process.env.RN_TLMGR_REPOSITORY || "https://mirror.ctan.org/systems/texlive/tlnet";
const DEFAULT_PACKAGES = ["make4ht", "tex4ht", "booktabs"];

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findFile(dir: string, name: string): Promise<string | undefined> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === name) return full;
    if (entry.isDirectory()) {
      const found = await findFile(full, name);
      if (found) return found;
    }
  }
  return undefined;
}

async function pruneRuntime(root: string) {
  const pruneNames = new Set(["doc", "source", "backups", "tlpkg"]);
  async function walk(dir: string) {
    const { readdir } = await import("node:fs/promises");
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (!entry.isDirectory()) return;
      if (pruneNames.has(entry.name)) {
        await rm(full, { recursive: true, force: true });
        return;
      }
      await walk(full);
    }));
  }
  await walk(root);
}

async function installMake4ht(root: string) {
  let make4ht = await findFile(root, "make4ht");
  if (make4ht) return make4ht;
  const tlmgr = await findFile(root, "tlmgr");
  if (!tlmgr) {
    throw new Error("TinyTeX archive did not contain make4ht or tlmgr");
  }
  const binDir = path.dirname(tlmgr);
  const env = { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` };
  const packages = (process.env.RN_TINYTEX_PACKAGES || DEFAULT_PACKAGES.join(" "))
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  await execFileAsync(tlmgr, ["option", "repository", TLMGR_REPOSITORY], { env, maxBuffer: 8 * 1024 * 1024 });
  await execFileAsync(tlmgr, ["option", "docfiles", "0"], { env, maxBuffer: 8 * 1024 * 1024 });
  await execFileAsync(tlmgr, ["option", "srcfiles", "0"], { env, maxBuffer: 8 * 1024 * 1024 });
  await execFileAsync(tlmgr, ["install", ...packages], {
    env,
    timeout: Number(process.env.RN_TLMGR_INSTALL_TIMEOUT_MS ?? 240_000),
    maxBuffer: 16 * 1024 * 1024
  });
  make4ht = await findFile(root, "make4ht");
  if (!make4ht) {
    throw new Error(`tlmgr install completed but make4ht was not found; packages=${packages.join(",")}`);
  }
  return make4ht;
}

async function download(url: string, output: string) {
  if (await exists(output)) return;
  await mkdir(path.dirname(output), { recursive: true });
  const response = await fetch(url, {
    signal: AbortSignal.timeout(Number(process.env.RN_TINYTEX_DOWNLOAD_TIMEOUT_MS ?? 240_000))
  });
  if (!response.ok || !response.body) {
    throw new Error(`TinyTeX download failed: HTTP ${response.status}`);
  }
  const stream = createWriteStream(output, { mode: 0o644 });
  await finished(Readable.fromWeb(response.body).pipe(stream));
}

async function main() {
  const shouldBundle =
    process.env.RN_BUNDLE_TEXLIVE === "1" ||
    process.env.RN_BUNDLE_TEXLIVE === "true" ||
    (process.env.VERCEL === "1" && process.platform === "linux" && process.arch === "x64");
  if (!shouldBundle) {
    console.log("Skipping TinyTeX bundle; set RN_BUNDLE_TEXLIVE=1 to force it locally.");
    return;
  }
  const existing = await findFile(ROOT, "make4ht").catch(() => undefined);
  if (existing) {
    console.log(`TinyTeX already prepared: ${existing}`);
    return;
  }
  console.log(`Downloading TinyTeX runtime: ${TINYTEX_URL}`);
  await download(TINYTEX_URL, ARCHIVE);
  console.log(`Extracting TinyTeX runtime to ${ROOT}`);
  await rm(ROOT, { recursive: true, force: true });
  await mkdir(ROOT, { recursive: true });
  await execFileAsync("tar", ["-xJf", ARCHIVE, "-C", ROOT], { maxBuffer: 8 * 1024 * 1024 });
  const make4ht = await installMake4ht(ROOT);
  await pruneRuntime(ROOT);
  await execFileAsync("chmod", ["-R", "u+rwX,go+rX", ROOT], { maxBuffer: 8 * 1024 * 1024 });
  const binDir = path.dirname(make4ht);
  const env = { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` };
  await execFileAsync(make4ht, ["--version"], { env, maxBuffer: 1024 * 1024 });
  console.log(`TinyTeX make4ht ready: ${make4ht}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
