// On-chain + storage configuration for the M3 client layer.
// All object ids come from move/Published.toml (published by M3-0).
// Override at runtime via window.__RN_M3_CONFIG__ for dev/staging swaps.

export interface M3Config {
  suiRpcUrl: string;
  network: "testnet" | "mainnet" | "devnet";
  /** M3-0 published package: 0x97ea53... (see move/Published.toml) */
  packageId: string;
  /** settlement::init shared objects */
  settlementConfigId: string;
  agentEarningsId: string;
  membershipReceiptRegistryId: string;
  /** Walrus */
  walrusPublisherUrl: string;
  walrusAggregatorUrl: string;
  walrusEpochs: number;
  /** Seal key servers (committee). `weight` is summed; `aggregatorUrl` for
   *  committee-mode servers. At least `sealThreshold` of weights must respond. */
  sealKeyServers: { objectId: string; weight: number; aggregatorUrl?: string }[];
  /** Threshold (sum of weights) of key servers that must respond to decrypt. */
  sealThreshold: number;
}

export const DEFAULT_M3_CONFIG: M3Config = {
  suiRpcUrl: "https://rpc-testnet.suiscan.xyz",
  network: "testnet",
  packageId: "0x7a1eed5292d80ea04f37f18fbbfdd1fd7774becc7c4f85972ebe16e16183a283",
  settlementConfigId: "0x544f91423d07fe8f58baf5d3b027bfb28e128f7424f197d54e06816690c5968e",
  agentEarningsId: "0xe1236e34459fafafd82ed3f88dcaa6c0d17addb6010a8849804d073a6f8fa9b6",
  membershipReceiptRegistryId: "0x8683682aaaacbb6ceaf1eb45d29b04674290014cc6e2c9be9a41e5d8babca361",
  walrusPublisherUrl: "https://publisher.walrus-testnet.walrus.space",
  walrusAggregatorUrl: "https://aggregator.walrus-testnet.walrus.space",
  walrusEpochs: 5,
  // Seal testnet decentralized key server (committee mode). The single object id
  // references an on-chain KeyServer object whose URL is the aggregator for the
  // whole committee; SealClient fetches per-member keys through it.
  // Source: MystenLabs/seal examples/frontend/src/utils.ts (DEVNET/TESTNET).
  sealKeyServers: [
    {
      objectId: "0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98",
      weight: 1,
      aggregatorUrl: "https://seal-aggregator-testnet.mystenlabs.com"
    }
  ],
  sealThreshold: 1
};

export function loadM3Config(): M3Config {
  const w = window as unknown as { __RN_M3_CONFIG__?: Partial<M3Config> };
  const overrides = w.__RN_M3_CONFIG__ || {};
  // Merge arrays/objects shallowly; scalar overrides win.
  return { ...DEFAULT_M3_CONFIG, ...overrides } as M3Config;
}

export const RESEARCH_MODULE = "research_protocol";
