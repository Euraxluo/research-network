import { Readable } from "node:stream";
import {
  DEFAULT_TESTNET_AGGREGATOR_URL,
  DEFAULT_TESTNET_SITE_OBJECT_ID,
  DEFAULT_TESTNET_SUI_RPC_URL,
  resolveWalrusSitePathDirect,
  shouldRedirectWalrusProxyResource,
  type WalrusSiteResource
} from "../src/core/walrus-sites.js";

const RESOURCE_CACHE_TTL_MS = 60_000;
const NEGATIVE_CACHE_TTL_MS = 15_000;
const AGGREGATOR_RETRIES = 3;
const AGGREGATOR_RETRY_DELAY_MS = 400;
const DEFAULT_MAX_PROXY_BYTES = 4_000_000;
type WalrusProxyNetwork = "testnet" | "mainnet" | "devnet";

interface CacheEntry {
  expiresAt: number;
  resolved?: { path: string; resource: WalrusSiteResource; url: string };
}

export interface WalrusProxyConfig {
  network: WalrusProxyNetwork;
  siteObjectId: string;
  rpcUrl: string;
  aggregatorUrl: string;
  sourceHeader: string;
}

// Module-level: survives across invocations on a warm serverless instance.
const resourceCache = new Map<string, CacheEntry>();

function queryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return value[0] ? String(value[0]) : undefined;
  }
  return value === undefined ? undefined : String(value);
}

