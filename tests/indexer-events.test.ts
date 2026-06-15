import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyEvents,
  emptyIndexState,
  getGraph,
  ingestSuiEvents,
  normalizeSuiEvents,
  pollSuiEvents,
  readEvents,
  readIndex,
  readSuiEventPollerState,
  type ProtocolEvent,
  ResearchClient,
  summarizeAssetEconomics,
  writeIndex
} from "../src/index.js";

let seq = 0;
function ev(event_type: string, payload: Record<string, unknown>, checkpoint = 1): ProtocolEvent {
  const event_seq = seq++;
  return {
    tx_digest: `tx_${event_type}_${event_seq}`,
    event_seq,
    event_type,
    checkpoint,
    timestamp_ms: 1_700_000_000_000,
    payload
  };
}

// One event of every projected v2 type. Mirrors the canonical event catalog in docs/17 裁决 2.
function fullCatalog(): ProtocolEvent[] {
  return [
    ev("AssetCited", { src_asset_id: "ra:a", dst_asset_id: "ra:b", relation_type: "cites", caller: "0xA" }),
    ev("AssetForked", { parent_asset_id: "ra:a", child_asset_id: "ra:c", included_mask: 5, caller: "0xC" }),
    ev("SkillInstalled", { skill_id: "sk:1", workspace_asset_id: "ra:c", install_mode: 1, installer: "0xC" }),
    ev("RevenuePoolCreated", { pool_id: "pool:1", asset_id: "ra:a", recipients: ["0xA", "0xB"], weights_bps: [6000, 4000] }),
    ev("RevenueDeposited", { pool_id: "pool:1", from: "0xBuyer", amount: 1000, total_received: 1000 }),
    ev("RevenueClaimed", { pool_id: "pool:1", claimer: "0xA", amount: 600 }),
    ev("ResearchReportPublished", { report_id: "rep:1", agent: "0xA", asset_id: "ra:a", title: "Encrypted Study", visibility: "encrypted", required_tier: 1, walrus_blob_id: "walrus:report", seal_id: "seal:1", ciphertext_hash: "cipher", plaintext_commitment: "plain", free_preview: "preview" }),
    ev("AgentChannelCreated", { channel_id: "chan:1", agent: "0xA", metadata_hash: "channel-meta" }),
    ev("PlatformMembershipPurchased", { pass_id: "pm:1", owner: "0xB", tier: 1, started_ms: 1_700_000_000_000, expires_ms: 1_700_086_400_000 }),
    ev("AgentSubscriptionPurchased", { pass_id: "sub:1", owner: "0xB", agent: "0xA", tier: 1, started_ms: 1_700_000_000_000, expires_ms: 1_700_086_400_000 }),
    ev("AccessReceiptRecorded", { receipt_id: "read:1", period_id: 202606, user: "0xB", report_id: "rep:1", agent: "0xA", access_type: "platform_member" }),
    ev("MembershipReportSettled", { period_id: 202606, user: "0xB", report_id: "rep:1", agent: "0xA", amount: 500 }),
    ev("DelegationCreated", { job_id: "job:1", buyer: "0xB", agent: "0xA", budget: 1000, deadline_ms: 1_700_086_400_000 }),
    ev("DelegationAccepted", { job_id: "job:1", agent: "0xA" }),
    ev("DelegationFunded", { job_id: "job:1", buyer: "0xB", amount: 1000 }),
    ev("DelegationResultSubmitted", { job_id: "job:1", report_id: "rep:private", agent: "0xA" }),
    ev("DelegationDisputeOpened", { job_id: "job:1", opened_by: "0xB", arbitrator: "0xD" }),
    ev("AgentPassportCreated", { passport_id: "ap:1", owner: "0xA", name: "octo" }),
    ev("ReputationCreated", { reputation_id: "rep:1", owner: "0xA", score: 10 }),
    ev("ReputationAdjusted", { reputation_id: "rep:1", owner: "0xA", delta: 5, new_score: 15 }),
    ev("BadgeIssued", { badge_id: "bdg:1", asset_id: "ra:a", recipient: "0xB", issuer: "0xA", badge_type: 2 }),
    ev("CrossChainPaymentReceived", { order_hash: "order-1", source_chain: "ethereum", source_tx: "0xdead", buyer: "0xB", amount: 1000 })
  ];
}

function edge(index: ReturnType<typeof emptyIndexState>, src: string, dst: string, relationType: string) {
  return Object.values(index.relationships).find(
    (r) => r.src_id === src && r.dst_id === dst && r.relation_type === relationType
  );
}

