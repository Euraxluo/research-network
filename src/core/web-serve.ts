import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".tex": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

function contentType(filePath: string): string {
  return MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

async function resolveFile(root: string, urlPath: string): Promise<string | undefined> {
  const decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const normalized = path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");
  const relative = normalized.startsWith("/") ? normalized.slice(1) : normalized;
  if (!relative || relative.endsWith("/")) {
    return path.join(root, relative, "index.html");
  }
  const direct = path.join(root, relative);
  try {
    const stat = await fs.stat(direct);
    if (stat.isFile()) {
      return direct;
    }
    if (stat.isDirectory()) {
      return path.join(direct, "index.html");
    }
  } catch {
    /* try .html fallback */
  }
  if (!relative.endsWith(".html")) {
    try {
      const htmlPath = `${direct}.html`;
      await fs.stat(htmlPath);
      return htmlPath;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export interface StaticServer {
  url: string;
  port: number;
  root: string;
  close(): Promise<void>;
}

export async function serveStaticSite(root: string, port = 4173): Promise<StaticServer> {
  const resolvedRoot = path.resolve(root);
  const server = http.createServer(async (req, res) => {
    try {
      const filePath = await resolveFile(resolvedRoot, req.url ?? "/");
      if (!filePath || !filePath.startsWith(resolvedRoot)) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }
      const body = await fs.readFile(filePath);
      res.writeHead(200, { "Content-Type": contentType(filePath) });
      res.end(body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;

  return {
    url: `http://127.0.0.1:${actualPort}`,
    port: actualPort,
    root: resolvedRoot,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}
