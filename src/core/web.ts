import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { readIndex } from "./local-store.js";
import { DEFAULT_LOCALNET_DIR, WEB_DIST_DIR } from "./paths.js";
import { renderWorkbenchBody, WORKBENCH_JS } from "./web-workbench.js";

const PDFJS_VERSION = "3.11.174";
const PDFJS_SCRIPT_INTEGRITY = "sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e";
const MATHJAX_VERSION = "3.2.2";
const MATHJAX_SCRIPT_INTEGRITY = "sha384-Wuix6BuhrWbjDBs24bXrjf4ZQ5aFeFWBuKkFekO2t8xFU0iNaLQfp2K6/1Nxveei";
const STATIC_ASSET_VERSION = "20260624-live-skills-v3";
const DEFAULT_TESTNET_RPC_URL = "https://sui-testnet-rpc.publicnode.com";
const DEFAULT_TESTNET_PACKAGE_ID = "0x5ecd097d8f13e995493d23c9b033c815bd6a8bf771331c389c027296e8b8231e";
const DEFAULT_TESTNET_WALRUS_AGGREGATOR_URL = "https://aggregator.walrus-testnet.walrus.space";
const DEFAULT_PROTOCOL_REPO = "Euraxluo/research-network";
const STATIC_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://cdn.jsdelivr.net",
  "connect-src 'self' data: https://api.github.com https://sui-testnet-rpc.publicnode.com https://fullnode.testnet.sui.io:443 https://*.sui.io https://aggregator.walrus-testnet.walrus.space https://*.walrus.space",
  "worker-src 'self' blob: https://cdnjs.cloudflare.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

