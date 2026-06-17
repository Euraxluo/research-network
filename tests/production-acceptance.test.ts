import { describe, expect, it } from "vitest";
import {
  assertProductionAcceptanceSessionAddress,
  assertProductionAcceptanceSessionFresh,
  assertProductionAcceptanceCanExecute,
  calculateProductionAcceptanceBudget,
  normalizeProductionAcceptanceSession,
  parseProductionAcceptanceArgs
} from "../src/core/production-acceptance.js";

describe("production acceptance guardrails", () => {
  it("defaults to dry-run testnet config and does not require funded sessions", () => {
    const config = parseProductionAcceptanceArgs([], {});
    const budget = assertProductionAcceptanceCanExecute(config);

    expect(config.network).toBe("testnet");
    expect(config.execute).toBe(false);
    expect(budget.committedSpendMist).toBe(3_800_000n);
    expect(budget.buyerMinimumMist).toBe(53_800_000n);
    expect(budget.agentMinimumMist).toBe(50_000_000n);
    expect(budget.totalBudgetMist).toBe(103_800_000n);
  });

  it("requires two session files and a positive spend cap before real execution", () => {
    const config = parseProductionAcceptanceArgs(["--execute"], {});

    expect(() => assertProductionAcceptanceCanExecute(config)).toThrow(/buyer-session, agent-session/);
  });

  it("requires a positive spend cap after execution session files are present", () => {
    const config = parseProductionAcceptanceArgs([
      "--execute",
      "--buyer-session", ".research-network/secrets/buyer.json",
      "--agent-session", ".research-network/secrets/agent.json"
    ], {});

    expect(() => assertProductionAcceptanceCanExecute(config)).toThrow(/max-spend-mist/);
  });

  it("supports no-spend preflight with sessions but without a spend cap", () => {
    const config = parseProductionAcceptanceArgs([
      "--preflight",
      "--buyer-session", ".research-network/secrets/buyer.json",
      "--agent-session", ".research-network/secrets/agent.json"
    ], {});
    const budget = assertProductionAcceptanceCanExecute(config);

    expect(config.preflight).toBe(true);
    expect(config.execute).toBe(false);
    expect(budget.totalBudgetMist).toBe(103_800_000n);
  });

  it("does not allow execute and preflight in the same run", () => {
    expect(() => parseProductionAcceptanceArgs(["--execute", "--preflight"], {})).toThrow(/mutually exclusive/);
  });

  it("rejects execution when configured spend exceeds the explicit cap", () => {
    const config = parseProductionAcceptanceArgs([
      "--execute",
      "--buyer-session", ".research-network/secrets/buyer.json",
      "--agent-session", ".research-network/secrets/agent.json",
      "--max-spend-mist", "1000"
    ], {});

    expect(() => assertProductionAcceptanceCanExecute(config)).toThrow(/exceeds max-spend-mist/);
  });

  it("accepts capped execution when the cap covers committed spend plus gas reserve", () => {
    const config = parseProductionAcceptanceArgs([
      "--execute",
      "--buyer-session", ".research-network/secrets/buyer.json",
      "--agent-session", ".research-network/secrets/agent.json",
      "--max-spend-mist", "110000000"
    ], {});
    const budget = assertProductionAcceptanceCanExecute(config);

    expect(budget.totalBudgetMist).toBe(103_800_000n);
    expect(budget.maxSpendMist).toBe(110_000_000n);
  });

  it("requires explicit mainnet object ids and service endpoints", () => {
    const config = parseProductionAcceptanceArgs(["--network", "mainnet"], {});

    expect(() => assertProductionAcceptanceCanExecute(config)).toThrow(/mainnet acceptance requires explicit/);
  });

  it("rejects mainnet acceptance when explicit config still points at testnet", () => {
    const config = parseProductionAcceptanceArgs([
      "--network", "mainnet",
      "--sui-rpc-url", "https://sui-testnet-rpc.publicnode.com",
      "--package-id", "0x5ecd097d8f13e995493d23c9b033c815bd6a8bf771331c389c027296e8b8231e",
      "--settlement-config-id", "0x612c971a021e8139e0cd4e63bfef162f4301e72532b808a840d3d16512125ea4",
      "--agent-earnings-id", "0xb637059cb77aca697e36673afa2e8639f7f82d16b8f0eba8eb6a1f5bd12eda2b",
      "--membership-receipt-registry-id", "0x5a25a789a4032c8460afa68b26b839a081c770372fa04e567207c606b68ad748",
      "--walrus-publisher-url", "https://publisher.walrus-testnet.walrus.space",
      "--walrus-aggregator-url", "https://aggregator.walrus-testnet.walrus.space",
      "--seal-key-server-object-id", "0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98",
      "--seal-key-server-aggregator-url", "https://seal-aggregator-testnet.mystenlabs.com"
    ], {});

    expect(() => assertProductionAcceptanceCanExecute(config)).toThrow(/rejects testnet config/);
  });

  it("allows explicit non-testnet-looking mainnet dry-run config", () => {
    const config = parseProductionAcceptanceArgs([
      "--network", "mainnet",
      "--sui-rpc-url", "https://fullnode.mainnet.sui.io:443",
      "--package-id", "0x" + "11".repeat(32),
      "--settlement-config-id", "0x" + "22".repeat(32),
      "--agent-earnings-id", "0x" + "33".repeat(32),
      "--membership-receipt-registry-id", "0x" + "44".repeat(32),
      "--walrus-publisher-url", "https://publisher.walrus.space",
      "--walrus-aggregator-url", "https://aggregator.walrus.space",
      "--seal-key-server-object-id", "0x" + "55".repeat(32),
      "--seal-key-server-aggregator-url", "https://seal-aggregator.mainnet.example"
    ], {});
    const budget = assertProductionAcceptanceCanExecute(config);

    expect(budget.totalBudgetMist).toBe(103_800_000n);
  });

  it("computes committed spend from all real value-transfer legs", () => {
    const budget = calculateProductionAcceptanceBudget({
      platformMembershipPriceMist: 10n,
      agentSubscriptionPriceMist: 20n,
      delegationBudgetMist: 30n,
      membershipSettlementShareMist: 40n,
      gasReserveMist: 5n,
      maxSpendMist: 105n
    });

    expect(budget.committedSpendMist).toBe(100n);
    expect(budget.buyerMinimumMist).toBe(105n);
    expect(budget.agentMinimumMist).toBe(5n);
    expect(budget.totalBudgetMist).toBe(110n);
  });

  it("normalizes browser-style zkLogin session files", () => {
    const session = normalizeProductionAcceptanceSession("buyer", {
      address: "0xabc",
      rn_zk_eph: { secret: "suiprivkey1x", maxEpoch: 123, randomness: "9" },
      rn_zk_session: { id_token: "header.payload.sig", salt: "456", maxEpoch: 123, randomness: "9" }
    });

    expect(session).toMatchObject({
      address: "0xabc",
      ephemeralSecretKey: "suiprivkey1x",
      idToken: "header.payload.sig",
      salt: "456",
      maxEpoch: 123,
      randomness: "9"
    });
  });

  it("rejects zkLogin session files whose supplied address does not match JWT + salt", () => {
    const session = normalizeProductionAcceptanceSession("buyer", {
      address: "0xabc",
      rn_zk_eph: { secret: "suiprivkey1x", maxEpoch: 123, randomness: "9" },
      rn_zk_session: { id_token: "header.payload.sig", salt: "456", maxEpoch: 123, randomness: "9" }
    });

    expect(() =>
      assertProductionAcceptanceSessionAddress("buyer", session, () => "0xdef")
    ).toThrow(/does not match derived address/);
  });

  it("uses the canonical derived zkLogin address when the session omits address", () => {
    const session = normalizeProductionAcceptanceSession("buyer", {
      rn_zk_eph: { secret: "suiprivkey1x", maxEpoch: 123, randomness: "9" },
      rn_zk_session: { id_token: "header.payload.sig", salt: "456", maxEpoch: 123, randomness: "9" }
    });

    expect(assertProductionAcceptanceSessionAddress("buyer", session, () => "0xdef")).toBe("0xdef");
  });

  it("rejects zkLogin sessions that are already too close to expiry", () => {
    expect(() => assertProductionAcceptanceSessionFresh("buyer", { maxEpoch: 101 }, 100, 2)).toThrow(
      /expires too soon/
    );
  });
});
