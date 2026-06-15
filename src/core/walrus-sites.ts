export const DEFAULT_TESTNET_SITE_OBJECT_ID = "0x2cd9764af24dde6e202bf8454ca11f312e0b21312867422fd685955f39a7f12a";
export const DEFAULT_TESTNET_SUI_RPC_URL = "https://sui-testnet-rpc.publicnode.com";
export const DEFAULT_TESTNET_AGGREGATOR_URL = "https://aggregator.walrus-testnet.walrus.space";

export interface WalrusSiteResource {
  path: string;
  blobId: string;
  headers: Record<string, string>;
  range?: unknown;
}

export interface WalrusSiteResourceRef {
  path: string;
  objectId: string;
}

export interface WalrusSiteResourceMap {
  resources: Record<string, WalrusSiteResource>;
  objectIds: Record<string, string>;
}

export type WalrusSiteRoutes = Record<string, string>;

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decimalToLittleEndianBytes(decimal: string, width = 32): Uint8Array {
  let value = BigInt(decimal);
  const bytes = new Uint8Array(width);
  for (let index = 0; index < width; index += 1) {
    bytes[index] = Number(value & 0xffn);
    value >>= 8n;
  }
  return bytes;
}

export function blobIdDecimalToBase64Url(decimal: string): string {
  return base64Url(decimalToLittleEndianBytes(decimal));
}

export function quiltPatchIdFromParts(blobIdDecimal: string, internalIdHex: string): string {
  const normalized = internalIdHex.startsWith("0x") ? internalIdHex.slice(2) : internalIdHex;
  return base64Url(Buffer.concat([
    Buffer.from(decimalToLittleEndianBytes(blobIdDecimal)),
    Buffer.from(normalized, "hex")
  ]));
}

export function normalizeWalrusSitePath(input: string | undefined): string[] {
  const path = normalizeRequestPath(input);
  return normalizeWalrusSitePathBase(path);
}

function normalizeRequestPath(input: string | undefined): string {
  let path = input || "/";
  try {
    path = decodeURIComponent(path);
  } catch {
    /* keep raw path */
  }
  path = path.split("?")[0]?.split("#")[0] || "/";
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  return path;
}

function normalizeWalrusSitePathBase(path: string): string[] {
  if (path === "/") {
    return ["/index.html"];
  }
  const candidates = [path];
  if (path.endsWith("/")) {
    candidates.push(`${path}index.html`);
  } else if (!/\.[A-Za-z0-9]+$/.test(path)) {
    candidates.push(`${path}.html`);
    candidates.push(`${path}/index.html`);
  }
  return [...new Set(candidates)];
}

function normalizeRouteTarget(target: string): string[] {
  return normalizeWalrusSitePathBase(normalizeRequestPath(target));
}

function routeMatches(path: string, pattern: string): boolean {
  const normalizedPattern = normalizeRequestPath(pattern);
  if (normalizedPattern === "/*") {
    return true;
  }
  if (normalizedPattern.endsWith("/*")) {
    const prefix = normalizedPattern.slice(0, -1);
    return path.startsWith(prefix) || path === prefix.slice(0, -1);
  }
  return path === normalizedPattern;
}

export function normalizeWalrusSitePathWithRoutes(input: string | undefined, routes?: WalrusSiteRoutes): string[] {
  const path = normalizeRequestPath(input);
  const candidates = normalizeWalrusSitePathBase(path);
  for (const [pattern, target] of Object.entries(routes ?? {})) {
    if (typeof target !== "string" || !routeMatches(path, pattern)) {
      continue;
    }
    for (const candidate of normalizeRouteTarget(target)) {
      candidates.push(candidate);
    }
  }
  return [...new Set(candidates)];
}

export function parseWalrusSiteRoutes(text: string): WalrusSiteRoutes | undefined {
  try {
    const body = JSON.parse(text) as { routes?: unknown };
    if (!body.routes || typeof body.routes !== "object" || Array.isArray(body.routes)) {
      return undefined;
    }
    const routes: WalrusSiteRoutes = {};
    for (const [pattern, target] of Object.entries(body.routes)) {
      if (typeof target === "string") {
        routes[pattern] = target;
      }
    }
    return Object.keys(routes).length ? routes : undefined;
  } catch {
    return undefined;
  }
}

async function rpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  if (!response.ok) {
    throw new Error(`Sui RPC ${method} failed: HTTP ${response.status}`);
  }
  const body = await response.json() as { result?: T; error?: { message?: string } };
  if (body.error) {
    throw new Error(`Sui RPC ${method} failed: ${body.error.message ?? JSON.stringify(body.error)}`);
  }
  return body.result as T;
}