function escapeHtml(input: unknown): string {
  return String(input ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function gitOutput(args: string[], fallback = ""): string {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  return result.status === 0 ? String(result.stdout || "").trim() || fallback : fallback;
}

function protocolRepoSlug(): string {
  const envSlug = process.env.RN_PROTOCOL_REPO ?? process.env.VERCEL_GIT_REPO_SLUG;
  const envOwner = process.env.VERCEL_GIT_REPO_OWNER;
  if (envOwner && envSlug && !envSlug.includes("/")) return `${envOwner}/${envSlug}`;
  if (envSlug && /^[^/]+\/[^/]+$/.test(envSlug)) return envSlug;
  const remote = process.env.RN_PROTOCOL_REPO_URL ?? process.env.RN_REPO_URL ?? gitOutput(["config", "--get", "remote.origin.url"]);
  const match = remote.match(/github\.com[:/]([^/\s]+)\/([^/\s.]+)(?:\.git)?$/);
  return match ? `${match[1]}/${match[2]}` : DEFAULT_PROTOCOL_REPO;
}

function gitTreeState(): "clean" | "dirty" | "unknown" {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  if (result.status !== 0) return "unknown";
  return String(result.stdout || "").trim() ? "dirty" : "clean";
}

function buildInfo(): Record<string, string> {
  const repo = protocolRepoSlug();
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? gitOutput(["rev-parse", "HEAD"], "unknown");
  const branch = process.env.VERCEL_GIT_COMMIT_REF ?? gitOutput(["rev-parse", "--abbrev-ref", "HEAD"], "main");
  return {
    repo,
    repoUrl: `https://github.com/${repo}`,
    branch,
    commit,
    shortCommit: commit && commit !== "unknown" ? commit.slice(0, 7) : "unknown",
    treeState: process.env.VERCEL ? "clean" : gitTreeState(),
    builtAt: new Date().toISOString(),
    assetVersion: STATIC_ASSET_VERSION
  };
}

function buildStatusHtml(): string {
  return `<div class="build-status" data-build-status data-repo="${escapeHtml(protocolRepoSlug())}" data-branch="main">
      <span data-build-status-text>Build status loading...</span>
      <button class="build-status-button" type="button" data-build-check>Check latest</button>
      <button class="build-status-button" type="button" data-clear-browser-state>Clear local state</button>
    </div>`;
}

function shell(title: string, body: string, options: { math?: boolean; subject?: string } = {}): string {
  const mathjax = options.math
    ? `<script>window.MathJax={tex:{inlineMath:[["\\\\(","\\\\)"]],displayMath:[["\\\\[","\\\\]"]]}};</script>
  <script src="https://cdn.jsdelivr.net/npm/mathjax@${MATHJAX_VERSION}/es5/tex-mml-chtml.js" integrity="${MATHJAX_SCRIPT_INTEGRITY}" crossorigin="anonymous" async></script>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - Research Network</title>
  <meta name="description" content="Agent-native decentralized research asset network: papers, skills, datasets and code published with verifiable Sui and Walrus provenance.">
  <meta http-equiv="Content-Security-Policy" content="${STATIC_CSP}">
  <link rel="stylesheet" href="/styles.css?v=${STATIC_ASSET_VERSION}">
  <script src="/site.js?v=${STATIC_ASSET_VERSION}" defer></script>
  ${mathjax}
</head>
<body>
  <div class="slim-strip"><div class="wrap">Git is the workspace · Walrus is the snapshot · Sui is the registry · Agents are first-class users</div></div>
  <header class="banner">
    <div class="wrap banner-inner">
      <a class="logo" href="/">research<span class="logo-chi">&chi;</span>iv</a>
      <form class="banner-search" action="/" method="get">
        <input type="search" name="q" placeholder="Search assets, skills, tags&hellip;" aria-label="Search">
        <button type="submit">Search</button>
      </form>
    </div>
  </header>
  <div class="subnav"><div class="wrap subnav-inner">
    <a href="/">Browse</a>
    <a href="/search.html">Search</a>
    <a href="/skills.html">Skills</a>
    <a href="/dashboard.html">Dashboard</a>
    <a href="/workbench.html">Workbench</a>
    <a href="/membership.html">Membership</a>
    <a href="/delegations.html">Delegations</a>
    <a href="/account.html">Account</a>
  </div></div>
  ${options.subject ? `<div class="subject-strip"><div class="wrap"><h1>${escapeHtml(options.subject)}</h1></div></div>` : ""}
  <main class="wrap">${body}</main>
  <footer class="footer"><div class="wrap">
    <p>Static site generated by the Research Network protocol kit · deployable to Walrus Sites.</p>
    ${buildStatusHtml()}
  </div></footer>
</body>
</html>`;
}

function routeSegment(id: string): string {
  if (/^[A-Za-z0-9._~-]+$/.test(id)) {
    return id;
  }
  return Buffer.from(id, "utf8").toString("base64url");
}

export { routeSegment };

function webPath(...segments: string[]): string {
  return `/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

function fileUrl(base: string, relativePath?: string): string | undefined {
  if (!relativePath) {
    return undefined;
  }
  if (/^https?:\/\//.test(base)) {
    return `${base.replace(/\/$/, "")}/${relativePath}`;
  }
  if (base.startsWith("file://")) {
    return `${base.replace(/\/$/, "")}/${relativePath}`;
  }
  return relativePath;
}

interface PublishedArtifactSource {
  localnetRoot: string;
  walrusBlobId: string;
}

function archiveMemberCandidates(relativePath?: string): string[] {
  if (!relativePath) {
    return [];
  }
  const normalized = path.posix.normalize(relativePath.replaceAll("\\", "/"));
  if (normalized.startsWith("../") || normalized === ".." || normalized.startsWith("/")) {
    return [];
  }
  return [`./${normalized}`, normalized];
}

async function readLocalWalrusArtifact(source: PublishedArtifactSource | undefined, relativePath?: string): Promise<Buffer | undefined> {
  if (!source?.walrusBlobId?.startsWith("walrus:local:")) {
    return undefined;
  }
  const suffix = source.walrusBlobId.slice("walrus:local:".length);
  if (!/^[a-zA-Z0-9_-]+$/.test(suffix)) {
    return undefined;
  }
  const archivePath = path.join(source.localnetRoot, "walrus", `walrus_local_${suffix}`, "release.tar.zst");
  try {
    await fs.access(archivePath);
  } catch {
    return undefined;
  }
  const decompressed = spawnSync("zstd", ["-dc", archivePath], { maxBuffer: 128 * 1024 * 1024 });
  if (decompressed.status !== 0 || !Buffer.isBuffer(decompressed.stdout)) {
    return undefined;
  }
  for (const member of archiveMemberCandidates(relativePath)) {
    const extracted = spawnSync("tar", ["-xOf", "-", member], {
      input: decompressed.stdout,
      maxBuffer: 128 * 1024 * 1024
    });
    if (extracted.status === 0 && Buffer.isBuffer(extracted.stdout)) {
      return extracted.stdout;
    }
  }
  return undefined;
}

async function writePaperArtifact(outputDir: string, assetId: string, relativePath: string | undefined, contents: Buffer): Promise<string> {
  const targetRel = path.join("paper", routeSegment(assetId), path.basename(relativePath ?? "paper"));
  const targetAbs = path.join(outputDir, targetRel);
  await fs.mkdir(path.dirname(targetAbs), { recursive: true });
  await fs.writeFile(targetAbs, contents);
  return webPath("paper", routeSegment(assetId), path.basename(relativePath ?? "paper"));
}

async function copyPaperArtifact(
  outputDir: string,
  assetId: string,
  base: string,
  relativePath?: string,
  artifactSource?: PublishedArtifactSource
): Promise<string | undefined> {
  const url = fileUrl(base, relativePath);
  if (!url && !relativePath) {
    return undefined;
  }
  if (url?.startsWith("file://")) {
    try {
      return await writePaperArtifact(outputDir, assetId, relativePath, await fs.readFile(new URL(url)));
    } catch {
      // Fall back to the published Walrus release below.
    }
  }
  const publishedArtifact = await readLocalWalrusArtifact(artifactSource, relativePath);
  if (publishedArtifact) {
    return await writePaperArtifact(outputDir, assetId, relativePath, publishedArtifact);
  }
  return url?.startsWith("file://") ? undefined : url;
}

async function readPaperSource(base: string, relativePath?: string, artifactSource?: PublishedArtifactSource): Promise<string | undefined> {
  const url = fileUrl(base, relativePath);
  if (url?.startsWith("file://")) {
    try {
      return await fs.readFile(new URL(url), "utf8");
    } catch {
      // Fall back to the published Walrus release below.
    }
  }
  const publishedArtifact = await readLocalWalrusArtifact(artifactSource, relativePath);
  return publishedArtifact?.toString("utf8");
}

function paperCode(assetId: string): string {
  return `RA:${assetId.replace(/^ra:/, "").slice(0, 18)}`;
}

function humanDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return parsed.toUTCString().slice(0, 16);
}

function authorLine(authors: Array<{ name: string; type?: string; github?: string; agent_id?: string }> = []): string {
  if (authors.length === 0) {
    return "Unknown";
  }
  return authors.map((author) => {
    const suffix = author.agent_id ? ` (${author.agent_id})` : author.github ? ` (@${author.github})` : author.type ? ` (${author.type})` : "";
    return `${author.name}${suffix}`;
  }).join(", ");
}

function bibtexKey(title: string, year: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
  return `${slug || "research_asset"}_${year}`;
}

function bibtexFor(asset: { id: string; title: string; created_at: string; manifest_hash: string; walrus_blob_id: string; manifest: { assets: { authors?: Array<{ name: string }> } } }): string {
  const year = String(new Date(asset.created_at).getUTCFullYear());
  const authors = asset.manifest.assets.authors?.map((author) => author.name).join(" and ") || "Research Network";
  return `@misc{${bibtexKey(asset.title, year)},
  title = {${asset.title}},
  author = {${authors}},
  year = {${year}},
  howpublished = {Research Network asset ${asset.id}},
  note = {Walrus blob ${asset.walrus_blob_id}; manifest ${asset.manifest_hash}}
}`;
}

/* ---------------------------------------------------------------- *
 * LaTeX -> HTML paper rendering (ar5iv-style)
 * ---------------------------------------------------------------- */

function latexInline(input: string): string {
  let text = input.replace(/%.*$/gm, "");
  text = escapeHtml(text);
  text = text
    .replace(/\\textbf\{([^{}]*)\}/g, "<strong>$1</strong>")
    .replace(/\\(?:emph|textit)\{([^{}]*)\}/g, "<em>$1</em>")
    .replace(/\\texttt\{([^{}]*)\}/g, "<code>$1</code>")
    .replace(/\\href\{([^{}]*)\}\{([^{}]*)\}/g, '<a href="$1">$2</a>')
    .replace(/\\url\{([^{}]*)\}/g, '<a href="$1">$1</a>')
    .replace(/\\footnote\{([^{}]*)\}/g, " ($1)")
    .replace(/\\cite[tp]?\{([^{}]*)\}/g, "[$1]")
    .replace(/\\(?:eq|c|page)?ref\{([^{}]*)\}/g, "$1")
    .replace(/\\label\{[^{}]*\}/g, "")
    .replace(/\$\$([^$]+)\$\$/g, '<span class="math display">\\[$1\\]</span>')
    .replace(/\$([^$]+)\$/g, '<span class="math">\\($1\\)</span>')
    .replace(/\\&amp;/g, "&amp;")
    .replace(/\\%/g, "%")
    .replace(/\\_/g, "_")
    .replace(/\\#/g, "#")
    .replace(/\\\\/g, "<br>")
    .replace(/(?:^|[^\\])~/g, (match) => match.replace("~", " "))
    .replace(/``/g, "\u201c")
    .replace(/''/g, "\u201d")
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?(?:\{[^{}]*\})?/g, "")
    .replace(/[{}]/g, "");
  return text.trim();
}

function latexParagraphs(input: string): string {
  return input
    .split(/\n\s*\n/)
    .map((paragraph) => latexInline(paragraph.replace(/\s*\n\s*/g, " ")))
    .filter(Boolean)
    .map((paragraph) => `<p>${paragraph}</p>`)
    .join("");
}

function latexBlocks(input: string): string {
  const out: string[] = [];
  const parts = input.split(/\\begin\{(itemize|enumerate|description|verbatim|equation\*?|align\*?)\}([\s\S]*?)\\end\{\1\}/g);
  for (let i = 0; i < parts.length; i += 1) {
    const slot = i % 3;
    if (slot === 0) {
      out.push(latexParagraphs(parts[i]));
    } else if (slot === 1) {
      const env = parts[i];
      const body = parts[i + 1] ?? "";
      if (env === "itemize" || env === "enumerate" || env === "description") {
        const items = body
          .split(/\\item\b(?:\[[^\]]*\])?/)
          .map((item) => item.trim())
          .filter(Boolean)
          .map((item) => `<li>${latexInline(item.replace(/\s*\n\s*/g, " "))}</li>`)
          .join("");
        out.push(env === "enumerate" ? `<ol>${items}</ol>` : `<ul>${items}</ul>`);
      } else if (env === "verbatim") {
        out.push(`<pre class="ltx-verbatim">${escapeHtml(body.replace(/^\n+|\n+$/g, ""))}</pre>`);
      } else {
        out.push(`<div class="math display">\\[${escapeHtml(body.trim())}\\]</div>`);
      }
      i += 1;
    }
  }
  return out.join("");
}

interface PaperSection {
  number: string;
  title: string;
  html: string;
}

function latexSections(input: string): PaperSection[] {
  const sections: PaperSection[] = [];
  const parts = input.split(/\\section\*?\{([^{}]+)\}/g);
  const preamble = parts[0]?.trim();
  if (preamble && latexBlocks(preamble)) {
    sections.push({ number: "", title: "", html: latexBlocks(preamble) });
  }
  for (let i = 1; i < parts.length; i += 2) {
    const sectionNumber = String(Math.ceil(i / 2));
    const title = latexInline(parts[i]);
    const content = parts[i + 1] ?? "";
    const subParts = content.split(/\\subsection\*?\{([^{}]+)\}/g);
    let html = latexBlocks(subParts[0] ?? "");
    for (let j = 1; j < subParts.length; j += 2) {
      const subNumber = `${sectionNumber}.${Math.ceil(j / 2)}`;
      html += `<h3><span class="ltx-tag">${escapeHtml(subNumber)}</span>${latexInline(subParts[j])}</h3>`;
      html += latexBlocks(subParts[j + 1] ?? "");
    }
    sections.push({ number: sectionNumber, title, html });
  }
  return sections;
}

interface RenderedPaper {
  html: string;
  hasMath: boolean;
  hasContent: boolean;
}

function renderPaperHtml(source: string | undefined, fallbackTitle: string, fallbackAuthors: string): RenderedPaper {
  if (!source) {
    return {
      html: `<div class="ltx-page"><p class="missing-note">No TeX source is available in the indexed snapshot, so the paper cannot be rendered as HTML.</p></div>`,
      hasMath: false,
      hasContent: false
    };
  }
  const title = source.match(/\\title\{([^{}]*)\}/)?.[1];
  const author = source.match(/\\author\{([^{}]*)\}/)?.[1]?.replace(/\\and\b/g, ", ");
  const abstract = source.match(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/)?.[1];
  const afterStart = source.split(/\\end\{abstract\}|\\maketitle/).at(-1) ?? source;
  const bodySource = afterStart.split(/\\bibliographystyle|\\bibliography\b|\\begin\{thebibliography\}|\\end\{document\}/).at(0) ?? afterStart;
  const sections = latexSections(bodySource);
  const pieces: string[] = [];
  pieces.push(`<h1 class="ltx-title">${title ? latexInline(title) : escapeHtml(fallbackTitle)}</h1>`);
  pieces.push(`<div class="ltx-authors">${author ? latexInline(author) : escapeHtml(fallbackAuthors)}</div>`);
  if (abstract) {
    pieces.push(`<div class="ltx-abstract"><h6>Abstract</h6>${latexParagraphs(abstract)}</div>`);
  }
  for (const section of sections) {
    if (!section.title) {
      pieces.push(`<section class="ltx-section">${section.html}</section>`);
      continue;
    }
    pieces.push(`<section class="ltx-section"><h2><span class="ltx-tag">${escapeHtml(section.number)}</span>${section.title}</h2>${section.html}</section>`);
  }
  const html = `<div class="ltx-page"><article class="ltx-document">${pieces.join("")}</article></div>`;
  return { html, hasMath: html.includes('class="math'), hasContent: true };
}

function renderMetadataHtml(title: string, authors: string, abstract: string | undefined, pdfOnly = false): RenderedPaper {
  const note = pdfOnly
    ? "The full paper is available as PDF only. Open the PDF tab for the complete document."
    : "";
  return {
    html: `<div class="ltx-page"><article class="ltx-document">
      <h1 class="ltx-title">${escapeHtml(title)}</h1>
      <div class="ltx-authors">${escapeHtml(authors)}</div>
      <div class="ltx-abstract"><h6>Abstract</h6><p>${escapeHtml((abstract ?? "").trim())}</p></div>
      ${note ? `<p class="missing-note">${escapeHtml(note)}</p>` : ""}
    </article></div>`,
    hasMath: false,
    hasContent: true
  };
}

/** Minimal, dependency-free markdown → HTML for README / paper.md rendering. Input is escaped
 *  first; only the markdown constructs below produce markup, so arbitrary HTML never passes. */
export function renderMarkdownBody(source: string): string {
  const lines = escapeHtml(source).replaceAll("\r\n", "\n").split("\n");
  const out: string[] = [];
  let paragraph: string[] = [];
  let listMode: "ul" | "ol" | null = null;
  let codeMode = false;
  let codeLines: string[] = [];

  const inline = (text: string): string => text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, href) =>
      /^(https?:\/\/|\/|#|\.\/)/.test(href) ? `<a href="${href}" rel="noopener">${label}</a>` : match);

  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${inline(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (listMode) {
      out.push(`</${listMode}>`);
      listMode = null;
    }
  };

  for (const line of lines) {
    if (codeMode) {
      if (/^```/.test(line)) {
        out.push(`<pre class="md-code">${codeLines.join("\n")}</pre>`);
        codeLines = [];
        codeMode = false;
      } else {
        codeLines.push(line);
      }
      continue;
    }
    if (/^```/.test(line)) {
      flushParagraph();
      flushList();
      codeMode = true;
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1].length + 1, 5);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const unordered = line.match(/^\s*[-*]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (unordered || ordered) {
      flushParagraph();
      const mode = unordered ? "ul" : "ol";
      if (listMode !== mode) {
        flushList();
        out.push(`<${mode}>`);
        listMode = mode;
      }
      out.push(`<li>${inline((unordered ?? ordered)![1])}</li>`);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    paragraph.push(line.trim());
  }
  if (codeMode && codeLines.length) {
    out.push(`<pre class="md-code">${codeLines.join("\n")}</pre>`);
  }
  flushParagraph();
  flushList();
  return out.join("\n");
}

function renderMarkdownPaper(source: string | undefined, fallbackTitle: string, fallbackAuthors: string): RenderedPaper {
  if (!source) {
    return { html: "", hasMath: false, hasContent: false };
  }
  // Lift a leading `# Title` into the document title to match the LaTeX layout.
  const titleMatch = source.match(/^#\s+(.+)\n?/);
  const body = titleMatch ? source.slice(titleMatch[0].length) : source;
  const html = `<div class="ltx-page"><article class="ltx-document md-doc">
    <h1 class="ltx-title">${escapeHtml(titleMatch?.[1]?.trim() || fallbackTitle)}</h1>
    <div class="ltx-authors">${escapeHtml(fallbackAuthors)}</div>
    ${renderMarkdownBody(body)}
  </article></div>`;
  return { html, hasMath: false, hasContent: true };
}

/** Block-explorer link config (HANDOFF §2.4-4): base URLs are overridable via env so the site
 *  can point at any Sui / Walrus explorer without code changes. */
export interface ExplorerConfig {
  suiBase: string;
  walrusBase: string;
}

interface OnChainProofConfig {
  network: string;
  suiRpcUrl: string;
  walrusAggregatorUrl: string;
  packageId: string;
  limit: number;
  protocolRepoUrl: string;
}

export function loadExplorerConfig(env: NodeJS.ProcessEnv = process.env): ExplorerConfig {
  return {
    suiBase: (env.SUI_EXPLORER_BASE_URL ?? "https://suiscan.xyz/testnet").replace(/\/$/, ""),
    walrusBase: (env.WALRUS_EXPLORER_BASE_URL ?? "https://walruscan.com/testnet").replace(/\/$/, "")
  };
}

/** Render an on-chain identifier as a clickable explorer link when it looks real; simulated
 *  local ids (tx_…, walrus:local:…, ra:local:…) stay plain text. */
function explorerLink(kind: "object" | "tx" | "account" | "walrus-blob", value: unknown, explorer: ExplorerConfig): string {
  const text = String(value ?? "");
  const escaped = escapeHtml(text);
  if (kind === "walrus-blob" && /^[A-Za-z0-9_-]{20,}$/.test(text)) {
    return `<a href="${escapeHtml(`${explorer.walrusBase}/blob/${text}`)}" rel="noopener" target="_blank">${escaped}</a>`;
  }
  if ((kind === "object" || kind === "account") && /^0x[0-9a-fA-F]{4,64}$/.test(text)) {
    return `<a href="${escapeHtml(`${explorer.suiBase}/${kind}/${text}`)}" rel="noopener" target="_blank">${escaped}</a>`;
  }
  if (kind === "tx" && /^[A-Za-z0-9]{32,50}$/.test(text) && !text.startsWith("tx_")) {
    return `<a href="${escapeHtml(`${explorer.suiBase}/tx/${text}`)}" rel="noopener" target="_blank">${escaped}</a>`;
  }
  return escaped;
}

function loadOnChainProofConfig(env: NodeJS.ProcessEnv = process.env): OnChainProofConfig {
  const limit = Number.parseInt(env.RN_SHOWCASE_EVENT_LIMIT ?? "6", 10);
  return {
    network: env.RN_WEB_NETWORK ?? env.RN_NETWORK ?? "testnet",
    suiRpcUrl: env.RN_TESTNET_SUI_RPC_URL ?? env.RN_SUI_RPC_URL ?? DEFAULT_TESTNET_RPC_URL,
    walrusAggregatorUrl: env.RN_WALRUS_AGGREGATOR_URL ?? env.WALRUS_AGGREGATOR_URL ?? DEFAULT_TESTNET_WALRUS_AGGREGATOR_URL,
    packageId: env.RN_PACKAGE_ID ?? DEFAULT_TESTNET_PACKAGE_ID,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 20) : 6,
    protocolRepoUrl: (env.RN_PROTOCOL_REPO_URL ?? env.RN_REPO_URL ?? "https://github.com/Euraxluo/research-network").replace(/\/$/, "")
  };
}

function renderChainSubmissionSource(config: OnChainProofConfig, explorer: ExplorerConfig): string {
  const eventType = `${config.packageId}::research_asset::ResearchAssetPublished`;
  return `<div hidden data-chain-source data-chain-index-api="/api/index" data-chain-rpc="${escapeHtml(config.suiRpcUrl)}" data-chain-package="${escapeHtml(config.packageId)}" data-chain-event-type="${escapeHtml(eventType)}" data-chain-limit="${config.limit}" data-sui-explorer="${escapeHtml(explorer.suiBase)}" data-walrus-explorer="${escapeHtml(explorer.walrusBase)}" data-walrus-aggregator="${escapeHtml(config.walrusAggregatorUrl)}" data-chain-network="${escapeHtml(config.network)}" data-protocol-repo="${escapeHtml(config.protocolRepoUrl)}"></div>`;
}

function renderPaperViewer(options: {
  paperPdf?: string;
  paperSource?: string;
  paperSourceLabel?: string;
  paperSourceText?: string;
  rendered: RenderedPaper;
}): string {
  const { paperPdf, paperSource, paperSourceLabel, paperSourceText, rendered } = options;
  const hasHtml = rendered.hasContent;
  const hasTex = Boolean(paperSourceText);
  const tabParts: string[] = [];
  if (paperPdf) tabParts.push(`<a class="format-tab" href="#pdf">PDF</a>`);
  if (hasHtml) tabParts.push(`<a class="format-tab" href="#paper">HTML</a>`);
  if (hasTex) tabParts.push(`<a class="format-tab" href="#tex">TeX</a>`);
  else if (paperSource) tabParts.push(`<a class="format-tab format-tab-external" href="${escapeHtml(paperSource)}">TeX</a>`);
  if (paperPdf) tabParts.push(`<a class="format-tab format-tab-external" href="${escapeHtml(paperPdf)}">Download PDF</a>`);
  if (paperSource) tabParts.push(`<a class="format-tab format-tab-external" href="${escapeHtml(paperSource)}" download>Download TeX</a>`);
  if (!tabParts.length) {
    return rendered.html;
  }

  const defaultFormat = paperPdf && !hasHtml ? "pdf" : "paper";
  const panels: string[] = [];
  if (paperPdf) {
    panels.push(`<section id="pdf" class="format-panel${defaultFormat === "pdf" ? " format-panel-default" : ""}" aria-label="PDF">
      <div class="pdfjs-viewer" data-pdf-url="${escapeHtml(paperPdf)}">
        <div class="pdfjs-pages" aria-busy="true" aria-label="PDF pages"></div>
      </div>
    </section>`);
  }
  if (hasHtml) {
    panels.push(`<section id="paper" class="format-panel${defaultFormat === "paper" ? " format-panel-default" : ""}" aria-label="HTML">
      <p class="source-note">${escapeHtml(paperSourceLabel ?? (hasTex ? "TeX source" : "metadata snapshot"))}</p>
      ${rendered.html}
    </section>`);
  }
  if (hasTex) {
    panels.push(`<section id="tex" class="format-panel" aria-label="TeX source">
      <p class="source-note">${escapeHtml(paperSourceLabel ?? "paper/main.tex")}${paperSource ? ` · <a href="${escapeHtml(paperSource)}" download>download raw file</a>` : ""}</p>
      <pre class="tex-source">${escapeHtml(paperSourceText)}</pre>
    </section>`);
  }

  return `<div class="paper-viewer" data-paper-viewer>
    <nav class="format-nav" aria-label="Paper formats">${tabParts.join('<span class="format-sep" aria-hidden="true"> | </span>')}</nav>
    ${panels.join("")}
  </div>`;
}

function repoLink(url: string): string {
  if (/^https?:\/\//.test(url)) {
    return `<li><a href="${escapeHtml(url)}" rel="noopener">Source Repository</a></li>`;
  }
  return "";
}

function renderAssetReports(
  reports: Array<{
    id: string;
    visibility: string;
    required_tier: number;
    walrus_blob_id: string;
    seal_id?: string;
    free_preview?: string;
  }>,
  explorer: ExplorerConfig
): string {
  if (!reports.length) {
    return "";
  }
  return `<div class="report-list">${reports.map((report) => `<article class="report-card">
    <h4>${escapeHtml(report.visibility)} report</h4>
    <dl class="mini-meta">
      <div><dt>ID</dt><dd><code>${escapeHtml(report.id)}</code></dd></div>
      <div><dt>Walrus</dt><dd>${explorerLink("walrus-blob", report.walrus_blob_id, explorer)}</dd></div>
      <div><dt>Tier</dt><dd>${escapeHtml(report.required_tier)}</dd></div>
      ${report.seal_id ? `<div><dt>Seal</dt><dd><code>${escapeHtml(report.seal_id)}</code></dd></div>` : ""}
    </dl>
    ${report.free_preview ? `<p>${escapeHtml(report.free_preview)}</p>` : ""}
  </article>`).join("")}</div>`;
}

async function readExistingWalrusSitesResources(outputDir: string): Promise<string | undefined> {
  try {
    return await fs.readFile(path.join(outputDir, "ws-resources.json"), "utf8");
  } catch {
    return undefined;
  }
}

type VerificationKind = "object" | "tx" | "account" | "walrus-blob" | "plain";

function verificationRows(fields: Record<string, unknown>, explorer?: ExplorerConfig, kinds: Record<string, VerificationKind> = {}): string {
  return `<dl class="verification">${Object.entries(fields)
    .map(([key, value]) => {
      const kind = kinds[key];
      const rendered = explorer && kind && kind !== "plain"
        ? explorerLink(kind, value, explorer)
        : escapeHtml(value);
      return `<div><dt>${escapeHtml(key)}</dt><dd>${rendered}</dd></div>`;
    })
    .join("")}</dl>`;
}

function jsonForInlineScript(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

export interface AccountDirectoryAsset {
  id: string;
  title: string;
  href: string;
  authors: string;
  githubs: string[];
  created_at: string;
  abstract?: string;
  types?: string[];
  tags?: string[];
  manifest_hash?: string;
  repo_url?: string;
  repo_commit?: string;
}

export function renderAccountPage(assetDirectory: AccountDirectoryAsset[] = []): string {
  const accountBody = `
<h1>Account</h1>
<div id="account-root"><p class="muted">Loading session…</p></div>
<script>window.__ASSET_DIRECTORY__ = ${jsonForInlineScript(assetDirectory)};</script>
<script>
(function () {
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
  var root = document.getElementById("account-root");
  var session = null, binding = null;
  try { session = JSON.parse(localStorage.getItem("rn_session") || "null"); } catch (e) {}
  try { binding = JSON.parse(localStorage.getItem("rn_github") || "null"); } catch (e) {}
  function isValidSuiAddress(value) {
    return /^0x[0-9a-f]{64}$/i.test(String(value || ""));
  }
  function isRepeatedByteAddress(value) {
    var clean = String(value || "").toLowerCase();
    if (!isValidSuiAddress(clean)) return false;
    var firstByte = clean.slice(2, 4);
    return clean.slice(2).match(new RegExp("^(?:" + firstByte + "){32}$")) !== null;
  }
  function clearAccountSession() {
    ["rn_session", "rn_github", "rn_zk_attestation", "rn_gh_state"].forEach(function (key) {
      try { localStorage.removeItem(key); } catch (e) {}
    });
    ["rn_zk_session", "rn_zk_eph", "rn_oauth_state", "rn_gh_state"].forEach(function (key) {
      try { sessionStorage.removeItem(key); } catch (e) {}
    });
  }
  function isTrustedAccountSession(value) {
    if (!value || !isValidSuiAddress(value.address)) return false;
    if (isRepeatedByteAddress(value.address)) return false;
    return Boolean(value.sub && value.iss && value.ts);
  }
  if (session && !isTrustedAccountSession(session)) {
    clearAccountSession();
    session = null;
    binding = null;
  }
  if (binding && session && binding.sui_address !== session.address) {
    try { localStorage.removeItem("rn_github"); } catch (e) {}
    binding = null;
  }
  function repoOwner(name) {
    var parts = String(name || "").split("/");
    return parts.length > 1 ? parts[0] : "";
  }
  function syntheticScopeId(account) {
    return "owner:" + String(account || "GitHub");
  }
  function repoItems(gh) {
    var seen = {};
    var out = [];
    var selected = selectedInstallationIds(gh);
    var selectedMap = {};
    selected.forEach(function (id) { selectedMap[String(id)] = true; });
    (gh && gh.available_repos || []).forEach(function (repo) {
      var name = typeof repo === "string" ? repo : repo.full_name;
      var installationId = typeof repo === "string" ? gh.installation_id : repo.installation_id || null;
      var granted = typeof repo === "string" ? true : repo.granted !== false;
      var account = typeof repo === "string" ? repoOwner(name) || gh.account || null : repo.installation_account || repoOwner(name) || null;
      var accountType = typeof repo === "string" ? gh.account_type || null : repo.installation_account_type || null;
      var scopeId = installationId ? String(installationId) : syntheticScopeId(account);
      if (!name || seen[name] || !granted || !selectedMap[scopeId]) return;
      seen[name] = true;
      out.push({
        full_name: name,
        installation_id: installationId || scopeId,
        installation_account: account,
        installation_account_type: accountType
      });
    });
    (gh && gh.installations || []).forEach(function (installation) {
      var installationId = installation && installation.id;
      if (!installationId || !selectedMap[String(installationId)]) return;
      (installation.repos || []).forEach(function (name) {
        if (!name || seen[name]) return;
        seen[name] = true;
        out.push({
          full_name: name,
          installation_id: installationId,
          installation_account: installation.account || null,
          installation_account_type: installation.accountType || installation.account_type || null
        });
      });
    });
    var fallbackInstallationId = gh && gh.installation_id ? String(gh.installation_id) : "";
    var hasInstallations = Boolean(gh && gh.installations && gh.installations.length);
    (gh && gh.repos || []).forEach(function (name) {
      if (!name || seen[name]) return;
      var account = repoOwner(name) || gh.account || null;
      var scopeId = fallbackInstallationId || syntheticScopeId(account);
      if (hasInstallations && (!fallbackInstallationId || !selectedMap[fallbackInstallationId])) return;
      if (!selectedMap[scopeId]) return;
      seen[name] = true;
      out.push({
        full_name: name,
        installation_id: gh.installation_id || scopeId,
        installation_account: account,
        installation_account_type: gh.account && account === gh.account ? gh.account_type || null : null
      });
    });
    out.sort(function (a, b) { return a.full_name.localeCompare(b.full_name); });
    return out;
  }
  function accountItems(gh) {
    var scopes = gh && Array.isArray(gh.organization_scopes) ? gh.organization_scopes : [];
    if (scopes.length) {
      return scopes.map(function (scope) {
        return {
          id: String(scope.id || scope.installation_id || ("uninstalled:" + scope.account)),
          account: scope.account || "GitHub",
          accountType: scope.accountType || scope.account_type || "Account",
          installed: scope.installed !== false,
          repos: Array.isArray(scope.repos) ? scope.repos : []
        };
      }).sort(function (a, b) {
        if (a.installed !== b.installed) return a.installed ? -1 : 1;
        return a.account.localeCompare(b.account);
      });
    }
    var installations = gh && Array.isArray(gh.installations) ? gh.installations : [];
    if (installations.length) {
      var byAccount = {};
      installations.forEach(function (installation) {
        var account = installation.account || "GitHub";
        var accountType = installation.accountType || installation.account_type || "Account";
        var key = account + "\u0000" + accountType;
        if (!byAccount[key]) {
          byAccount[key] = { id: String(installation.id), account: account, accountType: accountType, installed: true, repos: [] };
        }
        (installation.repos || []).forEach(function (repo) {
          if (byAccount[key].repos.indexOf(repo) === -1) byAccount[key].repos.push(repo);
        });
      });
      return Object.keys(byAccount).map(function (key) { return byAccount[key]; });
    }
    var accounts = {};
    var scopeByOwner = {};
    function addRepo(name, installationId, account, accountType) {
      if (!name) return;
      var owner = repoOwner(name) || account || (gh && gh.login) || "GitHub";
      var resolvedType = (account && owner === account ? accountType : null) || (gh && gh.login && owner === gh.login ? "User" : "Account");
      var existingId = scopeByOwner[owner];
      var id = installationId ? String(installationId) : (existingId || syntheticScopeId(owner));
      if (installationId && existingId && existingId !== id && accounts[existingId]) {
        accounts[id] = accounts[existingId];
        accounts[id].id = id;
        delete accounts[existingId];
      }
      scopeByOwner[owner] = id;
      if (!accounts[id]) {
        accounts[id] = {
          id: id,
          account: owner,
          accountType: resolvedType,
          installed: true,
          repos: []
        };
      }
      if (accounts[id].repos.indexOf(name) === -1) accounts[id].repos.push(name);
    }
    (gh && gh.available_repos || []).forEach(function (repo) {
      var name = typeof repo === "string" ? repo : repo.full_name;
      var granted = typeof repo === "string" ? true : repo.granted !== false;
      if (!granted) return;
      addRepo(
        name,
        typeof repo === "string" ? gh.installation_id : repo.installation_id || null,
        typeof repo === "string" ? gh.account || null : repo.installation_account || null,
        typeof repo === "string" ? gh.account_type || null : repo.installation_account_type || null
      );
    });
    (gh && gh.repos || []).forEach(function (name) {
      addRepo(name, gh && gh.installation_id || null, gh && gh.account || null, gh && gh.account_type || null);
    });
    return Object.keys(accounts).map(function (id) { return accounts[id]; }).sort(function (a, b) { return a.account.localeCompare(b.account); });
  }
  function selectedInstallationIds(gh) {
    var accounts = accountItems(gh);
    var selectable = accounts.filter(function (account) { return account.installed !== false; });
    var ids = gh && gh.selected_installation_ids;
    if (Array.isArray(ids)) {
      var valid = {};
      selectable.forEach(function (account) { valid[String(account.id)] = true; });
      var normalized = ids.map(function (id) { return String(id); }).filter(function (id) { return valid[id]; });
      if (ids.length > 0 && !normalized.length) return selectable.map(function (account) { return account.id; });
      return normalized;
    }
    return selectable.map(function (account) { return account.id; });
  }
  function selectedRepoItem(gh, repos) {
    var selected = gh && gh.selected_repo;
    for (var i = 0; selected && i < repos.length; i++) {
      if (repos[i].full_name === selected) return repos[i];
    }
    return repos[0] || null;
  }
  function installationForRepo(gh, repo) {
    if (!gh || !repo || !repo.installation_id) return null;
    var id = String(repo.installation_id);
    var installations = gh.installations || [];
    for (var i = 0; i < installations.length; i++) {
      if (String(installations[i].id) === id) return installations[i];
    }
    return null;
  }
  function applySelectedRepo(gh, repo) {
    if (!gh || !repo || !repo.full_name) return gh;
    gh.selected_repo = repo.full_name;
    if (repo.installation_id && !String(repo.installation_id).startsWith("owner:")) {
      var installation = installationForRepo(gh, repo);
      gh.installation_id = Number(repo.installation_id);
      gh.account = repo.installation_account || (installation && installation.account) || gh.account || null;
      gh.account_type = repo.installation_account_type || (installation && installation.accountType) || gh.account_type || null;
      gh.repos = installation && installation.repos ? installation.repos : [repo.full_name];
      var attestation = gh.binding_attestations && gh.binding_attestations[String(gh.installation_id)];
      if (attestation) {
        gh.binding_attestation = attestation.binding_attestation || gh.binding_attestation;
        gh.binding_attestation_payload = attestation.binding_attestation_payload || gh.binding_attestation_payload;
      }
    } else {
      gh.account = repo.installation_account || gh.account || null;
      gh.account_type = repo.installation_account_type || gh.account_type || null;
    }
    return gh;
  }
  function syncCurrentRepo(gh) {
    var repos = repoItems(gh);
    var selected = selectedRepoItem(gh, repos);
    if (selected) applySelectedRepo(gh, selected);
    return selected;
  }
  function accountSelectorHtml(gh) {
    var accounts = accountItems(gh);
    if (!accounts.length) return "";
    var selected = {};
    selectedInstallationIds(gh).forEach(function (id) { selected[String(id)] = true; });
    var hasOrgScope = accounts.some(function (account) { return String(account.accountType || account.account_type || "").toLowerCase() === "organization"; });
    var orgHint = hasOrgScope ? "" : '<p class="muted repo-account-hint">Organization repositories appear after installing or approving the GitHub App in that organization.</p>';
    return '<fieldset class="repo-account-scope"><legend>GitHub account / organization</legend>'
      + accounts.map(function (account) {
        var label = account.account + (account.accountType ? " · " + account.accountType : "");
        var installed = account.installed !== false;
        var detail = installed ? (account.repos.length + " authorized repo(s)") : "Not authorized yet";
        return '<label class="repo-account' + (installed ? "" : " unavailable") + '"><input class="rn-account-installation-scope" type="checkbox" value="' + esc(account.id) + '"' + (selected[account.id] && installed ? " checked" : "") + (installed ? "" : " disabled") + '><span><b>' + esc(label) + '</b><br><span class="muted">' + esc(detail) + '</span></span></label>';
      }).join("")
      + orgHint
      + '</fieldset>';
  }
  function repoSelectorHtml(gh, selectId) {
    var repos = repoItems(gh);
    if (!repos.length) return '<p class="muted">No repositories available in the selected accounts/orgs.</p>';
    var selected = selectedRepoItem(gh, repos);
    return '<label class="muted" for="' + esc(selectId) + '">Research repo</label><br>'
      + '<select id="' + esc(selectId) + '" class="repo-select">'
      + repos.map(function (repo) {
          var label = repo.full_name + (repo.installation_account ? " · " + repo.installation_account : "");
          return '<option value="' + esc(repo.full_name) + '" data-installation-id="' + esc(repo.installation_id || "") + '" data-installation-account="' + esc(repo.installation_account || "") + '" data-installation-account-type="' + esc(repo.installation_account_type || "") + '"' + (selected && repo.full_name === selected.full_name ? " selected" : "") + '>' + esc(label) + '</option>';
        }).join("")
      + '</select>';
  }
  function selectedOptionRepo(select) {
    var option = select.options[select.selectedIndex];
    return {
      full_name: select.value,
      installation_id: option.getAttribute("data-installation-id") || null,
      installation_account: option.getAttribute("data-installation-account") || null,
      installation_account_type: option.getAttribute("data-installation-account-type") || null
    };
  }
  function wireRepoControls(gh, selectId, pickerId) {
    if (!gh) return;
    function persist() { localStorage.setItem("rn_github", JSON.stringify(gh)); }
    function wireSelect() {
      var select = document.getElementById(selectId);
      if (!select) return;
      if (select.value && gh.selected_repo !== select.value) {
        applySelectedRepo(gh, selectedOptionRepo(select));
        persist();
      }
      select.addEventListener("change", function () {
        applySelectedRepo(gh, selectedOptionRepo(select));
        persist();
      });
    }
    Array.prototype.forEach.call(document.querySelectorAll(".rn-account-installation-scope"), function (input) {
      input.addEventListener("change", function () {
        var checked = Array.prototype.slice.call(document.querySelectorAll(".rn-account-installation-scope"))
          .filter(function (el) { return el.checked; })
          .map(function (el) { return String(el.value); });
        gh.selected_installation_ids = checked;
        syncCurrentRepo(gh);
        var picker = document.getElementById(pickerId);
        if (picker) picker.innerHTML = repoSelectorHtml(gh, selectId);
        persist();
        wireSelect();
      });
    });
    wireSelect();
  }
  function hasServerAttestation(gh) {
    var payload = gh && gh.binding_attestation_payload;
    return Boolean(
      gh &&
      gh.binding_attestation &&
      payload &&
      payload.sub === gh.sui_address &&
      String(payload.installation_id) === String(gh.installation_id)
    );
  }
  function verifyServerAttestation(gh, onDone) {
    if (!gh || !gh.binding_attestation) { onDone(false); return; }
    fetch("/api/github-binding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        binding_attestation: gh.binding_attestation,
        sui_address: gh.sui_address,
        installation_id: Number(gh.installation_id),
        repos: gh.repos || []
      })
    }).then(function (res) { return res.ok ? res.json() : null; }).then(function (body) {
      var payload = body && body.payload;
      onDone(Boolean(body && body.valid && payload && payload.sub === gh.sui_address && String(payload.installation_id) === String(gh.installation_id)));
    }).catch(function () { onDone(false); });
  }
  function render(directory) {
    if (!session || !session.address) {
      root.innerHTML = '<p class="muted">Not signed in.</p><p><a class="button" href="/account.html">Sign in with Google (zkLogin)</a></p>';
      return;
    }
    var html = '<h2>Sui identity</h2>'
      + '<dl class="verification">'
      + '<div><dt>zkLogin address</dt><dd>' + esc(session.address) + '</dd></div>'
      + (session.email ? '<div><dt>Email</dt><dd>' + esc(session.email) + '</dd></div>' : '')
      + '<div><dt>Provider</dt><dd>' + esc(session.iss || session.provider || "google") + '</dd></div>'
      + '</dl>';
    html += '<h2>Connected GitHub repositories</h2>';
    if (binding && binding.sui_address === session.address && binding.installation_id) {
      var manageUrl = '/account.html?connect=github';
      var attested = hasServerAttestation(binding);
      var selectedCount = selectedInstallationIds(binding).length;
      var repoCount = repoItems(binding).length;
      html += '<p class="muted">' + esc(binding.login || "GitHub") + ' · ' + selectedCount + ' selected account/org scope(s), ' + repoCount + ' repo option(s)<span id="rn-account-attestation-status">' + (attested ? ' · checking attestation…' : ' · local binding') + '</span></p>'
        + '<div class="repo-control">' + accountSelectorHtml(binding) + '<div id="rn-account-repo-picker">' + repoSelectorHtml(binding, "rn-account-repo-select") + '</div></div>'
        + '<p class="repo-actions"><a class="button" href="/account.html?connect=github">Refresh GitHub repos</a>'
        + '<a class="button" href="' + esc(manageUrl) + '">Add GitHub account/org access</a>'
        + '</p>';
    } else {
      html += '<p class="muted">No repositories connected yet.</p><p><a class="button" href="/account.html?connect=github">Connect GitHub</a></p>';
    }
    html += '<h2>My publications</h2>';
    var mine = [];
    if (binding && binding.login) {
      mine = (directory || []).filter(function (a) { return (a.githubs || []).indexOf(binding.login) !== -1; });
    }
    if (mine.length) {
      html += '<ul class="small-list">' + mine.map(function (a) { return '<li><a href="' + esc(a.href) + '">' + esc(a.title) + '</a> <span class="muted">' + esc(a.id) + '</span></li>'; }).join("") + '</ul>';
    } else {
      html += '<p class="muted">No indexed publications are linked to this account yet' + (binding && binding.login ? ' (matched by GitHub author handle).' : ' — connect GitHub so publications can be matched to you.') + '</p>';
    }
    html += '<p style="margin-top:24px"><button class="button" id="signout" type="button">Sign out</button></p>';
    root.innerHTML = html;
    verifyServerAttestation(binding, function (valid) {
      var status = document.getElementById("rn-account-attestation-status");
      if (status) status.textContent = valid ? " · server-attested" : " · local binding";
    });
    document.getElementById("signout").addEventListener("click", function () {
      ["rn_session", "rn_github", "rn_zk_attestation", "rn_gh_state"].forEach(function (k) { localStorage.removeItem(k); });
      ["rn_zk_session", "rn_zk_eph", "rn_oauth_state", "rn_gh_state"].forEach(function (k) { sessionStorage.removeItem(k); });
      location.href = "/account.html";
    });
    wireRepoControls(binding, "rn-account-repo-select", "rn-account-repo-picker");
  }
  var initialDirectory = window.__ASSET_DIRECTORY__ || [];
  if (initialDirectory.length || !session || !session.address) {
    render(initialDirectory);
    return;
  }
  fetch("/site-data.json", { cache: "no-store" })
    .then(function (res) { return res.ok ? res.json() : { assets: [] }; })
    .then(function (data) { render(data && data.assets ? data.assets : []); })
    .catch(function () { render([]); });
})();
</script>`;
  return shell("Account", accountBody, { subject: "Account" });
}

export const STYLES_CSS = `
:root {
  color-scheme: light;
  --arxiv-red: #b31b1b;
  --arxiv-red-dark: #8f1414;
  --link: #0068ac;
  --ink: #1a1a1a;
  --muted: #686868;
  --line: #ddd;
  --paper-bg: #fff;
  --page-bg: #fff;
  --sans: "Lucida Grande", "Helvetica Neue", Helvetica, Arial, sans-serif;
  --serif: "Latin Modern Roman", Georgia, "Times New Roman", serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--page-bg); color: var(--ink); font: 15px/1.55 var(--sans); }
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }
code { font-family: var(--mono); font-size: .92em; background: #f4f4f4; padding: 1px 4px; border-radius: 3px; }
.wrap { max-width: 1040px; margin: 0 auto; padding: 0 20px; }

/* chrome */
.slim-strip { background: #f2f2f2; border-bottom: 1px solid var(--line); color: #555; font-size: 11.5px; }
.slim-strip .wrap { padding-top: 4px; padding-bottom: 4px; }
.banner { background: var(--arxiv-red); }
.banner-inner { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding-top: 12px; padding-bottom: 12px; }
.logo { color: #fff; font-family: "Times New Roman", Times, serif; font-size: 30px; font-weight: 700; letter-spacing: .5px; line-height: 1; }
.logo:hover { text-decoration: none; }
.logo-chi { font-style: italic; font-weight: 400; padding: 0 1px; }
.banner-search { display: flex; gap: 6px; }
.banner-search input { width: 260px; max-width: 46vw; border: 0; border-radius: 2px; padding: 6px 10px; font-size: 13.5px; }
.banner-search button { border: 0; border-radius: 2px; background: #fff; color: var(--arxiv-red); font-weight: 700; font-size: 13px; padding: 6px 12px; cursor: pointer; }
.banner-search button:hover { background: #f3dcdc; }
.subnav { background: #fafafa; border-bottom: 1px solid var(--line); }
.subnav-inner { display: flex; flex-wrap: wrap; gap: 7px 22px; padding-top: 7px; padding-bottom: 7px; font-size: 13px; }
.subnav a { color: #444; }
.subnav a:hover { color: var(--arxiv-red); text-decoration: none; }
.subject-strip { border-bottom: 1px solid var(--line); }
.subject-strip h1 { font-size: 18px; font-weight: 400; color: #555; margin: 0; padding: 10px 0; }
main.wrap { padding-top: 22px; padding-bottom: 56px; }
.footer { border-top: 1px solid var(--line); background: #fafafa; color: var(--muted); font-size: 12.5px; }
.footer .wrap { padding: 18px 20px 26px; }
.build-status { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; color: var(--muted); font-family: var(--mono); font-size: 11.5px; }
.build-status-ok [data-build-status-text] { color: #1a7f37; }
.build-status-warning [data-build-status-text] { color: #8a5a00; }
.build-status-error [data-build-status-text] { color: var(--arxiv-red); }
.build-status-button { border: 1px solid #bbb; border-radius: 3px; background: #fff; color: #444; font: 11.5px/1.4 var(--mono); padding: 3px 8px; cursor: pointer; }
.build-status-button:hover { border-color: var(--arxiv-red); color: var(--arxiv-red); }
.build-status-button:disabled { opacity: .55; cursor: wait; }

h1 { font-size: 26px; margin: 0 0 12px; }
h2 { font-size: 19px; margin: 26px 0 10px; }
.muted { color: var(--muted); }

/* arXiv-style listing (home / search) */
.intro { max-width: 760px; color: #333; }
.stats-line { color: var(--muted); font-size: 13px; margin: 10px 0 4px; }
.chain-listing-note { color: #333; max-width: 820px; }
.chain-source-note { color: var(--muted); max-width: 820px; font-size: 12.5px; }
.chain-proofline { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 8px 0 6px; font-size: 12.5px; color: var(--muted); }
.chain-status { display: inline-block; border: 1px solid var(--line); border-radius: 3px; padding: 1px 7px; font-family: var(--mono); font-size: 11.5px; }
.chain-status-pending { color: #555; background: #fff; }
.chain-status-verified { color: #1a7f37; border-color: #9bd1aa; background: #f0fbf3; }
.chain-status-warning { color: #8f1414; border-color: #e5a3a3; background: #fff6f6; }
.chain-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 18px; margin: 8px 0 0; max-width: 880px; border-top: 1px solid #eee; padding-top: 7px; }
.chain-facts div { min-width: 0; }
.chain-facts dt { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
.chain-facts dd { margin: 0; min-width: 0; font-family: var(--mono); font-size: 11.5px; word-break: break-all; }
.chain-facts code { font-size: 1em; }
.live-dashboard { border-top: 2px solid var(--arxiv-red); padding-top: 12px; margin-bottom: 24px; }
.live-dashboard-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px 16px; }
.live-dashboard-head h2 { margin-top: 0; }
.live-dashboard-api { font-family: var(--mono); font-size: 12.5px; color: var(--muted); }
.data-table.live-dashboard-table { table-layout: fixed; }
.data-table.live-dashboard-table th:nth-child(1) { width: 56%; }
.data-table.live-dashboard-table th:nth-child(2) { width: 18%; }
.data-table.live-dashboard-table th:nth-child(3) { width: 13%; }
.data-table.live-dashboard-table th:nth-child(4) { width: 13%; }
.data-table.live-dashboard-table td { font-family: var(--sans); vertical-align: top; word-break: normal; overflow-wrap: break-word; }
.data-table.live-dashboard-table .live-dashboard-asset strong,
.data-table.live-dashboard-table .live-dashboard-asset strong a { word-break: normal; overflow-wrap: normal; }
.data-table.live-dashboard-table .mono { font-family: var(--mono); font-size: 12px; word-break: normal; overflow-wrap: anywhere; }
.live-dashboard-asset strong { display: block; margin-bottom: 2px; font-size: 14px; color: var(--ink); }
.live-dashboard-asset p { margin: 5px 0 0; max-width: 520px; color: #333; }
.live-dashboard-proof { display: flex; flex-direction: column; gap: 4px; }
.live-empty-card { flex: 1 1 100%; border: 1px solid var(--line); border-radius: 4px; background: #fff; padding: 14px 16px; min-width: 260px; }
.live-empty-card strong { display: block; margin-bottom: 4px; color: var(--ink); }
.live-empty-card p { margin: 0 0 10px; max-width: 720px; color: #333; }
.live-empty-card-loading { background: #fafafa; }
.live-event-rail { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.live-event-chip { border: 1px solid var(--line); border-radius: 3px; background: #fafafa; color: #555; font: 11px/1.5 var(--mono); padding: 2px 7px; }
.live-empty-table { padding: 12px 4px; font-family: var(--sans); }
.live-empty-table p { margin: 6px 0 0; }
.data-table.live-membership-table th:nth-child(1) { width: 25%; }
.data-table.live-membership-table th:nth-child(2) { width: 25%; }
.data-table.live-membership-table th:nth-child(3) { width: 25%; }
.data-table.live-membership-table th:nth-child(4) { width: 25%; }
.membership-event-name { font-weight: 700; color: var(--ink); }
dl.listing { margin: 12px 0 0; }
dl.listing > dt { padding: 12px 0 2px; font-size: 14px; border-top: 1px solid var(--line); }
dl.listing > dt:first-child { border-top: 0; }
dl.listing > dt .list-identifier { font-weight: 700; }
dl.listing > dd { margin: 0 0 14px 24px; }
.list-title { font-size: 17px; font-weight: 700; line-height: 1.3; margin: 2px 0; }
.list-title a { color: var(--ink); }
.list-title a:hover { color: var(--arxiv-red); text-decoration: none; }
.list-authors { font-size: 14px; margin: 1px 0; }
.list-subjects { font-size: 13px; color: var(--muted); margin: 1px 0 6px; }
.list-subjects .primary-subject { color: var(--arxiv-red); font-weight: 700; }
dl.listing > dd p { margin: 4px 0 0; font-size: 14px; color: #333; max-width: 800px; }
dl.listing > dt a { position: relative; z-index: 1; pointer-events: auto; }

.search-box { display: flex; gap: 8px; margin: 14px 0 4px; max-width: 640px; }
.search-box input { flex: 1; border: 1px solid #bbb; border-radius: 2px; padding: 8px 12px; font-size: 14.5px; }
.search-box input:focus { outline: 2px solid rgba(179,27,27,.35); }

/* abs page */
.dateline { color: var(--muted); font-size: 12.5px; margin: 0 0 4px; }
h1.abs-title { font-size: 25px; line-height: 1.25; margin: 2px 0 6px; }
.abs-authors { font-size: 15.5px; margin: 0 0 10px; }
blockquote.abstract { margin: 14px 0 18px; padding: 0; font-size: 15.5px; line-height: 1.55; max-width: 800px; }
blockquote.abstract .descriptor { font-weight: 700; }
.abs-tags { margin: 0 0 12px; }
.tag { display: inline-block; border: 1px solid #ccc; border-radius: 999px; background: #f7f7f7; color: #555; font-size: 12px; font-family: var(--mono); padding: 1px 9px; margin: 0 5px 5px 0; }
.metatable { font-size: 13.5px; margin: 0 0 8px; }
.metatable table { border-collapse: collapse; }
.metatable td { padding: 2px 10px 2px 0; vertical-align: top; }
.metatable td.label { font-weight: 700; color: #333; white-space: nowrap; }
.metatable td .arxiv-id { color: var(--arxiv-red); font-weight: 700; }
.abs-grid { display: grid; grid-template-columns: minmax(0, 1fr) 250px; gap: 36px; align-items: start; }
.abs-main { min-width: 0; }

.extra-services { font-size: 13.5px; }
.asset-sidebar-summary { border-top: 2px solid var(--arxiv-red); padding-top: 10px; }
.asset-sidebar-summary p { margin: 0; font-size: 12.8px; line-height: 1.5; color: #333; }
.asset-sidebar-record dd { font-family: var(--sans); font-size: 12.5px; }
.asset-sidebar-record dd code { font-family: var(--mono); }
.live-asset-paper .paper-viewer { margin-top: 10px; }
.access-box { border: 1px solid var(--line); border-radius: 4px; padding: 12px 14px 10px; margin: 0 0 16px; background: #fafafa; }
.access-box h2 { font-size: 14px; margin: 0 0 8px; color: #333; }
.access-box h3 { font-size: 12px; margin: 14px 0 8px; color: #333; text-transform: uppercase; letter-spacing: .3px; }
.access-box ul { list-style: none; margin: 0; padding: 0; }
.access-box li { margin: 0 0 6px; }
.access-box a.download-pdf { font-weight: 700; }
.access-box .disabled { color: #999; }
.report-list { display: grid; gap: 10px; }
.report-card { border-top: 1px solid var(--line); padding-top: 10px; }
.report-card h4 { margin: 0 0 6px; font-size: 12px; text-transform: capitalize; }
.report-card p { margin: 8px 0 0; font-size: 12.5px; line-height: 1.45; color: var(--muted); }
.sidebar-section { margin: 0 0 18px; }
.sidebar-section h3 { font-size: 13.5px; margin: 0 0 6px; color: #333; }
.verification { margin: 0; }
.verification div { padding: 5px 0; border-bottom: 1px solid #eee; }
.verification div:last-child { border-bottom: 0; }
.verification dt { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .6px; }
.verification dd { margin: 1px 0 0; font-family: var(--mono); font-size: 11.5px; word-break: break-all; color: #333; }
.small-list { margin: 0; padding: 0; list-style: none; font-size: 13px; }
.small-list li { padding: 4px 0; border-bottom: 1px solid #eee; }
.small-list li:last-child { border-bottom: 0; }
.compact-skill-list { border-top: 1px solid var(--line); max-width: 860px; }
.compact-skill-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(190px, 260px); gap: 12px 18px; padding: 11px 0; border-bottom: 1px solid #eee; align-items: start; }
.compact-skill-main, .compact-skill-meta { min-width: 0; }
.compact-skill-main strong { display: block; font-size: 14.5px; overflow-wrap: anywhere; }
.compact-skill-main p { margin: 3px 0 0; color: #333; font-size: 13.5px; line-height: 1.45; }
.compact-skill-tags { margin-top: 6px; }
.compact-skill-tags .tag { margin-bottom: 0; }
.compact-skill-meta { display: grid; gap: 4px; justify-items: end; text-align: right; font-size: 12.5px; }
.compact-skill-meta code { max-width: 100%; overflow-wrap: anywhere; }
.compact-skill-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.compact-skill-install { max-width: 100%; }
.compact-skill-install code { display: block; max-width: 100%; background: transparent; padding: 0; color: var(--muted); font-size: 11.5px; white-space: normal; overflow-wrap: anywhere; word-break: break-word; }
.repo-control { margin: 8px 0 10px; }
.repo-select { width: min(520px, 100%); margin-top: 4px; padding: 7px 10px; border: 1px solid #bbb; border-radius: 3px; background: #fff; color: var(--ink); font: inherit; }
.repo-select:focus { outline: 2px solid rgba(0, 104, 172, .22); border-color: var(--link); }
.repo-account-scope { margin: 0 0 12px; padding: 0; border: 0; }
.repo-account-scope legend { margin: 0 0 6px; color: var(--muted); }
.repo-account { display: flex; gap: 8px; align-items: flex-start; margin: 6px 0; font-size: 13.5px; }
.repo-account input { margin-top: 3px; }
.repo-account.unavailable { opacity: .68; }
.repo-actions { margin: 12px 0 14px; }
.account-shell { display: grid; gap: 18px; }
.account-profile { display: flex; align-items: center; gap: 16px; border-top: 2px solid var(--arxiv-red); border-bottom: 1px solid var(--line); padding: 16px 0; }
.account-avatar { flex: none; display: grid; place-items: center; width: 58px; height: 58px; border-radius: 50%; background: #f7f7f7; border: 1px solid var(--line); color: var(--arxiv-red); font: 700 17px/1 var(--serif); }
.account-profile-main { flex: 1; min-width: 0; }
.account-profile-main h1 { margin: 0 0 3px; line-height: 1.15; overflow-wrap: anywhere; }
.account-kicker { margin: 0 0 2px; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .6px; }
.account-subtitle { margin: 0; color: var(--muted); font-family: var(--mono); font-size: 12.5px; overflow-wrap: anywhere; }
.account-profile-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0; }
.account-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px; align-items: start; }
.account-panel { min-width: 0; border-top: 1px solid var(--line); padding-top: 14px; }
.account-panel-wide { grid-column: 1 / -1; }
.account-panel h2 { margin: 0; }
.account-panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.account-list { display: grid; gap: 8px; }
.account-row { display: flex; justify-content: space-between; gap: 12px; border: 1px solid var(--line); border-radius: 4px; background: #fff; padding: 10px 12px; min-width: 0; }
.account-row > div { min-width: 0; }
.account-row-title { margin: 0 0 2px; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
.account-row strong { display: block; overflow-wrap: anywhere; }
.account-row p { margin: 2px 0 0; }
.account-row code { align-self: flex-start; max-width: 42%; overflow-wrap: anywhere; }
.account-empty { border: 1px solid var(--line); border-radius: 4px; background: #fafafa; padding: 12px 14px; }
.account-empty p { margin: 4px 0 0; }
.account-asset-list, .account-event-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.account-asset-list li, .account-event-list li { border-bottom: 1px solid #eee; padding-bottom: 10px; }
.account-asset-list li:last-child, .account-event-list li:last-child { border-bottom: 0; padding-bottom: 0; }
.account-asset-list p, .account-event-list p { margin: 3px 0 0; }
.account-proof-links { display: flex; flex-wrap: wrap; gap: 10px; font-family: var(--mono); font-size: 12px; }
.account-event-list li { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.account-event-list li > div { min-width: 0; }
.account-auth-panel { border-top: 1px solid var(--line); padding-top: 16px; }
.account-auth-panel h2 { margin: 0 0 8px; }
.account-auth-panel-compact { margin-top: 12px; }
.auth-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; margin: 14px 0 0; }
.auth-card { border: 1px solid var(--line); border-radius: 4px; padding: 14px 16px; background: #fff; }
.auth-card h2 { margin: 0 0 6px; font-size: 15.5px; }
.auth-card p { margin: 6px 0 0; }

/* protocol workbench */
.workbench-root { max-width: 920px; }
.workbench-panel { border-top: 1px solid var(--line); padding: 16px 0 18px; }
.workbench-panel:first-child { border-top: 0; }
.workbench-panel h2 { margin-top: 0; }
.workbench-form { display: grid; grid-template-columns: repeat(2, minmax(220px, 1fr)); gap: 12px 16px; max-width: 820px; }
.field-label { display: block; color: var(--muted); font-size: 12.5px; }
.field-label input, .field-label select, .field-label textarea {
  display: block;
  width: 100%;
  margin-top: 4px;
  padding: 7px 9px;
  border: 1px solid #bbb;
  border-radius: 3px;
  background: #fff;
  color: var(--ink);
  font: 14px/1.4 var(--sans);
}
.field-label textarea { min-height: 82px; resize: vertical; }
.workbench-form .field-label:nth-of-type(4), .workbench-form .field-label:nth-of-type(5) { grid-column: 1 / -1; }
.workbench-form button { justify-self: start; }
.notice { margin: 0 0 14px; min-height: 22px; font-size: 13.5px; }
.notice.success { color: #1a7f37; }
.notice.error { color: #b31b1b; }
.workbench-actions { margin: 12px 0; }
.workbench-report-list { display: grid; gap: 12px; margin-top: 14px; }
.workbench-report { border: 1px solid var(--line); border-radius: 4px; padding: 12px 14px; background: #fff; }
.workbench-report.access-locked { background: #fafafa; }
.report-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.pill { display: inline-block; border: 1px solid var(--line); border-radius: 3px; padding: 1px 6px; color: var(--muted); font: 11px/1.45 var(--mono); text-transform: uppercase; white-space: nowrap; }
.mini-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 6px 12px; margin: 8px 0; }
.mini-meta div { min-width: 0; }
.mini-meta dt { color: var(--muted); font-size: 10.5px; text-transform: uppercase; letter-spacing: .4px; }
.mini-meta dd { margin: 0; font-family: var(--mono); font-size: 11.5px; word-break: break-all; }
.decrypted { border-left: 3px solid #1a7f37; background: #f6fbf7; padding: 8px 10px; margin: 8px 0 10px; }
.access-state { margin: 8px 0 10px; }

/* rendered paper (ar5iv style) */
.paper-viewer { margin: 24px 0 28px; }
.format-nav { display: block; margin: 0 0 14px; font-size: 15px; line-height: 1.6; }
.format-tab { display: inline; padding: 0; border: 0; background: none; color: var(--link); font-weight: 700; font-size: 15px; border-radius: 0; margin: 0; cursor: pointer; }
.format-tab:hover { text-decoration: underline; color: var(--arxiv-red); }
.format-tab.is-active { color: var(--arxiv-red); text-decoration: none; }
.format-sep { color: var(--muted); font-weight: 400; user-select: none; }
.format-panel { display: none; border: 0; background: transparent; padding: 0; margin: 0; }
.format-panel.is-active { display: block; }
.format-panel:target { display: block; }
.paper-viewer:not(:has(.format-panel:target)) .format-panel-default { display: block; }
.paper-viewer:has(.format-panel:target) .format-panel-default { display: none; }
.paper-viewer:has(.format-panel:target) .format-panel:target { display: block; }
.pdfjs-viewer { padding: 0; min-height: 0; background: transparent; }
.pdfjs-pages { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; }
canvas.pdfjs-page { display: block; max-width: 100%; height: auto !important; border: 0; box-shadow: none; background: transparent; }
.pdfjs-loading { color: var(--muted); font-size: 14px; padding: 4px 0; }
.format-panel .source-note { margin: 0 0 10px; padding: 0; font-size: 12px; color: var(--muted); font-family: var(--mono); }
.format-panel-empty { padding: 0; }
.live-paper-viewer { min-height: 220px; }
.document-frame { display: block; width: 100%; min-height: 760px; border: 0; background: #fff; color: var(--ink); }
.live-document-renderer { min-height: 160px; }
.download-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 7px; }
.download-list li { display: grid; gap: 1px; padding-bottom: 7px; border-bottom: 1px solid #eee; }
.download-list li:last-child { border-bottom: 0; padding-bottom: 0; }
.download-list a { font-weight: 700; }
.download-list code { display: block; width: 100%; background: transparent; padding: 0; color: var(--muted); overflow-wrap: anywhere; }
.tex-source { margin: 0; padding: 14px 0 0; font-family: var(--mono); font-size: 12.5px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; color: #222; overflow-x: auto; background: transparent; border: 0; }
.format-panel .ltx-page { border: 0; box-shadow: none; margin: 0; padding: 0; border-radius: 0; background: transparent; }
.ltx-page { border: 0; border-radius: 0; background: transparent; box-shadow: none; padding: 0; margin: 0; }
.ltx-document { font-family: var(--serif); font-size: 16.5px; line-height: 1.6; color: #111; max-width: 720px; margin: 0; }
.office-document p { margin: 0 0 12px; }
.office-document table { border-collapse: collapse; margin: 14px 0; max-width: 100%; }
.office-document td, .office-document th { border: 1px solid var(--line); padding: 5px 8px; vertical-align: top; }
.office-document img { max-width: 100%; height: auto; }
.word-document { font-family: var(--serif); }
.ppt-document { display: grid; gap: 20px; max-width: 760px; }
.ppt-slide { position: relative; min-height: 360px; border: 1px solid #ddd; background: #fff; padding: 42px 52px; box-shadow: 0 1px 2px rgba(0,0,0,.06); font-family: var(--sans); }
.ppt-slide-number { position: absolute; top: 14px; right: 18px; color: var(--muted); font: 11px/1.4 var(--mono); text-transform: uppercase; letter-spacing: .4px; }
.ppt-slide h2 { margin: 0 0 18px; font-size: 24px; line-height: 1.22; }
.ppt-slide p { margin: 0 0 10px; font-size: 16px; line-height: 1.45; }
.ltx-title { font-size: 24px; font-weight: 700; text-align: center; line-height: 1.3; margin: 0 0 14px; }
.ltx-authors { text-align: center; font-size: 16px; margin: 0 0 30px; }
.ltx-abstract { margin: 0 auto 30px; max-width: 88%; font-size: 15px; }
.ltx-abstract h6 { text-align: center; font-size: 15px; font-weight: 700; margin: 0 0 8px; }
.ltx-abstract p { margin: 0 0 10px; text-align: justify; hyphens: auto; }
.ltx-section h2 { font-family: var(--serif); font-size: 19.5px; font-weight: 700; margin: 28px 0 10px; }
.ltx-section h3 { font-family: var(--serif); font-size: 17px; font-weight: 700; margin: 20px 0 8px; }
.ltx-tag { margin-right: 12px; }
.ltx-section p { margin: 0 0 13px; text-align: justify; hyphens: auto; }
.ltx-section ul, .ltx-section ol { margin: 0 0 13px; padding-left: 28px; }
.ltx-table { width: 100%; border-collapse: collapse; margin: 14px 0 16px; font-size: 14px; }
.ltx-table td, .ltx-table th { border: 1px solid var(--line); padding: 6px 8px; vertical-align: top; }
.ltx-verbatim { background: #f7f7f7; border: 1px solid #e3e3e3; padding: 12px 14px; font-size: 13px; overflow: auto; }
.missing-note { color: var(--muted); font-style: italic; text-align: center; margin: 8px 0; }
.math.display { display: block; text-align: center; margin: 14px 0; }

/* skill / dashboard / misc */
.copy-row { display: flex; align-items: center; gap: 10px; border: 1px solid var(--line); border-radius: 4px; background: #fafafa; padding: 10px 12px; font-family: var(--mono); font-size: 13px; max-width: 640px; margin: 14px 0; }
.copy-row code { flex: 1; background: none; padding: 0; word-break: break-all; }
.copy-btn { flex: none; border: 1px solid #bbb; background: #fff; color: #555; border-radius: 3px; padding: 4px 12px; font-size: 12px; font-family: var(--mono); cursor: pointer; }
.copy-btn:hover { border-color: var(--arxiv-red); color: var(--arxiv-red); }
.copy-btn.done { color: #1a7f37; border-color: #1a7f37; }
.button { display: inline-block; border: 1px solid #bbb; border-radius: 3px; background: #fff; color: #333; font-size: 13.5px; padding: 6px 14px; margin: 0 8px 8px 0; }
.button:hover { border-color: var(--arxiv-red); color: var(--arxiv-red); text-decoration: none; }
pre { white-space: pre-wrap; word-break: break-word; background: #fafafa; color: #222; border: 1px solid var(--line); border-radius: 4px; padding: 14px; overflow: auto; font-size: 12.5px; }
.cite-box { font-family: var(--mono); font-size: 12.5px; }
.stats { display: flex; flex-wrap: wrap; gap: 12px; margin: 14px 0; }
.stat { border: 1px solid var(--line); border-radius: 4px; padding: 10px 18px; min-width: 130px; background: #fafafa; }
.stat b { display: block; font-size: 24px; }
.stat span { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .6px; }
.data-table { width: 100%; border-collapse: collapse; font-size: 13px; margin: 8px 0 20px; }
.data-table th, .data-table td { border: 1px solid var(--line); padding: 6px 10px; text-align: left; }
.data-table th { background: #fafafa; font-weight: 700; }
.data-table td { font-family: monospace; word-break: break-all; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
.card { border: 1px solid var(--line); border-radius: 4px; padding: 14px 16px; background: #fff; }
a.card { display: block; color: var(--ink); }
a.card:hover { text-decoration: none; border-color: var(--arxiv-red); }
a.card h3 { margin: 0 0 4px; font-size: 15.5px; color: var(--link); }
.result { display: block; padding: 12px 4px; border-bottom: 1px solid var(--line); color: var(--ink); }
.result:hover { text-decoration: none; background: #fafafa; }
.result strong { color: var(--link); font-size: 15.5px; }

/* markdown rendering (README / paper.md) */
.readme-box { border: 1px solid var(--line); border-radius: 4px; background: #fff; padding: 16px 20px; max-width: 800px; font-size: 14.5px; }
.md-doc h2, .md-doc h3, .md-doc h4 { margin: 18px 0 8px; }
.md-doc p { margin: 0 0 10px; }
.md-doc ul, .md-doc ol { margin: 0 0 10px; padding-left: 26px; }
.md-code { background: #f7f7f7; border: 1px solid #e3e3e3; padding: 12px 14px; font-size: 12.5px; overflow: auto; font-family: var(--mono); }

/* explorer-style events table */
.events-table td { font-family: var(--mono); font-size: 12px; }
.events-table .event-name { font-weight: 700; color: var(--arxiv-red); white-space: nowrap; }
.events-table .event-time { white-space: nowrap; color: var(--muted); }
.event-field { display: inline-block; margin-right: 10px; }
.event-key { color: var(--muted); }
.local-tx { color: #444; }
.local-badge { display: inline-block; margin-left: 6px; padding: 0 5px; border: 1px solid var(--line); border-radius: 3px; color: var(--muted); font: 10px/1.5 var(--sans); text-transform: uppercase; vertical-align: 1px; }

@media (max-width: 820px) {
  .abs-grid { grid-template-columns: 1fr; }
  .compact-skill-row { grid-template-columns: 1fr; }
  .compact-skill-meta { justify-items: start; text-align: left; }
  .compact-skill-actions { justify-content: flex-start; }
  .chain-facts { grid-template-columns: 1fr; }
  .banner-inner { flex-direction: column; align-items: flex-start; gap: 10px; }
  .banner-search { width: 100%; }
  .banner-search input { width: 100%; max-width: none; flex: 1; }
  .ltx-page { padding: 26px 20px; }
  .document-frame { min-height: 620px; }
  .ppt-slide { min-height: 280px; padding: 36px 24px 28px; }
  .ppt-slide h2 { font-size: 20px; }
  .ppt-slide p { font-size: 14.5px; }
  h1.abs-title { font-size: 21px; }
  .workbench-form { grid-template-columns: 1fr; }
  .report-head { display: block; }
  .pill { margin-top: 5px; }
  .account-profile { align-items: flex-start; flex-wrap: wrap; }
  .account-profile-actions { width: 100%; justify-content: flex-start; }
  .account-row { display: block; }
  .account-row code { display: inline-block; max-width: 100%; margin-top: 6px; }
  .account-event-list li { display: block; }
}
`;

const SITE_JS = `
(function () {
  "use strict";
  var TYPE_COLORS = { paper: "#b31b1b", skill: "#1a7f37", dataset: "#bc4c75", asset: "#5b4ccc", agent: "#0068ac", experiment: "#b58105", benchmark: "#bc4c75", code: "#0068ac" };
  var LOCAL_STATE_KEYS = [
    "rn_session",
    "rn_github",
    "rn_zk_attestation",
    "rn_gh_state",
    "rn_gh_recovery",
    "rn_workbench_demo",
    "rn_workbench_state",
    "rn_zk_salts"
  ];
  var SESSION_STATE_KEYS = [
    "rn_zk_session",
    "rn_zk_eph",
    "rn_oauth_state",
    "rn_gh_state",
    "rn_gh_recovery",
    "rn_acceptance_debug_role"
  ];

  /* copy buttons */
  function setupCopy() {
    Array.prototype.slice.call(document.querySelectorAll("[data-copy]")).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var text = btn.getAttribute("data-copy") || "";
        var done = function () {
          btn.classList.add("done");
          btn.textContent = "copied";
          setTimeout(function () { btn.classList.remove("done"); btn.textContent = "copy"; }, 1600);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, done);
        } else { done(); }
      });
    });
  }

  function setBuildStatus(root, text, tone) {
    var target = root.querySelector("[data-build-status-text]");
    if (!target) return;
    target.textContent = text;
    root.classList.remove("build-status-ok", "build-status-warning", "build-status-error");
    if (tone) root.classList.add("build-status-" + tone);
  }

  function shortCommit(commit) {
    var text = String(commit || "");
    return text && text !== "unknown" ? text.slice(0, 7) : "unknown";
  }

  function githubRepoApi(repo, branch) {
    return "https://api.github.com/repos/" + encodeURIComponent(repo).replace("%2F", "/") + "/commits/" + encodeURIComponent(branch || "main");
  }

  function setupBuildStatus() {
    Array.prototype.slice.call(document.querySelectorAll("[data-build-status]")).forEach(function (root) {
      var check = root.querySelector("[data-build-check]");
      var clear = root.querySelector("[data-clear-browser-state]");
      var info = null;

      fetch("/build-info.json", { cache: "no-store" })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (body) {
          info = body || {};
          root.setAttribute("data-current-commit", info.commit || "unknown");
          root.setAttribute("data-current-branch", info.branch || "main");
          root.setAttribute("data-current-repo", info.repo || root.getAttribute("data-repo") || "");
          setBuildStatus(root, "Current deploy " + shortCommit(info.commit) + " · " + (info.branch || "main"), "ok");
        })
        .catch(function () {
          setBuildStatus(root, "Build info unavailable on this host", "warning");
        });

      if (check) {
        check.addEventListener("click", function () {
          var repo = (info && info.repo) || root.getAttribute("data-repo") || "Euraxluo/research-network";
          var branch = (info && info.branch) || root.getAttribute("data-branch") || "main";
          var current = (info && info.commit) || root.getAttribute("data-current-commit") || "";
          check.disabled = true;
          setBuildStatus(root, "Checking GitHub " + repo + "@" + branch + "...", "");
          fetch(githubRepoApi(repo, branch), { cache: "no-store" })
            .then(function (res) {
              if (!res.ok) throw new Error("GitHub HTTP " + res.status);
              return res.json();
            })
            .then(function (body) {
              var latest = body && body.sha ? String(body.sha) : "";
              if (!latest) throw new Error("missing commit sha");
              root.setAttribute("data-latest-commit", latest);
              if (current && latest && current === latest) {
                setBuildStatus(root, "Up to date · " + shortCommit(current), "ok");
              } else {
                setBuildStatus(root, "Deploy " + shortCommit(current) + " is behind GitHub " + shortCommit(latest), "warning");
              }
            })
            .catch(function (err) {
              setBuildStatus(root, "Could not check GitHub commit: " + (err && err.message ? err.message : "request failed"), "error");
            })
            .finally(function () { check.disabled = false; });
        });
      }

      if (clear) {
        clear.addEventListener("click", function () {
          LOCAL_STATE_KEYS.forEach(function (key) { try { localStorage.removeItem(key); } catch (e) {} });
          SESSION_STATE_KEYS.forEach(function (key) { try { sessionStorage.removeItem(key); } catch (e) {} });
          setBuildStatus(root, "Local browser state cleared. Reloading...", "ok");
          setTimeout(function () {
            var url = new URL(window.location.href);
            url.searchParams.set("rn_state_reset", String(Date.now()));
            window.location.replace(url.toString());
          }, 250);
        });
      }
    });
  }

  /* client-side search filter: works on search results and on the home listing (dt+dd pairs) */
  function setupFilter() {
    var input = document.getElementById("filter");
    if (!input) return;
    var empty = document.querySelector("[data-search-empty]");
    if (!empty) {
      empty = document.createElement("p");
      empty.className = "muted search-empty";
      empty.setAttribute("data-search-empty", "");
      empty.hidden = true;
      var box = input.closest ? input.closest(".search-box") : input.parentNode;
      if (box && box.parentNode) box.parentNode.insertBefore(empty, box.nextSibling);
    }
    function listingEntries() {
      return Array.prototype.slice.call(document.querySelectorAll("dl.listing > dt")).map(function (dt) {
        var dd = dt.nextElementSibling;
        return { els: dd ? [dt, dd] : [dt], text: (dt.textContent + " " + (dd ? dd.textContent : "")).toLowerCase() };
      });
    }
    function apply() {
      var q = input.value.trim().toLowerCase();
      var visible = 0;
      var total = 0;
      Array.prototype.slice.call(document.querySelectorAll(".result")).forEach(function (row) {
        var hit = !q || row.textContent.toLowerCase().indexOf(q) !== -1;
        row.style.display = hit ? "" : "none";
        total += 1;
        if (hit) visible += 1;
      });
      listingEntries().forEach(function (entry) {
        var hit = !q || entry.text.indexOf(q) !== -1;
        entry.els.forEach(function (el) { el.style.display = hit ? "" : "none"; });
        total += 1;
        if (hit) visible += 1;
      });
      if (empty) {
        var busy = Boolean(document.querySelector("dl.listing[aria-busy='true']"));
        empty.hidden = !q || busy || total === 0 || visible > 0;
        empty.textContent = empty.hidden ? "" : 'No results for "' + input.value.trim() + '".';
      }
    }
    input.addEventListener("input", apply);
    document.addEventListener("rn:listings-updated", apply);
    try {
      var q = new URLSearchParams(window.location.search).get("q");
      if (q) { input.value = q; apply(); }
    } catch (e) { /* ignore */ }
  }

  function notifyListingsUpdated() {
    try { document.dispatchEvent(new CustomEvent("rn:listings-updated")); } catch (e) { /* ignore */ }
  }

  function rpcCall(url, method, params) {
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params })
    }).then(function (res) {
      if (!res.ok) throw new Error("RPC HTTP " + res.status);
      return res.json();
    }).then(function (json) {
      if (json.error) throw new Error(json.error.message || "RPC error");
      return json.result;
    });
  }

  function bytesToString(value) {
    if (!Array.isArray(value)) return typeof value === "string" ? value : "";
    try {
      return String.fromCharCode.apply(null, value);
    } catch (e) {
      return "";
    }
  }

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function shortText(value, head, tail) {
    var text = String(value || "");
    if (text.length <= head + tail + 3) return text;
    return text.slice(0, head) + "..." + text.slice(-tail);
  }

  function routeSegment(id) {
    var text = String(id || "");
    if (/^[A-Za-z0-9._~-]+$/.test(text)) return text;
    return btoa(unescape(encodeURIComponent(text))).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
  }

  function proofHref(base, kind, value) {
    var text = String(value || "");
    if (!text) return "";
    return base + "/" + kind + "/" + encodeURIComponent(text);
  }

  function proofLink(base, kind, value) {
    var text = String(value || "");
    var href = proofHref(base, kind, text);
    if (!href) return "";
    return '<a href="' + esc(href) + '" rel="noopener" target="_blank">' + esc(text) + '</a>';
  }

  function proofLabelLink(base, kind, value, label) {
    var href = proofHref(base, kind, value);
    if (!href) return esc(label || "");
    return '<a href="' + esc(href) + '" rel="noopener" target="_blank">' + esc(label) + '</a>';
  }

  function proofBlobHref(base, value) {
    var text = String(value || "");
    if (!text) return "";
    return base + "/blob/" + encodeURIComponent(text);
  }

  function proofBlobLink(base, value) {
    var text = String(value || "");
    var href = proofBlobHref(base, text);
    if (!href) return "";
    return '<a href="' + esc(href) + '" rel="noopener" target="_blank">' + esc(text) + '</a>';
  }

  function proofBlobLabelLink(base, value, label) {
    var href = proofBlobHref(base, value);
    if (!href) return esc(label || "");
    return '<a href="' + esc(href) + '" rel="noopener" target="_blank">' + esc(label) + '</a>';
  }

  function proofDate(ms) {
    var n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return "";
    try { return new Date(n).toISOString().replace("T", " ").slice(0, 19); } catch (e) { return ""; }
  }

  function commitLink(repoBase, commit) {
    var text = String(commit || "");
    if (!text) return '<span class="muted">not recorded on-chain</span>';
    var short = shortText(text, 10, 8);
    if (repoBase && /^[0-9a-f]{7,64}$/i.test(text)) {
      return '<a href="' + esc(repoBase + "/commit/" + encodeURIComponent(text)) + '" rel="noopener" target="_blank"><code title="' + esc(text) + '">' + esc(short) + '</code></a>';
    }
    return '<code title="' + esc(text) + '">' + esc(short) + '</code>';
  }

  function plainLink(href, label) {
    var url = String(href || "");
    if (!url) return esc(label || "");
    return '<a href="' + esc(url) + '" rel="noopener">' + esc(label) + '</a>';
  }

  var zstdDecoderPromise = null;
  var liveManifestCache = {};

  function loadZstdDecoder() {
    if (!zstdDecoderPromise) {
      zstdDecoderPromise = import("https://cdn.jsdelivr.net/npm/zstddec@0.2.0/dist/zstddec-stream.modern.js").then(function (mod) {
        var decoder = new mod.ZSTDDecoder();
        return decoder.init().then(function () { return decoder; });
      });
    }
    return zstdDecoderPromise;
  }

  function tarString(bytes, start, length) {
    var end = start;
    while (end < start + length && bytes[end] !== 0) end += 1;
    return new TextDecoder().decode(bytes.slice(start, end)).trim();
  }

  function tarSize(bytes, start) {
    var raw = tarString(bytes, start + 124, 12).replace(/\\0/g, "").trim();
    return raw ? parseInt(raw, 8) || 0 : 0;
  }

  function readTarMember(bytes, wanted) {
    var offset = 0;
    var textDecoder = new TextDecoder();
    while (offset + 512 <= bytes.length) {
      var name = tarString(bytes, offset, 100);
      if (!name) return null;
      var prefix = tarString(bytes, offset + 345, 155);
      var fullName = prefix ? prefix + "/" + name : name;
      var size = tarSize(bytes, offset);
      var bodyStart = offset + 512;
      if (fullName === wanted || fullName === "./" + wanted || fullName.replace(/^\\.\\//, "") === wanted) {
        return {
          bytes: bytes.slice(bodyStart, bodyStart + size),
          text: textDecoder.decode(bytes.slice(bodyStart, bodyStart + size))
        };
      }
      offset = bodyStart + Math.ceil(size / 512) * 512;
    }
    return null;
  }

  function normalizeRepoUrl(value) {
    var text = String(value || "").trim();
    if (!/^https?:\\/\\//.test(text)) return "";
    return text.replace(/\\.git$/, "").replace(/\\/$/, "");
  }

  function releaseAuthorLine(authors) {
    if (!Array.isArray(authors) || !authors.length) return "Unknown";
    return authors.map(function (author) {
      var suffix = author && author.agent_id ? " (" + author.agent_id + ")" : author && author.github ? " (@" + author.github + ")" : author && author.type ? " (" + author.type + ")" : "";
      return String(author && author.name ? author.name : "Unknown") + suffix;
    }).join(", ");
  }

  function metadataFromRelease(release, fallback) {
    var asset = release && release.assets ? release.assets : {};
    return {
      id: String(asset.id || fallback.sui_object_id || ""),
      title: String(asset.title || "On-chain Research Asset v" + (fallback.version || "?")),
      authors: releaseAuthorLine(asset.authors),
      abstract: String(asset.abstract || ""),
      types: Array.isArray(asset.types) ? asset.types : ["asset"],
      tags: Array.isArray(asset.tags) ? asset.tags : [],
      created_at: String(release && release.created_at ? release.created_at : fallback.created_at || ""),
      manifest_hash: fallback.manifest_hash,
      repo_url: normalizeRepoUrl(release && release.repo),
      repo_commit: String(fallback.repo_commit || release && release.commit || ""),
      walrus_blob_id: fallback.walrus_blob_id,
      sui_object_id: fallback.sui_object_id,
      tx_digest: fallback.tx_digest,
      href: asset.id ? "/abs/" + routeSegment(asset.id) + ".html" : ""
    };
  }

  function fetchWalrusReleaseMetadata(input) {
    if (!input.blobId || !input.manifestHash || !input.aggregatorUrl) return Promise.resolve(null);
    var cacheKey = input.blobId + ":" + input.manifestHash;
    if (liveManifestCache[cacheKey]) return liveManifestCache[cacheKey];
    liveManifestCache[cacheKey] = fetch(input.aggregatorUrl.replace(/\\/$/, "") + "/v1/blobs/" + encodeURIComponent(input.blobId), { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("Walrus blob HTTP " + res.status);
        return res.arrayBuffer();
      })
      .then(function (buffer) {
        return loadZstdDecoder().then(function (decoder) {
          return decoder.decode(new Uint8Array(buffer));
        });
      })
      .then(function (tarBytes) {
        var manifest = readTarMember(tarBytes, "manifest.json");
        if (!manifest) throw new Error("release manifest missing");
        var release = JSON.parse(manifest.text);
        if (release.manifest_hash !== input.manifestHash) {
          throw new Error("manifest hash mismatch");
        }
        return metadataFromRelease(release, input);
      })
      .catch(function () { return null; });
    return liveManifestCache[cacheKey];
  }

  function appendLiveIndexEntry(listing, asset, position, suiExplorer, walrusExplorer) {
    var dt = document.createElement("dt");
    var dd = document.createElement("dd");
    var title = String(asset.title || asset.id || "Research Asset");
    var titleHtml = asset.href ? plainLink(asset.href, title) : proofLabelLink(suiExplorer, "object", asset.sui_object_id, title);
    var types = Array.isArray(asset.types) && asset.types.length ? asset.types : ["asset"];
    var tags = Array.isArray(asset.tags) ? asset.tags : [];
    var subjects = '<span class="primary-subject">' + esc(types[0] || "asset") + '</span>' + types.slice(1).map(function (type) { return '; ' + esc(type); }).join("") + (tags.length ? ' &middot; ' + esc(tags.join(", ")) : "");
    var proof = asset.proof || {};
    var verified = Boolean(proof.tx_success && proof.object_type_match && proof.owner_match && proof.blob_match && proof.manifest_match && proof.release_manifest_match);
    var statusClass = verified ? "verified" : "warning";
    var statusLabel = verified ? "Live indexed" : "Live evidence incomplete";
    var missing = [];
    if (!proof.tx_success) missing.push("tx");
    if (!proof.object_type_match) missing.push("type");
    if (!proof.owner_match) missing.push("owner");
    if (!proof.blob_match) missing.push("blob");
    if (!proof.manifest_match) missing.push("object manifest");
    if (!proof.release_manifest_match) missing.push("release manifest");
    var actions = [
      proofLabelLink(suiExplorer, "object", asset.sui_object_id, "object"),
      proofLabelLink(suiExplorer, "tx", asset.tx_digest, "tx"),
      proofBlobLabelLink(walrusExplorer, asset.walrus_blob_id, "walrus"),
      asset.href ? plainLink(asset.href, "asset page") : ""
    ].filter(Boolean);
    dt.className = "chain-submission-entry";
    dd.className = "chain-submission-entry";
    dt.innerHTML = '<span class="list-identifier">[' + position + ']&nbsp;' + proofLabelLink(suiExplorer, "object", asset.sui_object_id, "ResearchAsset " + shortText(asset.sui_object_id, 8, 6)) + '</span> [' + actions.join(", ") + ']';
    dd.innerHTML =
      '<div class="list-title">' + titleHtml + '</div>' +
      '<div class="list-authors">' + esc(asset.authors || "Unknown") + '</div>' +
      '<div class="list-subjects">' + subjects + (asset.created_at ? ' &middot; published ' + esc(String(asset.created_at).replace("T", " ").slice(0, 19)) + ' UTC' : '') + '</div>' +
      '<p class="chain-listing-note">' + esc(asset.abstract || "") + '</p>' +
      '<div class="chain-proofline"><span class="chain-status chain-status-' + statusClass + '">' + esc(statusLabel) + '</span><span>' + esc(verified ? "Verified on Sui and Walrus" : missing.join(", ")) + '</span></div>' +
      '<dl class="chain-facts">' +
      '<div><dt>Sui object</dt><dd>' + proofLink(suiExplorer, "object", asset.sui_object_id) + '</dd></div>' +
      '<div><dt>Sui tx</dt><dd>' + proofLink(suiExplorer, "tx", asset.tx_digest) + '</dd></div>' +
      '<div><dt>Walrus blob</dt><dd>' + proofBlobLink(walrusExplorer, asset.walrus_blob_id) + '</dd></div>' +
      '<div><dt>Manifest hash</dt><dd><code title="' + esc(asset.manifest_hash || "") + '">' + esc(shortText(asset.manifest_hash || "", 18, 12)) + '</code></dd></div>' +
      (asset.repo_url ? '<div><dt>Repository</dt><dd>' + plainLink(asset.repo_url, asset.repo_url) + '</dd></div>' : '') +
      '<div><dt>Repo commit</dt><dd>' + commitLink(asset.repo_url, asset.repo_commit) + '</dd></div>' +
      '</dl>';
    listing.appendChild(dt);
    listing.appendChild(dd);
  }

  function liveProofState(asset) {
    var proof = asset && asset.proof ? asset.proof : {};
    var checks = [
      ["tx", proof.tx_success],
      ["sender", proof.sender_match],
      ["type", proof.object_type_match],
      ["owner", proof.owner_match],
      ["blob", proof.blob_match],
      ["manifest", proof.manifest_match],
      ["release manifest", proof.release_manifest_match]
    ];
    var missing = checks.filter(function (check) { return !check[1]; }).map(function (check) { return check[0]; });
    return {
      verified: missing.length === 0,
      missing: missing,
      label: missing.length === 0 ? "Live verified" : "Live evidence incomplete",
      detail: missing.length === 0 ? "event, tx, object, blob and release manifest agree" : "missing: " + missing.join(", ")
    };
  }

  function renderDashboardLiveRow(asset, index, suiExplorer, walrusExplorer) {
    var state = liveProofState(asset);
    var statusClass = state.verified ? "verified" : "warning";
    var title = String(asset.title || asset.id || "Research Asset");
    var assetHref = asset.href || (asset.id ? "/asset.html?id=" + routeSegment(asset.id) : "");
    var titleHtml = assetHref ? plainLink(assetHref, title) : proofLabelLink(suiExplorer, "object", asset.sui_object_id, title);
    var types = Array.isArray(asset.types) && asset.types.length ? asset.types.join(", ") : "asset";
    var tags = Array.isArray(asset.tags) && asset.tags.length ? " · " + asset.tags.join(", ") : "";
    var created = asset.created_at ? String(asset.created_at).replace("T", " ").slice(0, 19) + " UTC" : "not recorded";
    var repoText = asset.repo_url ? asset.repo_url.replace(/^https?:\\/\\/(www\\.)?github\\.com\\//, "") : "";
    var repoHtml = asset.repo_url ? plainLink(asset.repo_url, repoText || asset.repo_url) : '<span class="muted">not recorded in release manifest</span>';
    var signer = asset.tx_sender || asset.event_owner_address || asset.creator_address || "";
    var gasOwner = asset.gas_owner || signer;
    var gasText = asset.sui_spent_mist ? asset.sui_spent_mist + " MIST" : "not indexed";
    return '<tr>' +
      '<td class="live-dashboard-asset">' +
        '<strong>' + titleHtml + '</strong>' +
        '<div class="muted">[' + (index + 1) + '] ' + esc(asset.id || asset.sui_object_id || "") + '</div>' +
        '<div>' + esc(asset.authors || "Unknown") + '</div>' +
        '<div class="muted">' + esc(types + tags) + ' · published ' + esc(created) + '</div>' +
        '<p>' + esc(shortText(asset.abstract || "Indexed from a live Sui ResearchAssetPublished event and its Walrus release manifest.", 160, 40)) + '</p>' +
      '</td>' +
      '<td class="live-dashboard-proof">' +
        '<span><strong>ResearchAssetPublished</strong></span>' +
        '<span class="mono">object: ' + proofLabelLink(suiExplorer, "object", asset.sui_object_id, shortText(asset.sui_object_id, 12, 10)) + '</span>' +
        '<span class="mono">tx: ' + proofLabelLink(suiExplorer, "tx", asset.tx_digest, shortText(asset.tx_digest, 12, 10)) + '</span>' +
        '<span class="mono">signer: ' + proofLabelLink(suiExplorer, "account", signer, shortText(signer, 12, 10)) + '</span>' +
        '<span class="mono">gas: ' + proofLabelLink(suiExplorer, "account", gasOwner, shortText(gasOwner, 8, 6)) + ' · ' + esc(gasText) + '</span>' +
        '<span class="chain-status chain-status-' + statusClass + '">' + esc(state.label) + '</span>' +
        '<span class="muted">' + esc(state.detail) + '</span>' +
      '</td>' +
      '<td>' +
        '<div class="mono">' + proofBlobLabelLink(walrusExplorer, asset.walrus_blob_id, shortText(asset.walrus_blob_id, 12, 10)) + '</div>' +
        '<div class="muted">manifest</div>' +
        '<div class="mono"><code title="' + esc(asset.manifest_hash || "") + '">' + esc(shortText(asset.manifest_hash || "", 16, 12)) + '</code></div>' +
      '</td>' +
      '<td>' +
        '<div>' + repoHtml + '</div>' +
        '<div class="muted">commit</div>' +
        '<div class="mono">' + commitLink(asset.repo_url, asset.repo_commit) + '</div>' +
      '</td>' +
    '</tr>';
  }

  function formatMembershipDate(value) {
    if (!value) return "not recorded";
    return String(value).replace("T", " ").slice(0, 19) + " UTC";
  }

  function formatMist(value) {
    if (!value) return "not recorded";
    var n = Number(value);
    if (Number.isFinite(n) && n >= 1000000000) {
      return (n / 1000000000).toFixed(4).replace(/0+$/, "").replace(/\\.$/, "") + " SUI";
    }
    return String(value) + " MIST";
  }

  function formatSuiAmount(value) {
    if (!value) return "not recorded";
    var n = Number(value);
    if (!Number.isFinite(n)) return String(value) + " MIST";
    return (n / 1000000000).toFixed(n < 1000000000 ? 6 : 4).replace(/0+$/, "").replace(/\\.$/, "") + " SUI";
  }

  function renderMembershipLiveRow(event, index, suiExplorer) {
    var eventName = String(event.event_type || "MembershipEvent");
    var subject = String(event.subject_address || event.signer || "");
    var objectId = String(event.object_id || "");
    var amount = event.amount_mist ? formatMist(event.amount_mist) : "";
    var fee = event.platform_fee_mist ? "platform fee " + formatMist(event.platform_fee_mist) : "";
    var objectLine = objectId
      ? proofLabelLink(suiExplorer, "object", objectId, shortText(objectId, 12, 10))
      : (amount || "event only");
    var detail = [
      event.tier ? "tier " + event.tier : "",
      event.access_type ? "access " + event.access_type : "",
      event.period_id ? "period " + event.period_id : "",
      event.report_id ? "report " + shortText(event.report_id, 12, 10) : "",
      event.agent_address ? "agent " + shortText(event.agent_address, 8, 6) : "",
      amount,
      fee
    ].filter(Boolean).join(" · ");
    return '<tr>' +
      '<td>' +
        '<div class="membership-event-name">' + esc(eventName) + '</div>' +
        '<div class="muted">[' + (index + 1) + '] ' + esc(event.module || "protocol") + ' · ' + esc(formatMembershipDate(event.created_at)) + '</div>' +
      '</td>' +
      '<td>' +
        '<div class="mono">account: ' + proofLabelLink(suiExplorer, "account", subject, shortText(subject, 12, 10)) + '</div>' +
        '<div class="mono">signer: ' + proofLabelLink(suiExplorer, "account", event.signer || subject, shortText(event.signer || subject, 12, 10)) + '</div>' +
      '</td>' +
      '<td>' +
        '<div class="mono">' + objectLine + '</div>' +
        '<div class="muted">' + esc(detail || "chain event recorded") + '</div>' +
      '</td>' +
      '<td>' +
        '<div class="mono">tx: ' + proofLabelLink(suiExplorer, "tx", event.tx_digest, shortText(event.tx_digest, 12, 10)) + '</div>' +
        '<div class="mono">gas: ' + proofLabelLink(suiExplorer, "account", event.gas_owner || event.signer, shortText(event.gas_owner || event.signer, 8, 6)) + '</div>' +
        '<div class="muted">' + esc(formatMist(event.sui_spent_mist)) + '</div>' +
      '</td>' +
    '</tr>';
  }

  function setupMembershipIndex() {
    var root = document.querySelector("[data-live-membership]");
    var source = document.querySelector("[data-chain-source][data-chain-index-api]");
    if (!root || !source || !window.fetch) return;
    var stats = root.querySelector("[data-live-membership-stats]");
    var status = root.querySelector("[data-live-membership-status]");
    var rows = root.querySelector("[data-live-membership-rows]");
    var indexApi = source.getAttribute("data-chain-index-api") || "/api/index";
    var sourceLimit = Number(source.getAttribute("data-chain-limit")) || 6;
    var limit = Math.max(1, Math.min(20, Number(root.getAttribute("data-live-membership-limit")) || sourceLimit));
    var suiExplorer = source.getAttribute("data-sui-explorer") || "https://suiscan.xyz/testnet";
    var indexUrl = indexApi + (indexApi.indexOf("?") === -1 ? "?" : "&") + "limit=" + encodeURIComponent(String(limit));
    root.setAttribute("aria-busy", "true");
    fetch(indexUrl, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("index API HTTP " + res.status);
      return res.json();
    }).then(function (data) {
      var membership = data && data.membership ? data.membership : {};
      var counts = membership.counts || {};
      var events = Array.isArray(membership.recent_events) ? membership.recent_events : [];
      var eventTypes = Array.isArray(membership.event_types) ? membership.event_types : [];
      if (stats) {
        stats.innerHTML =
          '<div class="stat"><b>' + Number(counts.platform_membership_passes || 0) + '</b><span>Live passes</span></div>' +
          '<div class="stat"><b>' + Number(counts.agent_subscription_passes || 0) + '</b><span>Live subscriptions</span></div>' +
          '<div class="stat"><b>' + Number(counts.access_receipts || 0) + '</b><span>Live receipts</span></div>' +
          '<div class="stat"><b>' + Number(counts.total_events || events.length || 0) + '</b><span>Membership events</span></div>';
      }
      if (status) {
        status.innerHTML = 'Loaded from ' + plainLink(indexUrl, "/api/index") +
          ' · membership event types ' + esc(String(eventTypes.length || 0)) +
          ' · package ' + proofLabelLink(suiExplorer, "object", data.package_id || source.getAttribute("data-chain-package"), shortText(data.package_id || source.getAttribute("data-chain-package"), 12, 10));
      }
      if (rows) {
        rows.innerHTML = events.length
          ? events.map(function (event, index) { return renderMembershipLiveRow(event, index, suiExplorer); }).join("")
          : '<tr><td colspan="4"><p class="muted">The backend checked Sui live events for membership, subscription, receipt, settlement, and claim types. This package has no matching live events yet.</p></td></tr>';
      }
      root.setAttribute("aria-busy", "false");
    }).catch(function (err) {
      root.setAttribute("aria-busy", "false");
      if (stats) {
        stats.innerHTML = '<div class="stat"><b>API</b><span>Unavailable</span></div>';
      }
      if (status) {
        status.innerHTML = 'Could not load ' + plainLink(indexUrl, "/api/index") + ': ' + esc(err && err.message ? err.message : "request failed");
      }
      if (rows) {
        rows.innerHTML = '<tr><td colspan="4"><p class="muted">Membership data is intentionally served only by the backend live index. Check <code>/api/index/health</code> and Vercel Function logs.</p></td></tr>';
      }
    });
  }

  function liveAssetResultHtml(asset) {
    var title = String(asset.title || asset.id || "Research Asset");
    var href = asset.href || (asset.id ? "/asset.html?id=" + routeSegment(asset.id) : "#");
    var tags = Array.isArray(asset.tags) && asset.tags.length ? " · " + asset.tags.join(", ") : "";
    return '<a class="result" href="' + esc(href) + '">' +
      '<strong>' + esc(title) + '</strong><br>' +
      '<span class="muted">' + esc((Array.isArray(asset.types) ? asset.types.join(", ") : "asset") + tags) + '</span><br>' +
      '<span>' + esc(shortText(asset.abstract || "", 180, 30)) + '</span>' +
    '</a>';
  }

  function setupLiveSearch() {
    var root = document.querySelector("[data-live-search]");
    var source = document.querySelector("[data-chain-source][data-chain-index-api]");
    if (!root || !source || !window.fetch) return;
    var input = root.querySelector("[data-live-search-input]");
    var results = root.querySelector("[data-live-search-results]");
    var status = root.querySelector("[data-live-search-status]");
    var indexApi = source.getAttribute("data-chain-index-api") || "/api/index";
    var limit = Math.max(1, Math.min(20, Number(root.getAttribute("data-live-search-limit")) || 20));
    var timer = null;
    function load() {
      var q = input && input.value ? String(input.value).trim() : "";
      var indexUrl = indexApi + (indexApi.indexOf("?") === -1 ? "?" : "&") + "limit=" + encodeURIComponent(String(limit)) + (q ? "&q=" + encodeURIComponent(q) : "");
      if (status) status.innerHTML = 'Loading live index from ' + plainLink(indexUrl, "/api/index") + '...';
      fetch(indexUrl, { cache: "no-store" }).then(function (res) {
        if (!res.ok) throw new Error("index API HTTP " + res.status);
        return res.json();
      }).then(function (data) {
        var assets = Array.isArray(data.assets) ? data.assets : [];
        if (status) status.innerHTML = 'Loaded ' + assets.length + ' live asset(s) from ' + plainLink(indexUrl, "/api/index") + '.';
        if (results) {
          results.innerHTML = assets.length
            ? assets.map(liveAssetResultHtml).join("")
            : '<p class="muted">No live ResearchAssetPublished rows matched this query.</p>';
        }
      }).catch(function (err) {
        if (status) status.innerHTML = 'Could not load live search: ' + esc(err && err.message ? err.message : "request failed");
        if (results) results.innerHTML = '<p class="muted">Search is intentionally backed only by the live backend index.</p>';
      });
    }
    if (input) {
      input.addEventListener("input", function () {
        clearTimeout(timer);
        timer = setTimeout(load, 180);
      });
    }
    load();
  }

  function artifactApiFromIndex(indexApi) {
    var clean = String(indexApi || "/api/index").split("?")[0].replace(/\\/$/, "");
    return /\\/index$/.test(clean) ? clean + "/artifact" : "/api/index/artifact";
  }

  function artifactUrl(asset, pathValue, artifactApi, aggregatorUrl) {
    if (!asset || !asset.walrus_blob_id || !pathValue) return "";
    var params = new URLSearchParams();
    params.set("blob", asset.walrus_blob_id);
    params.set("path", pathValue);
    if (aggregatorUrl) params.set("aggregator", aggregatorUrl);
    return artifactApi + "?" + params.toString();
  }

  function artifactExt(pathValue) {
    var clean = String(pathValue || "").split("?")[0].split("#")[0];
    var match = clean.match(/\\.([A-Za-z0-9]+)$/);
    return match ? match[1].toLowerCase() : "";
  }

  function hasArtifactExt(pathValue, exts) {
    var ext = artifactExt(pathValue);
    return exts.indexOf(ext) !== -1;
  }

  function pushUniqueDownload(list, seen, label, pathValue, url) {
    if (!pathValue || !url || seen[pathValue]) return;
    seen[pathValue] = true;
    list.push({ label: label, path: pathValue, url: url });
  }

  function livePaperBundle(asset, artifactApi, aggregatorUrl) {
    var paper = asset && asset.paper ? asset.paper : {};
    var sourcePath = String(paper.source_path || "");
    var htmlPath = paper.html_path || (hasArtifactExt(sourcePath, ["html", "htm"]) ? sourcePath : "");
    var mdPath = hasArtifactExt(sourcePath, ["md", "markdown"]) ? sourcePath : "";
    var texPath = hasArtifactExt(sourcePath, ["tex", "latex"]) ? sourcePath : "";
    var pdfPath = paper.pdf_path || (hasArtifactExt(sourcePath, ["pdf"]) ? sourcePath : "");
    var wordPath = paper.word_path || (hasArtifactExt(sourcePath, ["word", "docx", "doc"]) ? sourcePath : "");
    var pptPath = paper.ppt_path || (hasArtifactExt(sourcePath, ["pptx", "ppt"]) ? sourcePath : "");
    var bibPath = paper.bib_path || "";
    var readmePath = paper.readme_path || "";
    var formats = [];
    var downloads = [];
    var seen = {};
    function addFormat(kind, id, label, pathValue) {
      var url = artifactUrl(asset, pathValue, artifactApi, aggregatorUrl);
      if (!pathValue || !url) return;
      formats.push({ kind: kind, id: id, label: label, path: pathValue, url: url });
      pushUniqueDownload(downloads, seen, label + " raw", pathValue, url);
    }
    addFormat("html", "paper-html", "HTML", htmlPath);
    addFormat("markdown", "paper-md", "Markdown", mdPath);
    addFormat("tex", "paper-tex", "LaTeX", texPath);
    addFormat("pdf", "pdf", "PDF", pdfPath);
    addFormat("word", "paper-word", "Word", wordPath);
    addFormat("ppt", "paper-ppt", "PPT", pptPath);
    addFormat("markdown", "readme", "README", readmePath);
    pushUniqueDownload(downloads, seen, "BibTeX raw", bibPath, artifactUrl(asset, bibPath, artifactApi, aggregatorUrl));
    pushUniqueDownload(downloads, seen, "README raw", readmePath, artifactUrl(asset, readmePath, artifactApi, aggregatorUrl));
    return {
      formats: formats,
      downloads: downloads,
      readme: readmePath ? { path: readmePath, url: artifactUrl(asset, readmePath, artifactApi, aggregatorUrl) } : null
    };
  }

  function livePaperDefaultId(formats) {
    var preferred = formats.filter(function (format) { return format.kind !== "pdf"; })[0] || formats[0];
    return preferred ? preferred.id : "";
  }

  function renderLivePaperViewer(formats) {
    if (!formats.length) {
      return '<div class="paper-viewer live-paper-viewer" data-live-paper><p class="format-panel-empty muted">No paper artifact path is declared in this live Walrus release manifest.</p></div>';
    }
    var defaultId = livePaperDefaultId(formats);
    var nav = formats.map(function (format) {
      return '<a class="format-tab" href="#' + esc(format.id) + '">' + esc(format.label) + '</a>';
    }).join('<span class="format-sep" aria-hidden="true"> | </span>');
    var panels = formats.map(function (format) {
      var cls = "format-panel" + (format.id === defaultId ? " format-panel-default" : "");
      if (format.kind === "pdf") {
        return '<section id="' + esc(format.id) + '" class="' + cls + '" aria-label="PDF">' +
          '<div class="pdfjs-viewer" data-pdf-url="' + esc(format.url) + '">' +
          '<div class="pdfjs-pages" aria-busy="true" aria-label="PDF pages"></div>' +
          '</div></section>';
      }
      if (format.kind === "html") {
        return '<section id="' + esc(format.id) + '" class="' + cls + '" aria-label="HTML">' +
          '<p class="source-note">Rendered from ' + esc(format.path) + ' &middot; <a href="' + esc(format.url) + '" download>download raw file</a></p>' +
          '<iframe class="document-frame" sandbox src="' + esc(format.url) + '" title="HTML paper"></iframe>' +
          '</section>';
      }
      return '<section id="' + esc(format.id) + '" class="' + cls + '" aria-label="' + esc(format.label) + '">' +
        '<p class="source-note">Rendered from ' + esc(format.path) + ' &middot; <a href="' + esc(format.url) + '" download>download raw file</a></p>' +
        '<div class="live-document-renderer" data-render-kind="' + esc(format.kind) + '" data-artifact-url="' + esc(format.url) + '" data-artifact-path="' + esc(format.path) + '">' +
        '<p class="pdfjs-loading">Rendering ' + esc(format.label) + ' content...</p>' +
        '</div></section>';
    }).join("");
    return '<div class="paper-viewer live-paper-viewer" data-paper-viewer data-live-paper>' +
      '<nav class="format-nav" aria-label="Paper formats">' + nav + '</nav>' +
      panels +
      '</div>';
  }

  function renderDownloadList(downloads) {
    if (!downloads.length) return '<p class="muted">No downloadable artifact paths are declared.</p>';
    return '<ul class="download-list">' + downloads.map(function (item) {
      return '<li><a href="' + esc(item.url) + '" download>' + esc(item.label) + '</a><code>' + esc(item.path) + '</code></li>';
    }).join("") + '</ul>';
  }

  function fetchArtifactText(url) {
    return fetch(url, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("artifact HTTP " + res.status);
      return res.text();
    });
  }

  function fetchArtifactBuffer(url) {
    return fetch(url, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("artifact HTTP " + res.status);
      return res.arrayBuffer();
    });
  }

  function markdownToHtml(source) {
    var lines = esc(source).replaceAll("\\r\\n", "\\n").split("\\n");
    var out = [];
    var paragraph = [];
    var listMode = null;
    var codeMode = false;
    var codeLines = [];
    var tick = String.fromCharCode(96);
    var inlineCodePattern = new RegExp(tick + "([^" + tick + "]+)" + tick, "g");
    var codeFence = tick + tick + tick;
    function inline(text) {
      return text
        .replace(inlineCodePattern, "<code>$1</code>")
        .replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>")
        .replace(/\\*([^*]+)\\*/g, "<em>$1</em>")
        .replace(/\\[([^\\]]+)\\]\\(([^)\\s]+)\\)/g, function (match, label, href) {
          return /^(https?:\\/\\/|\\/|#|\\.\\/)/.test(href) ? '<a href="' + href + '" rel="noopener">' + label + '</a>' : match;
        });
    }
    function flushParagraph() {
      if (!paragraph.length) return;
      out.push("<p>" + inline(paragraph.join(" ")) + "</p>");
      paragraph = [];
    }
    function flushList() {
      if (!listMode) return;
      out.push("</" + listMode + ">");
      listMode = null;
    }
    lines.forEach(function (line) {
      if (codeMode) {
        if (line.indexOf(codeFence) === 0) {
          out.push('<pre class="md-code">' + codeLines.join("\\n") + '</pre>');
          codeLines = [];
          codeMode = false;
        } else {
          codeLines.push(line);
        }
        return;
      }
      if (line.indexOf(codeFence) === 0) {
        flushParagraph();
        flushList();
        codeMode = true;
        return;
      }
      var heading = line.match(/^(#{1,4})\\s+(.*)$/);
      if (heading) {
        flushParagraph();
        flushList();
        var level = Math.min(heading[1].length + 1, 5);
        out.push("<h" + level + ">" + inline(heading[2]) + "</h" + level + ">");
        return;
      }
      var unordered = line.match(/^\\s*[-*]\\s+(.*)$/);
      var ordered = line.match(/^\\s*\\d+[.)]\\s+(.*)$/);
      if (unordered || ordered) {
        flushParagraph();
        var mode = unordered ? "ul" : "ol";
        if (listMode !== mode) {
          flushList();
          out.push("<" + mode + ">");
          listMode = mode;
        }
        out.push("<li>" + inline((unordered || ordered)[1]) + "</li>");
        return;
      }
      if (!line.trim()) {
        flushParagraph();
        flushList();
        return;
      }
      paragraph.push(line.trim());
    });
    if (codeMode && codeLines.length) out.push('<pre class="md-code">' + codeLines.join("\\n") + '</pre>');
    flushParagraph();
    flushList();
    return out.join("\\n");
  }

  function renderMarkdownPaperClient(source, fallbackTitle, fallbackAuthors) {
    var titleMatch = source.match(/^#\\s+(.+)\\n?/);
    var body = titleMatch ? source.slice(titleMatch[0].length) : source;
    return '<div class="ltx-page"><article class="ltx-document md-doc">' +
      '<h1 class="ltx-title">' + esc(titleMatch && titleMatch[1] ? titleMatch[1].trim() : fallbackTitle) + '</h1>' +
      '<div class="ltx-authors">' + esc(fallbackAuthors || "Unknown") + '</div>' +
      markdownToHtml(body) +
      '</article></div>';
  }

  var LATEX_BS = String.fromCharCode(92);

  function latexCommandValue(source, command) {
    var marker = LATEX_BS + command + "{";
    var start = source.indexOf(marker);
    if (start < 0) return "";
    var i = start + marker.length;
    var depth = 1;
    var out = "";
    for (; i < source.length; i += 1) {
      var ch = source[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
      out += ch;
    }
    return out.trim();
  }

  function latexInlineClient(value) {
    var text = esc(String(value || ""));
    var cmd = LATEX_BS + LATEX_BS;
    text = text
      .replace(new RegExp(cmd + "emph\\\\{([^{}]+)\\\\}", "g"), "<em>$1</em>")
      .replace(new RegExp(cmd + "textbf\\\\{([^{}]+)\\\\}", "g"), "<strong>$1</strong>")
      .replace(new RegExp(cmd + "texttt\\\\{([^{}]+)\\\\}", "g"), "<code>$1</code>")
      .replace(/\\$([^$]+)\\$/g, '<span class="math">\\\\($1\\\\)</span>')
      .replace(new RegExp(cmd + "&amp;", "g"), "&amp;")
      .replace(new RegExp(cmd + "%", "g"), "%")
      .replace(new RegExp(cmd + "_", "g"), "_")
      .replace(new RegExp(cmd + "#", "g"), "#")
      .replace(new RegExp(cmd + cmd, "g"), "<br>");
    text = text.replace(new RegExp(cmd + "[a-zA-Z]+\\\\*?(?:\\\\[[^\\\\]]*\\\\])?(?:\\\\{[^{}]*\\\\})?", "g"), "");
    return text.replace(/[{}]/g, "").trim();
  }

  function latexParagraphsOnlyClient(input) {
    return String(input || "")
      .split(/\\n\\s*\\n/)
      .map(function (paragraph) { return latexInlineClient(paragraph.replace(/\\s*\\n\\s*/g, " ")); })
      .filter(Boolean)
      .map(function (paragraph) { return "<p>" + paragraph + "</p>"; })
      .join("");
  }

  function latexListClient(env, body) {
    var raw = String(body || "");
    var chunks = raw.split(LATEX_BS + "item").slice(1);
    var tag = env === "enumerate" ? "ol" : "ul";
    var items = chunks.map(function (chunk) {
      var label = "";
      var text = chunk.trim();
      if (text[0] === "[") {
        var close = text.indexOf("]");
        if (close >= 0) {
          label = text.slice(1, close);
          text = text.slice(close + 1).trim();
        }
      }
      var bodyHtml = latexInlineClient(text.replace(/\\s*\\n\\s*/g, " "));
      if (env === "description" && label) {
        bodyHtml = "<strong>" + latexInlineClient(label) + "</strong> " + bodyHtml;
      }
      return bodyHtml ? "<li>" + bodyHtml + "</li>" : "";
    }).filter(Boolean).join("");
    return items ? "<" + tag + ">" + items + "</" + tag + ">" : "";
  }

  function latexTableClient(body) {
    var rows = String(body || "").split(LATEX_BS + LATEX_BS).map(function (row) {
      return row.replace(new RegExp(LATEX_BS + LATEX_BS + "hline", "g"), "").trim();
    }).filter(Boolean);
    if (!rows.length) return "";
    return '<table class="ltx-table"><tbody>' + rows.map(function (row) {
      var cells = row.split("&").map(function (cell) {
        return "<td>" + latexInlineClient(cell.trim()) + "</td>";
      }).join("");
      return "<tr>" + cells + "</tr>";
    }).join("") + "</tbody></table>";
  }

  function latexParagraphsClient(input) {
    var text = String(input || "");
    var tablePattern = new RegExp(LATEX_BS + LATEX_BS + "begin\\\\{tabular\\\\}\\\\{[^{}]*\\\\}([\\\\s\\\\S]*?)" + LATEX_BS + LATEX_BS + "end\\\\{tabular\\\\}", "g");
    text = text.replace(tablePattern, function (_match, body) {
      return "\\n\\n@@RN_HTML::" + latexTableClient(body) + "\\n\\n";
    });
    var envPattern = new RegExp(LATEX_BS + LATEX_BS + "begin\\\\{(itemize|enumerate|description)\\\\}(?:\\\\[[^\\\\]]*\\\\])?([\\\\s\\\\S]*?)" + LATEX_BS + LATEX_BS + "end\\\\{(?:itemize|enumerate|description)\\\\}", "g");
    text = text.replace(envPattern, function (_match, env, body) {
      return "\\n\\n@@RN_HTML::" + latexListClient(env, body) + "\\n\\n";
    });
    return text.split(/\\n\\s*\\n/).map(function (block) {
      if (block.indexOf("@@RN_HTML::") === 0) return block.slice("@@RN_HTML::".length);
      return latexParagraphsOnlyClient(block);
    }).join("");
  }

  function renderLatexPaperClient(source, fallbackTitle, fallbackAuthors) {
    var title = latexCommandValue(source, "title") || fallbackTitle;
    var author = latexCommandValue(source, "author").replace(new RegExp(LATEX_BS + LATEX_BS + "and\\\\b", "g"), ", ") || fallbackAuthors || "Unknown";
    var abstract = "";
    var beginAbs = source.indexOf(LATEX_BS + "begin{abstract}");
    var endAbs = source.indexOf(LATEX_BS + "end{abstract}");
    if (beginAbs >= 0 && endAbs > beginAbs) {
      abstract = source.slice(beginAbs + (LATEX_BS + "begin{abstract}").length, endAbs);
    }
    var bodyStart = Math.max(source.indexOf(LATEX_BS + "maketitle"), endAbs);
    var body = bodyStart >= 0 ? source.slice(bodyStart) : source;
    var endDoc = body.indexOf(LATEX_BS + "end{document}");
    if (endDoc >= 0) body = body.slice(0, endDoc);
    var bib = body.search(new RegExp(LATEX_BS + LATEX_BS + "bibliographystyle|" + LATEX_BS + LATEX_BS + "bibliography\\\\b|" + LATEX_BS + LATEX_BS + "begin\\\\{thebibliography\\\\}"));
    if (bib >= 0) body = body.slice(0, bib);
    body = body.replace(new RegExp(LATEX_BS + LATEX_BS + "maketitle", "g"), "");
    body = body.replace(new RegExp(LATEX_BS + LATEX_BS + "(section|subsection)\\\\*?\\\\{([^{}]+)\\\\}", "g"), function (_match, kind, heading) {
      return "\\n\\n@@RN_" + kind.toUpperCase() + "::" + heading + "\\n\\n";
    });
    var pieces = [
      '<h1 class="ltx-title">' + latexInlineClient(title) + '</h1>',
      '<div class="ltx-authors">' + latexInlineClient(author) + '</div>'
    ];
    if (abstract) pieces.push('<div class="ltx-abstract"><h6>Abstract</h6>' + latexParagraphsClient(abstract) + '</div>');
    var sectionNumber = 0;
    var subsectionNumber = 0;
    body.split(/\\n\\s*\\n/).forEach(function (block) {
      var section = block.match(/^@@RN_(SECTION|SUBSECTION)::([\\s\\S]*)$/);
      if (section && section[1] === "SECTION") {
        sectionNumber += 1;
        subsectionNumber = 0;
        pieces.push('<section class="ltx-section"><h2><span class="ltx-tag">' + sectionNumber + '</span>' + latexInlineClient(section[2]) + '</h2></section>');
        return;
      }
      if (section && section[1] === "SUBSECTION") {
        subsectionNumber += 1;
        pieces.push('<section class="ltx-section"><h3><span class="ltx-tag">' + sectionNumber + "." + subsectionNumber + '</span>' + latexInlineClient(section[2]) + '</h3></section>');
        return;
      }
      var html = latexParagraphsClient(block);
      if (html) pieces.push('<section class="ltx-section">' + html + '</section>');
    });
    return '<div class="ltx-page"><article class="ltx-document">' + pieces.join("") + '</article></div>';
  }

  var externalScriptPromises = {};
  function loadExternalScript(src, test) {
    if (test && test()) return Promise.resolve();
    if (externalScriptPromises[src]) return externalScriptPromises[src];
    externalScriptPromises[src] = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = src;
      script.crossOrigin = "anonymous";
      script.onload = function () { resolve(); };
      script.onerror = function () { reject(new Error("could not load " + src)); };
      document.head.appendChild(script);
    });
    return externalScriptPromises[src];
  }

  function loadMammoth() {
    return loadExternalScript("https://cdn.jsdelivr.net/npm/mammoth@1.12.0/mammoth.browser.min.js", function () { return Boolean(window.mammoth); })
      .then(function () { return window.mammoth; });
  }

  function loadJSZip() {
    return loadExternalScript("https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js", function () { return Boolean(window.JSZip); })
      .then(function () { return window.JSZip; });
  }

  function sanitizeDocumentHtml(html) {
    var template = document.createElement("template");
    template.innerHTML = String(html || "");
    Array.prototype.slice.call(template.content.querySelectorAll("script,style,iframe,object,embed,form")).forEach(function (node) {
      node.remove();
    });
    Array.prototype.slice.call(template.content.querySelectorAll("*")).forEach(function (el) {
      Array.prototype.slice.call(el.attributes).forEach(function (attr) {
        var name = attr.name.toLowerCase();
        var value = attr.value || "";
        if (name.indexOf("on") === 0 || name === "style" || (/^(href|src)$/i.test(name) && /^\\s*javascript:/i.test(value))) {
          el.removeAttribute(attr.name);
        }
      });
    });
    return template.innerHTML;
  }

  function printableRunsFromText(text) {
    var seen = {};
    return (String(text || "").match(/[A-Za-z0-9][A-Za-z0-9\\s.,;:!?()[\\]{}'"_#@%+\\-\\/=]{7,}/g) || [])
      .map(function (line) { return line.replace(/\\s+/g, " ").trim(); })
      .filter(function (line) {
        if (line.length < 8 || seen[line]) return false;
        seen[line] = true;
        return true;
      })
      .slice(0, 80);
  }

  function renderBinaryTextPreview(buffer, label) {
    var bytes = new Uint8Array(buffer);
    var ascii = "";
    for (var i = 0; i < bytes.length; i += 1) {
      var code = bytes[i];
      ascii += code >= 32 && code <= 126 ? String.fromCharCode(code) : " ";
    }
    var text = "";
    try { text += new TextDecoder("utf-16le").decode(bytes) + "\\n"; } catch (e) { /* ignore */ }
    text += ascii;
    var lines = printableRunsFromText(text);
    if (!lines.length) {
      return '<div class="ltx-page"><article class="ltx-document"><p class="missing-note">' + esc(label) + ' is present in the live release, but this legacy binary file did not expose readable text in the browser. Use the raw download for the original file.</p></article></div>';
    }
    return '<div class="ltx-page"><article class="ltx-document office-document"><h1 class="ltx-title">' + esc(label) + '</h1>' +
      lines.map(function (line) { return '<p>' + esc(line) + '</p>'; }).join("") +
      '</article></div>';
  }

  function renderWordBuffer(buffer, pathValue) {
    return loadMammoth().then(function (mammoth) {
      return mammoth.convertToHtml({ arrayBuffer: buffer });
    }).then(function (result) {
      var body = sanitizeDocumentHtml(result && result.value ? result.value : "");
      if (!body.trim()) return renderBinaryTextPreview(buffer, "Word document");
      return '<div class="ltx-page"><article class="ltx-document office-document word-document">' + body + '</article></div>';
    }).catch(function () {
      return renderBinaryTextPreview(buffer, hasArtifactExt(pathValue, ["doc"]) ? "Legacy Word document" : "Word document");
    });
  }

  function renderPptSlides(slides, fallbackTitle) {
    if (!slides.length) {
      return '<div class="ltx-page"><article class="ltx-document"><p class="missing-note">The presentation is present in the live release, but no slide text could be extracted. Use the raw download for the original deck.</p></article></div>';
    }
    return '<div class="ppt-document">' + slides.map(function (slide, index) {
      var lines = slide.lines || [];
      var title = lines[0] || fallbackTitle || ("Slide " + (index + 1));
      var body = lines.slice(1);
      return '<section class="ppt-slide">' +
        '<div class="ppt-slide-number">Slide ' + (index + 1) + '</div>' +
        '<h2>' + esc(title) + '</h2>' +
        (body.length ? body.map(function (line) { return '<p>' + esc(line) + '</p>'; }).join("") : '<p class="muted">No body text on this slide.</p>') +
        '</section>';
    }).join("") + '</div>';
  }

  function renderPptxBuffer(buffer, pathValue) {
    if (!hasArtifactExt(pathValue, ["pptx"])) {
      return Promise.resolve(renderBinaryTextPreview(buffer, "Legacy PowerPoint deck"));
    }
    return loadJSZip().then(function (JSZip) {
      return JSZip.loadAsync(buffer);
    }).then(function (zip) {
      var slideNames = Object.keys(zip.files).filter(function (name) {
        return /^ppt\\/slides\\/slide\\d+\\.xml$/.test(name);
      }).sort(function (a, b) {
        var am = a.match(/slide(\\d+)\\.xml/) || ["", "0"];
        var bm = b.match(/slide(\\d+)\\.xml/) || ["", "0"];
        return Number(am[1]) - Number(bm[1]);
      });
      return Promise.all(slideNames.map(function (name) {
        return zip.file(name).async("string").then(function (xmlText) {
          var xml = new DOMParser().parseFromString(xmlText, "application/xml");
          var nodes = Array.prototype.slice.call(xml.getElementsByTagName("a:t"));
          if (!nodes.length) nodes = Array.prototype.slice.call(xml.getElementsByTagName("t"));
          var lines = nodes.map(function (node) { return String(node.textContent || "").trim(); }).filter(Boolean);
          return { name: name, lines: lines };
        });
      }));
    }).then(function (slides) {
      return renderPptSlides(slides, pathValue.split("/").pop() || "Presentation");
    }).catch(function () {
      return renderBinaryTextPreview(buffer, "PowerPoint deck");
    });
  }

  function typesetMathIfAvailable(root) {
    if (window.MathJax && window.MathJax.typesetPromise) {
      try { window.MathJax.typesetPromise([root]); } catch (e) { /* ignore */ }
    }
  }

  function renderLiveArtifactPanels(scope, asset) {
    Array.prototype.slice.call(scope.querySelectorAll(".live-document-renderer:not([data-rendered])")).forEach(function (target) {
      var kind = target.getAttribute("data-render-kind") || "";
      var url = target.getAttribute("data-artifact-url") || "";
      var pathValue = target.getAttribute("data-artifact-path") || "";
      target.setAttribute("data-rendered", "true");
      var done = function (html) {
        target.innerHTML = html;
        typesetMathIfAvailable(target);
      };
      var fail = function (err) {
        target.innerHTML = '<p class="pdfjs-loading">Could not render ' + esc(pathValue || kind) + ': ' + esc(err && err.message ? err.message : "request failed") + '. <a href="' + esc(url) + '" download>Download raw file</a></p>';
      };
      if (kind === "markdown") {
        fetchArtifactText(url).then(function (text) { done(renderMarkdownPaperClient(text, asset.title || asset.id || "Research Asset", asset.authors || "Unknown")); }).catch(fail);
      } else if (kind === "tex") {
        fetchArtifactText(url).then(function (text) { done(renderLatexPaperClient(text, asset.title || asset.id || "Research Asset", asset.authors || "Unknown")); }).catch(fail);
      } else if (kind === "word") {
        fetchArtifactBuffer(url).then(function (buffer) { return renderWordBuffer(buffer, pathValue); }).then(done).catch(fail);
      } else if (kind === "ppt") {
        fetchArtifactBuffer(url).then(function (buffer) { return renderPptxBuffer(buffer, pathValue); }).then(done).catch(fail);
      }
    });
  }

  function renderLiveSkills(asset, artifactApi, aggregatorUrl) {
    var skills = Array.isArray(asset.skills) ? asset.skills : [];
    if (!skills.length) {
      return '<p class="muted">No skills are declared in this live Walrus release manifest.</p>';
    }
    return '<div class="compact-skill-list">' + skills.map(function (skill) {
      var entryUrl = artifactUrl(asset, skill.entry_path, artifactApi, aggregatorUrl);
      var caps = Array.isArray(skill.capabilities) ? skill.capabilities : [];
      var installCommand = liveSkillInstallCommand(skill);
      var objectId = skill.id || "";
      return '<div class="compact-skill-row">' +
        '<div class="compact-skill-main">' +
          '<strong>' + esc(skill.name || objectId || "Skill") + '</strong>' +
          '<p>' + esc(shortText(skill.description || "No skill description recorded.", 140, 28)) + '</p>' +
          (caps.length ? '<div class="compact-skill-tags">' + caps.slice(0, 5).map(function (cap) { return '<span class="tag">' + esc(cap) + '</span>'; }).join("") + (caps.length > 5 ? '<span class="muted">+' + (caps.length - 5) + '</span>' : '') + '</div>' : '') +
        '</div>' +
        '<div class="compact-skill-meta">' +
          (objectId ? '<code title="' + esc(objectId) + '">' + esc(shortText(objectId, 12, 10)) + '</code>' : '') +
          '<div class="compact-skill-actions">' +
            '<a href="/skills.html?q=' + encodeURIComponent(objectId || skill.name || "") + '">Open in Skills</a>' +
            (entryUrl ? '<a href="' + esc(entryUrl) + '" download>Download</a>' : '') +
          '</div>' +
          '<div class="compact-skill-install"><code>' + esc(installCommand) + '</code></div>' +
        '</div>' +
      '</div>';
    }).join("") + '</div>';
  }

  function liveSkillInstallCommand(skill) {
    return "research install " + String(skill && (skill.id || skill.name) || "skill");
  }

  function liveSkillEntries(assets) {
    var entries = [];
    (Array.isArray(assets) ? assets : []).forEach(function (asset) {
      (Array.isArray(asset.skills) ? asset.skills : []).forEach(function (skill) {
        entries.push({ asset: asset, skill: skill });
      });
    });
    return entries;
  }

  function liveSkillSearchText(entry) {
    var skill = entry.skill || {};
    var asset = entry.asset || {};
    return [
      skill.id,
      skill.manifest_id,
      skill.source_asset_id,
      skill.name,
      skill.description,
      Array.isArray(skill.capabilities) ? skill.capabilities.join(" ") : "",
      skill.relation,
      skill.access_visibility,
      asset.id,
      asset.title,
      asset.authors,
      asset.repo_url,
      asset.repo_commit
    ].join("\\n").toLowerCase();
  }

  function renderLiveSkillCatalogCard(entry, artifactApi, aggregatorUrl, suiExplorer) {
    var asset = entry.asset || {};
    var skill = entry.skill || {};
    var assetHref = asset.href || (asset.id ? "/asset.html?id=" + routeSegment(asset.id) : "");
    var entryUrl = artifactUrl(asset, skill.entry_path, artifactApi, aggregatorUrl);
    var installCommand = liveSkillInstallCommand(skill);
    var caps = Array.isArray(skill.capabilities) ? skill.capabilities : [];
    var state = liveProofState(asset);
    var repoText = asset.repo_url ? asset.repo_url.replace(/^https?:\\/\\/(www\\.)?github\\.com\\//, "") : "";
    var signer = asset.tx_sender || asset.event_owner_address || asset.creator_address || "";
    return '<article class="card live-skill-card live-skill-catalog-card">' +
      '<div class="dateline">Skill · ' + esc(skill.access_visibility || "public") + ' · ' + esc(skill.relation || "owned") + '</div>' +
      '<h3>' + esc(skill.name || skill.id || "Skill") + '</h3>' +
      '<p>' + esc(skill.description || "No skill description recorded.") + '</p>' +
      (caps.length ? '<div class="abs-tags">' + caps.slice(0, 8).map(function (cap) { return '<span class="tag">' + esc(cap) + '</span>'; }).join("") + '</div>' : '') +
      '<div class="copy-row"><code>' + esc(installCommand) + '</code><button class="copy-btn" type="button" data-copy="' + esc(installCommand) + '">copy</button></div>' +
      '<dl class="verification">' +
        '<div><dt>Skill object</dt><dd><code>' + esc(skill.id || "") + '</code></dd></div>' +
        '<div><dt>Manifest ID</dt><dd><code>' + esc(skill.manifest_id || "") + '</code></dd></div>' +
        '<div><dt>Source assert</dt><dd>' + (assetHref ? plainLink(assetHref, shortText(asset.title || asset.id || "Research Asset", 42, 14)) : esc(asset.title || asset.id || "Research Asset")) + '</dd></div>' +
        '<div><dt>Proof</dt><dd><span class="chain-status chain-status-' + (state.verified ? "verified" : "warning") + '">' + esc(state.label) + '</span></dd></div>' +
        '<div><dt>Repository</dt><dd>' + (asset.repo_url ? plainLink(asset.repo_url, repoText || shortText(asset.repo_url, 24, 12)) : '<span class="muted">not recorded</span>') + '</dd></div>' +
        '<div><dt>Signer</dt><dd>' + proofOrMuted(proofLink(suiExplorer, "account", signer)) + '</dd></div>' +
      '</dl>' +
      '<p>' +
        (assetHref ? '<a class="button" href="' + esc(assetHref) + '">Source Assert</a>' : '') +
        (entryUrl ? '<a class="button" href="' + esc(entryUrl) + '">Read SKILL.md</a>' : '') +
      '</p>' +
    '</article>';
  }

  function setupLiveSkillCatalog() {
    var root = document.querySelector("[data-live-skills]");
    var source = document.querySelector("[data-chain-source][data-chain-index-api]");
    if (!root || !source || !window.fetch) return;
    var input = root.querySelector("[data-live-skills-input]");
    var status = root.querySelector("[data-live-skills-status]");
    var results = root.querySelector("[data-live-skills-results]");
    var indexApi = source.getAttribute("data-chain-index-api") || "/api/index";
    var artifactApi = artifactApiFromIndex(indexApi);
    var aggregatorUrl = source.getAttribute("data-walrus-aggregator") || "";
    var suiExplorer = source.getAttribute("data-sui-explorer") || "https://suiscan.xyz/testnet";
    var limit = Math.max(1, Math.min(20, Number(root.getAttribute("data-live-skills-limit")) || 20));
    var indexUrl = indexApi + (indexApi.indexOf("?") === -1 ? "?" : "&") + "limit=" + encodeURIComponent(String(limit));
    var initialQuery = "";
    try { initialQuery = new URLSearchParams(location.search).get("q") || ""; } catch (err) {}
    if (input && initialQuery) input.value = initialQuery;
    var entries = [];
    var assetCount = 0;
    var resolvedManifestCount = 0;
    var missingManifestCount = 0;
    function render() {
      var q = input && input.value ? String(input.value).trim().toLowerCase() : "";
      var filtered = q ? entries.filter(function (entry) { return liveSkillSearchText(entry).indexOf(q) !== -1; }) : entries;
      if (status) {
        status.innerHTML = 'Found ' + filtered.length + ' skill(s) from ' + entries.length + ' live skill record(s) via ' + plainLink(indexUrl, "/api/index") +
          '. Live assets: ' + assetCount + '; resolved release manifests: ' + resolvedManifestCount + '; Walrus manifest misses: ' + missingManifestCount + '.';
      }
      if (results) {
        if (filtered.length) {
          results.innerHTML = '<div class="grid live-skill-grid live-skill-catalog-grid">' + filtered.map(function (entry) { return renderLiveSkillCatalogCard(entry, artifactApi, aggregatorUrl, suiExplorer); }).join("") + '</div>';
        } else if (assetCount && missingManifestCount) {
          results.innerHTML = '<p class="muted">The live index has Sui ResearchAssetPublished rows, but their Walrus release manifests could not be resolved from the testnet aggregator, so no installable skills can be shown yet.</p>';
        } else if (assetCount) {
          results.innerHTML = '<p class="muted">The live index has research assets, but none of their resolved release manifests declare skills.</p>';
        } else {
          results.innerHTML = '<p class="muted">No live research assets were returned by the backend index.</p>';
        }
      }
      setupCopy();
    }
    if (status) status.innerHTML = 'Loading skill catalog from ' + plainLink(indexUrl, "/api/index") + '...';
    fetch(indexUrl, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("index API HTTP " + res.status);
      return res.json();
    }).then(function (data) {
      var assets = Array.isArray(data.assets) ? data.assets : [];
      assetCount = assets.length;
      resolvedManifestCount = assets.filter(function (asset) { return asset.release_manifest_status === "resolved" || (Array.isArray(asset.skills) && asset.skills.length); }).length;
      missingManifestCount = assets.filter(function (asset) { return asset.release_manifest_status === "unavailable"; }).length;
      entries = liveSkillEntries(assets);
      render();
      if (input) input.addEventListener("input", render);
    }).catch(function (err) {
      if (status) status.innerHTML = 'Could not load skill catalog from ' + plainLink(indexUrl, "/api/index") + ': ' + esc(err && err.message ? err.message : "request failed");
      if (results) results.innerHTML = '<p class="muted">Skills are intentionally loaded from the backend live index. Check <code>/api/index/health</code> if this stays empty.</p>';
    });
  }

  function proofOrMuted(html) {
    return html || '<span class="muted">not recorded</span>';
  }

  function setupLiveAssetDetail() {
    var root = document.querySelector("[data-live-asset-detail]");
    var source = document.querySelector("[data-chain-source][data-chain-index-api]");
    if (!root || !source || !window.fetch) return;
    var params = new URLSearchParams(location.search);
    var wanted = params.get("id") || params.get("object") || "";
    var indexApi = source.getAttribute("data-chain-index-api") || "/api/index";
    var artifactApi = artifactApiFromIndex(indexApi);
    var aggregatorUrl = source.getAttribute("data-walrus-aggregator") || "";
    var suiExplorer = source.getAttribute("data-sui-explorer") || "https://suiscan.xyz/testnet";
    var walrusExplorer = source.getAttribute("data-walrus-explorer") || "https://walruscan.com/testnet";
    var indexUrl = indexApi + (indexApi.indexOf("?") === -1 ? "?" : "&") + "limit=20";
    root.innerHTML = '<p class="muted">Loading the live research asset...</p>';
    fetch(indexUrl, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("index API HTTP " + res.status);
      return res.json();
    }).then(function (data) {
      var assets = Array.isArray(data.assets) ? data.assets : [];
      var asset = assets.find(function (item) {
        return routeSegment(item.id || "") === wanted || item.id === wanted || item.sui_object_id === wanted;
      }) || (wanted ? null : assets[0]);
      if (!asset) {
        root.innerHTML = '<p class="muted">No live research asset matched this URL.</p>';
        return;
      }
      var state = liveProofState(asset);
      var bundle = livePaperBundle(asset, artifactApi, aggregatorUrl);
      var types = Array.isArray(asset.types) && asset.types.length ? asset.types.join("; ") : "Research Asset";
      var tags = Array.isArray(asset.tags) ? asset.tags : [];
      var signer = asset.tx_sender || asset.event_owner_address || asset.creator_address || "";
      root.innerHTML =
        '<div class="abs-grid live-asset-paper">' +
          '<div class="abs-main">' +
            '<div class="dateline">[Live Sui testnet submission on ' + esc(formatMembershipDate(asset.created_at)) + ']</div>' +
            '<h1 class="abs-title">' + esc(asset.title || asset.id || "Research Asset") + '</h1>' +
            '<div class="abs-authors">' + esc(asset.authors || "Unknown") + '</div>' +
            '<div class="abs-tags">' + tags.map(function (tag) { return '<span class="tag">' + esc(tag) + '</span>'; }).join("") + '</div>' +
            renderLivePaperViewer(bundle.formats) +
            '<h2>Skills</h2>' +
            renderLiveSkills(asset, artifactApi, aggregatorUrl) +
          '</div>' +
          '<aside class="extra-services">' +
            '<div class="sidebar-section asset-sidebar-summary">' +
              '<h3>Abstract</h3>' +
              '<p>' + esc(asset.abstract || "No abstract recorded in this live release.") + '</p>' +
            '</div>' +
            '<div class="access-box">' +
              '<h2>Read & Download</h2>' +
              renderDownloadList(bundle.downloads) +
            '</div>' +
            '<div class="sidebar-section">' +
              '<h3>Research Asset</h3>' +
              '<dl class="verification asset-sidebar-record">' +
                '<div><dt>Subjects</dt><dd>' + esc(types) + '</dd></div>' +
                '<div><dt>Asset ID</dt><dd><code>' + esc(asset.id || asset.sui_object_id || "") + '</code></dd></div>' +
                '<div><dt>Repository</dt><dd>' + (asset.repo_url ? plainLink(asset.repo_url, shortText(asset.repo_url, 24, 16)) : '<span class="muted">not recorded</span>') + '</dd></div>' +
                '<div><dt>Commit</dt><dd>' + commitLink(asset.repo_url, asset.repo_commit) + '</dd></div>' +
                '<div><dt>Verification</dt><dd><span class="chain-status chain-status-' + (state.verified ? "verified" : "warning") + '">' + esc(state.label) + '</span> <span class="muted">' + esc(state.detail) + '</span></dd></div>' +
              '</dl>' +
            '</div>' +
            '<div class="sidebar-section">' +
              '<h3>Verifiable Record</h3>' +
              '<dl class="verification">' +
                '<div><dt>Sui object</dt><dd>' + proofOrMuted(proofLink(suiExplorer, "object", asset.sui_object_id)) + '</dd></div>' +
                '<div><dt>Sui tx</dt><dd>' + proofOrMuted(proofLink(suiExplorer, "tx", asset.tx_digest)) + '</dd></div>' +
                '<div><dt>Walrus blob</dt><dd>' + proofOrMuted(proofBlobLink(walrusExplorer, asset.walrus_blob_id)) + '</dd></div>' +
                '<div><dt>Signer</dt><dd>' + proofOrMuted(proofLink(suiExplorer, "account", signer)) + '</dd></div>' +
                '<div><dt>Gas owner</dt><dd>' + proofOrMuted(proofLink(suiExplorer, "account", asset.gas_owner || signer)) + '</dd></div>' +
                '<div><dt>Gas spent</dt><dd><code>' + esc(asset.sui_spent_mist || "not indexed") + '</code></dd></div>' +
                '<div><dt>Manifest</dt><dd><code title="' + esc(asset.manifest_hash || "") + '">' + esc(shortText(asset.manifest_hash || "", 18, 12)) + '</code></dd></div>' +
              '</dl>' +
            '</div>' +
          '</aside>' +
        '</div>';
      setupPaperViewer();
      renderLiveArtifactPanels(root, asset);
      setupPdfRender();
    }).catch(function (err) {
      root.innerHTML = '<p class="muted">Could not load the live research asset: ' + esc(err && err.message ? err.message : "request failed") + '</p>';
    });
  }

  function renderDelegationLiveRow(event, index, suiExplorer) {
    var actor = event.buyer || event.agent || event.arbitrator || event.signer || "";
    var value = event.budget_mist ? formatSuiAmount(event.budget_mist) : event.amount_mist ? formatSuiAmount(event.amount_mist) : "event only";
    var parties = [
      event.buyer ? "buyer " + shortText(event.buyer, 8, 6) : "",
      event.agent ? "agent " + shortText(event.agent, 8, 6) : "",
      event.arbitrator ? "arb " + shortText(event.arbitrator, 8, 6) : "",
      event.report_id ? "report " + shortText(event.report_id, 8, 6) : ""
    ].filter(Boolean).join(" · ");
    return '<tr>' +
      '<td><div class="membership-event-name">' + esc(event.event_type || "DelegationEvent") + '</div><div class="muted">[' + (index + 1) + '] ' + esc(formatMembershipDate(event.created_at)) + '</div></td>' +
      '<td><div class="mono">' + (event.job_id ? proofLabelLink(suiExplorer, "object", event.job_id, shortText(event.job_id, 12, 10)) : "event only") + '</div><div class="muted">' + esc(parties || "delegation event") + '</div></td>' +
      '<td><div>' + esc(value) + '</div><div class="muted">' + (event.deadline_at ? "deadline " + esc(formatMembershipDate(event.deadline_at)) : "") + '</div></td>' +
      '<td><div class="mono">tx: ' + proofLabelLink(suiExplorer, "tx", event.tx_digest, shortText(event.tx_digest, 12, 10)) + '</div><div class="mono">signer: ' + proofLabelLink(suiExplorer, "account", actor, shortText(actor, 8, 6)) + '</div><div class="muted">gas ' + esc(formatSuiAmount(event.sui_spent_mist)) + '</div></td>' +
    '</tr>';
  }

  function delegationEventRail(eventTypes) {
    var types = Array.isArray(eventTypes) ? eventTypes : [];
    if (!types.length) return "";
    return '<div class="live-event-rail">' + types.map(function (type) {
      var name = String(type || "").split("::").pop() || String(type || "");
      return '<span class="live-event-chip" title="' + esc(type) + '">' + esc(name) + '</span>';
    }).join("") + '</div>';
  }

  function setupDelegationIndex() {
    var root = document.querySelector("[data-live-delegations]");
    var source = document.querySelector("[data-chain-source][data-chain-index-api]");
    if (!root || !source || !window.fetch) return;
    var stats = root.querySelector("[data-live-delegation-stats]");
    var status = root.querySelector("[data-live-delegation-status]");
    var rows = root.querySelector("[data-live-delegation-rows]");
    var indexApi = source.getAttribute("data-chain-index-api") || "/api/index";
    var suiExplorer = source.getAttribute("data-sui-explorer") || "https://suiscan.xyz/testnet";
    var indexUrl = indexApi + (indexApi.indexOf("?") === -1 ? "?" : "&") + "limit=20";
    fetch(indexUrl, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("index API HTTP " + res.status);
      return res.json();
    }).then(function (data) {
      var delegations = data && data.delegations ? data.delegations : {};
      var counts = delegations.counts || {};
      var events = Array.isArray(delegations.recent_events) ? delegations.recent_events : [];
      var eventTypes = Array.isArray(delegations.event_types) ? delegations.event_types : [];
      var totalEvents = Number(counts.total_events || events.length || 0);
      var totalBudgetMist = events.reduce(function (sum, event) {
        var n = Number(event.budget_mist || event.amount_mist || 0);
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0);
      var latestEvent = events[0] && events[0].created_at ? formatMembershipDate(events[0].created_at).replace(" UTC", "") : "none";
      if (stats) {
        stats.innerHTML = totalEvents
          ? '<div class="stat"><b>' + Number(counts.created || 0) + '</b><span>Created</span></div>' +
            '<div class="stat"><b>' + esc(formatSuiAmount(totalBudgetMist)) + '</b><span>Budget seen</span></div>' +
            '<div class="stat"><b>' + esc(latestEvent.slice(5, 16)) + '</b><span>Latest</span></div>' +
            '<div class="stat"><b>' + totalEvents + '</b><span>Live events</span></div>'
          : '<div class="live-empty-card">' +
              '<strong>No live delegation jobs yet</strong>' +
              '<p>The backend queried Sui testnet for this package and found no delegation events. This is a real empty chain state, not a local fixture.</p>' +
              delegationEventRail(eventTypes) +
            '</div>';
      }
      if (status) {
        status.innerHTML = totalEvents
          ? 'Loaded ' + totalEvents + ' live delegation event(s) from ' + plainLink(indexUrl, "/api/index") + '.'
          : 'Checked ' + eventTypes.length + ' delegation event type(s) through ' + plainLink(indexUrl, "/api/index") + '.';
      }
      if (rows) {
        rows.innerHTML = events.length
          ? events.map(function (event, index) { return renderDelegationLiveRow(event, index, suiExplorer); }).join("")
          : '<tr><td colspan="4"><div class="live-empty-table"><strong>Ready for the first private research delegation.</strong><p class="muted">Create a job from the Workbench and the new Sui object, buyer, agent, budget, and tx digest will appear here after the live index refreshes.</p><p><a class="button" href="/workbench.html">Open Workbench</a></p></div></td></tr>';
      }
    }).catch(function (err) {
      if (stats) stats.innerHTML = '<div class="live-empty-card"><strong>Delegation index unavailable</strong><p>Delegation data is served only by the backend live index.</p></div>';
      if (status) status.innerHTML = 'Could not load live delegation data: ' + esc(err && err.message ? err.message : "request failed");
      if (rows) rows.innerHTML = '<tr><td colspan="4"><p class="muted">No fallback fixture delegation rows were rendered.</p></td></tr>';
    });
  }

  function setupLiveDashboard() {
    var root = document.querySelector("[data-live-dashboard]");
    var source = document.querySelector("[data-chain-source][data-chain-index-api]");
    if (!root || !source || !window.fetch) return;
    var stats = root.querySelector("[data-live-dashboard-stats]");
    var status = root.querySelector("[data-live-dashboard-status]");
    var rows = root.querySelector("[data-live-dashboard-rows]");
    var indexApi = source.getAttribute("data-chain-index-api") || "/api/index";
    var sourceLimit = Number(source.getAttribute("data-chain-limit")) || 6;
    var limit = Math.max(1, Math.min(20, Number(root.getAttribute("data-live-dashboard-limit")) || sourceLimit));
    var suiExplorer = source.getAttribute("data-sui-explorer") || "https://suiscan.xyz/testnet";
    var walrusExplorer = source.getAttribute("data-walrus-explorer") || "https://walruscan.com/testnet";
    var indexUrl = indexApi + (indexApi.indexOf("?") === -1 ? "?" : "&") + "limit=" + encodeURIComponent(String(limit));
    root.setAttribute("aria-busy", "true");
    fetch(indexUrl, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("index API HTTP " + res.status);
      return res.json();
    }).then(function (data) {
      if (!data || data.source !== "live-sui-testnet+walrus-release-manifest") {
        throw new Error("index API did not return live source");
      }
      var assets = Array.isArray(data.assets) ? data.assets : [];
      var verified = assets.filter(function (asset) { return liveProofState(asset).verified; }).length;
      var repos = {};
      assets.forEach(function (asset) {
        if (asset.repo_url) repos[asset.repo_url] = true;
      });
      var storage = data.storage || {};
      var mode = data.serving_mode || (data.persisted ? "live-refresh-with-postgres" : "live-refresh-without-persistence");
      var storageLabel = storage.configured ? "Postgres persistence enabled" : "DB not bound: refreshed from Sui/Walrus on read";
      if (stats) {
        stats.innerHTML =
          '<div class="stat"><b>' + assets.length + '</b><span>Live assets</span></div>' +
          '<div class="stat"><b>' + verified + '</b><span>Verified proofs</span></div>' +
          '<div class="stat"><b>' + Object.keys(repos).length + '</b><span>Git repos</span></div>' +
          '<div class="stat"><b>' + esc(storage.configured ? "DB" : "Live") + '</b><span>Serving mode</span></div>';
      }
      if (status) {
        status.innerHTML = 'Loaded from ' + plainLink(indexUrl, "/api/index") +
          ' · generated ' + esc(String(data.generated_at || "now").replace("T", " ").slice(0, 19)) +
          ' · package ' + proofLabelLink(suiExplorer, "object", data.package_id || source.getAttribute("data-chain-package"), shortText(data.package_id || source.getAttribute("data-chain-package"), 12, 10)) +
          ' · ' + esc(mode) + ' · ' + esc(storageLabel);
      }
      if (rows) {
        rows.innerHTML = assets.length
          ? assets.map(function (asset, index) { return renderDashboardLiveRow(asset, index, suiExplorer, walrusExplorer); }).join("")
          : '<tr><td colspan="4"><p class="muted">/api/index returned no live ResearchAssetPublished rows for this package.</p></td></tr>';
      }
      root.setAttribute("aria-busy", "false");
    }).catch(function (err) {
      root.setAttribute("aria-busy", "false");
      if (stats) {
        stats.innerHTML = '<div class="stat"><b>0</b><span>Live assets</span></div><div class="stat"><b>API</b><span>Unavailable</span></div>';
      }
      if (status) {
        status.innerHTML = 'Could not load ' + plainLink(indexUrl, "/api/index") + ': ' + esc(err && err.message ? err.message : "request failed");
      }
      if (rows) {
        rows.innerHTML = '<tr><td colspan="4"><p class="muted">Dashboard data is intentionally served only by the backend live index. Check <code>/api/index/health</code> and Vercel Function logs.</p></td></tr>';
      }
    });
  }

  function appendOnChainSubmissionEntry(listing, input, position) {
    var event = input.event;
    var objectData = input.objectData;
    var txData = input.txData;
    var packageId = input.packageId;
    var suiExplorer = input.suiExplorer;
    var walrusExplorer = input.walrusExplorer;
    var parsed = event.parsedJson || {};
    var fields = objectData && objectData.content && objectData.content.fields ? objectData.content.fields : {};
    var txDigest = event.id && event.id.txDigest ? event.id.txDigest : "";
    var objectId = String(parsed.asset_id || "");
    var eventOwner = String(parsed.owner || parsed.creator || "").toLowerCase();
    var objectOwner = objectData && objectData.owner && objectData.owner.AddressOwner ? String(objectData.owner.AddressOwner).toLowerCase() : "";
    var eventBlob = bytesToString(parsed.walrus_blob_id);
    var objectBlob = bytesToString(fields.walrus_blob_id);
    var eventManifest = bytesToString(parsed.manifest_hash);
    var objectManifest = bytesToString(fields.manifest_hash);
    var repoCommit = bytesToString(parsed.repo_commit);
    var metadata = input.metadataByManifest && eventManifest ? input.metadataByManifest[eventManifest] : null;
    var expectedType = packageId + "::research_asset::ResearchAsset";
    var txOk = Boolean(txData && txData.effects && txData.effects.status && txData.effects.status.status === "success");
    var typeOk = Boolean(objectData && objectData.type === expectedType);
    var ownerOk = Boolean(objectOwner && eventOwner && objectOwner === eventOwner);
    var blobOk = Boolean(eventBlob && objectBlob && eventBlob === objectBlob);
    var manifestOk = Boolean(eventManifest && objectManifest && eventManifest === objectManifest);
    var statusClass = "warning";
    var statusLabel = "Live mismatch";
    var statusDetail = "";
    if (txOk && typeOk && ownerOk && blobOk && manifestOk) {
      statusClass = "verified";
      statusLabel = "Live verified";
      statusDetail = "event, tx, object, blob and manifest agree";
    } else {
      var missing = [];
      if (!txOk) missing.push("tx");
      if (!typeOk) missing.push("type");
      if (!ownerOk) missing.push("owner");
      if (!blobOk) missing.push("blob");
      if (!manifestOk) missing.push("manifest");
      statusDetail = missing.join(", ");
    }
    var created = proofDate(parsed.created_ms || fields.created_ms);
    var version = String(parsed.version || fields.version || "?");
    var mask = String(parsed.asset_type_mask || fields.asset_type_mask || "?");
    var title = metadata && metadata.title ? String(metadata.title) : "On-chain Research Asset v" + version;
    var titleHtml = metadata && metadata.href ? plainLink(metadata.href, title) : proofLabelLink(suiExplorer, "object", objectId, title);
    var authorsHtml = metadata && metadata.authors ? esc(String(metadata.authors)) : "Owner " + proofLink(suiExplorer, "account", eventOwner);
    var types = metadata && Array.isArray(metadata.types) && metadata.types.length ? metadata.types : ["sui-testnet"];
    var tags = metadata && Array.isArray(metadata.tags) ? metadata.tags : [];
    var subjects = '<span class="primary-subject">' + esc(types[0] || "sui-testnet") + '</span>' + types.slice(1).map(function (type) { return '; ' + esc(type); }).join("") + (tags.length ? ' &middot; ' + esc(tags.join(", ")) : "");
    var abstract = metadata && metadata.abstract ? String(metadata.abstract) : "This row is rendered from live ResearchAssetPublished events and cross-checked against the current Sui object, transaction effects, Walrus blob id, and manifest hash.";
    var metadataSource = metadata
      ? "Title, authors, abstract and repository are read from the Walrus release manifest addressed by the on-chain blob id; the release manifest hash matches this live Sui event."
      : "Sui stores the registry anchor, not title or abstract fields. Metadata will appear after the on-chain Walrus release manifest is available.";
    var dt = document.createElement("dt");
    var dd = document.createElement("dd");
    var actions = [
      proofLabelLink(suiExplorer, "object", objectId, "object"),
      proofLabelLink(suiExplorer, "tx", txDigest, "tx"),
      proofBlobLabelLink(walrusExplorer, eventBlob, "walrus"),
      metadata && metadata.href ? plainLink(metadata.href, "asset page") : ""
    ].filter(Boolean);
    dt.className = "chain-submission-entry";
    dd.className = "chain-submission-entry";
    dt.innerHTML = '<span class="list-identifier">[' + position + ']&nbsp;' + proofLabelLink(suiExplorer, "object", objectId, "ResearchAsset " + shortText(objectId, 8, 6)) + '</span> [' + actions.join(", ") + ']';
    dd.innerHTML =
      '<div class="list-title">' + titleHtml + '</div>' +
      '<div class="list-authors">' + authorsHtml + '</div>' +
      '<div class="list-subjects">' + subjects + '; asset_type_mask=' + esc(mask) + (created ? ' &middot; published ' + esc(created) + ' UTC' : '') + '</div>' +
      '<p class="chain-listing-note">' + esc(abstract) + '</p>' +
      '<p class="chain-source-note">' + esc(metadataSource) + '</p>' +
      '<div class="chain-proofline"><span class="chain-status chain-status-' + statusClass + '">' + esc(statusLabel) + '</span><span>' + esc(statusDetail) + '</span></div>' +
      '<dl class="chain-facts">' +
      '<div><dt>Sui object</dt><dd>' + proofLink(suiExplorer, "object", objectId) + '</dd></div>' +
      '<div><dt>Sui tx</dt><dd>' + proofLink(suiExplorer, "tx", txDigest) + '</dd></div>' +
      '<div><dt>Walrus blob</dt><dd>' + proofBlobLink(walrusExplorer, eventBlob) + '</dd></div>' +
      '<div><dt>Manifest hash</dt><dd><code title="' + esc(eventManifest) + '">' + esc(shortText(eventManifest, 18, 12)) + '</code></dd></div>' +
      '<div><dt>Content source</dt><dd>' + (metadata ? proofBlobLabelLink(walrusExplorer, eventBlob, "Walrus release manifest") + ' <span class="muted">matched by hash</span>' : '<span class="muted">Sui anchor only</span>') + '</dd></div>' +
      (metadata && metadata.repo_url ? '<div><dt>Repository</dt><dd>' + plainLink(metadata.repo_url, metadata.repo_url) + '</dd></div>' : '') +
      '<div><dt>Repo commit</dt><dd>' + commitLink(metadata && metadata.repo_url ? metadata.repo_url : input.protocolRepo, repoCommit || (metadata && metadata.repo_commit)) + '</dd></div>' +
      '<div><dt>Package</dt><dd>' + proofLink(suiExplorer, "object", packageId) + '</dd></div>' +
      '</dl>';
    listing.appendChild(dt);
    listing.appendChild(dd);
  }

  function setupChainSubmissions() {
    var source = document.querySelector("[data-chain-source][data-chain-rpc][data-chain-package]");
    var listing = document.querySelector("[data-chain-submissions]");
    if (!source || !listing || !window.fetch) return;
    var indexApi = source.getAttribute("data-chain-index-api") || "/api/index";
    var rpcUrl = source.getAttribute("data-chain-rpc");
    var packageId = source.getAttribute("data-chain-package");
    var eventType = source.getAttribute("data-chain-event-type") || (packageId + "::research_asset::ResearchAssetPublished");
    var limit = Math.max(1, Math.min(20, Number(source.getAttribute("data-chain-limit")) || 6));
    var suiExplorer = source.getAttribute("data-sui-explorer") || "https://suiscan.xyz/testnet";
    var walrusExplorer = source.getAttribute("data-walrus-explorer") || "https://walruscan.com/testnet";
    var walrusAggregator = source.getAttribute("data-walrus-aggregator") || "https://aggregator.walrus-testnet.walrus.space";
    var protocolRepo = source.getAttribute("data-protocol-repo") || "";
    if (!rpcUrl || !packageId) return;
    listing.setAttribute("aria-busy", "true");

    function renderFromLiveIndex(data) {
      var assets = data && Array.isArray(data.assets) ? data.assets : [];
      if (!assets.length) {
        listing.setAttribute("aria-busy", "false");
        listing.innerHTML = '<dt><span class="list-identifier">No live submissions found</span></dt><dd><p class="muted">The live index API returned no ResearchAssetPublished assets for the configured package.</p></dd>';
        notifyListingsUpdated();
        return;
      }
      listing.innerHTML = "";
      listing.setAttribute("aria-busy", "false");
      assets.forEach(function (asset, index) {
        appendLiveIndexEntry(listing, asset, index + 1, suiExplorer, walrusExplorer);
      });
      notifyListingsUpdated();
    }

    function loadDirectFromChain() {
    rpcCall(rpcUrl, "suix_queryEvents", [{ MoveEventType: eventType }, null, limit, true]).then(function (page) {
      var events = (page && page.data ? page.data : []).filter(function (event) {
        return event && event.id && event.id.txDigest && event.parsedJson && event.parsedJson.asset_id;
      });
      if (!events.length) {
        listing.setAttribute("aria-busy", "false");
        listing.innerHTML = '<dt><span class="list-identifier">No live submissions found</span></dt><dd><p class="muted">Sui RPC returned no ResearchAssetPublished events for the configured package.</p></dd>';
        notifyListingsUpdated();
        return null;
      }
      var objectIds = events.map(function (event) { return event.parsedJson.asset_id; });
      var txDigests = events.map(function (event) { return event.id.txDigest; });
      return Promise.all([
        rpcCall(rpcUrl, "sui_multiGetObjects", [objectIds, { showType: true, showOwner: true, showContent: true }]),
        rpcCall(rpcUrl, "sui_multiGetTransactionBlocks", [txDigests, { showEffects: true, showEvents: true }]),
        Promise.all(events.map(function (event) {
          var parsed = event.parsedJson || {};
          return fetchWalrusReleaseMetadata({
            aggregatorUrl: walrusAggregator,
            blobId: bytesToString(parsed.walrus_blob_id),
            manifestHash: bytesToString(parsed.manifest_hash),
            repo_commit: bytesToString(parsed.repo_commit),
            created_at: proofDate(parsed.created_ms),
            version: String(parsed.version || ""),
            walrus_blob_id: bytesToString(parsed.walrus_blob_id),
            manifest_hash: bytesToString(parsed.manifest_hash),
            sui_object_id: String(parsed.asset_id || ""),
            tx_digest: event.id && event.id.txDigest ? event.id.txDigest : ""
          });
        }))
      ]).then(function (results) {
      var objectById = {};
      (results[0] || []).forEach(function (entry) {
        if (entry && entry.data && entry.data.objectId) objectById[entry.data.objectId] = entry.data;
      });
      var txByDigest = {};
      (results[1] || []).forEach(function (entry) {
        if (entry && entry.digest) txByDigest[entry.digest] = entry;
      });
        var metadataByManifest = {};
        (results[2] || []).forEach(function (metadata) {
          if (metadata && metadata.manifest_hash) metadataByManifest[metadata.manifest_hash] = metadata;
        });
        listing.innerHTML = "";
        listing.setAttribute("aria-busy", "false");
        events.forEach(function (event, index) {
          appendOnChainSubmissionEntry(listing, {
            event: event,
            objectData: objectById[event.parsedJson.asset_id],
            txData: txByDigest[event.id.txDigest],
            packageId: packageId,
            suiExplorer: suiExplorer,
            walrusExplorer: walrusExplorer,
            protocolRepo: protocolRepo,
            metadataByManifest: metadataByManifest
          }, index + 1);
        });
        notifyListingsUpdated();
      });
    }).catch(function (err) {
      listing.setAttribute("aria-busy", "false");
      listing.innerHTML = '<dt><span class="list-identifier">Live submissions unavailable</span></dt><dd><p class="muted">Could not read Sui testnet right now: ' + esc(err && err.message ? err.message : "RPC error") + '</p></dd>';
      notifyListingsUpdated();
    });
    }

    var indexUrl = indexApi + (indexApi.indexOf("?") === -1 ? "?" : "&") + "limit=" + encodeURIComponent(String(limit));
    fetch(indexUrl, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("index API HTTP " + res.status);
      return res.json();
    }).then(function (data) {
      if (!data || data.source !== "live-sui-testnet+walrus-release-manifest") {
        throw new Error("index API did not return live source");
      }
      renderFromLiveIndex(data);
    }).catch(function () {
      loadDirectFromChain();
    });
  }

  function setupPaperViewer() {
    var root = document.querySelector("[data-paper-viewer]");
    if (!root) return;
    var tabs = Array.prototype.slice.call(root.querySelectorAll(".format-tab[href^='#']"));
    var panels = Array.prototype.slice.call(root.querySelectorAll(".format-panel"));
    function sync() {
      var hash = (location.hash || "").replace("#", "");
      var active = hash;
      if (!active || !document.getElementById(active)) {
        var def = root.querySelector(".format-panel-default");
        active = def ? def.id : panels[0] && panels[0].id;
      }
      tabs.forEach(function (tab) {
        var href = tab.getAttribute("href") || "";
        tab.classList.toggle("is-active", href === "#" + active);
      });
      panels.forEach(function (panel) {
        var on = panel.id === active;
        panel.classList.toggle("is-active", on);
      });
      if (active === "pdf") setupPdfRender();
    }
    window.addEventListener("hashchange", sync);
    sync();
  }

  var PDFJS_VERSION = "${PDFJS_VERSION}";
  var PDFJS_BASE = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/" + PDFJS_VERSION;
  var PDFJS_SCRIPT_INTEGRITY = "${PDFJS_SCRIPT_INTEGRITY}";
  var pdfJsLoadPromise = null;

  function loadPdfJs() {
    if (pdfJsLoadPromise) return pdfJsLoadPromise;
    pdfJsLoadPromise = new Promise(function (resolve, reject) {
      if (window.pdfjsLib) { resolve(window.pdfjsLib); return; }
      var s = document.createElement("script");
      s.src = PDFJS_BASE + "/pdf.min.js";
      s.integrity = PDFJS_SCRIPT_INTEGRITY;
      s.crossOrigin = "anonymous";
      s.onload = function () {
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + "/pdf.worker.min.js";
          resolve(window.pdfjsLib);
        } else { reject(new Error("pdf.js missing")); }
      };
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return pdfJsLoadPromise;
  }

  function setupPdfRender() {
    var viewers = Array.prototype.slice.call(document.querySelectorAll(".pdfjs-viewer:not([data-rendered])"));
    if (!viewers.length) return;
    viewers.forEach(function (viewer) {
      viewer.setAttribute("data-rendered", "true");
    });
    loadPdfJs().then(function (pdfjsLib) {
      viewers.forEach(function (viewer) {
        var url = viewer.getAttribute("data-pdf-url");
        var pagesRoot = viewer.querySelector(".pdfjs-pages");
        if (!url || !pagesRoot || pagesRoot.querySelector("canvas")) return;
        pagesRoot.innerHTML = '<p class="pdfjs-loading">Rendering PDF pages…</p>';
        pdfjsLib.getDocument(url).promise.then(function (pdf) {
          pagesRoot.innerHTML = "";
          var width = Math.min(720, pagesRoot.clientWidth || viewer.clientWidth || 720) - 8;
          var chain = Promise.resolve();
          for (var p = 1; p <= pdf.numPages; p += 1) {
            (function (pageNum) {
              chain = chain.then(function () { return pdf.getPage(pageNum); }).then(function (page) {
                var base = page.getViewport({ scale: 1 });
                var scale = width / base.width;
                var viewport = page.getViewport({ scale: scale });
                var canvas = document.createElement("canvas");
                canvas.className = "pdfjs-page";
                var ctx = canvas.getContext("2d");
                canvas.height = viewport.height;
                canvas.width = viewport.width;
                pagesRoot.appendChild(canvas);
                return page.render({ canvasContext: ctx, viewport: viewport }).promise;
              });
            })(p);
          }
          return chain;
        }).catch(function () {
          pagesRoot.innerHTML = '<p class="pdfjs-loading">Could not render preview. <a href="' + url + '">Download PDF</a></p>';
        });
      });
    }).catch(function () { /* pdf.js unavailable */ });
  }

  function init() {
    setupCopy();
    setupBuildStatus();
    setupFilter();
    setupChainSubmissions();
    setupLiveDashboard();
    setupMembershipIndex();
    setupDelegationIndex();
    setupLiveSearch();
    setupLiveSkillCatalog();
    setupLiveAssetDetail();
    setupPaperViewer();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }
})();
`;

export interface BuildStaticWebOptions {
  publicLiveOnly?: boolean;
}

export async function buildStaticWeb(outputDir = WEB_DIST_DIR, localnetRoot?: string, options: BuildStaticWebOptions = {}): Promise<string> {
  const index = await readIndex(localnetRoot);
  const resolvedLocalnetRoot = localnetRoot ?? DEFAULT_LOCALNET_DIR;
  const explorer = loadExplorerConfig();
  const onChainProofConfig = loadOnChainProofConfig();
  const publicLiveOnly = Boolean(options.publicLiveOnly);
  const walrusSitesResources = await readExistingWalrusSitesResources(outputDir);
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(path.join(outputDir, "abs"), { recursive: true });
  await fs.mkdir(path.join(outputDir, "skill"), { recursive: true });
  if (walrusSitesResources) {
    await fs.writeFile(path.join(outputDir, "ws-resources.json"), walrusSitesResources, "utf8");
  }

  await fs.writeFile(path.join(outputDir, "styles.css"), STYLES_CSS, "utf8");
  await fs.writeFile(path.join(outputDir, "site.js"), SITE_JS, "utf8");
  await fs.writeFile(path.join(outputDir, "build-info.json"), JSON.stringify(buildInfo(), null, 2) + "\n", "utf8");
  await fs.writeFile(path.join(outputDir, "workbench.js"), WORKBENCH_JS, "utf8");

  const assets = publicLiveOnly ? [] : Object.values(index.assets);
  const skills = publicLiveOnly ? [] : Object.values(index.skills);

  const searchBody = publicLiveOnly ? `
${renderChainSubmissionSource(onChainProofConfig, explorer)}
<section data-live-search data-live-search-limit="20" aria-live="polite">
  <p class="muted">Search is loaded from the backend live index. It reads Sui <code>ResearchAssetPublished</code> events, verifies the referenced object and Walrus release manifest, then filters the live rows.</p>
  <div class="search-box"><input data-live-search-input type="search" placeholder="Filter live assets, authors, tags&hellip;" autocomplete="off"></div>
  <p class="chain-source-note" data-live-search-status>Loading live search from <code>/api/index</code>...</p>
  <div data-live-search-results><p class="muted">Loading live results...</p></div>
</section>` : `
<p class="muted">Static search snapshot generated from the local index. Filtering runs entirely in your browser.</p>
<div class="search-box"><input id="filter" type="search" placeholder="Filter assets, skills, tags&hellip;" autocomplete="off"></div>
${Object.values(index.search_documents).map((document) => `<a class="result" href="${document.entity_type === "asset" ? escapeHtml(webPath("abs", `${routeSegment(document.entity_id)}.html`)) : document.entity_type === "skill" ? escapeHtml(webPath("skill", `${routeSegment(document.entity_id)}.html`)) : "#"}"><strong>${escapeHtml(document.title)}</strong><br><span class="muted">${escapeHtml(document.entity_type)} &middot; ${escapeHtml(document.tags.join(", "))}</span></a>`).join("")}`;
  await fs.writeFile(path.join(outputDir, "search.html"), shell("Search", searchBody, { subject: "Search" }), "utf8");

  const skillsBody = publicLiveOnly ? `
${renderChainSubmissionSource(onChainProofConfig, explorer)}
<section data-live-skills data-live-skills-limit="20" aria-live="polite">
  <p class="muted">Find installable agent skills from live research assets. The catalog is resolved through <code>/api/index</code>, so each result keeps its source asset, Sui proof, Walrus release, repository, and commit attached.</p>
  <div class="search-box"><input data-live-skills-input type="search" placeholder="Search skills, capabilities, source assets, repos&hellip;" autocomplete="off"></div>
  <p class="chain-source-note" data-live-skills-status>Loading skill catalog from <code>/api/index</code>...</p>
  <div data-live-skills-results><p class="muted">Loading live skills...</p></div>
</section>` : `
<p class="muted">Installable skills indexed from the local workspace snapshot.</p>
<div class="grid live-skill-grid">
${skills.map((skill) => {
  const installCommand = `research install ${skill.id}`;
  return `<article class="card live-skill-card"><h3><a href="${escapeHtml(webPath("skill", `${routeSegment(skill.id)}.html`))}">${escapeHtml(skill.name)}</a></h3><p>${escapeHtml(skill.description)}</p><div>${skill.manifest.capabilities.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div><div class="copy-row"><code>${escapeHtml(installCommand)}</code><button class="copy-btn" type="button" data-copy="${escapeHtml(installCommand)}">copy</button></div></article>`;
}).join("")}
</div>`;
  await fs.writeFile(path.join(outputDir, "skills.html"), shell("Skills", skillsBody, { subject: "Find Skills" }), "utf8");

  const reports = Object.values(index.reports);
  const delegations = publicLiveOnly ? [] : Object.values(index.delegations);
  const delegationRows = delegations
    .map((job) => `<tr><td>${escapeHtml(job.id)}</td><td>${escapeHtml(job.status)}</td><td>${escapeHtml(job.buyer)}</td><td>${escapeHtml(job.agent)}</td><td>${job.budget}</td></tr>`)
    .join("");

  const dashboardBody = `
${renderChainSubmissionSource(onChainProofConfig, explorer)}
<section class="live-dashboard" data-live-dashboard data-live-dashboard-limit="20" aria-live="polite" aria-busy="true">
  <div class="live-dashboard-head">
    <h2>Live Index Events</h2>
    <span class="live-dashboard-api"><a href="/api/index?limit=20" rel="noopener">/api/index?limit=20</a></span>
  </div>
  <p class="chain-listing-note">Dashboard rows are loaded from the backend index. The Function reads Sui <code>ResearchAssetPublished</code> events, verifies Sui object and transaction state, resolves the Walrus release manifest, then returns repository and commit metadata for the UI.</p>
  <div class="stats" data-live-dashboard-stats>
    <div class="stat"><b>...</b><span>Live assets</span></div>
    <div class="stat"><b>...</b><span>Verified proofs</span></div>
    <div class="stat"><b>...</b><span>Git repos</span></div>
    <div class="stat"><b>API</b><span>Serving mode</span></div>
  </div>
  <p class="chain-source-note" data-live-dashboard-status>Loading live backend index from <code>/api/index</code>...</p>
  <table class="data-table events-table live-dashboard-table">
    <thead><tr><th>Research asset</th><th>Sui proof</th><th>Walrus content</th><th>Repository</th></tr></thead>
    <tbody data-live-dashboard-rows>
      <tr><td colspan="4"><p class="muted">Loading live Sui testnet assets through the backend index...</p></td></tr>
    </tbody>
  </table>
</section>`;
  await fs.writeFile(path.join(outputDir, "dashboard.html"), shell("Dashboard", dashboardBody, { subject: "Dashboard" }), "utf8");
  const membershipBody = `
${renderChainSubmissionSource(onChainProofConfig, explorer)}
<section class="live-dashboard" data-live-membership data-live-membership-limit="20" aria-live="polite" aria-busy="true">
  <div class="live-dashboard-head">
    <h2>Live Membership Rails</h2>
    <span class="live-dashboard-api"><a href="/api/index?limit=20" rel="noopener">/api/index?limit=20</a></span>
  </div>
  <p class="chain-listing-note">Membership rows are loaded from the backend live index. The Function checks Sui testnet access and settlement events for platform passes, agent subscriptions, access receipts, membership settlement, and agent claims. Fixture receipts are never rendered as public live data.</p>
  <div class="stats" data-live-membership-stats>
    <div class="stat"><b>...</b><span>Live passes</span></div>
    <div class="stat"><b>...</b><span>Live subscriptions</span></div>
    <div class="stat"><b>...</b><span>Live receipts</span></div>
    <div class="stat"><b>...</b><span>Membership events</span></div>
  </div>
  <p class="chain-source-note" data-live-membership-status>Loading live membership events from <code>/api/index</code>...</p>
  <table class="data-table events-table live-dashboard-table live-membership-table">
    <thead><tr><th>Event</th><th>Account</th><th>Object or amount</th><th>Sui proof</th></tr></thead>
    <tbody data-live-membership-rows>
      <tr><td colspan="4"><p class="muted">Loading membership, subscription, receipt, settlement, and claim events from Sui testnet...</p></td></tr>
    </tbody>
  </table>
</section>`;
  await fs.writeFile(path.join(outputDir, "membership.html"), shell("Membership", membershipBody, { subject: "Membership" }), "utf8");
  const delegationsBody = publicLiveOnly ? `
${renderChainSubmissionSource(onChainProofConfig, explorer)}
<section class="live-dashboard" data-live-delegations aria-live="polite" aria-busy="true">
  <div class="live-dashboard-head">
    <h2>Live Delegation Rails</h2>
    <span class="live-dashboard-api"><a href="/api/index?limit=20" rel="noopener">/api/index?limit=20</a></span>
  </div>
  <p class="chain-listing-note">Delegation rows are loaded from the backend live index. The Function checks Sui testnet delegation events for creation, funding, submission, completion, refund, dispute, and resolution evidence. Local showcase delegation rows are not rendered as public data.</p>
  <div class="stats" data-live-delegation-stats>
    <div class="live-empty-card live-empty-card-loading">
      <strong>Checking live delegation rails...</strong>
      <p>The page is waiting for <code>/api/index</code> to return Sui testnet events.</p>
    </div>
  </div>
  <p class="chain-source-note" data-live-delegation-status>Loading live delegation events from <code>/api/index</code>...</p>
  <table class="data-table events-table live-dashboard-table live-membership-table">
    <thead><tr><th>Event</th><th>Job and parties</th><th>Value</th><th>Sui proof</th></tr></thead>
    <tbody data-live-delegation-rows>
      <tr><td colspan="4"><p class="muted">Loading live Sui testnet delegation events...</p></td></tr>
    </tbody>
  </table>
</section>` : `
<p class="muted">Private Delegation results are encrypted on Walrus and decryptable only by the buyer and agent, with temporary arbitration access during disputes.</p>
${delegationRows ? `<table class="data-table"><thead><tr><th>Job</th><th>Status</th><th>Buyer</th><th>Agent</th><th>Budget</th></tr></thead><tbody>${delegationRows}</tbody></table>` : `<p class="muted">No private delegation jobs indexed yet.</p>`}`;
  await fs.writeFile(path.join(outputDir, "delegations.html"), shell("Delegations", delegationsBody, { subject: "Delegations" }), "utf8");
  await fs.writeFile(path.join(outputDir, "workbench.html"), shell("Protocol Workbench", renderWorkbenchBody(index), { subject: "Protocol Workbench" }), "utf8");

  const assetDetailBody = `
${renderChainSubmissionSource(onChainProofConfig, explorer)}
<section data-live-asset-detail aria-live="polite">
  <p class="muted">Loading the live research asset...</p>
</section>`;
  await fs.writeFile(path.join(outputDir, "asset.html"), shell("Live Asset", assetDetailBody, { subject: "Live Asset", math: true }), "utf8");

  for (const asset of assets) {
    const seg = routeSegment(asset.id);
    const absHref = webPath("abs", `${seg}.html`);
    const paper = asset.manifest.assets.assets?.paper;
    const artifactSource = { localnetRoot: resolvedLocalnetRoot, walrusBlobId: asset.walrus_blob_id };
    const paperPdf = await copyPaperArtifact(outputDir, asset.id, asset.repo_url, paper?.path, artifactSource);
    const paperSource = await copyPaperArtifact(outputDir, asset.id, asset.repo_url, paper?.source, artifactSource);
    const paperSourceText = await readPaperSource(asset.repo_url, paper?.source, artifactSource);
    // Markdown rendering path (HANDOFF §2.4-1): paper.md declared as source, or repo-level
    // paper/paper.md + README.md picked up even when the manifest only knows LaTeX/PDF.
    const sourceIsMarkdown = Boolean(paper?.source?.endsWith(".md"));
    const paperMdText = sourceIsMarkdown ? paperSourceText : await readPaperSource(asset.repo_url, "paper/paper.md", artifactSource);
    const readmeText = await readPaperSource(asset.repo_url, "README.md", artifactSource);
    const assetAccess = asset.manifest.assets.access ?? {
      visibility: asset.manifest.assets.publish.visibility === "encrypted"
        ? "encrypted"
        : asset.manifest.assets.publish.visibility === "private_delegation"
          ? "private_delegation"
          : "public"
    };
    const assetReports = reports.filter((report) => report.asset_id === asset.id);
    const accessLabel = assetAccess.visibility === "private_delegation" ? "Private Delegation" : assetAccess.visibility[0].toUpperCase() + assetAccess.visibility.slice(1);
    const accessNote = assetAccess.visibility === "public"
      ? "Open research, no Seal decrypt required."
      : assetAccess.visibility === "encrypted"
        ? "Encrypted on Walrus; Seal unlocks for platform members or agent subscribers."
        : "Private delegation result; Seal unlocks only for buyer and agent unless dispute arbitration is authorized.";
    const authors = authorLine(asset.manifest.assets.authors);
    const typeLabel = asset.types.map((type) => type[0].toUpperCase() + type.slice(1)).join("; ");
    const primarySkill = asset.manifest.skills[0];
    const renderedFromTex = sourceIsMarkdown
      ? renderMarkdownPaper(paperSourceText, asset.title, authors)
      : renderPaperHtml(paperSourceText, asset.title, authors);
    const renderedFromMd = renderedFromTex.hasContent ? renderedFromTex : renderMarkdownPaper(paperMdText, asset.title, authors);
    const rendered = renderedFromMd.hasContent
      ? renderedFromMd
      : paperPdf
        ? renderMetadataHtml(asset.title, authors, asset.abstract, !paperSourceText)
        : renderedFromTex;
    const paperViewer = renderPaperViewer({
      paperPdf,
      paperSource,
      paperSourceLabel: paper?.source ?? (renderedFromMd !== renderedFromTex && renderedFromMd.hasContent ? "paper/paper.md" : undefined),
      paperSourceText: sourceIsMarkdown ? undefined : paperSourceText,
      rendered
    });
    const body = `
<div class="abs-grid">
  <div class="abs-main">
    <div class="dateline">[Submitted on ${escapeHtml(humanDate(asset.created_at))} (${escapeHtml(asset.version)})]</div>
    <h1 class="abs-title">${escapeHtml(asset.title)}</h1>
    <div class="abs-authors">${escapeHtml(authors)}</div>
    <blockquote class="abstract"><span class="descriptor">Abstract:</span> ${escapeHtml(asset.abstract)}</blockquote>
    <div class="abs-tags">${asset.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
    <div class="metatable"><table>
      <tr><td class="label">Subjects:</td><td>${escapeHtml(typeLabel)}</td></tr>
      <tr><td class="label">Access:</td><td>${escapeHtml(accessLabel)}</td></tr>
      ${assetAccess.seal_id ? `<tr><td class="label">Seal ID:</td><td><code>${escapeHtml(assetAccess.seal_id)}</code></td></tr>` : ""}
      <tr><td class="label">Cite as:</td><td><span class="arxiv-id">${escapeHtml(paperCode(asset.id))}</span></td></tr>
      <tr><td class="label">Asset ID:</td><td><code>${escapeHtml(asset.id)}</code></td></tr>
      <tr><td class="label">Submission history:</td><td>From ${escapeHtml(String(asset.manifest.assets.generated_by?.agent ?? "authoring process"))} &mdash; [${escapeHtml(asset.version)}] ${escapeHtml(humanDate(asset.created_at))}</td></tr>
    </table></div>

    ${paperViewer}

    ${readmeText ? `<h2>README</h2><div class="readme-box md-doc">${renderMarkdownBody(readmeText)}</div>` : ""}

    <h2>Skills</h2>
    <div class="compact-skill-list">${asset.manifest.skills.map((skill) => `<div class="compact-skill-row"><div class="compact-skill-main"><strong><a href="${escapeHtml(webPath("skill", `${routeSegment(skill.id)}.html`))}">${escapeHtml(skill.manifest.name)}</a></strong><p>${escapeHtml(skill.manifest.description)}</p><div class="compact-skill-tags">${skill.manifest.capabilities.slice(0, 5).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}${skill.manifest.capabilities.length > 5 ? `<span class="muted">+${skill.manifest.capabilities.length - 5}</span>` : ""}</div></div><div class="compact-skill-meta"><code title="${escapeHtml(skill.id)}">${escapeHtml(skill.id)}</code><div class="compact-skill-actions"><a href="${escapeHtml(webPath("skill", `${routeSegment(skill.id)}.html`))}">Open skill</a></div></div></div>`).join("") || "<p class=\"muted\">No skills declared.</p>"}</div>
  </div>
  <aside class="extra-services">
    <div class="access-box">
      <h2>Access Research:</h2>
      <ul>
        ${paperPdf ? `<li><a class="download-pdf" href="${escapeHtml(paperPdf)}">View PDF</a></li>` : `<li><span class="disabled">PDF unavailable</span></li>`}
        ${rendered.hasContent ? `<li><a href="#paper">HTML (rendered)</a></li>` : paperPdf ? `<li><a href="#pdf">PDF preview</a></li>` : `<li><span class="disabled">HTML unavailable</span></li>`}
        ${paperSourceText ? `<li><a href="#tex">TeX Source</a></li>` : paperSource ? `<li><a href="${escapeHtml(paperSource)}" download>TeX Source</a></li>` : ""}
        ${repoLink(asset.repo_url)}
      </ul>
      <p class="muted">${escapeHtml(accessNote)}</p>
      ${assetReports.length ? `<h3>Research reports</h3>${renderAssetReports(assetReports, explorer)}` : ""}
    </div>
    ${primarySkill ? `<div class="sidebar-section">
      <h3>Tools</h3>
      <ul class="small-list">
        <li><a href="${escapeHtml(webPath("skill", `${routeSegment(primarySkill.id)}.html`))}">Install Skill</a></li>
      </ul>
    </div>` : ""}
    <div class="sidebar-section">
      <h3>Verifiable Record</h3>
      ${verificationRows(
        { "Sui object": asset.sui_object_id, "Walrus blob": asset.walrus_blob_id, Manifest: asset.manifest_hash, "Content hash": asset.content_hash, Commit: asset.repo_commit },
        explorer,
        { "Sui object": "object", "Walrus blob": "walrus-blob" }
      )}
    </div>
    <div class="sidebar-section">
      <h3>Related</h3>
      <ul class="small-list">
        <li>Generated by: ${escapeHtml(String(asset.manifest.assets.generated_by?.agent ?? "authoring process"))}</li>
        <li>Derived from: ${escapeHtml(Array.isArray(asset.manifest.assets.derived_from) ? asset.manifest.assets.derived_from.length : 0)} assets</li>
      </ul>
    </div>
    <div class="sidebar-section">
      <h3>Export BibTeX Citation</h3>
      <pre class="cite-box">${escapeHtml(bibtexFor(asset))}</pre>
    </div>
  </aside>
</div>`;
    const subject = `${typeLabel.split(";")[0]} > ${paperCode(asset.id)}`;
    await fs.writeFile(
      path.join(outputDir, "abs", `${seg}.html`),
      shell(asset.title, body, { math: rendered.hasMath, subject }),
      "utf8"
    );
  }

  const homeBody = `
<p class="intro">An agent-native, decentralized research asset network. Papers, skills, datasets and code are authored in Git, snapshotted on Walrus, registered on Sui, and resolved back to their original source artifacts for humans and agents alike.</p>
<p class="stats-line">Live Sui ${escapeHtml(onChainProofConfig.network)} registry &middot; package ${explorerLink("object", onChainProofConfig.packageId, explorer)} &middot; event <code>ResearchAssetPublished</code></p>
<div class="search-box"><input id="filter" type="search" placeholder="Search titles, authors, tags&hellip;" autocomplete="off" aria-label="Search submissions"></div>
<h2>Recent submissions</h2>
${renderChainSubmissionSource(onChainProofConfig, explorer)}
<dl class="listing" data-chain-submissions aria-live="polite" aria-busy="true">
  <dt><span class="list-identifier">Loading live Sui testnet submissions</span></dt>
  <dd><p class="chain-listing-note">Reading <code>ResearchAssetPublished</code> anchors from Sui RPC, then resolving title and abstract from the Walrus release manifest referenced by each on-chain blob id.</p></dd>
</dl>`;
  await fs.writeFile(path.join(outputDir, "index.html"), shell("Home", homeBody, { subject: "Research Network" }), "utf8");

  // Account page (HANDOFF §2.4-5): session + GitHub binding live in the browser, so the page
  // ships a compact asset directory and resolves "my assets" client-side. In public live-only
  // builds, the directory is intentionally empty so local fixture assets are not presented as
  // indexed user publications.
  const assetDirectory: AccountDirectoryAsset[] = assets.map((asset) => ({
    id: asset.id,
    title: asset.title,
    href: webPath("abs", `${routeSegment(asset.id)}.html`),
    authors: authorLine(asset.manifest.assets.authors),
    githubs: (asset.manifest.assets.authors ?? [])
      .map((author) => author.github)
      .filter((github): github is string => Boolean(github)),
    created_at: asset.created_at,
    abstract: asset.abstract,
    types: asset.types,
    tags: asset.tags,
    manifest_hash: asset.manifest_hash,
    repo_url: asset.repo_url,
    repo_commit: asset.repo_commit
  }));
  await fs.writeFile(
    path.join(outputDir, "site-data.json"),
    JSON.stringify({ generated_at: new Date().toISOString(), assets: assetDirectory }, null, 2),
    "utf8"
  );
  await fs.writeFile(path.join(outputDir, "account.html"), renderAccountPage(assetDirectory), "utf8");

  for (const skill of skills) {
    const installCommand = `research install ${skill.id}`;
    const skillAccess = skill.access ?? { visibility: "public" };
    const body = `
<h1>${escapeHtml(skill.name)}</h1>
<p class="muted">${escapeHtml(skill.relation)} skill &middot; ${escapeHtml(skill.description)}</p>
<div>${skill.manifest.capabilities.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
<div class="copy-row"><code>${escapeHtml(installCommand)}</code><button class="copy-btn" type="button" data-copy="${escapeHtml(installCommand)}">copy</button></div>
<p><a class="button" href="${escapeHtml(webPath("abs", `${routeSegment(skill.source_asset_id)}.html`))}">Source asset</a><a class="button" href="/api/skills/${escapeHtml(routeSegment(skill.id))}/install">Install manifest</a></p>
<h2>Verification</h2>
${verificationRows(
  { "Skill ID": skill.id, "Sui object": skill.sui_object_id, "Walrus blob": skill.walrus_blob_id, "Access": skillAccess.visibility, "Manifest": skill.manifest_hash },
  explorer,
  { "Sui object": "object", "Walrus blob": "walrus-blob" }
)}
<h2>Manifest</h2>
<pre>${escapeHtml(JSON.stringify(skill.manifest, null, 2))}</pre>`;
    await fs.writeFile(path.join(outputDir, "skill", `${routeSegment(skill.id)}.html`), shell(skill.name, body, { subject: "Skill" }), "utf8");
  }

  return outputDir;
}
