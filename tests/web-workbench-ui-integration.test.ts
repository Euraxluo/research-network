import { createElement } from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AGENT = "0x" + "a1".repeat(32);
const BUYER = "0x" + "b2".repeat(32);
const REPORT_ID = "0x" + "01".repeat(32);
const MEMBERSHIP_ID = "0x" + "02".repeat(32);
const SUBSCRIPTION_ID = "0x" + "03".repeat(32);
const DELEGATION_ID = "0x" + "04".repeat(32);
const RECEIPT_ID = "0x" + "05".repeat(32);
const PRIVATE_REPORT_ID = "0x" + "06".repeat(32);
const REPORT_SEAL_ID = "0x" + "07".repeat(32);
const PRIVATE_SEAL_ID = "0x" + "08".repeat(32);

const mocks = vi.hoisted(() => {
  const state = {
    currentSigner: null as null | {
      address: string;
      signAndExecuteTransaction: ReturnType<typeof vi.fn>;
      signPersonalMessage: ReturnType<typeof vi.fn>;
    }
  };
  return {
    state,
    buildZkLoginSigner: vi.fn(async () => state.currentSigner),
    publishReport: vi.fn(),
    publishReportDemo: vi.fn(),
    buyPlatformMembershipOnChain: vi.fn(),
    buyAgentSubscriptionOnChain: vi.fn(),
    createDelegationJobOnChain: vi.fn(),
    fundDelegationJobOnChain: vi.fn(),
    publishPrivateResultOnChain: vi.fn(),
    decryptReportOnChain: vi.fn(),
    recordPlatformAccessReceiptOnChain: vi.fn(),
    settleMembershipReportOnChain: vi.fn(),
    claimAgentEarningsOnChain: vi.fn(),
    completeDelegationJobOnChain: vi.fn(),
    openDisputeOnChain: vi.fn(),
    submitPrivateResultDemo: vi.fn()
  };
});

vi.mock("../web/src/lib/config.ts", () => ({
  loadM3Config: () => ({
    network: "testnet",
    suiRpcUrl: "https://sui-testnet-rpc.publicnode.com",
    packageId: "0x" + "11".repeat(32),
    settlementConfigId: "0x" + "22".repeat(32),
    agentEarningsId: "0x" + "33".repeat(32),
    membershipReceiptRegistryId: "0x" + "44".repeat(32),
    walrusPublisherUrl: "https://publisher.walrus-testnet.walrus.space",
    walrusAggregatorUrl: "https://aggregator.walrus-testnet.walrus.space",
    walrusEpochs: 5,
    sealKeyServers: [{
      objectId: "0x" + "55".repeat(32),
      weight: 1,
      aggregatorUrl: "https://seal-aggregator-testnet.mystenlabs.com"
    }],
    sealThreshold: 1,
    platformMembershipPriceMist: "1000000",
    agentSubscriptionPriceMist: "1000000",
    delegationBudgetMist: "1000000",
    membershipSettlementShareMist: "800000",
    accessDurationMs: 2592000000
  })
}));

vi.mock("../web/src/lib/signer.ts", () => ({
  buildZkLoginSigner: mocks.buildZkLoginSigner
}));

vi.mock("../web/src/lib/clients.ts", () => ({
  publishReport: mocks.publishReport,
  publishReportDemo: mocks.publishReportDemo,
  buyPlatformMembershipOnChain: mocks.buyPlatformMembershipOnChain,
  buyAgentSubscriptionOnChain: mocks.buyAgentSubscriptionOnChain,
  createDelegationJobOnChain: mocks.createDelegationJobOnChain,
  fundDelegationJobOnChain: mocks.fundDelegationJobOnChain,
  publishPrivateResultOnChain: mocks.publishPrivateResultOnChain,
  decryptReport: mocks.decryptReportOnChain,
  recordPlatformAccessReceiptOnChain: mocks.recordPlatformAccessReceiptOnChain,
  settleMembershipReportOnChain: mocks.settleMembershipReportOnChain,
  claimAgentEarningsOnChain: mocks.claimAgentEarningsOnChain,
  completeDelegationJobOnChain: mocks.completeDelegationJobOnChain,
  openDisputeOnChain: mocks.openDisputeOnChain,
  submitPrivateResultDemo: mocks.submitPrivateResultDemo
}));

