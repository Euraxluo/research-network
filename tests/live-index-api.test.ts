import fs from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { researchIndexApi } from "../src/api/index-service.js";

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_RN_INDEX_CRON_SECRET = process.env.RN_INDEX_CRON_SECRET;

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
    expect(spec.paths["/api/index/ingest"]).toBeTruthy();
    expect(spec.paths["/api/index/health"]).toBeTruthy();
  });

  it("ships one Vercel catch-all entrypoint for Elysia subroutes", async () => {
    await expect(fs.access("api/index.ts")).resolves.toBeUndefined();
    await expect(fs.access("api/index/[...path].ts")).resolves.toBeUndefined();
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
});
