import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildStaticWeb,
  initPdfOnlyWorkspace,
  initWorkspace,
  publishWorkspace,
  replayIndexer
} from "../src/index.js";
import { routeSegment } from "../src/core/web.js";
import { serveStaticSite } from "../src/core/web-serve.js";

let tempRoot: string;

async function makeTempDir(name: string) {
  const dir = path.join(tempRoot, name);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function sitePath(serverUrl: string, routePath: string): string {
  return `${serverUrl}/${routePath.replace(/^\//, "")}`;
}

describe("static web E2E", () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "research-web-e2e-"));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("builds, serves, and returns all key routes with expected content", async () => {
    const workspace = await initWorkspace({
      target: await makeTempDir("workspace"),
      title: "E2E Test Paper",
      author: "E2E Agent",
      agentId: "agent:e2e",
      force: true
    });
    const localnet = path.join(tempRoot, "localnet");
    const published = await publishWorkspace(workspace, localnet);
    await replayIndexer({ localnetRoot: localnet });
    const siteDir = path.join(tempRoot, "site");
    await buildStaticWeb(siteDir, localnet);

    const assetSeg = routeSegment(published.sui.assetId);
    const server = await serveStaticSite(siteDir, 0);
    try {
      const routes: Array<{ path: string; expect: RegExp | string }> = [
        { path: "/", expect: /Recent submissions|E2E Test Paper/ },
        { path: "/index.html", expect: /logo-chi/ },
        { path: "/search.html", expect: /Filter assets, skills/ },
        { path: "/dashboard.html", expect: /Events/ },
        { path: "/licenses.html", expect: /Licenses/ },
        { path: "/styles.css", expect: /--arxiv-red/ },
        { path: "/site.js", expect: /setupPaperViewer/ },
        { path: `/abs/${assetSeg}.html`, expect: /format-nav/ },
        { path: `/abs/${assetSeg}.html`, expect: /format-nav/ },
        { path: `/abs/${assetSeg}.html`, expect: /pdfjs-viewer/ },
        { path: `/abs/${assetSeg}.html`, expect: /id="tex"/ },
        { path: `/abs/${assetSeg}.html`, expect: /tex-source/ },
        { path: `/paper/${assetSeg}/main.pdf`, expect: "%PDF" },
        { path: `/paper/${assetSeg}/main.tex`, expect: /\\documentclass/ },
        { path: `/graph/${assetSeg}.html`, expect: /graph-canvas/ }
      ];

      for (const route of routes) {
        const response = await fetch(sitePath(server.url, route.path));
        expect(response.status, `${route.path} should return 200`).toBe(200);
        const body = await response.text();
        if (route.expect instanceof RegExp) {
          expect(body, `${route.path} body`).toMatch(route.expect);
        } else {
          expect(body, `${route.path} body`).toContain(route.expect);
        }
      }

      const indexHtml = await (await fetch(sitePath(server.url, "/"))).text();
      expect(indexHtml).toContain(`/paper/${assetSeg}/main.pdf`);
      expect(indexHtml).not.toContain("ra:local:");

      const absHtml = await (await fetch(sitePath(server.url, `/abs/${assetSeg}.html`))).text();
      expect(absHtml).not.toContain("<iframe");
      expect(absHtml).not.toContain("paper-frame");
    } finally {
      await server.close();
    }
  });

  it("serves a PDF-only asset with embedded PDF and no TeX source", async () => {
    const workspace = await initPdfOnlyWorkspace({
      target: await makeTempDir("pdf-only"),
      title: "PDF Only Note",
      author: "PDF Agent",
      agentId: "agent:pdf",
      force: true
    });
    const localnet = path.join(tempRoot, "localnet-pdf");
    const published = await publishWorkspace(workspace, localnet);
    await replayIndexer({ localnetRoot: localnet });
    const siteDir = path.join(tempRoot, "site-pdf");
    await buildStaticWeb(siteDir, localnet);

    const assetSeg = routeSegment(published.sui.assetId);
    const server = await serveStaticSite(siteDir, 0);
    try {
      const absHtml = await (await fetch(sitePath(server.url, `/abs/${assetSeg}.html`))).text();
      expect(absHtml).toContain("pdfjs-viewer");
      expect(absHtml).toContain('href="#paper">HTML</a>');
      expect(absHtml).not.toContain("main.tex");

      const pdf = await fetch(sitePath(server.url, `/paper/${assetSeg}/main.pdf`));
      expect(pdf.status).toBe(200);
      expect((await pdf.text()).startsWith("%PDF")).toBe(true);

      const indexHtml = await (await fetch(sitePath(server.url, "/"))).text();
      expect(indexHtml).toContain("PDF Only Note");
      expect(indexHtml).toContain(`/paper/${assetSeg}/main.pdf`);
      expect(indexHtml).not.toContain("tex");
    } finally {
      await server.close();
    }
  });

  it("serves the checked-in web/dist when present", async () => {
    const distDir = path.resolve("web/dist");
    try {
      await fs.stat(path.join(distDir, "index.html"));
    } catch {
      await buildStaticWeb(distDir);
    }

    const server = await serveStaticSite(distDir, 0);
    try {
      const index = await fetch(sitePath(server.url, "/"));
      expect(index.status).toBe(200);
      const html = await index.text();
      expect(html).toContain("research");
      expect(html).toContain("Recent submissions");

      const absFiles = await fs.readdir(path.join(distDir, "abs"));
      expect(absFiles.length).toBeGreaterThan(0);
      const abs = await fetch(sitePath(server.url, `/abs/${absFiles[0]}`));
      expect(abs.status).toBe(200);
      expect(await abs.text()).toMatch(/format-nav|pdfjs-viewer/);
    } finally {
      await server.close();
    }
  });
});
