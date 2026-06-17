// On-chain + storage configuration for the M3/M4 client layer.
// All object ids come from move/Published.toml.
// Override at runtime via window.__RN_M3_CONFIG__ for dev/staging swaps.

export interface M3Config {
  suiRpcUrl: string;
  network: "testnet" | "mainnet" | "devnet";
  /** Current testnet package with Seal id == report.seal_id policy. */
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
  /** Default production/testnet transaction amounts in MIST. Override per deployment. */
  platformMembershipPriceMist: string;
  agentSubscriptionPriceMist: string;
  delegationBudgetMist: string;
  membershipSettlementShareMist: string;
  accessDurationMs: number;
  defaultArbitratorAddress?: string;
}

export const DEFAULT_M3_CONFIG: M3Config = {
  suiRpcUrl: "https://sui-testnet-rpc.publicnode.com",
  network: "testnet",
  packageId: "0x5ecd097d8f13e995493d23c9b033c815bd6a8bf771331c389c027296e8b8231e",
  settlementConfigId: "0x612c971a021e8139e0cd4e63bfef162f4301e72532b808a840d3d16512125ea4",
  agentEarningsId: "0xb637059cb77aca697e36673afa2e8639f7f82d16b8f0eba8eb6a1f5bd12eda2b",
  membershipReceiptRegistryId: "0x5a25a789a4032c8460afa68b26b839a081c770372fa04e567207c606b68ad748",
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
  sealThreshold: 1,
  platformMembershipPriceMist: "1000000",
  agentSubscriptionPriceMist: "1000000",
  delegationBudgetMist: "1000000",
  membershipSettlementShareMist: "800000",
  accessDurationMs: 30 * 24 * 60 * 60 * 1000,
  defaultArbitratorAddress: undefined
};

export function loadM3Config(): M3Config {
  const g = globalThis as unknown as { __RN_M3_CONFIG__?: Partial<M3Config> };
  const overrides = g.__RN_M3_CONFIG__ || {};
  // Merge arrays/objects shallowly; scalar overrides win.
  return { ...DEFAULT_M3_CONFIG, ...overrides } as M3Config;
}

export const RESEARCH_MODULE = "research_protocol";
