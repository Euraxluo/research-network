import { describe, expect, it } from "vitest";
import { resolveSkillFromLiveIndex } from "../src/core/skill-resolver.js";
import type { LiveIndexResult } from "../src/core/live-index.js";

const skillObjectId = "0xa683ea0b4a6b90610144d3e2e05fbf870076e32d31332dbbdc36f787c03b2784";

function liveIndex(): LiveIndexResult {
  return {
    generated_at: "2026-06-24T00:00:00.000Z",
    source: "live-sui-testnet+walrus-release-manifest",
    rpc_url: "https://sui-testnet-rpc.publicnode.com",
    package_id: "0xpackage",
    event_type: "0xpackage::research_asset::ResearchAssetPublished",
    aggregator_url: "https://aggregator.walrus-testnet.walrus.space",
    limit: 20,
    assets: [{
      id: "0x4141e4bd5c85d1c25adbde619ead911df044326497efb2383d9b73ecf37a4b18",
      sui_object_id: "0x4141e4bd5c85d1c25adbde619ead911df044326497efb2383d9b73ecf37a4b18",
      title: "Orbstack Loop Engine",
      authors: "Codex",
      abstract: "Loop engine research asset",
      types: ["paper", "skill"],
      tags: ["loop-engine"],
      created_at: "2026-06-24T00:00:00.000Z",
      manifest_hash: "sha256:manifest",
      manifest_hash_verified: true,
      repo_url: "https://github.com/Euraxluo/orbstack-loop-engine-research-asset",
      repo_commit: "98ab5507d757813d006116f0f01fb40896e37546",
      walrus_blob_id: "E5AV_dMv5f4XenTVEIF7-RccP4OPuK0Tl27GgF9-UUM",
      event_owner_address: "0xowner",
      creator_address: "0xcreator",
      object_owner_address: "0xowner",
      tx_sender: "0xsender",
      gas_owner: "0xgas",
      sui_spent_mist: "1000",
      tx_digest: "BaBF7je2fjHzk7ZnUDmUvVGNSzd9UyHkkSGDxq53SsbR",
      release_manifest_status: "resolved",
      paper: {},
      skills: [{
        id: skillObjectId,
        global_ref: "rn:skill:sui-testnet:0x4141:skill:orbstack-loop-engine@0.1.0",
        manifest_id: "skill:orbstack-loop-engine@0.1.0",
        source_asset_id: "0x4141e4bd5c85d1c25adbde619ead911df044326497efb2383d9b73ecf37a4b18",
        on_chain_status: "published",
        name: "orbstack-loop-engine",
        version: "0.1.0",
        description: "Turns loop-engine observations into research operations.",
        capabilities: ["loop-engine"],
        path: "skill/orbstack-loop-engine/skill.yaml",
        relation: "owned",
        entry_path: "skill/orbstack-loop-engine/SKILL.md",
        access_visibility: "public",
        depends_on: [],
        derived_from: null
      }],
      workflows: [],
      relationships: [],
      proof: {
        tx_success: true,
        sender_match: true,
        object_type_match: true,
        owner_match: true,
        gas_paid: true,
        blob_match: true,
        manifest_match: true,
        release_manifest_match: true
      }
    }],
    membership: {
      source: "live-sui-testnet-events",
      event_types: [],
      counts: {
        platform_membership_passes: 0,
        platform_membership_payments: 0,
        agent_subscription_passes: 0,
        agent_subscription_payments: 0,
        access_receipts: 0,
        membership_settlements: 0,
        agent_earnings_claims: 0,
        total_events: 0
      },
      recent_events: []
    },
    delegations: {
      source: "live-sui-testnet-events",
      event_types: [],
      counts: {
        created: 0,
        accepted: 0,
        funded: 0,
        submitted: 0,
        completed: 0,
        refunded: 0,
        disputed: 0,
        resolved: 0,
        total_events: 0
      },
      recent_events: []
    }
  };
}

describe("live skill resolver", () => {
  it("uses the on-chain SkillAsset object id as the canonical global skill id", () => {
    const resolved = resolveSkillFromLiveIndex(liveIndex(), skillObjectId);
    expect(resolved).toMatchObject({
      skill_object_id: skillObjectId,
      canonical_id: skillObjectId,
      manifest_id: "skill:orbstack-loop-engine@0.1.0",
      source_asset_id: "0x4141e4bd5c85d1c25adbde619ead911df044326497efb2383d9b73ecf37a4b18",
      paths: {
        skill_yaml: "skill/orbstack-loop-engine/skill.yaml",
        skill_entry: "skill/orbstack-loop-engine/SKILL.md"
      },
      install_command: `research install ${skillObjectId}`
    });
    expect(resolved?.artifact_urls.skill_entry).toContain("blob=E5AV_dMv5f4XenTVEIF7-RccP4OPuK0Tl27GgF9-UUM");
    expect(resolved?.artifact_urls.skill_entry).toContain("path=skill%2Forbstack-loop-engine%2FSKILL.md");
  });

  it("does not resolve package-local manifest ids as global skill ids", () => {
    expect(resolveSkillFromLiveIndex(liveIndex(), "skill:orbstack-loop-engine@0.1.0")).toBeUndefined();
  });
});