let dom: JSDOM;
let root: ReturnType<typeof createRoot> | null = null;

function makeSigner(address: string) {
  return {
    address,
    signAndExecuteTransaction: vi.fn(),
    signPersonalMessage: vi.fn()
  };
}

function installDom(): void {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "http://127.0.0.1/workbench.html?rn_demo=1",
    pretendToBeVisual: true
  });
  const globals: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    sessionStorage: dom.window.sessionStorage,
    navigator: dom.window.navigator,
    location: dom.window.location,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLSelectElement: dom.window.HTMLSelectElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    IS_REACT_ACT_ENVIRONMENT: true
  };
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
}

function seedAgentSession(): void {
  dom.window.localStorage.setItem(
    "rn_session",
    JSON.stringify({
      provider: "google",
      address: AGENT,
      email: "agent@example.com"
    })
  );
  dom.window.localStorage.setItem(
    "rn_github",
    JSON.stringify({
      sui_address: AGENT,
      login: "octo-agent",
      installation_id: 101,
      account: "octo-agent",
      account_type: "User",
      selected_installation_ids: ["101"],
      selected_repo: "octo-agent/research-alpha",
      repos: ["octo-agent/research-alpha"],
      available_repos: [{
        full_name: "octo-agent/research-alpha",
        installation_id: 101,
        installation_account: "octo-agent",
        installation_account_type: "User"
      }]
    })
  );
}

function installClientMocks(): void {
  mocks.publishReport.mockImplementation(async (input: {
    title: string;
    visibility: "public" | "encrypted" | "private_delegation";
    requiredTier: number;
    freePreview: string;
    plaintext: string;
    sourceRepo: string;
  }, signer: { address: string }) => ({
    report: {
      id: REPORT_ID,
      sui_object_id: REPORT_ID,
      tx_digest: "tx-publish-report",
      agent: signer.address,
      visibility: input.visibility,
      required_tier: input.requiredTier,
      walrus_blob_id: "walrus-report-blob",
      seal_id: REPORT_SEAL_ID,
      ciphertext_hash: "sha256:cipher",
      plaintext_commitment: "sha256:plain",
      title: input.title,
      free_preview: input.freePreview,
      created_at: "2026-06-17T00:00:00.000Z",
      source_repo: input.sourceRepo
    },
    plaintext: input.plaintext,
    txDigest: "tx-publish-report"
  }));
  mocks.buyPlatformMembershipOnChain.mockResolvedValue({
    digest: "tx-buy-membership",
    objectId: MEMBERSHIP_ID
  });
  mocks.buyAgentSubscriptionOnChain.mockResolvedValue({
    digest: "tx-buy-subscription",
    objectId: SUBSCRIPTION_ID
  });
  mocks.createDelegationJobOnChain.mockResolvedValue({
    digest: "tx-create-delegation",
    objectId: DELEGATION_ID
  });
  mocks.fundDelegationJobOnChain.mockResolvedValue("tx-fund-delegation");
  mocks.publishPrivateResultOnChain.mockImplementation(async (input: {
    signer: { address: string };
    jobObjectId: string;
    title: string;
    freePreview: string;
    plaintext: string;
    sourceRepo: string;
  }) => ({
    report: {
      id: PRIVATE_REPORT_ID,
      sui_object_id: PRIVATE_REPORT_ID,
      tx_digest: "tx-private-result",
      agent: input.signer.address,
      visibility: "private_delegation",
      required_tier: 0,
      walrus_blob_id: "walrus-private-blob",
      seal_id: PRIVATE_SEAL_ID,
      ciphertext_hash: "sha256:private-cipher",
      plaintext_commitment: "sha256:private-plain",
      free_preview_hash: "sha256:private-preview",
      delegation_job_id: input.jobObjectId,
      title: input.title,
      free_preview: input.freePreview,
      created_at: "2026-06-17T00:00:01.000Z",
      source_repo: input.sourceRepo
    },
    plaintext: input.plaintext,
    txDigest: "tx-private-result"
  }));
  mocks.decryptReportOnChain.mockImplementation(async (_report: unknown, moduleFn: string) =>
    "decrypted via " + moduleFn
  );
  mocks.recordPlatformAccessReceiptOnChain.mockResolvedValue({
    digest: "tx-record-receipt",
    objectId: RECEIPT_ID
  });
  mocks.settleMembershipReportOnChain.mockResolvedValue("tx-settle-receipt");
  mocks.claimAgentEarningsOnChain.mockResolvedValue("tx-claim-earnings");
  mocks.completeDelegationJobOnChain.mockResolvedValue("tx-complete-delegation");
}

