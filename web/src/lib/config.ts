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
  packageId: "0x97ea53589f599affc946b747ca71e1918cfadc10ca1313d453671f033fc2c5aa",
  settlementConfigId: "0x91a66a2f2a88c86afc127c2c8c705d3d8eb683112eeb3eab6ac3fc3b9f905600",
  agentEarningsId: "0x0c990504ad6770dec3af198515ed093fc586f85469856a793282900783ce24ee",
  membershipReceiptRegistryId: "0x7a11ede5060e509b3efce714f65f1550fae687e53c0e7e443ef469b42a3fd3fe",
  walrusPublisherUrl: "https://publisher.walrus-testnet.walrus.space",
  walrusAggregatorUrl: "https://aggregator.walrus-testnet.walrus.space",
  walrusEpochs: 5,
  // Official Seal testnet key servers (object id + weight). Fill real object ids
  // from the Seal testnet config before M3 decrypt is exercised end-to-end.
  sealKeyServers: [
    { objectId: "0xaeab97f96cf9877fee2883315d859c8417917c1de2ce95c83f4eb53eedcd75b0", weight: 1 },
    { objectId: "0xb2f89646c8c9e4b7a3d5e8f1c6a9d2e7b4f8a1c3d5e7b9f2a4c6d8e1b3f5a7c9", weight: 1 }
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
