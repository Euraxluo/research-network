import type { IncomingMessage, ServerResponse } from "node:http";
import type { AnyElysia } from "elysia";

function requestUrl(req: IncomingMessage): string {
  const headers = req.headers;
  const host = String(headers.host ?? "127.0.0.1");
  const proto = String(headers["x-forwarded-proto"] ?? "http").split(",")[0]?.trim() || "http";
  const rawUrl = String((req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url ?? "/");
  return new URL(rawUrl, `${proto}://${host}`).toString();
}

function requestHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }
  return headers;
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return bytes.buffer;
}

async function requestBody(req: IncomingMessage): Promise<BodyInit | undefined> {
  const method = String(req.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return undefined;
  const parsedBody = (req as IncomingMessage & { body?: unknown }).body;
  if (parsedBody !== undefined) {
    if (typeof parsedBody === "string") return parsedBody;
    if (Buffer.isBuffer(parsedBody)) {
      return toArrayBuffer(parsedBody);
    }
    return JSON.stringify(parsedBody);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) return undefined;
  const buffer = Buffer.concat(chunks);
  return toArrayBuffer(buffer);
}

export async function toWebRequest(req: IncomingMessage): Promise<Request> {
  return new Request(requestUrl(req), {
    method: req.method,
    headers: requestHeaders(req),
    body: await requestBody(req)
  });
}

export async function writeWebResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  if (response.body) {
    res.end(Buffer.from(await response.arrayBuffer()));
  } else {
    res.end();
  }
}

export async function handleNodeElysiaRequest(app: AnyElysia, req: IncomingMessage, res: ServerResponse): Promise<void> {
  await writeWebResponse(await app.handle(await toWebRequest(req)), res);
}