async function renderWorkbench() {
  const pageModulePath = "../web/src/pages/WorkbenchPage.tsx";
  const storeModulePath = "../web/src/lib/store.ts";
  const [{ WorkbenchPage }, { useWorkbench }] = await Promise.all([
    import(pageModulePath),
    import(storeModulePath)
  ]);
  const rootEl = dom.window.document.getElementById("root");
  expect(rootEl).toBeTruthy();
  root = createRoot(rootEl!);
  await act(async () => {
    root!.render(createElement(WorkbenchPage));
  });
  await flush();
  return { useWorkbench };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    });
  }
}

function byTestId<T extends Element = Element>(testId: string): T {
  const el = dom.window.document.querySelector(`[data-testid="${testId}"]`);
  expect(el, `missing [data-testid="${testId}"]`).toBeTruthy();
  return el as T;
}

async function clickByTestId(testId: string): Promise<void> {
  const el = byTestId<HTMLElement>(testId);
  await act(async () => {
    el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await flush();
}

async function clickDecrypt(reportId: string): Promise<void> {
  const button = dom.window.document.querySelector(
    `[data-report-id="${reportId}"] button.decrypt-report`
  ) as HTMLButtonElement | null;
  expect(button, `missing decrypt button for ${reportId}`).toBeTruthy();
  expect(button!.disabled, `decrypt button for ${reportId} should be enabled`).toBe(false);
  await act(async () => {
    button!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await flush();
}

async function selectActor(actor: string): Promise<void> {
  const select = byTestId<HTMLSelectElement>("actor-select");
  await act(async () => {
    select.value = actor;
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  await flush();
}

function statusText(): string {
  return dom.window.document.querySelector("#workbench-status")?.textContent ?? "";
}

function persistedState(): {
  reports: Array<{ id: string; visibility: string; agent: string }>;
  platform_memberships: Array<{ pass_id: string; owner_address: string }>;
  agent_subscriptions: Array<{ pass_id: string; owner_address: string; agent: string }>;
  access_receipts: Array<{ id: string; settlement_tx_digest?: string }>;
  delegations: Array<{ id: string; status: string; buyer: string; agent: string; result_report_id?: string }>;
  unlocked: Record<string, boolean>;
  plaintexts: Record<string, string>;
} {
  return JSON.parse(dom.window.localStorage.getItem("rn_workbench_state") ?? "{}");
}

describe("Workbench UI production-flow integration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.state.currentSigner = makeSigner(AGENT);
    installDom();
    seedAgentSession();
    installClientMocks();
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root!.unmount();
      });
      root = null;
    }
    dom.window.close();
  });

  it("publishes from the page through the signer-backed Walrus + Seal + Sui client path", async () => {
    await renderWorkbench();

    expect(byTestId("m3-active").textContent).toContain("On-chain mode");
    await clickByTestId("publish-submit");

    expect(mocks.publishReport).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Market structure notes",
        visibility: "encrypted",
        requiredTier: 1,
        sourceRepo: "octo-agent/research-alpha"
      }),
      expect.objectContaining({ address: AGENT })
    );
    expect(mocks.publishReportDemo).not.toHaveBeenCalled();
    expect(statusText()).toContain("Published on-chain encrypted report");
    expect(persistedState().reports[0]).toMatchObject({
      id: REPORT_ID,
      agent: AGENT,
      visibility: "encrypted"
    });
  });

  it("runs the membership, decrypt, subscription, delegation, settlement, and claim user stories from the UI", async () => {
    const agentSigner = makeSigner(AGENT);
    const buyerSigner = makeSigner(BUYER);
    mocks.state.currentSigner = agentSigner;
    const { useWorkbench } = await renderWorkbench();

    await clickByTestId("publish-submit");
    await act(async () => {
      useWorkbench.getState().setSigner(buyerSigner);
    });
    await selectActor("buyer");

    await clickByTestId("buy-membership");
    expect(mocks.buyPlatformMembershipOnChain).toHaveBeenCalledWith(
      expect.objectContaining({ signer: expect.objectContaining({ address: BUYER }) })
    );
    expect(statusText()).toContain("Platform membership active on-chain");
    expect(persistedState().platform_memberships[0]).toMatchObject({
      pass_id: MEMBERSHIP_ID,
      owner_address: BUYER
    });

    await clickDecrypt(REPORT_ID);
    expect(mocks.decryptReportOnChain).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: REPORT_ID }),
      "seal_approve_report_with_platform_membership",
      expect.objectContaining({ address: BUYER }),
      MEMBERSHIP_ID,
      undefined
    );
    expect(mocks.recordPlatformAccessReceiptOnChain).toHaveBeenCalledWith(
      expect.objectContaining({
        signer: expect.objectContaining({ address: BUYER }),
        passObjectId: MEMBERSHIP_ID,
        reportObjectId: REPORT_ID
      })
    );
    expect(persistedState().access_receipts[0]).toMatchObject({
      id: RECEIPT_ID
    });

    await clickByTestId("subscribe-agent");
    expect(mocks.buyAgentSubscriptionOnChain).toHaveBeenCalledWith(
      expect.objectContaining({
        signer: expect.objectContaining({ address: BUYER }),
        agent: AGENT
      })
    );
    expect(persistedState().agent_subscriptions[0]).toMatchObject({
      pass_id: SUBSCRIPTION_ID,
      owner_address: BUYER,
      agent: AGENT
    });

    await clickDecrypt(REPORT_ID);
    expect(mocks.decryptReportOnChain).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: REPORT_ID }),
      "seal_approve_report_with_agent_subscription",
      expect.objectContaining({ address: BUYER }),
      SUBSCRIPTION_ID,
      undefined
    );

    await clickByTestId("create-delegation");
    expect(mocks.createDelegationJobOnChain).toHaveBeenCalledWith(
      expect.objectContaining({
        signer: expect.objectContaining({ address: BUYER }),
        agent: AGENT
      })
    );
    expect(mocks.fundDelegationJobOnChain).toHaveBeenCalledWith(
      expect.objectContaining({
        signer: expect.objectContaining({ address: BUYER }),
        jobObjectId: DELEGATION_ID
      })
    );
    expect(persistedState().delegations[0]).toMatchObject({
      id: DELEGATION_ID,
      buyer: BUYER,
      agent: AGENT,
      status: "funded"
    });

    await act(async () => {
      useWorkbench.getState().setSigner(agentSigner);
    });
    await selectActor("agent");
    await clickByTestId("submit-private-result");
    expect(mocks.publishPrivateResultOnChain).toHaveBeenCalledWith(
      expect.objectContaining({
        signer: expect.objectContaining({ address: AGENT }),
        jobObjectId: DELEGATION_ID
      })
    );
    expect(persistedState().delegations[0]).toMatchObject({
      status: "submitted",
      result_report_id: PRIVATE_REPORT_ID
    });

    await clickByTestId("settle-membership-receipt");
    expect(mocks.settleMembershipReportOnChain).toHaveBeenCalledWith(
      expect.objectContaining({
        signer: expect.objectContaining({ address: AGENT }),
        receiptObjectId: RECEIPT_ID
      })
    );
    expect(persistedState().access_receipts[0].settlement_tx_digest).toBe("tx-settle-receipt");

    await clickByTestId("claim-agent-earnings");
    expect(mocks.claimAgentEarningsOnChain).toHaveBeenCalledWith({
      signer: expect.objectContaining({ address: AGENT })
    });
    expect(statusText()).toContain("Agent earnings claimed on-chain");

    await act(async () => {
      useWorkbench.getState().setSigner(buyerSigner);
    });
    await selectActor("buyer");
    await clickDecrypt(PRIVATE_REPORT_ID);
    expect(mocks.decryptReportOnChain).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: PRIVATE_REPORT_ID }),
      "seal_approve_private_result",
      expect.objectContaining({ address: BUYER }),
      undefined,
      DELEGATION_ID
    );
    expect(persistedState().unlocked[BUYER + ":" + PRIVATE_REPORT_ID]).toBe(true);

    await clickByTestId("complete-delegation");
    expect(mocks.completeDelegationJobOnChain).toHaveBeenCalledWith(
      expect.objectContaining({
        signer: expect.objectContaining({ address: BUYER }),
        jobObjectId: DELEGATION_ID
      })
    );
    expect(persistedState().delegations[0].status).toBe("completed");
  });
});
