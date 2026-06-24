import fs from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLiveIndex, releaseHasDeclaredFile } from "../src/core/live-index.js";

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe("live Sui/Walrus index", () => {
  it("trusts only artifact paths present in the release file manifest", () => {
    const release = {
      assets: { id: "ra:test" },
      files: [
        { path: "manifest.json" },
        { path: "README.md" },
        { path: "paper/main.pdf" },
        { path: "./paper/main.tex" }
      ]
    };
    expect(releaseHasDeclaredFile(release, "paper/main.pdf")).toBe(true);
    expect(releaseHasDeclaredFile(release, "paper/main.tex")).toBe(true);
    expect(releaseHasDeclaredFile(release, "paper/missing.tex")).toBe(false);
    expect(releaseHasDeclaredFile(release, "../paper/main.tex")).toBe(false);
    expect(releaseHasDeclaredFile(undefined, "paper/main.tex")).toBe(false);
  });

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
        const filter = body.params?.[0] as { MoveEventType?: string } | undefined;
        if (!filter?.MoveEventType?.endsWith("::research_asset::ResearchAssetPublished")) {
          return Response.json({ result: { data: [] } });
        }
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

  it("indexes skills, workflows, and graph relationships from the Walrus release manifest", async () => {
    const releaseBytes = await fs.readFile("fixtures/public-showcase/localnet/walrus/walrus_local_c58208ad2f099b3a68d70cea/release.tar.zst");
    const release = JSON.parse(await fs.readFile("fixtures/public-showcase/localnet/walrus/walrus_local_c58208ad2f099b3a68d70cea/manifest.json", "utf8")) as {
      manifest_hash: string;
      commit: string;
    };
    const packageId = "0xabc";
    const signer = `0x${"8a".repeat(32)}`;
    const assetId = `0x${"37".repeat(32)}`;
    const txDigest = "7MGBt7CZkUE1ep71iFse4kyydKzAKk4oXQEmBPqFLpXx";
    globalThis.fetch = vi.fn(async (url, init) => {
      if (String(url).includes("walrus")) {
        return new Response(releaseBytes);
      }
      if (!init?.body) {
        return ORIGINAL_FETCH(url, init);
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string; params?: unknown[] };
      if (body.method === "suix_queryEvents") {
        const filter = body.params?.[0] as { MoveEventType?: string } | undefined;
        if (!filter?.MoveEventType?.endsWith("::research_asset::ResearchAssetPublished")) {
          return Response.json({ result: { data: [] } });
        }
        return Response.json({
          result: {
            data: [{
              id: { txDigest, eventSeq: "0" },
              parsedJson: {
                asset_id: assetId,
                owner: signer,
                creator: signer,
                version: "0.1.0",
                manifest_hash: release.manifest_hash,
                walrus_blob_id: "walrus-loop-engine",
                repo_commit: release.commit,
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
              content: { fields: { manifest_hash: release.manifest_hash, walrus_blob_id: "walrus-loop-engine" } }
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

    expect(index.assets[0].title).toContain("Loop Engine");
    expect(index.assets[0].skills).toEqual([
      expect.objectContaining({
        id: "skill:loop-engine-cartographer@0.1.0",
        name: "loop-engine-cartographer",
        capabilities: expect.arrayContaining(["state-transition-graph"]),
        entry_path: "skill/loop-engine-cartographer/SKILL.md"
      })
    ]);
    expect(index.assets[0].workflows).toEqual([
      expect.objectContaining({
        id: "workflow:publish-loop-engine-asset@0.1.0",
        name: "publish-loop-engine-asset"
      })
    ]);
    expect(index.assets[0].relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({
        src_id: "ra:showcase:loop-engine",
        dst_id: "skill:loop-engine-cartographer@0.1.0",
        relation_type: "contains_skill"
      }),
      expect.objectContaining({
        src_id: "ra:showcase:loop-engine",
        dst_id: "workflow:publish-loop-engine-asset@0.1.0",
        relation_type: "contains_workflow"
      })
    ]));
  });

  it("indexes live membership events from Sui access and settlement modules", async () => {
    const packageId = "0xabc";
    const signer = `0x${"8a".repeat(32)}`;
    const passId = `0x${"ef".repeat(32)}`;
    const txDigest = "3CXbhwf9N8NYauAPo6kE6u54BbjBMAPNTVDY4RbSv8xG";
    const seenMoveEventTypes: string[] = [];
    globalThis.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string; params?: unknown[] };
      if (body.method === "suix_queryEvents") {
        const filter = body.params?.[0] as { MoveEventType?: string } | undefined;
        const moveEventType = String(filter?.MoveEventType ?? "");
        seenMoveEventTypes.push(moveEventType);
        if (moveEventType.endsWith("::research_asset::ResearchAssetPublished")) {
          return Response.json({ result: { data: [] } });
        }
        if (moveEventType.endsWith("::access::PlatformMembershipPurchased")) {
          return Response.json({
            result: {
              data: [{
                id: { txDigest, eventSeq: "0" },
                type: moveEventType,
                sender: signer,
                parsedJson: {
                  pass_id: passId,
                  owner: signer,
                  tier: 1,
                  started_ms: "1782207002124",
                  expires_ms: "1784799002124"
                },
                timestampMs: "1782207002124"
              }]
            }
          });
        }
        if (moveEventType.endsWith("::settlement::PlatformMembershipPaid")) {
          return Response.json({
            result: {
              data: [{
                id: { txDigest, eventSeq: "1" },
                type: moveEventType,
                sender: signer,
                parsedJson: {
                  buyer: signer,
                  amount: "1000000",
                  platform_fee: "200000",
                  duration_ms: "2592000000",
                  created_ms: "1782207002124"
                },
                timestampMs: "1782207002124"
              }]
            }
          });
        }
        return Response.json({ result: { data: [] } });
      }
      if (body.method === "sui_multiGetTransactionBlocks") {
        return Response.json({
          result: [{
            digest: txDigest,
            transaction: { data: { sender: signer, gasData: { owner: signer } } },
            effects: { status: { status: "success" } },
            balanceChanges: [{ owner: { AddressOwner: signer }, coinType: "0x2::sui::SUI", amount: "-3776280" }]
          }]
        });
      }
      if (body.method === "sui_multiGetObjects") {
        return Response.json({ result: [] });
      }
      throw new Error(`unexpected RPC method ${body.method}`);
    }) as typeof fetch;

    const index = await buildLiveIndex({
      rpcUrl: "https://sui.test",
      aggregatorUrl: "https://walrus.test",
      packageId,
      limit: 20
    });

    expect(seenMoveEventTypes).toContain(`${packageId}::access::PlatformMembershipPurchased`);
    expect(seenMoveEventTypes).toContain(`${packageId}::settlement::PlatformMembershipPaid`);
    expect(index.membership.counts).toMatchObject({
      platform_membership_passes: 1,
      platform_membership_payments: 1,
      total_events: 2
    });
    expect(index.membership.recent_events[0]).toMatchObject({
      tx_digest: txDigest,
      signer,
      gas_owner: signer,
      sui_spent_mist: "3776280"
    });
    expect(index.membership.recent_events.some((event) => event.object_id === passId)).toBe(true);
  });
});