interface DynamicFieldsPage {
  data: Array<{
    name?: { value?: { path?: string } };
    objectId: string;
  }>;
  nextCursor?: string | null;
  hasNextPage: boolean;
}

interface SuiObjectResponse {
  data?: {
    objectId: string;
    content?: {
      fields?: {
        name?: { fields?: { path?: string } };
        value?: {
          fields?: {
            blob_id?: string;
            headers?: { fields?: { contents?: Array<{ fields?: { key?: string; value?: string } }> } };
            path?: string;
            range?: unknown;
          };
        };
      };
    };
  };
  error?: unknown;
}

function headersFromContents(contents: Array<{ fields?: { key?: string; value?: string } }> | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const entry of contents ?? []) {
    const key = entry.fields?.key;
    const value = entry.fields?.value;
    if (key && value !== undefined) {
      headers[key.toLowerCase()] = value;
    }
  }
  return headers;
}

function resourceFromObject(object: SuiObjectResponse): WalrusSiteResource | undefined {
  const fields = object.data?.content?.fields;
  const value = fields?.value?.fields;
  const blobId = value?.blob_id;
  const path = value?.path ?? fields?.name?.fields?.path;
  if (!blobId || !path) {
    return undefined;
  }
  return {
    path,
    blobId,
    headers: headersFromContents(value?.headers?.fields?.contents),
    range: value?.range
  };
}

export async function listWalrusSiteResourceRefs(siteObjectId: string, rpcUrl = DEFAULT_TESTNET_SUI_RPC_URL): Promise<WalrusSiteResourceRef[]> {
  const refs: WalrusSiteResourceRef[] = [];
  let cursor: string | null | undefined;
  do {
    const page = await rpc<DynamicFieldsPage>(rpcUrl, "suix_getDynamicFields", [siteObjectId, cursor ?? null, 50]);
    for (const item of page.data ?? []) {
      const path = item.name?.value?.path;
      if (path) {
        refs.push({ path, objectId: item.objectId });
      }
    }
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor);
  return refs;
}

export async function fetchWalrusSiteResourceMap(siteObjectId: string, rpcUrl = DEFAULT_TESTNET_SUI_RPC_URL): Promise<WalrusSiteResourceMap> {
  const refs = await listWalrusSiteResourceRefs(siteObjectId, rpcUrl);
  const resources: Record<string, WalrusSiteResource> = {};
  const objectIds: Record<string, string> = {};
  for (let index = 0; index < refs.length; index += 50) {
    const chunk = refs.slice(index, index + 50);
    const objects = await rpc<SuiObjectResponse[]>(rpcUrl, "sui_multiGetObjects", [
      chunk.map((ref) => ref.objectId),
      { showContent: true, showType: true }
    ]);
    for (const object of objects) {
      const resource = resourceFromObject(object);
      if (resource) {
        resources[resource.path] = resource;
        objectIds[resource.path] = object.data?.objectId ?? "";
      }
    }
  }
  return { resources, objectIds };
}

export function walrusAggregatorResourceUrl(resource: WalrusSiteResource, aggregatorUrl = DEFAULT_TESTNET_AGGREGATOR_URL): string {
  const base = aggregatorUrl.replace(/\/$/, "");
  const internalId = resource.headers["x-wal-quilt-patch-internal-id"];
  if (internalId) {
    return `${base}/v1/blobs/by-quilt-patch-id/${quiltPatchIdFromParts(resource.blobId, internalId)}`;
  }
  return `${base}/v1/blobs/${blobIdDecimalToBase64Url(resource.blobId)}`;
}

export function shouldRedirectWalrusProxyResource(input: {
  contentLength?: number;
  maxProxyBytes: number;
  rangeHeader?: string;
}): boolean {
  if (input.rangeHeader) {
    return true;
  }
  return Boolean(input.contentLength && input.contentLength > input.maxProxyBytes);
}

export async function resolveWalrusSitePath(input: {
  siteObjectId: string;
  path: string;
  rpcUrl?: string;
  aggregatorUrl?: string;
}): Promise<{ path: string; resource: WalrusSiteResource; url: string } | undefined> {
  const map = await fetchWalrusSiteResourceMap(input.siteObjectId, input.rpcUrl);
  for (const candidate of normalizeWalrusSitePath(input.path)) {
    const resource = map.resources[candidate];
    if (resource) {
      return {
        path: candidate,
        resource,
        url: walrusAggregatorResourceUrl(resource, input.aggregatorUrl)
      };
    }
  }
  return undefined;
}

const sitePackageIdCache = new Map<string, string>();
const siteRoutesCache = new Map<string, { expiresAt: number; routes?: WalrusSiteRoutes }>();
const SITE_ROUTES_CACHE_TTL_MS = 60_000;

