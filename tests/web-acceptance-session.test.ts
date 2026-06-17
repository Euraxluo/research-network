import { beforeEach, describe, expect, it, vi } from "vitest";

function makeStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
    clear: vi.fn(() => values.clear())
  } as unknown as Storage;
}

describe("web acceptance session export", () => {
  let local: Storage;
  let session: Storage;

  beforeEach(() => {
    local = makeStorage();
    session = makeStorage();
    Object.defineProperty(globalThis, "localStorage", { value: local, configurable: true });
    Object.defineProperty(globalThis, "sessionStorage", { value: session, configurable: true });
  });

  it("exports the current tab zkLogin state in production acceptance format", async () => {
    const { buildAcceptanceSessionExport } = await import("../web/src/lib/acceptance-session.js");
    localStorage.setItem("rn_session", JSON.stringify({
      address: "0x" + "12".repeat(32),
      email: "buyer@example.com"
    }));
    sessionStorage.setItem("rn_zk_eph", JSON.stringify({
      secret: "suiprivkey1secret",
      maxEpoch: 321,
      randomness: "999"
    }));
    sessionStorage.setItem("rn_zk_session", JSON.stringify({
      id_token: "header.payload.sig",
      salt: "123456",
      maxEpoch: 321,
      randomness: "999"
    }));

    const exported = buildAcceptanceSessionExport(new Date("2026-06-17T00:00:00.000Z"));

    expect(exported).toMatchObject({
      address: "0x" + "12".repeat(32),
      ephemeralSecretKey: "suiprivkey1secret",
      idToken: "header.payload.sig",
      salt: "123456",
      maxEpoch: 321,
      randomness: "999",
      rn_zk_eph: {
        secret: "suiprivkey1secret",
        maxEpoch: 321,
        randomness: "999"
      },
      rn_zk_session: {
        id_token: "header.payload.sig",
        salt: "123456",
        maxEpoch: 321,
        randomness: "999"
      },
      exportedAt: "2026-06-17T00:00:00.000Z"
    });
    expect(exported.warning).toContain("Sensitive zkLogin acceptance session");
  });

  it("fails closed when the same-tab ephemeral key is missing", async () => {
    const { buildAcceptanceSessionExport } = await import("../web/src/lib/acceptance-session.js");
    localStorage.setItem("rn_session", JSON.stringify({ address: "0x" + "12".repeat(32) }));
    sessionStorage.setItem("rn_zk_session", JSON.stringify({
      id_token: "header.payload.sig",
      salt: "123456",
      maxEpoch: 321,
      randomness: "999"
    }));

    expect(() => buildAcceptanceSessionExport()).toThrow(/rn_zk_eph\.secret/);
  });
});
