import { describe, expect, it } from "vitest";
import {
  DEFAULT_M3_CONFIG,
  m3ConfigOverridesFromEnv,
  validateM3Config,
  type M3Config
} from "../web/src/lib/config.js";

function mainnetConfig(overrides: Partial<M3Config> = {}): M3Config {
  return {
    ...DEFAULT_M3_CONFIG,
    network: "mainnet",
    suiRpcUrl: "https://fullnode.mainnet.sui.io:443",
    packageId: "0x" + "11".repeat(32),
    settlementConfigId: "0x" + "22".repeat(32),
    agentEarningsId: "0x" + "33".repeat(32),
    membershipReceiptRegistryId: "0x" + "44".repeat(32),
    walrusPublisherUrl: "https://publisher.walrus.space",
    walrusAggregatorUrl: "https://aggregator.walrus.space",
    sealKeyServers: [{
      objectId: "0x" + "55".repeat(32),
      weight: 1,
      aggregatorUrl: "https://seal-aggregator.mainnet.example"
    }],
    ...overrides
  };
}

describe("M3 web runtime config", () => {
  it("accepts explicit non-testnet-looking mainnet config", () => {
    expect(validateM3Config(mainnetConfig()).network).toBe("mainnet");
  });

  it("rejects mainnet config that still carries testnet defaults", () => {
    expect(() => validateM3Config(mainnetConfig({ packageId: DEFAULT_M3_CONFIG.packageId }))).toThrow(
      /mainnet M3 config rejects testnet values/
    );
    expect(() => validateM3Config(mainnetConfig({ walrusAggregatorUrl: DEFAULT_M3_CONFIG.walrusAggregatorUrl }))).toThrow(
      /walrusAggregatorUrl/
    );
    expect(() => validateM3Config(mainnetConfig({ sealKeyServers: DEFAULT_M3_CONFIG.sealKeyServers }))).toThrow(
      /sealKeyServers/
    );
  });

  it("builds config overrides from VITE_RN env values", () => {
    const overrides = m3ConfigOverridesFromEnv({
      VITE_RN_NETWORK: "mainnet",
      VITE_RN_SUI_RPC_URL: "https://fullnode.mainnet.sui.io:443",
      VITE_RN_PACKAGE_ID: "0x" + "11".repeat(32),
      VITE_RN_SETTLEMENT_CONFIG_ID: "0x" + "22".repeat(32),
      VITE_RN_AGENT_EARNINGS_ID: "0x" + "33".repeat(32),
      VITE_RN_MEMBERSHIP_RECEIPT_REGISTRY_ID: "0x" + "44".repeat(32),
      VITE_RN_WALRUS_PUBLISHER_URL: "https://publisher.walrus.space",
      VITE_RN_WALRUS_AGGREGATOR_URL: "https://aggregator.walrus.space",
      VITE_RN_SEAL_KEY_SERVER_OBJECT_ID: "0x" + "55".repeat(32),
      VITE_RN_SEAL_KEY_SERVER_AGGREGATOR_URL: "https://seal-aggregator.mainnet.example",
      VITE_RN_SEAL_THRESHOLD: "1"
    });

    expect(overrides.network).toBe("mainnet");
    expect(overrides.sealKeyServers?.[0]).toMatchObject({
      objectId: "0x" + "55".repeat(32),
      aggregatorUrl: "https://seal-aggregator.mainnet.example"
    });
  });

  it("rejects invalid VITE_RN network values", () => {
    expect(() => m3ConfigOverridesFromEnv({ VITE_RN_NETWORK: "localnet" })).toThrow(/VITE_RN_NETWORK/);
  });
});
