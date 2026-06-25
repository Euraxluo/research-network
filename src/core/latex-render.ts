import { execFile } from "node:child_process";
import { readdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class LatexHtmlRendererUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LatexHtmlRendererUnavailable";
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch {
    return false;
  }
}

async function findFile(dir: string, name: string): Promise<string | undefined> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if ((entry.isFile() || entry.isSymbolicLink()) && entry.name === name) return full;
    if (entry.isDirectory()) {
      const found = await findFile(full, name);
      if (found) return found;
    }
  }
  return undefined;
}

async function resolveMake4ht(): Promise<{ command: string; env: NodeJS.ProcessEnv }> {
  if (process.env.RN_MAKE4HT_PATH) {
    return {
      command: process.env.RN_MAKE4HT_PATH,
      env: {
        ...process.env,
        LC_ALL: "C",
        LANG: "C",
        PATH: `${path.dirname(process.env.RN_MAKE4HT_PATH)}:${process.env.PATH ?? ""}`
      }
    };
  }
  const bundledRoot = path.resolve(process.cwd(), ".vercel", "texlive");
  const bundled = await findFile(bundledRoot, "make4ht");
  if (bundled && await fileExists(bundled)) {
    const binDir = path.dirname(bundled);
    return {
      command: bundled,
      env: {
        ...process.env,
        LC_ALL: "C",
        LANG: "C",
        PATH: `${binDir}:${process.env.PATH ?? ""}`
      }
    };
  }
  return { command: "make4ht", env: process.env };
}

function bodyFragment(html: string): string {
  const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return (match ? match[1] : html).trim();
}

export async function renderLatexToHtmlWithMake4ht(source: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "rn-latex-"));
  try {
    const inputPath = path.join(root, "paper.tex");
    const outputDir = path.join(root, "out");
    await writeFile(inputPath, source, "utf8");
    try {
      const make4ht = await resolveMake4ht();
      await execFileAsync(
        make4ht.command,
        ["-u", "-f", "html5", "-d", outputDir, inputPath],
        {
          cwd: root,
          env: make4ht.env,
          timeout: Number(process.env.RN_LATEX_RENDER_TIMEOUT_MS ?? 20_000),
          maxBuffer: 8 * 1024 * 1024
        }
      );
    } catch (error) {
      const err = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
      if (err.code === "ENOENT") {
        throw new LatexHtmlRendererUnavailable("make4ht is not installed in this runtime");
      }
      throw new LatexHtmlRendererUnavailable(
        [err.message, err.stderr, err.stdout].filter(Boolean).join("\n").slice(0, 4000)
      );
    }
    const html = await readFile(path.join(outputDir, "paper.html"), "utf8");
    const fragment = bodyFragment(html);
    if (!fragment) {
      throw new LatexHtmlRendererUnavailable("make4ht produced an empty HTML document");
    }
    return fragment;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