describe("indexer v2 event catalog", () => {
  it("projects the full v2 event catalog into graph + economic state", async () => {
    const index = emptyIndexState();
    await applyEvents(index, fullCatalog());

    // Graph projection from canonical relationship events.
    expect(edge(index, "ra:a", "ra:b", "cites")).toBeTruthy();
    expect(edge(index, "ra:a", "ra:c", "fork")?.metadata.included_mask).toBe(5);
    expect(edge(index, "ra:c", "sk:1", "installs_skill")?.metadata.install_mode).toBe(1);

    // Revenue escrow accounting.
    const pool = index.revenue_pools["pool:1"];
    expect(pool.total_received).toBe(1000);
    expect(pool.total_claimed).toBe(600);
    expect(pool.claimed_by["0xA"]).toBe(600);
    expect(pool.recipients).toEqual(["0xA", "0xB"]);

    // Seal Access commerce.
    expect(index.reports["rep:1"]).toMatchObject({ visibility: "encrypted", required_tier: 1, agent: "0xA" });
    expect(index.agent_channels["chan:1"].agent).toBe("0xA");
    expect(index.platform_memberships["pm:1"].owner_address).toBe("0xB");
    expect(index.agent_subscriptions["sub:1"].agent).toBe("0xA");
    expect(index.access_receipts["read:1"]).toMatchObject({ report_id: "rep:1", access_type: "platform_member" });
    expect(index.agent_earnings["0xA"].total_earned).toBe(500);
    expect(index.delegations["job:1"]).toMatchObject({ status: "disputed", result_report_id: "rep:private", arbitrator: "0xD" });

    // Identity / reputation / badge / cross-chain payment.
    expect(index.agents["ap:1"].name).toBe("octo");
    expect(index.reputations["rep:1"].score).toBe(15);
    expect(index.badges["bdg:1"].badge_type).toBe(2);
    expect(index.payments["order-1"]).toMatchObject({ source_chain: "ethereum", amount: 1000 });

    expect(index.search_documents["rep:1"]?.entity_type).toBe("report");
  });

  it("is idempotent — replaying the same events does not double cumulative state", async () => {
    const events = fullCatalog();
    const index = emptyIndexState();
    await applyEvents(index, events);
    const relCount = Object.keys(index.relationships).length;

    // Replay the exact same log.
    await applyEvents(index, events);

    expect(index.processed_event_keys.length).toBe(events.length);
    expect(index.events.length).toBe(events.length);
    expect(Object.keys(index.relationships).length).toBe(relCount);
    expect(index.revenue_pools["pool:1"].total_claimed).toBe(600); // not 1200
    expect(index.revenue_pools["pool:1"].claimed_by["0xA"]).toBe(600);
  });

  it("records unknown event types without projecting or throwing (forward compatible)", async () => {
    const index = emptyIndexState();
    const unknown = ev("SomeFutureEvent", { foo: "bar" });
    await applyEvents(index, [unknown]);
    expect(index.processed_event_keys).toContain(`${unknown.tx_digest}:${unknown.event_seq}`);
    expect(index.events).toHaveLength(1);
  });

  it("publishes standalone reports through the SDK with Seal field validation", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rn-report-sdk-"));
    const client = new ResearchClient({ localnetRoot: root });
    await expect(client.publishReport({
      agent: "0xA",
      title: "Missing Seal",
      visibility: "encrypted"
    })).rejects.toThrow(/walrusBlobId/);

    const result = await client.publishReport({
      agent: "0xA",
      title: "Encrypted Standalone Report",
      visibility: "encrypted",
      walrusBlobId: "walrus:report:1",
      sealId: "seal:report:1",
      ciphertextHash: "sha256:cipher",
      plaintextCommitment: "sha256:plain",
      freePreview: "Only the preview is public."
    });
    const index = await readIndex(root);
    expect(index.reports[result.reportId]).toMatchObject({
      title: "Encrypted Standalone Report",
      visibility: "encrypted",
      seal_id: "seal:report:1"
    });
    expect(index.search_documents[result.reportId]?.body).toContain("Only the preview is public.");
  });

  it("getGraph returns cite and fork edges around an asset", async () => {
    const index = emptyIndexState();
    await applyEvents(index, fullCatalog());
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rn-graph-"));
    await writeIndex(index, root);

    const graph = await getGraph("ra:a", root);
    const relTypes = graph.edges.map((e) => e.relation_type).sort();
    expect(relTypes).toContain("cites");
    expect(relTypes).toContain("fork");
    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toEqual(expect.arrayContaining(["ra:a", "ra:b", "ra:c"]));
  });
});