function inferContentType(path: string): string {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".pdf")) return "application/pdf";
  if (path.endsWith(".tex")) return "text/plain; charset=utf-8";
  if (path.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= AGGREGATOR_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, init);
      // Walrus testnet aggregator cold starts answer 502/503; retry those.
      if (response.status !== 502 && response.status !== 503) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < AGGREGATOR_RETRIES) {
      await sleep(AGGREGATOR_RETRY_DELAY_MS * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function resolveCached(input: {
  siteObjectId: string;
  path: string;
  rpcUrl: string;
  aggregatorUrl: string;
  bypassCache?: boolean;
}): Promise<CacheEntry["resolved"]> {
  const key = `${input.siteObjectId}:${input.path}`;
  const now = Date.now();
  const cached = resourceCache.get(key);
  if (!input.bypassCache && cached && cached.expiresAt > now) {
    return cached.resolved;
  }
  const resolved = await resolveWalrusSitePathDirect({ ...input, bypassCache: input.bypassCache });
  resourceCache.set(key, {
    resolved,
    expiresAt: now + (resolved ? RESOURCE_CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS)
  });
  return resolved;
}

function maxProxyBytes(): number {
  const configured = Number(process.env.WALRUS_PROXY_MAX_BYTES ?? DEFAULT_MAX_PROXY_BYTES);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_PROXY_BYTES;
}

function numberHeader(value: string | null | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function setProxyHeaders(res: any, input: {
  sourceHeader: string;
  siteObjectId: string;
  resolved: { path: string; resource: WalrusSiteResource; url: string };
  contentType: string;
  upstream?: Response;
}) {
  res.setHeader("content-type", input.contentType);
  res.setHeader("cache-control", "s-maxage=30, stale-while-revalidate=300");
  res.setHeader("x-research-network-source", input.sourceHeader);
  res.setHeader("x-walrus-site-object-id", input.siteObjectId);
  res.setHeader("x-walrus-resource-path", input.resolved.path);
  const contentEncoding = input.upstream?.headers.get("content-encoding") || input.resolved.resource.headers["content-encoding"];
  if (contentEncoding && contentEncoding !== "identity") {
    res.setHeader("content-encoding", contentEncoding);
  }
  const contentLength = input.upstream?.headers.get("content-length");
  if (contentLength) {
    res.setHeader("content-length", contentLength);
  }
  const acceptRanges = input.upstream?.headers.get("accept-ranges");
  if (acceptRanges) {
    res.setHeader("accept-ranges", acceptRanges);
  }
  const contentRange = input.upstream?.headers.get("content-range");
  if (contentRange) {
    res.setHeader("content-range", contentRange);
  }
}

export function resolveWalrusProxyConfig(env: NodeJS.ProcessEnv = process.env): WalrusProxyConfig {
  const network = env.WALRUS_NETWORK || env.RN_WEB_NETWORK || env.RN_NETWORK || "testnet";
  if (network !== "testnet" && network !== "mainnet" && network !== "devnet") {
    throw new Error("WALRUS_NETWORK/RN_WEB_NETWORK must be testnet, mainnet, or devnet");
  }
  const explicitSiteObjectId = env.WALRUS_SITE_OBJECT_ID;
  const explicitRpcUrl = env.WALRUS_SUI_RPC_URL || env.SUI_RPC_URL;
  const explicitAggregatorUrl = env.WALRUS_AGGREGATOR_URL;
  const config: WalrusProxyConfig = {
    network,
    siteObjectId: explicitSiteObjectId || DEFAULT_TESTNET_SITE_OBJECT_ID,
    rpcUrl: explicitRpcUrl || DEFAULT_TESTNET_SUI_RPC_URL,
    aggregatorUrl: explicitAggregatorUrl || DEFAULT_TESTNET_AGGREGATOR_URL,
    sourceHeader: `walrus-${network}`
  };
  if (network === "mainnet") {
    const missing = [
      ["WALRUS_SITE_OBJECT_ID", explicitSiteObjectId],
      ["WALRUS_SUI_RPC_URL or SUI_RPC_URL", explicitRpcUrl],
      ["WALRUS_AGGREGATOR_URL", explicitAggregatorUrl]
    ].filter(([, value]) => !value).map(([name]) => name);
    if (missing.length) {
      throw new Error(`mainnet Walrus proxy requires explicit ${missing.join(", ")}`);
    }
    const leaks = walrusMainnetTestnetLeaks(config);
    if (leaks.length) {
      throw new Error(`mainnet Walrus proxy rejects testnet config in ${leaks.join(", ")}`);
    }
  }
  return config;
}

function walrusMainnetTestnetLeaks(config: WalrusProxyConfig): string[] {
  return [
    ["WALRUS_SITE_OBJECT_ID", config.siteObjectId],
    ["SUI_RPC_URL", config.rpcUrl],
    ["WALRUS_AGGREGATOR_URL", config.aggregatorUrl]
  ].filter(([, value]) => isKnownTestnetValue(String(value))).map(([name]) => name);
}

function isKnownTestnetValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === DEFAULT_TESTNET_SITE_OBJECT_ID.toLowerCase() ||
    normalized.includes("testnet") ||
    normalized.includes("sui-testnet-rpc.publicnode.com");
}

async function pipeBody(upstream: Response, res: any): Promise<void> {
  if (!upstream.body) {
    res.send(Buffer.from(await upstream.arrayBuffer()));
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const stream = Readable.fromWeb(upstream.body as never);
    stream.on("error", reject);
    res.on("error", reject);
    res.on("finish", resolve);
    stream.pipe(res);
  });
}

export default async function handler(req: any, res: any) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).setHeader("content-type", "application/json; charset=utf-8");
    res.send(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  try {
    const config = resolveWalrusProxyConfig();
    const { siteObjectId, rpcUrl, aggregatorUrl } = config;
    const requestedPath = queryValue(req.query?.path) || "/";
    const rangeHeader = typeof req.headers?.range === "string" ? req.headers.range : undefined;
    const bypassCache = Boolean(req.query?.refresh || req.query?.cache_bust || req.query?.rn_verify);

    const resolved = await resolveCached({ siteObjectId, path: requestedPath, rpcUrl, aggregatorUrl, bypassCache });
    if (!resolved) {
      res.status(404).setHeader("content-type", "text/plain; charset=utf-8");
      res.send(`Walrus Site resource not found: ${requestedPath}`);
      return;
    }

    if (shouldRedirectWalrusProxyResource({ maxProxyBytes: maxProxyBytes(), rangeHeader })) {
      res.status(302);
      res.setHeader("location", resolved.url);
      res.setHeader("cache-control", "no-store");
      res.setHeader("x-research-network-source", config.sourceHeader);
      res.setHeader("x-walrus-site-object-id", siteObjectId);
      res.setHeader("x-walrus-resource-path", resolved.path);
      res.send(`Redirecting to Walrus aggregator for ${resolved.path}`);
      return;
    }

    const upstream = await fetchWithRetry(resolved.url);
    if (!upstream.ok) {
      res.status(upstream.status === 404 || upstream.status === 416 ? upstream.status : 502).setHeader("content-type", "text/plain; charset=utf-8");
      res.send(`Walrus aggregator fetch failed for ${resolved.path}: HTTP ${upstream.status}`);
      return;
    }

    const contentType = resolved.resource.headers["content-type"] || upstream.headers.get("content-type") || inferContentType(resolved.path);
    const contentLength = numberHeader(upstream.headers.get("content-length") || resolved.resource.headers["content-length"]);
    if (shouldRedirectWalrusProxyResource({ contentLength, maxProxyBytes: maxProxyBytes() })) {
      res.status(302);
      res.setHeader("location", resolved.url);
      res.setHeader("cache-control", "no-store");
      res.setHeader("x-research-network-source", config.sourceHeader);
      res.setHeader("x-walrus-site-object-id", siteObjectId);
      res.setHeader("x-walrus-resource-path", resolved.path);
      res.send(`Redirecting large Walrus resource for ${resolved.path}`);
      return;
    }

    res.status(upstream.status === 206 ? 206 : 200);
    setProxyHeaders(res, { sourceHeader: config.sourceHeader, siteObjectId, resolved, contentType, upstream });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    await pipeBody(upstream, res);
  } catch (error) {
    res.status(502).setHeader("content-type", "application/json; charset=utf-8");
    res.send(JSON.stringify({
      error: "walrus_proxy_failed",
      message: error instanceof Error ? error.message : String(error)
    }));
  }
}
