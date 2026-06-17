import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeTransactionBlock: vi.fn(),
  getZkLoginSignature: vi.fn(() => "zklogin-composite-signature")
}));

vi.mock("@mysten/sui/zklogin", async () => {
  const actual = await vi.importActual<typeof import("@mysten/sui/zklogin")>("@mysten/sui/zklogin");
  return {
    ...actual,
    getZkLoginSignature: mocks.getZkLoginSignature
  };
});

vi.mock("../web/src/lib/sui-client.ts", () => ({
  getSuiClient: () => ({
    executeTransactionBlock: mocks.executeTransactionBlock
  })
}));

describe("web zkLogin signer", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    const local = new Map<string, string>();
    const session = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storageFromMap(local)
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: storageFromMap(session)
    });
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        proofPoints: {
          a: ["1", "2"],
          b: [["1", "2"], ["3", "4"]],
          c: ["5", "6"]
        },
        issBase64Details: { value: "aHR0cHM6Ly9hY2NvdW50cy5nb29nbGUuY29t", indexMod4: 0 },
        headerBase64: "eyJhbGciOiJSUzI1NiJ9",
        addressSeed: "1"
      }),
      text: async () => ""
    })) as never;
  });

  it("uses a zkLogin composite signature for Seal personal-message signing", async () => {
    const { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519");
    const signerModulePath = "../web/src/lib/signer.ts";
    const { buildZkLoginSigner } = await import(signerModulePath);
    const keypair = Ed25519Keypair.generate();

    localStorage.setItem("rn_session", JSON.stringify({ address: "0x" + "11".repeat(32) }));
    sessionStorage.setItem("rn_zk_eph", JSON.stringify({
      secret: keypair.getSecretKey(),
      randomness: "9",
      maxEpoch: 100,
      nonce: "nonce"
    }));
    sessionStorage.setItem("rn_zk_session", JSON.stringify({
      id_token: "header.payload.signature",
      salt: "123",
      maxEpoch: 100,
      randomness: "9"
    }));

    const signer = await buildZkLoginSigner();
    expect(signer).toBeTruthy();

    const signature = await signer!.signPersonalMessage(new TextEncoder().encode("seal session"));

    expect(signature).toBe("zklogin-composite-signature");
    expect(mocks.getZkLoginSignature).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/zklogin-prove", expect.objectContaining({ method: "POST" }));
  });
});

function storageFromMap(values: Map<string, string>) {
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear()
  };
}
