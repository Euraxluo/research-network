import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLiveIndex } from "../src/core/live-index.js";

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe("live Sui/Walrus index", () => {
  it("indexes transaction signer and gas evidence for live research assets", async () => {
    const rpcBodies: Array<{ method?: string; params?: unknown[] }> = [];
    const packageId = "0xabc";
    const signer = `0x${"8a".repeat(32)}`;
    const assetId = `0x${"37".repeat(32)}`;
    const txDigest = "7MGBt7CZkUE1ep71iFse4kyydKzAKk4oXQEmBPqFLpXx";
    globalThis.fetch = vi.fn(async (url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string; params?: unknown[] };
      if (String(url).includes("walrus")) {
        return new Response("not available in this unit test", { status: 404 });
      }
      rpcBodies.push(body);
      if (body.method === "suix_queryEvents") {
        return Response.json({
          result: {
            data: [{
              id: { txDigest, eventSeq: "0" },
              parsedJson: {
                asset_id: assetId,
                owner: signer,
                creator: signer,
                version: "0.1.0",
                manifest_hash: "sha256:test",
                walrus_blob_id: "blob123",
                repo_commit: "abc1234",
                created_ms: "1782189126775"
              }
            }]
          }
        });
      }
      if (body.method === "sui_multiGetObjects") {
        return Response.json({
          result: [{
            data: {
              objectId: assetId,
              type: `${packageId}::research_asset::ResearchAsset`,
              owner: { AddressOwner: signer },
              content: { fields: { manifest_hash: "sha256:test", walrus_blob_id: "blob123" } }
            }
          }]
        });
      }
      if (body.method === "sui_multiGetTransactionBlocks") {
        return Response.json({
          result: [{
            digest: txDigest,
            transaction: { data: { sender: signer, gasData: { owner: signer } } },
            effects: { status: { status: "success" } },
            balanceChanges: [{ owner: { AddressOwner: signer }, coinType: "0x2::sui::SUI", amount: "-4262680" }]
          }]
        });
      }
      throw new Error(`unexpected RPC method ${body.method}`);
    }) as typeof fetch;

    const index = await buildLiveIndex({
      rpcUrl: "https://sui.test",
      aggregatorUrl: "https://walrus.test",
      packageId,
      limit: 1
    });

    const txRequest = rpcBodies.find((body) => body.method === "sui_multiGetTransactionBlocks");
    expect(txRequest?.params?.[1]).toMatchObject({
      showInput: true,
      showEffects: true,
      showEvents: true,
      showBalanceChanges: true
    });
    expect(index.assets[0]).toMatchObject({
      event_owner_address: signer,
      creator_address: signer,
      object_owner_address: signer,
      tx_sender: signer,
      gas_owner: signer,
      sui_spent_mist: "4262680",
      proof: {
        tx_success: true,
        sender_match: true,
        object_type_match: true,
        owner_match: true,
        gas_paid: true,
        blob_match: true,
        manifest_match: true
      }
    });
  });
});
