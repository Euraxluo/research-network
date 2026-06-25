import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

function configuredMake4htPath(): string {
  return process.env.RN_MAKE4HT_PATH || "make4ht";
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
      await execFileAsync(
        configuredMake4htPath(),
        ["-u", "-f", "html5", "-d", outputDir, inputPath],
        {
          cwd: root,
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
