import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../web/src/lib/config.ts", () => ({
  loadM3Config: () => ({
    network: "mainnet",
    suiRpcUrl: "https://fullnode.mainnet.sui.io:443",
    packageId: "0x" + "11".repeat(32),
    settlementConfigId: "0x" + "22".repeat(32),
    agentEarningsId: "0x" + "33".repeat(32),
    membershipReceiptRegistryId: "0x" + "44".repeat(32),
    walrusPublisherUrl: "https://publisher.walrus.space",
    walrusAggregatorUrl: "https://aggregator.walrus.space",
    walrusEpochs: 5,
    sealKeyServers: [{
      objectId: "0x" + "55".repeat(32),
      weight: 1,
      aggregatorUrl: "https://seal-aggregator.mainnet.example"
    }],
    sealThreshold: 1,
    platformMembershipPriceMist: "1000000",
    agentSubscriptionPriceMist: "1000000",
    delegationBudgetMist: "1000000",
    membershipSettlementShareMist: "800000",
    accessDurationMs: 2592000000
  })
}));

const VALID_BROWSER_ADDRESS = "0xb178126020d69bb24ecd6a39ac5db18a8badae973dae0e9b20a889a68b609d7f";

describe("mainnet workbench demo fallback guard", () => {
  beforeEach(() => {
    vi.resetModules();
    const dom = new JSDOM("<!doctype html><html><body></body></html>", {
      url: "http://127.0.0.1/workbench.html?rn_demo=1",
      pretendToBeVisual: true
    });
    const globals: Record<string, unknown> = {
      window: dom.window,
      document: dom.window.document,
      localStorage: dom.window.localStorage,
      sessionStorage: dom.window.sessionStorage,
      location: dom.window.location,
      URLSearchParams: dom.window.URLSearchParams
    };
    for (const [key, value] of Object.entries(globals)) {
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
    localStorage.setItem("rn_session", JSON.stringify({
      provider: "google",
      address: VALID_BROWSER_ADDRESS,
      sub: "mainnet-subject",
      iss: "https://accounts.google.com",
      ts: Date.now()
    }));
    localStorage.setItem("rn_github", JSON.stringify({
      sui_address: VALID_BROWSER_ADDRESS,
      login: "agent",
      selected_repo: "agent/research",
      repos: ["agent/research"]
    }));
  });

  it("blocks local demo writes for mainnet commerce and delegation actions without a signer", async () => {
    const storeModulePath = "../web/src/lib/store.ts";
    const { useWorkbench } = await import(storeModulePath);
    const state = useWorkbench.getState();

    await state.buyMembership();
    expect(useWorkbench.getState().statusText).toContain("Mainnet membership purchase requires a live zkLogin signer");

    await state.subscribeAgent();
    expect(useWorkbench.getState().statusText).toContain("Mainnet agent subscription requires a live zkLogin signer");

    await state.createDelegation();
    expect(useWorkbench.getState().statusText).toContain("Mainnet delegation creation requires a live zkLogin signer");

    await state.settleLatestMembershipReceipt();
    expect(useWorkbench.getState().statusText).toContain("Mainnet receipt settlement requires a live zkLogin signer");

    await state.claimAgentEarnings();
    expect(useWorkbench.getState().statusText).toContain("Mainnet earnings claim requires a live zkLogin signer");

    await state.publish({
      title: "Mainnet report",
      visibility: "encrypted",
      tier: 1,
      preview: "preview",
      plaintext: "body"
    });
    expect(useWorkbench.getState().statusText).toContain("Mainnet publishing requires a live zkLogin signer");

    const persisted = JSON.parse(localStorage.getItem("rn_workbench_state") ?? "{}") as {
      reports?: unknown[];
      platform_memberships?: unknown[];
      agent_subscriptions?: unknown[];
      delegations?: unknown[];
    };
    expect(persisted.reports ?? []).toEqual([]);
    expect(persisted.platform_memberships ?? []).toEqual([]);
    expect(persisted.agent_subscriptions ?? []).toEqual([]);
    expect(persisted.delegations ?? []).toEqual([]);
  });
});
