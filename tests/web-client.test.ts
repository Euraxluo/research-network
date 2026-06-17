import { beforeEach, describe, expect, it, vi } from "vitest";

const CREATED_REPORT_ID = "0x" + "ab".repeat(32);

const mocks = vi.hoisted(() => {
  const suiClient = {
    devInspectTransactionBlock: vi.fn(() => {
      throw new Error("devInspect must not be used to reserve report ids");
    })
  };
  return {
    suiClient,
    uploadBlob: vi.fn(),
    sealEncrypt: vi.fn(),
    buildPublishEncryptedReport: vi.fn(),
    buildPublishPublicReport: vi.fn(),
    buildAcceptDelegationJob: vi.fn(),
    buildBuyAgentSubscription: vi.fn(),
    buildBuyPlatformMembership: vi.fn(),
    buildClaimAgentEarnings: vi.fn(),
    buildCompleteDelegationJob: vi.fn(),
    buildCreateDelegationJob: vi.fn(),
    buildFundDelegationJob: vi.fn(),
    buildOpenDispute: vi.fn(),
    buildPublishPrivateResult: vi.fn(),
    buildRecordPlatformAccessReceipt: vi.fn(),
    buildSettleMembershipReport: vi.fn()
  };
});

function hexToBytes(hex: string): Uint8Array {
  const raw = hex.replace(/^0x/, "");
  const bytes = new Uint8Array(raw.length / 2);
  for (let i = 0; i < raw.length; i += 2) bytes[i / 2] = parseInt(raw.slice(i, i + 2), 16);
  return bytes;
}

vi.mock("../web/src/lib/config.ts", () => ({
  loadM3Config: () => ({
    suiRpcUrl: "http://127.0.0.1:9000",
    network: "testnet",
    packageId: "0xpackage",
    settlementConfigId: "0xsettlement",
    agentEarningsId: "0xearnings",
    membershipReceiptRegistryId: "0xregistry",
    walrusPublisherUrl: "http://127.0.0.1:9001",
    walrusAggregatorUrl: "http://127.0.0.1:9002",
    walrusEpochs: 1,
    sealKeyServers: [],
    sealThreshold: 1,
    platformMembershipPriceMist: "1000000",
    agentSubscriptionPriceMist: "1000000",
    delegationBudgetMist: "1000000",
    membershipSettlementShareMist: "800000",
    accessDurationMs: 2592000000
  })
}));

vi.mock("../web/src/lib/walrus.ts", () => ({
  uploadBlob: mocks.uploadBlob,
  readBlob: vi.fn(),
  blobIdToBytes: (blobId: string) => new TextEncoder().encode(blobId)
}));

vi.mock("../web/src/lib/seal-client.ts", () => ({
  sealEncrypt: mocks.sealEncrypt,
  sealDecrypt: vi.fn(),
  bytesToObjectId: (bytes: Uint8Array) =>
    "0x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")
}));

vi.mock("../web/src/lib/sui-client.ts", () => ({
  getSuiClient: () => mocks.suiClient,
  buildAcceptDelegationJob: mocks.buildAcceptDelegationJob,
  buildBuyAgentSubscription: mocks.buildBuyAgentSubscription,
  buildBuyPlatformMembership: mocks.buildBuyPlatformMembership,
  buildClaimAgentEarnings: mocks.buildClaimAgentEarnings,
  buildCompleteDelegationJob: mocks.buildCompleteDelegationJob,
  buildCreateDelegationJob: mocks.buildCreateDelegationJob,
  buildFundDelegationJob: mocks.buildFundDelegationJob,
  buildOpenDispute: mocks.buildOpenDispute,
  buildPublishPrivateResult: mocks.buildPublishPrivateResult,
  buildPublishPublicReport: mocks.buildPublishPublicReport,
  buildPublishEncryptedReport: mocks.buildPublishEncryptedReport,
  buildRecordPlatformAccessReceipt: mocks.buildRecordPlatformAccessReceipt,
  buildSettleMembershipReport: mocks.buildSettleMembershipReport
}));

