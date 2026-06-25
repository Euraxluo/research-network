import {
  createClient,
  createPool,
  sql as vercelSql,
  type QueryResult,
  type QueryResultRow,
  type VercelPool
} from "@vercel/postgres";
import {
  buildLiveIndex,
  emptyLiveDelegationSummary,
  emptyLiveMembershipSummary,
  liveIndexConfig,
  matchesLiveIndexQuery,
  type BuildLiveIndexOptions,
  type LiveIndexAsset,
  type LiveIndexResult
} from "./live-index.js";

interface AssetRow {
  asset_json: unknown;
}

interface RunRow {
  indexed_at: string;
}

export interface LiveIndexStorageState {
  configured: boolean;
  provider: "vercel-postgres";
}

export interface LiveIndexIngestResult {
  success: boolean;
  persisted: boolean;
  storage: LiveIndexStorageState;
  indexed_at: string;
  assets_count: number;
  index: LiveIndexResult;
}

export interface ReadLiveIndexOptions extends BuildLiveIndexOptions {
  refresh?: boolean;
}

let schemaReady: Promise<void> | undefined;
let pooledDb: VercelPool | undefined;

type SqlValue = string | number | boolean | null | undefined;
type SqlTag = <T extends QueryResultRow = QueryResultRow>(strings: TemplateStringsArray, ...values: SqlValue[]) => Promise<QueryResult<T>>;

function postgresUrl(): string | undefined {
  return process.env.POSTGRES_URL ?? process.env.POSTGRES_PRISMA_URL ?? process.env.DATABASE_URL;
}

function canUsePool(url: string): boolean {
  return url.includes("-pooler.") || url.includes("localhost") || Boolean(process.env.POSTGRES_URL);
}

const db: SqlTag = async (strings, ...values) => {
  if (process.env.POSTGRES_URL) {
    return vercelSql(strings, ...values);
  }
  const connectionString = postgresUrl();
  if (!connectionString) {
    throw new Error("Vercel Postgres is not configured: set POSTGRES_URL or DATABASE_URL in Vercel");
  }
  if (canUsePool(connectionString)) {
    pooledDb ??= createPool({ connectionString });
    return pooledDb.sql(strings, ...values);
  }
  const client = createClient({ connectionString });
  await client.connect();
  try {
    return await client.sql(strings, ...values);
  } finally {
    await client.end();
  }
};

export function liveIndexStorageState(): LiveIndexStorageState {
  return {
    configured: Boolean(postgresUrl()),
    provider: "vercel-postgres"
  };
}

function assetSearchText(asset: LiveIndexAsset): string {
  return [
    asset.id,
    asset.title,
    asset.authors,
    asset.abstract,
    asset.types.join(" "),
    (asset.skills ?? []).map((skill) => [skill.id, skill.name, skill.description, skill.relation].join(" ")).join("\n"),
    (asset.workflows ?? []).map((workflow) => [workflow.id, workflow.name, workflow.description, workflow.inputs.join(" "), workflow.outputs.join(" ")].join(" ")).join("\n"),
    (asset.relationships ?? []).map((relationship) => [relationship.src_id, relationship.dst_id, relationship.relation_type].join(" ")).join("\n"),
    asset.sui_object_id,
    asset.tx_digest,
    asset.walrus_blob_id,
    asset.manifest_hash,
    asset.event_owner_address,
    asset.creator_address,
    asset.object_owner_address,
    asset.tx_sender,
    asset.gas_owner,
    asset.sui_spent_mist,
    asset.repo_url ?? "",
    asset.repo_commit
  ].join("\n").toLowerCase();
}