describe("indexer economic queries", () => {
  function ecoEvents(): ProtocolEvent[] {
    return [
      ev("SkillPublished", { skill_id: "sk:1", sui_object_id: "0xsk1", source_asset_id: "ra:eco", name: "eco-skill", version: "0.1.0", walrus_blob_id: "walrus:local:eco", manifest_hash: "h" }),
      ev("RevenuePoolCreated", { pool_id: "pool:eco", asset_id: "ra:eco", recipients: ["0xA"], weights_bps: [10000] }),
      ev("RevenueDeposited", { pool_id: "pool:eco", amount: 500, total_received: 500 }),
      ev("RevenueClaimed", { pool_id: "pool:eco", claimer: "0xA", amount: 200 }),
      ev("ResearchReportPublished", { report_id: "rep:eco", agent: "0xA", asset_id: "ra:eco", title: "Eco Report", visibility: "encrypted", required_tier: 1, walrus_blob_id: "walrus:report", seal_id: "seal", ciphertext_hash: "cipher", plaintext_commitment: "plain", free_preview: "economics preview" }),
      ev("AccessReceiptRecorded", { receipt_id: "read:eco", period_id: 202606, user: "0xB", report_id: "rep:eco", agent: "0xA", access_type: "platform_member" }),
      ev("MembershipReportSettled", { period_id: 202606, user: "0xB", report_id: "rep:eco", agent: "0xA", amount: 500 }),
      ev("CrossChainPaymentReceived", { order_hash: "o-eco", source_chain: "solana", source_tx: "0x9", buyer: "0xB", amount: 500 })
    ];
  }

  it("summarizeAssetEconomics aggregates revenue pools + Seal Access reports for an asset", async () => {
    const index = emptyIndexState();
    await applyEvents(index, ecoEvents());
    const eco = summarizeAssetEconomics(index, "ra:eco");
    expect(eco.total_received).toBe(500);
    expect(eco.total_claimed).toBe(200);
    expect(eco.unclaimed).toBe(300);
    expect(eco.report_count).toBe(1);
    expect(eco.access_count).toBe(1);
    expect(eco.reports[0]?.id).toBe("rep:eco");
    expect(eco.agent_earnings[0]?.total_earned).toBe(500);
    expect(eco.revenue_pools[0]?.id).toBe("pool:eco");
  });

  it("ResearchClient exposes economic state from the index", async () => {
    const index = emptyIndexState();
    await applyEvents(index, ecoEvents());
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rn-sdk-"));
    await writeIndex(index, root);
    const client = new ResearchClient({ localnetRoot: root });

    expect(await client.listRevenuePools()).toHaveLength(1);
    expect((await client.getRevenuePool("pool:eco"))?.total_received).toBe(500);
    expect(await client.listReports()).toHaveLength(1);
    expect((await client.listPayments())[0]?.amount).toBe(500);
    expect((await client.assetEconomics("ra:eco")).unclaimed).toBe(300);
  });

  it("ResearchClient records local Seal Access actions through event projections", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rn-access-actions-"));
    const client = new ResearchClient({ localnetRoot: root });

    await client.buyPlatformMembership({ ownerAddress: "0xB", tier: 1, durationDays: 30 });
    await client.subscribeAgent({ ownerAddress: "0xB", agent: "0xA", amount: 1000 });
    const created = await client.createDelegationJob({ buyer: "0xB", agent: "0xA", budget: 2500 });
    await client.acceptDelegationJob({ jobId: created.jobId, agent: "0xA" });
    const submitted = await client.submitPrivateResult({
      jobId: created.jobId,
      agent: "0xA",
      walrusBlobId: "walrus:private",
      sealId: "seal:private",
      ciphertextHash: "cipher",
      plaintextCommitment: "plain"
    });
    await client.recordAccessReceipt({ periodId: 202606, user: "0xB", reportId: submitted.reportId, agent: "0xA" });
    const duplicateReceipt = await client.recordAccessReceipt({ periodId: 202606, user: "0xB", reportId: submitted.reportId, agent: "0xA" });
    await client.settleMembershipPeriod({ periodId: 202606, user: "0xB", grossAmount: 1000 });

    const index = await readIndex(root);
    expect(Object.values(index.platform_memberships)).toHaveLength(1);
    expect(Object.values(index.agent_subscriptions)).toHaveLength(1);
    expect(index.delegations[created.jobId]).toMatchObject({ status: "submitted", result_report_id: submitted.reportId });
    expect(index.reports[submitted.reportId]?.visibility).toBe("private_delegation");
    expect(index.search_documents[submitted.reportId]).toBeUndefined();
    expect(Object.values(index.access_receipts)).toHaveLength(1);
    expect(duplicateReceipt.existing).toBe(true);
    expect(index.agent_earnings["0xA"].total_earned).toBe(1700);
  });
});

