import {
  type ProtocolEvent,
  type IndexState,
  type SuiEventCursor,
  type SuiEventPollerState
} from "./types.js";
import { type ApplyOptions, applyEvents } from "./indexer.js";
import {
  appendEvents,
  readIndex,
  readSuiEventPollerState,
  writeIndex,
  writeSuiEventPollerState
} from "./local-store.js";

export const PROTOCOL_EVENT_MODULES = [
  "research_asset",
  "skill",
  "revenue",
  "payment",
  "report",
  "access",
  "delegation",
  "settlement",
  "agent",
  "reputation",
  "badge"
] as const;

/** Shape of a single event as returned by Sui RPC (`sui_queryEvents` / checkpoint reads).
 *  Only the fields the indexer needs are modelled; extra fields are ignored. */
export interface RawSuiEvent {
  id: { txDigest: string; eventSeq: string | number };
  type: string; // e.g. "0x03d2..::revenue::RevenueClaimed"
  parsedJson?: Record<string, unknown>;
  timestampMs?: string | number;
  checkpoint?: string | number;
  packageId?: string;
  sender?: string;
}

/** Modules whose events this protocol indexes. Events from other packages/modules are ignored. */
const PROTOCOL_MODULES = new Set<string>(PROTOCOL_EVENT_MODULES);

/** Parse a fully-qualified Sui struct type `<pkg>::<module>::<Name>` into (module, name). */
function splitType(type: string): { module: string; name: string } | undefined {
  const parts = type.split("::");
  if (parts.length < 3) {
    return undefined;
  }
  return { module: parts[parts.length - 2], name: parts[parts.length - 1] };
}

/** Normalize one raw Sui event into the indexer's ProtocolEvent shape. Returns undefined for
 *  events outside the protocol's modules (so a broad event query can be passed in directly).
 *  The Move event struct name becomes `event_type`; `parsedJson` becomes the payload (its
 *  field names already match the Move struct fields the indexer reads). */
export function normalizeSuiEvent(raw: RawSuiEvent, packageId?: string): ProtocolEvent | undefined {
  if (packageId && raw.packageId && raw.packageId !== packageId) {
    return undefined;
  }
  const parsed = splitType(raw.type);
  if (!parsed || !PROTOCOL_MODULES.has(parsed.module)) {
    return undefined;
  }
  const timestamp_ms = Number(raw.timestampMs ?? 0);
  return {
    tx_digest: String(raw.id.txDigest),
    event_seq: Number(raw.id.eventSeq),
    event_type: parsed.name,
    checkpoint: Number(raw.checkpoint ?? raw.timestampMs ?? 0),
    timestamp_ms,
    payload: { ...(raw.parsedJson ?? {}), sender: raw.sender }
  };
}

/** Normalize a batch of raw Sui events, dropping non-protocol events. */
export function normalizeSuiEvents(raws: RawSuiEvent[], packageId?: string): ProtocolEvent[] {
  return raws
    .map((raw) => normalizeSuiEvent(raw, packageId))
    .filter((event): event is ProtocolEvent => Boolean(event));
}

/** Ingest raw Sui events into an index: normalize, then fold through the (idempotent) indexer.
 *  This is the seam a live Sui RPC poller plugs into — it fetches `sui_queryEvents` pages and
 *  hands the raw events here. Replaying overlapping pages is safe (per-event dedup). */
export async function ingestSuiEvents(
  index: IndexState,
  raws: RawSuiEvent[],
  options: ApplyOptions & { packageId?: string } = {}
): Promise<IndexState> {
  const events = normalizeSuiEvents(raws, options.packageId);
  return applyEvents(index, events, options);
}

export interface SuiEventPollerFetchResponse {
  ok?: boolean;
  status?: number;
  json(): Promise<unknown>;
  text?(): Promise<string>;
}

export type SuiEventPollerFetch = (url: string, init: {
  method: "POST";
  headers: Record<string, string>;
  body: string;
}) => Promise<SuiEventPollerFetchResponse>;

interface SuiEventPage {
  data?: RawSuiEvent[];
  nextCursor?: SuiEventCursor | null;
  hasNextPage?: boolean;
}

interface RpcEnvelope<T> {
  result?: T;
  error?: { code?: number; message?: string };
}

export interface PollSuiEventsOptions extends ApplyOptions {
  rpcUrl: string;
  packageId: string;
  modules?: string[];
  limit?: number;
  maxPagesPerModule?: number;
  localnetRoot?: string;
  fetchImpl?: SuiEventPollerFetch;
}