async function ensureLiveIndexSchema(): Promise<void> {
  if (!liveIndexStorageState().configured) {
    throw new Error("Vercel Postgres is not configured: set POSTGRES_URL or DATABASE_URL in Vercel");
  }
  schemaReady ??= (async () => {
    await db`
      CREATE TABLE IF NOT EXISTS rn_live_index_assets (
        sui_object_id text PRIMARY KEY,
        asset_id text NOT NULL,
        title text NOT NULL,
        authors text NOT NULL,
        abstract text NOT NULL,
        manifest_hash text NOT NULL,
        walrus_blob_id text NOT NULL,
        tx_digest text NOT NULL,
        repo_url text,
        repo_commit text NOT NULL,
        package_id text NOT NULL,
        event_type text NOT NULL,
        rpc_url text NOT NULL,
        aggregator_url text NOT NULL,
        search_text text NOT NULL,
        asset_json jsonb NOT NULL,
        indexed_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await db`
      CREATE INDEX IF NOT EXISTS rn_live_index_assets_package_idx
        ON rn_live_index_assets (package_id, indexed_at DESC)
    `;
    await db`
      CREATE INDEX IF NOT EXISTS rn_live_index_assets_search_idx
        ON rn_live_index_assets USING gin (to_tsvector('simple', search_text))
    `;
    await db`
      CREATE TABLE IF NOT EXISTS rn_live_index_runs (
        id bigserial PRIMARY KEY,
        status text NOT NULL,
        package_id text NOT NULL,
        event_type text NOT NULL,
        rpc_url text NOT NULL,
        aggregator_url text NOT NULL,
        assets_count integer NOT NULL DEFAULT 0,
        error text,
        started_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz
      )
    `;
  })();
  return schemaReady;
}

async function recordRunStart(config: ReturnType<typeof liveIndexConfig>): Promise<number | undefined> {
  if (!liveIndexStorageState().configured) return undefined;
  await ensureLiveIndexSchema();
  const result = await db<{ id: number }>`
    INSERT INTO rn_live_index_runs (status, package_id, event_type, rpc_url, aggregator_url)
    VALUES ('running', ${config.packageId}, ${config.eventType}, ${config.rpcUrl}, ${config.aggregatorUrl})
    RETURNING id
  `;
  return result.rows[0]?.id;
}

async function recordRunComplete(id: number | undefined, status: "success" | "failed", assetsCount: number, error?: string): Promise<void> {
  if (!id || !liveIndexStorageState().configured) return;
  await db`
    UPDATE rn_live_index_runs
    SET status = ${status}, assets_count = ${assetsCount}, error = ${error ?? null}, completed_at = now()
    WHERE id = ${id}
  `;
}

export async function persistLiveIndex(index: LiveIndexResult): Promise<void> {
  if (!liveIndexStorageState().configured) {
    throw new Error("Vercel Postgres is not configured: set POSTGRES_URL or DATABASE_URL in Vercel");
  }
  await ensureLiveIndexSchema();
  for (const asset of index.assets) {
    await db`
      INSERT INTO rn_live_index_assets (
        sui_object_id,
        asset_id,
        title,
        authors,
        abstract,
        manifest_hash,
        walrus_blob_id,
        tx_digest,
        repo_url,
        repo_commit,
        package_id,
        event_type,
        rpc_url,
        aggregator_url,
        search_text,
        asset_json,
        indexed_at
      )
      VALUES (
        ${asset.sui_object_id},
        ${asset.id},
        ${asset.title},
        ${asset.authors},
        ${asset.abstract},
        ${asset.manifest_hash},
        ${asset.walrus_blob_id},
        ${asset.tx_digest},
        ${asset.repo_url ?? null},
        ${asset.repo_commit},
        ${index.package_id},
        ${index.event_type},
        ${index.rpc_url},
        ${index.aggregator_url},
        ${assetSearchText(asset)},
        ${JSON.stringify(asset)},
        now()
      )
      ON CONFLICT (sui_object_id) DO UPDATE SET
        asset_id = excluded.asset_id,
        title = excluded.title,
        authors = excluded.authors,
        abstract = excluded.abstract,
        manifest_hash = excluded.manifest_hash,
        walrus_blob_id = excluded.walrus_blob_id,
        tx_digest = excluded.tx_digest,
        repo_url = excluded.repo_url,
        repo_commit = excluded.repo_commit,
        package_id = excluded.package_id,
        event_type = excluded.event_type,
        rpc_url = excluded.rpc_url,
        aggregator_url = excluded.aggregator_url,
        search_text = excluded.search_text,
        asset_json = excluded.asset_json,
        indexed_at = now()
    `;
  }
}

export async function ingestLiveIndex(options: BuildLiveIndexOptions = {}): Promise<LiveIndexIngestResult> {
  const config = liveIndexConfig(options);
  const runId = await recordRunStart(config);
  try {
    const index = await buildLiveIndex(options);
    if (liveIndexStorageState().configured) {
      await persistLiveIndex(index);
    }
    await recordRunComplete(runId, "success", index.assets.length);
    return {
      success: true,
      persisted: liveIndexStorageState().configured,
      storage: liveIndexStorageState(),
      indexed_at: new Date().toISOString(),
      assets_count: index.assets.length,
      index
    };
  } catch (error) {
    await recordRunComplete(runId, "failed", 0, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export async function readPersistedLiveIndex(options: BuildLiveIndexOptions = {}): Promise<LiveIndexResult | undefined> {
  if (!liveIndexStorageState().configured) return undefined;
  await ensureLiveIndexSchema();
  const config = liveIndexConfig(options);
  const query = String(options.query ?? "").trim();
  const like = `%${query.toLowerCase()}%`;
  const result = query
    ? await db<AssetRow>`
        SELECT asset_json
        FROM rn_live_index_assets
        WHERE package_id = ${config.packageId}
          AND search_text ILIKE ${like}
        ORDER BY indexed_at DESC
        LIMIT ${config.limit}
      `
    : await db<AssetRow>`
        SELECT asset_json
        FROM rn_live_index_assets
        WHERE package_id = ${config.packageId}
        ORDER BY indexed_at DESC
        LIMIT ${config.limit}
      `;
  const assets = result.rows
    .map((row) => row.asset_json as LiveIndexAsset)
    .filter((asset) => matchesLiveIndexQuery(asset, options.query ?? ""));
  if (!assets.length) {
    return undefined;
  }
  return {
    generated_at: new Date().toISOString(),
    source: "live-sui-testnet+walrus-release-manifest",
    rpc_url: config.rpcUrl,
    package_id: config.packageId,
    event_type: config.eventType,
    aggregator_url: config.aggregatorUrl,
    limit: config.limit,
    query: options.query,
    assets,
    membership: emptyLiveMembershipSummary(config.packageId),
    delegations: emptyLiveDelegationSummary(config.packageId)
  };
}

export async function latestLiveIndexRunAt(): Promise<string | undefined> {
  if (!liveIndexStorageState().configured) return undefined;
  await ensureLiveIndexSchema();
  const result = await db<RunRow>`
    SELECT completed_at::text AS indexed_at
    FROM rn_live_index_runs
    WHERE status = 'success'
    ORDER BY completed_at DESC NULLS LAST
    LIMIT 1
  `;
  return result.rows[0]?.indexed_at;
}

export async function readOrRefreshLiveIndex(options: ReadLiveIndexOptions = {}): Promise<LiveIndexResult> {
  const refresh = options.refresh ?? process.env.RN_INDEX_REFRESH_ON_READ !== "0";
  if (refresh) {
    try {
      return (await ingestLiveIndex(options)).index;
    } catch (error) {
      const persisted = await readPersistedLiveIndex(options);
      if (persisted) return persisted;
      throw error;
    }
  }
  const persisted = await readPersistedLiveIndex(options);
  if (persisted) return persisted;
  return (await ingestLiveIndex(options)).index;
}
