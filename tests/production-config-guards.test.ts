import { describe, expect, it } from "vitest";
import { resolveWalrusProxyConfig } from "../api/walrus.js";
import { resolveAuthSuiRpcUrl } from "../src/core/web-auth.js";
import {
  DEFAULT_TESTNET_AGGREGATOR_URL,
  DEFAULT_TESTNET_SITE_OBJECT_ID,
  DEFAULT_TESTNET_SUI_RPC_URL
} from "../src/core/walrus-sites.js";

describe("production deployment config guards", () => {
  it("allows explicit testnet defaults for non-mainnet Walrus proxy deployments", () => {
    const config = resolveWalrusProxyConfig({});

    expect(config).toMatchObject({
      network: "testnet",
      siteObjectId: DEFAULT_TESTNET_SITE_OBJECT_ID,
      rpcUrl: DEFAULT_TESTNET_SUI_RPC_URL,
      aggregatorUrl: DEFAULT_TESTNET_AGGREGATOR_URL,
      sourceHeader: "walrus-testnet"
    });
  });

  it("requires explicit mainnet Walrus proxy ids and endpoints", () => {
    expect(() => resolveWalrusProxyConfig({ RN_WEB_NETWORK: "mainnet" })).toThrow(
      /mainnet Walrus proxy requires explicit/
    );
  });

  it("rejects mainnet Walrus proxy config that still points at testnet", () => {
    expect(() =>
      resolveWalrusProxyConfig({
        RN_WEB_NETWORK: "mainnet",
        WALRUS_SITE_OBJECT_ID: DEFAULT_TESTNET_SITE_OBJECT_ID,
        SUI_RPC_URL: DEFAULT_TESTNET_SUI_RPC_URL,
        WALRUS_AGGREGATOR_URL: DEFAULT_TESTNET_AGGREGATOR_URL
      })
    ).toThrow(/rejects testnet config/);
  });

  it("accepts explicit non-testnet-looking mainnet Walrus proxy config", () => {
    const config = resolveWalrusProxyConfig({
      RN_WEB_NETWORK: "mainnet",
      WALRUS_SITE_OBJECT_ID: "0x" + "11".repeat(32),
      SUI_RPC_URL: "https://fullnode.mainnet.sui.io:443",
      WALRUS_AGGREGATOR_URL: "https://aggregator.walrus.space"
    });

    expect(config.sourceHeader).toBe("walrus-mainnet");
  });

  it("requires explicit mainnet auth RPC and rejects testnet RPC", () => {
    expect(() => resolveAuthSuiRpcUrl({ RN_WEB_NETWORK: "mainnet" })).toThrow(/AUTH_SUI_RPC_URL/);
    expect(() =>
      resolveAuthSuiRpcUrl({ RN_WEB_NETWORK: "mainnet", AUTH_SUI_RPC_URL: DEFAULT_TESTNET_SUI_RPC_URL })
    ).toThrow(/rejects testnet/);
    expect(resolveAuthSuiRpcUrl({
      RN_WEB_NETWORK: "mainnet",
      AUTH_SUI_RPC_URL: "https://fullnode.mainnet.sui.io:443"
    })).toBe("https://fullnode.mainnet.sui.io:443");
  });
});
