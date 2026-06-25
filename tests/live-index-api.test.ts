import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { researchIndexApi } from "../src/api/index-service.js";

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_RN_INDEX_CRON_SECRET = process.env.RN_INDEX_CRON_SECRET;
const execFileAsync = promisify(execFile);

async function makeReleaseBlobWithTex(): Promise<Uint8Array> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rn-render-api-"));
  try {
    const releaseDir = path.join(root, "release");
    const tarPath = path.join(root, "release.tar");
    const archivePath = path.join(root, "release.tar.zst");
    await fs.mkdir(path.join(releaseDir, "paper"), { recursive: true });
    await fs.writeFile(path.join(releaseDir, "manifest.json"), JSON.stringify({
      schema: "research-asset-manifest/v0.1",
      title: "Loop Engine Research",
      assets: { id: "ra:test" },
      files: [
        { path: "manifest.json" },
        { path: "paper/main.tex" }
      ]
    }), "utf8");
    await fs.writeFile(path.join(releaseDir, "paper", "main.tex"), String.raw`
\documentclass{article}
\title{: Loop Engine Runtime Notes}
\author{Research Network}
\begin{document}
\maketitle
\begin{abstract}
Loop Engine coordinates agent runs, commit evidence, and chain-backed research assertions.
\end{abstract}
\section{Indexed Assertion}
The verified runtime state is $S_t = f(S_{t-1}, a_t)$, with repository evidence stored next to the on-chain object.
\end{document}
`, "utf8");
    await execFileAsync("tar", ["-cf", tarPath, "-C", releaseDir, "."]);
    await execFileAsync("zstd", ["-q", "-f", tarPath, "-o", archivePath]);
    return new Uint8Array(await fs.readFile(archivePath));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function serveWalrusBlob(blob: Uint8Array): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    if (request.url === "/v1/blobs/test-render-blob") {
      response.writeHead(200, { "content-type": "application/octet-stream" });
      response.end(Buffer.from(blob));
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("test Walrus server did not expose a TCP address");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server)
  };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

afterEach(() => {
  process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  process.env.RN_INDEX_CRON_SECRET = ORIGINAL_RN_INDEX_CRON_SECRET;
});

describe("live index Elysia API", () => {
  it("exposes OpenAPI routes for the query handler and ingest job", async () => {
    const response = await researchIndexApi.handle(new Request("http://127.0.0.1/api/index/openapi"));
    expect(response.status).toBe(200);
    const spec = await response.json() as { paths: Record<string, unknown> };
    expect(spec.paths["/api/index"]).toBeTruthy();
    expect(spec.paths["/api/index/artifact"]).toBeTruthy();
    expect(spec.paths["/api/index/skill/{id}"]).toBeTruthy();
    expect(spec.paths["/api/index/skill/{id}/content"]).toBeTruthy();
    expect(spec.paths["/api/index/ingest"]).toBeTruthy();
    expect(spec.paths["/api/index/health"]).toBeTruthy();
  });

  it("ships one Vercel catch-all entrypoint for Elysia subroutes", async () => {
    await expect(fs.access("api/index.ts")).resolves.toBeUndefined();
    await expect(fs.access("api/index/[...path].ts")).resolves.toBeUndefined();
    await expect(fs.access("api/index/skill/[id].ts")).resolves.toBeUndefined();
    await expect(fs.access("api/index/skill/[id]/content.ts")).resolves.toBeUndefined();
    await expect(fs.access("api/index/artifact.ts")).rejects.toBeTruthy();
    await expect(fs.access("api/index/ingest.ts")).rejects.toBeTruthy();
  });

  it("reports database configuration without requiring a live ingest", async () => {
    const response = await researchIndexApi.handle(new Request("http://127.0.0.1/api/index/health"));
    expect(response.status).toBe(200);
    const body = await response.json() as { ok: boolean; storage: { provider: string } };
    expect(body.ok).toBe(true);
    expect(body.storage.provider).toBe("vercel-postgres");
  });

  it("tolerates Vercel catch-all query params on index subroutes", async () => {
    const response = await researchIndexApi.handle(new Request("http://127.0.0.1/api/index/persisted?...path=persisted"));
    expect(response.status).toBe(200);
    const body = await response.json() as { source: string; assets: unknown[] };
    expect(body.source).toBe("live-sui-testnet+walrus-release-manifest");
    expect(Array.isArray(body.assets)).toBe(true);
  });

  it("protects the Cron-compatible ingest job when a secret is configured", async () => {
    process.env.RN_INDEX_CRON_SECRET = "test-secret";
    const response = await researchIndexApi.handle(new Request("http://127.0.0.1/api/index/ingest"));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: "unauthorized_index_job"
    });
  });

  it("renders a live Walrus LaTeX artifact through make4ht", async () => {
    const blob = await makeReleaseBlobWithTex();
    const walrus = await serveWalrusBlob(blob);
    try {
      const response = await researchIndexApi.handle(new Request(
        `http://127.0.0.1/api/index/artifact/render?format=html&blob=test-render-blob&path=paper/main.tex&aggregator=${encodeURIComponent(walrus.url)}`
      ));
      expect(response.status).toBe(200);
      expect(response.headers.get("x-research-renderer")).toBe("make4ht");
      expect(response.headers.get("content-type")).toContain("text/html");
      const html = await response.text();
      expect(html).toContain("Loop Engine Runtime Notes");
      expect(html).toContain("Indexed Assertion");
      expect(html.replace(/\s+/g, " ")).toContain("chain-backed research assertions");
      expect(html).not.toContain("Missing superscript or subscript argument");
      expect(html).not.toContain("mjx-container");
    } finally {
      await walrus.close();
    }
  });
});