export async function getWalrusSitePackageId(siteObjectId: string, rpcUrl = DEFAULT_TESTNET_SUI_RPC_URL): Promise<string> {
  const cached = sitePackageIdCache.get(siteObjectId);
  if (cached) {
    return cached;
  }
  const object = await rpc<{ data?: { type?: string } }>(rpcUrl, "sui_getObject", [siteObjectId, { showType: true }]);
  const match = object.data?.type?.match(/^(0x[0-9a-fA-F]+)::site::Site$/);
  if (!match) {
    throw new Error(`Object ${siteObjectId} is not a Walrus Site (type: ${object.data?.type ?? "unknown"})`);
  }
  sitePackageIdCache.set(siteObjectId, match[1]);
  return match[1];
}

export async function getWalrusSiteResourceByPath(input: {
  siteObjectId: string;
  path: string;
  rpcUrl?: string;
}): Promise<WalrusSiteResource | undefined> {
  const rpcUrl = input.rpcUrl ?? DEFAULT_TESTNET_SUI_RPC_URL;
  const packageId = await getWalrusSitePackageId(input.siteObjectId, rpcUrl);
  const object = await rpc<SuiObjectResponse>(rpcUrl, "suix_getDynamicFieldObject", [
    input.siteObjectId,
    { type: `${packageId}::site::ResourcePath`, value: { path: input.path } }
  ]);
  if (object.error || !object.data) {
    return undefined;
  }
  return resourceFromObject(object);
}

export async function resolveWalrusSitePathDirect(input: {
  siteObjectId: string;
  path: string;
  rpcUrl?: string;
  aggregatorUrl?: string;
  bypassCache?: boolean;
}): Promise<{ path: string; resource: WalrusSiteResource; url: string } | undefined> {
  const resolved = await resolveWalrusSiteCandidates({
    siteObjectId: input.siteObjectId,
    candidates: normalizeWalrusSitePath(input.path),
    rpcUrl: input.rpcUrl,
    aggregatorUrl: input.aggregatorUrl
  });
  if (resolved) {
    return resolved;
  }

  const routes = await getWalrusSiteRoutes(input);
  const routedCandidates = normalizeWalrusSitePathWithRoutes(input.path, routes)
    .filter((candidate) => !normalizeWalrusSitePath(input.path).includes(candidate));
  return resolveWalrusSiteCandidates({
    siteObjectId: input.siteObjectId,
    candidates: routedCandidates,
    rpcUrl: input.rpcUrl,
    aggregatorUrl: input.aggregatorUrl
  });
}

async function resolveWalrusSiteCandidates(input: {
  siteObjectId: string;
  candidates: string[];
  rpcUrl?: string;
  aggregatorUrl?: string;
}): Promise<{ path: string; resource: WalrusSiteResource; url: string } | undefined> {
  for (const candidate of input.candidates) {
    const resource = await getWalrusSiteResourceByPath({
      siteObjectId: input.siteObjectId,
      path: candidate,
      rpcUrl: input.rpcUrl
    });
    if (resource) {
      return {
        path: candidate,
        resource,
        url: walrusAggregatorResourceUrl(resource, input.aggregatorUrl)
      };
    }
  }
  return undefined;
}

async function getWalrusSiteRoutes(input: {
  siteObjectId: string;
  rpcUrl?: string;
  aggregatorUrl?: string;
  bypassCache?: boolean;
}): Promise<WalrusSiteRoutes | undefined> {
  const key = `${input.siteObjectId}:${input.rpcUrl ?? DEFAULT_TESTNET_SUI_RPC_URL}:${input.aggregatorUrl ?? DEFAULT_TESTNET_AGGREGATOR_URL}`;
  const cached = siteRoutesCache.get(key);
  const now = Date.now();
  if (!input.bypassCache && cached && cached.expiresAt > now) {
    return cached.routes;
  }
  const resource = await getWalrusSiteResourceByPath({
    siteObjectId: input.siteObjectId,
    path: "/ws-resources.json",
    rpcUrl: input.rpcUrl
  });
  if (!resource) {
    siteRoutesCache.set(key, { routes: undefined, expiresAt: now + SITE_ROUTES_CACHE_TTL_MS });
    return undefined;
  }
  const response = await fetch(walrusAggregatorResourceUrl(resource, input.aggregatorUrl));
  if (!response.ok) {
    siteRoutesCache.set(key, { routes: undefined, expiresAt: now + SITE_ROUTES_CACHE_TTL_MS });
    return undefined;
  }
  const routes = parseWalrusSiteRoutes(await response.text());
  siteRoutesCache.set(key, { routes, expiresAt: now + SITE_ROUTES_CACHE_TTL_MS });
  return routes;
}
