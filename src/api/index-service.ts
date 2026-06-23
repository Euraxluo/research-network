import { swagger } from "@elysiajs/swagger";
import { Elysia, t } from "elysia";
import {
  DEFAULT_LIVE_INDEX_WALRUS_AGGREGATOR_URL,
  readLiveReleaseArtifact
} from "../core/live-index.js";
import {
  ingestLiveIndex,
  latestLiveIndexRunAt,
  liveIndexStorageState,
  readOrRefreshLiveIndex,
  readPersistedLiveIndex
} from "../core/live-index-db.js";

function intQuery(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolQuery(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const text = String(value).toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return undefined;
}

function cleanQuery(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text ? text : undefined;
}

function cronAuthorized(headers: Headers): boolean {
  const secret = process.env.RN_INDEX_CRON_SECRET ?? process.env.CRON_SECRET;
  if (!secret) return true;
  return headers.get("authorization") === `Bearer ${secret}`;
}

function liveIndexResponse(index: Awaited<ReturnType<typeof readOrRefreshLiveIndex>>) {
  const storage = liveIndexStorageState();
  return {
    ...index,
    storage,
    persisted: storage.configured,
    serving_mode: storage.configured ? "live-refresh-with-postgres" : "live-refresh-without-persistence"
  };
}

export const researchIndexApi = new Elysia({ prefix: "/api", aot: false })
  .use(swagger({
    path: "/index/swagger",
    specPath: "/index/openapi",
    documentation: {
      info: {
        title: "Research Network Live Index API",
        version: "0.1.0",
        description: "Live Sui testnet + Walrus release-manifest index, optionally persisted in Vercel Postgres and exposed for the public showcase."
      },
      tags: [
        { name: "index", description: "Read the public research asset index" },
        { name: "job", description: "Run or inspect the ingest job" }
      ]
    }
  }))
  .get("/index", async ({ query, set }) => {
    try {
      const index = await readOrRefreshLiveIndex({
        limit: intQuery(query.limit, Number(process.env.RN_SHOWCASE_EVENT_LIMIT ?? 20)),
        query: cleanQuery(query.q),
        refresh: boolQuery(query.refresh)
      });
      return liveIndexResponse(index);
    } catch (error) {
      set.status = 502;
      return {
        error: "live_index_unavailable",
        storage: liveIndexStorageState(),
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }, {
    tags: ["index"],
    query: t.Object({
      q: t.Optional(t.String({ description: "Search title, author, repo, tx, object, blob, hash, tags, or abstract." })),
      limit: t.Optional(t.String({ description: "Max assets to return, capped at 20." })),
      refresh: t.Optional(t.String({ description: "Set to 0/false to read only from the persisted index." }))
    }),
    detail: {
      summary: "Read the live public research index",
      description: "By default this refreshes from Sui testnet + Walrus, persists into Vercel Postgres when configured, then returns the indexed assets. If live refresh fails, it falls back to the latest persisted rows."
    }
  })
  .get("/index/persisted", async ({ query }) => {
    const index = await readPersistedLiveIndex({
      limit: intQuery(query.limit, Number(process.env.RN_SHOWCASE_EVENT_LIMIT ?? 20)),
      query: cleanQuery(query.q)
    });
    return index ?? {
      generated_at: new Date().toISOString(),
      source: "live-sui-testnet+walrus-release-manifest",
      storage: liveIndexStorageState(),
      assets: []
    };
  }, {
    tags: ["index"],
    query: t.Object({
      q: t.Optional(t.String()),
      limit: t.Optional(t.String())
    }),
    detail: {
      summary: "Read only the persisted Vercel Postgres index"
    }
  })
  .get("/index/health", async () => ({
    ok: true,
    service: "research-network-live-index",
    storage: liveIndexStorageState(),
    latest_successful_ingest_at: await latestLiveIndexRunAt()
  }), {
    tags: ["index"],
    detail: {
      summary: "Check index API and database status"
    }
  })
  .get("/index/artifact", async ({ query, set }) => {
    const blobId = cleanQuery(query.blob);
    const artifactPath = cleanQuery(query.path);
    if (!blobId || !artifactPath) {
      set.status = 400;
      return { error: "missing_release_artifact_query", message: "blob and path are required" };
    }
    try {
      const artifact = await readLiveReleaseArtifact({
        blobId,
        path: artifactPath,
        aggregatorUrl: cleanQuery(query.aggregator) ?? process.env.RN_WALRUS_AGGREGATOR_URL ?? process.env.WALRUS_AGGREGATOR_URL ?? DEFAULT_LIVE_INDEX_WALRUS_AGGREGATOR_URL
      });
      if (!artifact) {
        set.status = 404;
        return { error: "release_artifact_not_found", blob: blobId, path: artifactPath };
      }
      const body = artifact.bytes.buffer.slice(
        artifact.bytes.byteOffset,
        artifact.bytes.byteOffset + artifact.bytes.byteLength
      ) as ArrayBuffer;
      return new Response(body, {
        headers: {
          "content-type": artifact.contentType,
          "cache-control": "public, max-age=300, stale-while-revalidate=3600",
          "content-disposition": `inline; filename="${artifact.filename.replace(/"/g, "")}"`
        }
      });
    } catch (error) {
      set.status = 502;
      return {
        error: "release_artifact_unavailable",
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }, {
    tags: ["index"],
    query: t.Object({
      blob: t.String({ description: "Walrus release blob id containing the packed research asset." }),
      path: t.String({ description: "Artifact path inside the release tarball, for example paper/main.pdf." }),
      aggregator: t.Optional(t.String({ description: "Optional Walrus aggregator URL override." }))
    }),
    detail: {
      summary: "Read a file from a live Walrus release blob",
      description: "Streams paper, TeX, README, and other release artifacts by unpacking the zstd-compressed Walrus release blob. Public pages use this to render the live paper view without local fixtures."
    }
  })
  .get("/index/ingest", async ({ query, request, set }) => {
    if (!cronAuthorized(request.headers)) {
      set.status = 401;
      return { success: false, error: "unauthorized_index_job" };
    }
    try {
      return await ingestLiveIndex({
        limit: intQuery(query.limit, Number(process.env.RN_SHOWCASE_EVENT_LIMIT ?? 20)),
        query: cleanQuery(query.q)
      });
    } catch (error) {
      set.status = 502;
      return {
        success: false,
        error: "index_ingest_failed",
        storage: liveIndexStorageState(),
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }, {
    tags: ["job"],
    query: t.Object({
      q: t.Optional(t.String()),
      limit: t.Optional(t.String())
    }),
    detail: {
      summary: "Run the Vercel Cron-compatible ingest job",
      description: "This endpoint is intentionally GET-compatible because Vercel Cron invokes a path on schedule. Set RN_INDEX_CRON_SECRET or CRON_SECRET to require Bearer authorization."
    }
  })
  .post("/index/ingest", async ({ body, request, set }) => {
    if (!cronAuthorized(request.headers)) {
      set.status = 401;
      return { success: false, error: "unauthorized_index_job" };
    }
    const input = body as { limit?: string | number; q?: string } | undefined;
    try {
      return await ingestLiveIndex({
        limit: intQuery(input?.limit, Number(process.env.RN_SHOWCASE_EVENT_LIMIT ?? 20)),
        query: cleanQuery(input?.q)
      });
    } catch (error) {
      set.status = 502;
      return {
        success: false,
        error: "index_ingest_failed",
        storage: liveIndexStorageState(),
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }, {
    tags: ["job"],
    body: t.Optional(t.Object({
      q: t.Optional(t.String()),
      limit: t.Optional(t.Union([t.String(), t.Number()]))
    })),
    detail: {
      summary: "Run the ingest job manually"
    }
  })
  .compile();

export type ResearchIndexApi = typeof researchIndexApi;