describe("Sui event normalization", () => {
  const PKG = "0x03d2";
  function raw(type: string, parsedJson: Record<string, unknown>, eventSeq = "0", txDigest = "tx", packageId = PKG) {
    return { id: { txDigest, eventSeq }, type, parsedJson, timestampMs: "1700000000000", checkpoint: "42", packageId };
  }

  it("normalizes protocol events and drops foreign ones", () => {
    const events = normalizeSuiEvents([
      raw(`${PKG}::revenue::RevenueClaimed`, { pool_id: "0xpool", claimer: "0xA", amount: "600", created_ms: "1700000000000" }),
      raw("0x2::coin::CoinBalanceChange", { amount: "1" }, "1")
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]?.event_type).toBe("RevenueClaimed");
    expect(events[0]?.tx_digest).toBe("tx");
    expect(events[0]?.payload.amount).toBe("600");
  });

  it("ingests raw Sui events into the index (publish + claim + fork)", async () => {
    const index = emptyIndexState();
    await ingestSuiEvents(index, [
      raw(`${PKG}::revenue::RevenuePoolCreated`, { pool_id: "0xpool", asset_id: "0xasset" }, "0", "tx1"),
      raw(`${PKG}::revenue::RevenueDeposited`, { pool_id: "0xpool", amount: "1000", total_received: "1000" }, "1", "tx1"),
      raw(`${PKG}::revenue::RevenueClaimed`, { pool_id: "0xpool", claimer: "0xA", amount: "600" }, "2", "tx1"),
      raw(`${PKG}::research_asset::AssetForked`, { parent_asset_id: "0xp", child_asset_id: "0xc", included_mask: "5" }, "3", "tx1")
    ], { packageId: PKG });

    expect(index.revenue_pools["0xpool"]?.total_received).toBe(1000);
    expect(index.revenue_pools["0xpool"]?.total_claimed).toBe(600);
    const forkEdge = Object.values(index.relationships).find((r) => r.relation_type === "fork");
    expect(forkEdge?.src_id).toBe("0xp");
    expect(forkEdge?.dst_id).toBe("0xc");
  });

  it("filters events emitted by a different package id", () => {
    const events = normalizeSuiEvents([
      raw(`0xOTHER::revenue::RevenueClaimed`, { pool_id: "x" }, "0", "tx", "0xOTHER")
    ], PKG);
    expect(events).toHaveLength(0);
  });

  it("polls Sui RPC pages incrementally and persists module cursors", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rn-sui-poll-"));
    const calls: Array<{ module: string; cursor: unknown }> = [];
    const pages = [
      {
        data: [
          raw(`${PKG}::revenue::RevenuePoolCreated`, { pool_id: "0xpool", asset_id: "0xasset" }, "0", "tx1"),
          raw(`${PKG}::revenue::RevenueDeposited`, { pool_id: "0xpool", amount: "1000", total_received: "1000" }, "1", "tx1")
        ],
        nextCursor: { txDigest: "tx1", eventSeq: "1" },
        hasNextPage: true
      },
      {
        data: [
          raw(`${PKG}::revenue::RevenueClaimed`, { pool_id: "0xpool", claimer: "0xA", amount: "600" }, "2", "tx1")
        ],
        nextCursor: { txDigest: "tx1", eventSeq: "2" },
        hasNextPage: false
      },
      {
        data: [],
        nextCursor: { txDigest: "tx1", eventSeq: "2" },
        hasNextPage: false
      }
    ];
    let pageIndex = 0;
    const fetchImpl = async (_url: string, init: { body: string }) => {
      const request = JSON.parse(init.body);
      calls.push({ module: request.params[0].MoveModule.module, cursor: request.params[1] });
      return { ok: true, status: 200, json: async () => ({ result: pages[pageIndex++] ?? pages.at(-1) }) };
    };

    const first = await pollSuiEvents({
      localnetRoot: root,
      rpcUrl: "https://rpc.example",
      packageId: PKG,
      modules: ["revenue"],
      maxPagesPerModule: 4,
      limit: 2,
      fetchImpl
    });

    expect(first.pages_fetched).toBe(2);
    expect(first.events_ingested).toBe(3);
    expect(first.index.revenue_pools["0xpool"]).toMatchObject({ total_received: 1000, total_claimed: 600 });
    expect(await readEvents(root)).toHaveLength(3);
    expect((await readSuiEventPollerState(root)).module_cursors.revenue).toEqual({ txDigest: "tx1", eventSeq: "2" });
    expect(calls.map((call) => call.cursor)).toEqual([null, { txDigest: "tx1", eventSeq: "1" }]);

    const second = await pollSuiEvents({
      localnetRoot: root,
      rpcUrl: "https://rpc.example",
      packageId: PKG,
      modules: ["revenue"],
      fetchImpl
    });
    expect(second.events_ingested).toBe(0);
    expect(await readEvents(root)).toHaveLength(3);
    expect(calls.at(-1)?.cursor).toEqual({ txDigest: "tx1", eventSeq: "2" });
  });
});