export interface PollSuiEventsResult {
  state: SuiEventPollerState;
  pages_fetched: number;
  events_seen: number;
  events_ingested: number;
  cursors: Record<string, SuiEventCursor | null>;
  index: IndexState;
}

function protocolEventKey(event: ProtocolEvent): string {
  return `${event.tx_digest}:${event.event_seq}`;
}

async function rpc<T>(url: string, method: string, params: unknown[], fetchImpl?: SuiEventPollerFetch): Promise<T> {
  const doFetch = fetchImpl ?? (globalThis.fetch as unknown as SuiEventPollerFetch | undefined);
  if (!doFetch) {
    throw new Error("No fetch implementation available for Sui event polling");
  }
  const response = await doFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  if (response.ok === false) {
    throw new Error(`Sui RPC HTTP ${response.status ?? "error"}: ${response.text ? await response.text() : ""}`);
  }
  const body = await response.json() as RpcEnvelope<T>;
  if (body.error) {
    throw new Error(`Sui RPC ${method} failed: ${body.error.message ?? body.error.code ?? "unknown error"}`);
  }
  if (body.result === undefined) {
    throw new Error(`Sui RPC ${method} returned no result`);
  }
  return body.result;
}

async function queryMoveModuleEvents(input: {
  rpcUrl: string;
  packageId: string;
  module: string;
  cursor?: SuiEventCursor | null;
  limit: number;
  fetchImpl?: SuiEventPollerFetch;
}): Promise<SuiEventPage> {
  return rpc<SuiEventPage>(input.rpcUrl, "suix_queryEvents", [
    { MoveModule: { package: input.packageId, module: input.module } },
    input.cursor ?? null,
    input.limit,
    false
  ], input.fetchImpl);
}

/** Poll Sui RPC for protocol Move-module events and persist both the folded index and the
 *  per-module cursors. This is intentionally at-least-once: overlapping pages are safe because
 *  the indexer deduplicates by tx_digest:event_seq, while cursors make normal runs incremental. */
export async function pollSuiEvents(options: PollSuiEventsOptions): Promise<PollSuiEventsResult> {
  const modules = options.modules?.length ? options.modules : [...PROTOCOL_EVENT_MODULES];
  const limit = options.limit ?? 50;
  const maxPages = options.maxPagesPerModule ?? 1;
  const pollerState = await readSuiEventPollerState(options.localnetRoot);
  const index = await readIndex(options.localnetRoot);
  const alreadyProcessed = new Set(index.processed_event_keys);
  const allEvents: ProtocolEvent[] = [];
  let pagesFetched = 0;
  let eventsSeen = 0;

  for (const moduleName of modules) {
    let cursor = pollerState.module_cursors[moduleName] ?? null;
    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      const page = await queryMoveModuleEvents({
        rpcUrl: options.rpcUrl,
        packageId: options.packageId,
        module: moduleName,
        cursor,
        limit,
        fetchImpl: options.fetchImpl
      });
      pagesFetched += 1;
      const normalized = normalizeSuiEvents(page.data ?? [], options.packageId);
      eventsSeen += normalized.length;
      allEvents.push(...normalized.filter((event) => !alreadyProcessed.has(protocolEventKey(event))));
      for (const event of normalized) {
        pollerState.last_checkpoints[moduleName] = Math.max(
          pollerState.last_checkpoints[moduleName] ?? 0,
          Number.isFinite(event.checkpoint) ? event.checkpoint : 0
        );
      }
      cursor = page.nextCursor ?? cursor;
      pollerState.module_cursors[moduleName] = cursor;
      if (!page.hasNextPage) {
        break;
      }
    }
  }

  if (allEvents.length) {
    await appendEvents(allEvents, options.localnetRoot);
    await applyEvents(index, allEvents, options);
  }
  index.updated_at = new Date().toISOString();
  await writeIndex(index, options.localnetRoot);

  const now = new Date().toISOString();
  const nextState: SuiEventPollerState = {
    ...pollerState,
    package_id: options.packageId,
    rpc_url: options.rpcUrl,
    pages_fetched: pollerState.pages_fetched + pagesFetched,
    events_seen: pollerState.events_seen + eventsSeen,
    events_ingested: pollerState.events_ingested + allEvents.length,
    updated_at: now
  };
  await writeSuiEventPollerState(nextState, options.localnetRoot);

  return {
    state: nextState,
    pages_fetched: pagesFetched,
    events_seen: eventsSeen,
    events_ingested: allEvents.length,
    cursors: nextState.module_cursors,
    index
  };
}
