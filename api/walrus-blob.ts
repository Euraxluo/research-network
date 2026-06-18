export const config = {
  api: {
    bodyParser: false
  }
};

const DEFAULT_WALRUS_PUBLISHER = "https://publisher.walrus-testnet.walrus.space";
const DEFAULT_WALRUS_AGGREGATOR = "https://aggregator.walrus-testnet.walrus.space";
const DEFAULT_WALRUS_EPOCHS = 5;
const MAX_BLOB_BYTES = 10 * 1024 * 1024;

function env(name: string, fallback: string): string {
  const value = process.env[name] ?? process.env[`VITE_${name}`];
  return value && value.trim() ? value.trim() : fallback;
}

function walrusPublisherUrl(): string {
  return env("RN_WALRUS_PUBLISHER_URL", DEFAULT_WALRUS_PUBLISHER).replace(/\/$/, "");
}

function walrusAggregatorUrl(): string {
  return env("RN_WALRUS_AGGREGATOR_URL", DEFAULT_WALRUS_AGGREGATOR).replace(/\/$/, "");
}

function walrusEpochs(req: any): number {
  const raw = Number(req.query?.epochs ?? process.env.RN_WALRUS_EPOCHS ?? process.env.VITE_RN_WALRUS_EPOCHS ?? DEFAULT_WALRUS_EPOCHS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_WALRUS_EPOCHS;
}

function blobId(req: any): string {
  const id = String(req.query?.blobId ?? req.query?.blob_id ?? "");
  if (!/^[A-Za-z0-9_-]{20,}$/.test(id)) {
    throw new Error("invalid_blob_id");
  }
  return id;
}

async function readRequestBody(req: any): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_BLOB_BYTES) {
      throw new Error("blob_too_large");
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function sendJson(res: any, status: number, value: unknown): void {
  res.status(status);
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.send(JSON.stringify(value));
}

async function upload(req: any, res: any): Promise<void> {
  const body = await readRequestBody(req);
  if (!body.length) {
    sendJson(res, 400, { error: "empty_blob" });
    return;
  }
  const upstream = await fetch(`${walrusPublisherUrl()}/v1/blobs?epochs=${walrusEpochs(req)}`, {
    method: "PUT",
    body: body as unknown as BodyInit
  });
  const text = await upstream.text();
  if (!upstream.ok) {
    sendJson(res, 502, { error: "walrus_upload_failed", status: upstream.status, detail: text.slice(0, 2000) });
    return;
  }
  res.status(200);
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
  res.send(text);
}

async function read(req: any, res: any): Promise<void> {
  const id = blobId(req);
  const upstream = await fetch(`${walrusAggregatorUrl()}/v1/blobs/${id}`);
  if (!upstream.ok) {
    sendJson(res, upstream.status === 404 ? 404 : 502, { error: "walrus_read_failed", status: upstream.status });
    return;
  }
  const bytes = Buffer.from(await upstream.arrayBuffer());
  res.status(200);
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/octet-stream");
  res.setHeader("x-walrus-blob-id", id);
  res.send(bytes);
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method === "PUT" || req.method === "POST") {
      await upload(req, res);
      return;
    }
    if (req.method === "GET") {
      await read(req, res);
      return;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
  } catch (error) {
    const message = String((error as Error)?.message || error);
    sendJson(res, message === "invalid_blob_id" ? 400 : 500, { error: message });
  }
}