describe("web M3/M4 client publish path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.uploadBlob.mockResolvedValue({ blobId: "blob-testnet-1" });
    mocks.sealEncrypt.mockResolvedValue({ ciphertext: new Uint8Array([7, 8, 9]), symmetricKey: new Uint8Array([1]) });
    mocks.buildPublishEncryptedReport.mockImplementation(() => ({
      setSender: vi.fn(),
      build: vi.fn(async () => new Uint8Array([1, 2, 3]))
    }));
  });

  it("publishes encrypted reports with a publisher-chosen seal_id, not a devInspect-predicted object id", async () => {
    const clientModulePath = "../web/src/lib/clients.ts";
    const { publishReport } = await import(clientModulePath);
    const signer = {
      address: "0x" + "cd".repeat(32),
      signAndExecuteTransaction: vi.fn(async () => ({
        digest: "tx-real",
        status: "success",
        createdObjectIds: [CREATED_REPORT_ID],
        createdObjects: [{ objectId: CREATED_REPORT_ID, objectType: "0xpackage::report::ResearchReport" }]
      })),
      signPersonalMessage: vi.fn()
    };

    const result = await publishReport(
      {
        title: "Encrypted mainnet blocker regression",
        visibility: "encrypted",
        requiredTier: 1,
        freePreview: "preview",
        plaintext: "private body",
        agent: signer.address,
        sourceRepo: "owner/repo"
      },
      signer
    );

    expect(mocks.suiClient.devInspectTransactionBlock).not.toHaveBeenCalled();
    expect(mocks.sealEncrypt).toHaveBeenCalledTimes(1);
    expect(mocks.buildPublishEncryptedReport).toHaveBeenCalledTimes(1);
    expect(signer.signAndExecuteTransaction).toHaveBeenCalledTimes(1);

    const sealIdHex = mocks.sealEncrypt.mock.calls[0][1] as string;
    expect(sealIdHex).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.report.id).toBe(CREATED_REPORT_ID);
    expect(result.report.sui_object_id).toBe(CREATED_REPORT_ID);
    expect(result.report.seal_id).toBe(sealIdHex);
    expect(result.report.seal_id).not.toBe(result.report.id);

    const publishArgs = mocks.buildPublishEncryptedReport.mock.calls[0][0] as { sealId: Uint8Array };
    expect(Array.from(publishArgs.sealId)).toEqual(Array.from(hexToBytes(sealIdHex)));
  });

  it("requires typed created object changes for published reports", async () => {
    const clientModulePath = "../web/src/lib/clients.ts";
    const { publishReport } = await import(clientModulePath);
    const signer = {
      address: "0x" + "cd".repeat(32),
      signAndExecuteTransaction: vi.fn(async () => ({
        digest: "tx-untyped-report",
        status: "success",
        createdObjectIds: [CREATED_REPORT_ID]
      })),
      signPersonalMessage: vi.fn()
    };

    await expect(publishReport(
      {
        title: "Untyped object change regression",
        visibility: "encrypted",
        requiredTier: 1,
        freePreview: "preview",
        plaintext: "private body",
        agent: signer.address,
        sourceRepo: "owner/repo"
      },
      signer
    )).rejects.toThrow("typed ResearchReport");
  });

  it("uses typed created object changes for real commerce and delegation wrappers", async () => {
    const clientModulePath = "../web/src/lib/clients.ts";
    const {
      buyAgentSubscriptionOnChain,
      buyPlatformMembershipOnChain,
      claimAgentEarningsOnChain,
      createDelegationJobOnChain,
      recordPlatformAccessReceiptOnChain,
      settleMembershipReportOnChain
    } = await import(clientModulePath);
    const txs: Array<{ setSender: ReturnType<typeof vi.fn>; build: ReturnType<typeof vi.fn> }> = [];
    const fakeTx = () => {
      const tx = {
        setSender: vi.fn(),
        build: vi.fn(async () => new Uint8Array([1, 2, 3]))
      };
      txs.push(tx);
      return tx;
    };
    mocks.buildBuyPlatformMembership.mockImplementation(fakeTx);
    mocks.buildBuyAgentSubscription.mockImplementation(fakeTx);
    mocks.buildCreateDelegationJob.mockImplementation(fakeTx);
    mocks.buildRecordPlatformAccessReceipt.mockImplementation(fakeTx);
    mocks.buildSettleMembershipReport.mockImplementation(fakeTx);
    mocks.buildClaimAgentEarnings.mockImplementation(fakeTx);

    const ids = {
      coin: "0x" + "01".repeat(32),
      membership: "0x" + "02".repeat(32),
      subscription: "0x" + "03".repeat(32),
      job: "0x" + "04".repeat(32),
      receipt: "0x" + "05".repeat(32)
    };
    const signer = {
      address: "0x" + "cd".repeat(32),
      signAndExecuteTransaction: vi
        .fn()
        .mockResolvedValueOnce({
          digest: "tx-membership",
          status: "success",
          createdObjectIds: [ids.coin, ids.membership],
          createdObjects: [
            { objectId: ids.coin, objectType: "0x2::coin::Coin<0x2::sui::SUI>" },
            { objectId: ids.membership, objectType: "0xpackage::access::PlatformMembershipPass" }
          ]
        })
        .mockResolvedValueOnce({
          digest: "tx-subscription",
          status: "success",
          createdObjectIds: [ids.coin, ids.subscription],
          createdObjects: [
            { objectId: ids.coin, objectType: "0x2::coin::Coin<0x2::sui::SUI>" },
            { objectId: ids.subscription, objectType: "0xpackage::access::AgentSubscriptionPass" }
          ]
        })
        .mockResolvedValueOnce({
          digest: "tx-job",
          status: "success",
          createdObjectIds: [ids.job],
          createdObjects: [{ objectId: ids.job, objectType: "0xpackage::delegation::DelegationJob" }]
        })
        .mockResolvedValueOnce({
          digest: "tx-receipt",
          status: "success",
          createdObjectIds: [ids.receipt],
          createdObjects: [{ objectId: ids.receipt, objectType: "0xpackage::access::AccessReceipt" }]
        })
        .mockResolvedValueOnce({
          digest: "tx-settle",
          status: "success",
          createdObjectIds: []
        })
        .mockResolvedValueOnce({
          digest: "tx-claim",
          status: "success",
          createdObjectIds: []
        }),
      signPersonalMessage: vi.fn()
    };

    await expect(buyPlatformMembershipOnChain({ signer })).resolves.toEqual({
      digest: "tx-membership",
      objectId: ids.membership
    });
    await expect(buyAgentSubscriptionOnChain({ signer, agent: "0x" + "aa".repeat(32) })).resolves.toEqual({
      digest: "tx-subscription",
      objectId: ids.subscription
    });
    await expect(
      createDelegationJobOnChain({
        signer,
        agent: "0x" + "aa".repeat(32),
        question: "q",
        sourceArtifact: "artifact"
      })
    ).resolves.toEqual({ digest: "tx-job", objectId: ids.job });
    await expect(
      recordPlatformAccessReceiptOnChain({
        signer,
        passObjectId: ids.membership,
        reportObjectId: CREATED_REPORT_ID,
        periodId: 202606
      })
    ).resolves.toEqual({ digest: "tx-receipt", objectId: ids.receipt });
    await expect(settleMembershipReportOnChain({ signer, receiptObjectId: ids.receipt })).resolves.toBe("tx-settle");
    await expect(claimAgentEarningsOnChain({ signer })).resolves.toBe("tx-claim");

    expect(txs).toHaveLength(6);
    expect(txs.every((tx) => tx.setSender.mock.calls[0]?.[0] === signer.address)).toBe(true);
    expect(signer.signAndExecuteTransaction).toHaveBeenCalledTimes(6);
  });

  it("does not fall back to the first created object when typed object changes omit the expected type", async () => {
    const clientModulePath = "../web/src/lib/clients.ts";
    const { buyPlatformMembershipOnChain } = await import(clientModulePath);
    mocks.buildBuyPlatformMembership.mockImplementation(() => ({
      setSender: vi.fn(),
      build: vi.fn(async () => new Uint8Array([1, 2, 3]))
    }));
    const signer = {
      address: "0x" + "cd".repeat(32),
      signAndExecuteTransaction: vi.fn(async () => ({
        digest: "tx-wrong-object",
        status: "success",
        createdObjectIds: ["0x" + "01".repeat(32)],
        createdObjects: [
          { objectId: "0x" + "01".repeat(32), objectType: "0x2::coin::Coin<0x2::sui::SUI>" }
        ]
      })),
      signPersonalMessage: vi.fn()
    };

    await expect(buyPlatformMembershipOnChain({ signer })).rejects.toThrow("typed PlatformMembershipPass");
  });

  it("requires exact Move struct names for created object type matching", async () => {
    const clientModulePath = "../web/src/lib/clients.ts";
    const { buyPlatformMembershipOnChain } = await import(clientModulePath);
    mocks.buildBuyPlatformMembership.mockImplementation(() => ({
      setSender: vi.fn(),
      build: vi.fn(async () => new Uint8Array([1, 2, 3]))
    }));
    const signer = {
      address: "0x" + "cd".repeat(32),
      signAndExecuteTransaction: vi.fn(async () => ({
        digest: "tx-substring-object-type",
        status: "success",
        createdObjectIds: ["0x" + "01".repeat(32)],
        createdObjects: [
          { objectId: "0x" + "01".repeat(32), objectType: "0xpackage::access::FakePlatformMembershipPass" }
        ]
      })),
      signPersonalMessage: vi.fn()
    };

    await expect(buyPlatformMembershipOnChain({ signer })).rejects.toThrow("typed PlatformMembershipPass");
  });

  it("rejects commerce object ids that are not backed by typed object changes", async () => {
    const clientModulePath = "../web/src/lib/clients.ts";
    const { buyPlatformMembershipOnChain } = await import(clientModulePath);
    mocks.buildBuyPlatformMembership.mockImplementation(() => ({
      setSender: vi.fn(),
      build: vi.fn(async () => new Uint8Array([1, 2, 3]))
    }));
    const signer = {
      address: "0x" + "cd".repeat(32),
      signAndExecuteTransaction: vi.fn(async () => ({
        digest: "tx-untyped-membership",
        status: "success",
        createdObjectIds: ["0x" + "02".repeat(32)]
      })),
      signPersonalMessage: vi.fn()
    };

    await expect(buyPlatformMembershipOnChain({ signer })).rejects.toThrow("typed PlatformMembershipPass");
  });

  it("rejects failed Sui effects before treating a digest as accepted", async () => {
    const clientModulePath = "../web/src/lib/clients.ts";
    const { claimAgentEarningsOnChain } = await import(clientModulePath);
    mocks.buildClaimAgentEarnings.mockImplementation(() => ({
      setSender: vi.fn(),
      build: vi.fn(async () => new Uint8Array([1, 2, 3]))
    }));
    const signer = {
      address: "0x" + "cd".repeat(32),
      signAndExecuteTransaction: vi.fn(async () => ({
        digest: "tx-aborted",
        status: "failure",
        error: "MoveAbort in settlement::claim_agent_earnings",
        createdObjectIds: []
      })),
      signPersonalMessage: vi.fn()
    };

    await expect(claimAgentEarningsOnChain({ signer })).rejects.toThrow(
      /Sui transaction tx-aborted failed: MoveAbort/
    );
  });
});
