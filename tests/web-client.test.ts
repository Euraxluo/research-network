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
    buildPublishPublicReport: vi.fn()
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
    sealThreshold: 1
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
  buildPublishPublicReport: mocks.buildPublishPublicReport,
  buildPublishEncryptedReport: mocks.buildPublishEncryptedReport
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
        createdObjectIds: [CREATED_REPORT_ID]
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
});
