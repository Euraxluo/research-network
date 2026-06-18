import { describe, expect, it } from "vitest";
import { genAddressSeed } from "@mysten/sui/zklogin";
import {
  assertProductionAcceptanceSessionAddress,
  assertProductionAcceptanceSessionFresh,
  assertProductionAcceptanceCanExecute,
  calculateProductionAcceptanceBudget,
  createProductionAcceptanceReceipt,
  defaultProductionAcceptanceReceiptPath,
  normalizeProductionAcceptanceBalanceChanges,
  normalizeProductionAcceptanceSession,
  parseProductionAcceptanceArgs,
  productionAcceptanceFreshnessEvidence,
  productionAcceptanceDelegationFundingMeta,
  productionAcceptanceProverEvidence,
  productionAcceptanceSuiSpentMist,
  summarizeProductionAcceptanceSpend,
  zkProofEvidence
} from "../src/core/production-acceptance.js";

describe("production acceptance guardrails", () => {
  it("defaults to dry-run testnet config and does not require funded sessions", () => {
    const config = parseProductionAcceptanceArgs([], {});
    const budget = assertProductionAcceptanceCanExecute(config);

    expect(config.network).toBe("testnet");
    expect(config.execute).toBe(false);
    expect(config.receiptPath).toBe(defaultProductionAcceptanceReceiptPath("testnet", "dry-run"));
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

    expect(config.receiptPath).toBe(defaultProductionAcceptanceReceiptPath("testnet", "execute"));
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
    expect(config.receiptPath).toBe(defaultProductionAcceptanceReceiptPath("testnet", "preflight"));
    expect(budget.totalBudgetMist).toBe(103_800_000n);
  });

  it("keeps an explicit receipt path when provided", () => {
    const config = parseProductionAcceptanceArgs([
      "--preflight",
      "--buyer-session", ".research-network/secrets/buyer.json",
      "--agent-session", ".research-network/secrets/agent.json",
      "--receipt", ".research-network/acceptance/custom-preflight.json"
    ], {});

    expect(config.receiptPath).toBe(".research-network/acceptance/custom-preflight.json");
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

  it("records receipt provenance when supplied by the acceptance runner", () => {
    const config = parseProductionAcceptanceArgs([], {});
    const budget = assertProductionAcceptanceCanExecute(config);
    const receipt = createProductionAcceptanceReceipt(config, budget, {
      generatedBy: "tests/production-acceptance.test.ts",
      gitCommit: "a".repeat(40),
      gitTreeState: "clean",
      packageName: "@research-network/protocol-kit",
      packageVersion: "0.1.0"
    });

    expect(receipt.provenance).toEqual({
      generatedBy: "tests/production-acceptance.test.ts",
      gitCommit: "a".repeat(40),
      gitTreeState: "clean",
      packageName: "@research-network/protocol-kit",
      packageVersion: "0.1.0"
    });
  });

  it("requires explicit mainnet object ids and service endpoints", () => {
    const config = parseProductionAcceptanceArgs(["--network", "mainnet"], {});

    expect(() => assertProductionAcceptanceCanExecute(config)).toThrow(/mainnet acceptance requires explicit/);
  });

  it("requires explicit mainnet economic parameters before acceptance can approve funds", () => {
    const config = parseProductionAcceptanceArgs([
      "--network", "mainnet",
      "--sui-rpc-url", "https://fullnode.mainnet.sui.io:443",
      "--package-id", "0x" + "11".repeat(32),
      "--settlement-config-id", "0x" + "22".repeat(32),
      "--agent-earnings-id", "0x" + "33".repeat(32),
      "--membership-receipt-registry-id", "0x" + "44".repeat(32),
      "--walrus-publisher-url", "https://publisher.walrus.space",
      "--walrus-aggregator-url", "https://aggregator.walrus.space",
      "--walrus-epochs", "5",
      "--seal-key-server-object-id", "0x" + "55".repeat(32),
      "--seal-key-server-aggregator-url", "https://seal-aggregator.mainnet.example",
      "--seal-threshold", "1"
    ], {});

    expect(() => assertProductionAcceptanceCanExecute(config)).toThrow(/mainnet acceptance requires explicit platform-membership-mist/);
  });

  it("requires explicit mainnet Walrus epochs and Seal threshold before acceptance can approve funds", () => {
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
      "--seal-key-server-aggregator-url", "https://seal-aggregator.mainnet.example",
      "--platform-membership-mist", "1000000",
      "--agent-subscription-mist", "1000000",
      "--delegation-budget-mist", "1000000",
      "--membership-settlement-share-mist", "800000",
      "--access-duration-ms", "2592000000"
    ], {});

    expect(() => assertProductionAcceptanceCanExecute(config)).toThrow(/walrus-epochs, seal-threshold/);
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
      "--walrus-epochs", "5",
      "--seal-key-server-object-id", "0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98",
      "--seal-key-server-aggregator-url", "https://seal-aggregator-testnet.mystenlabs.com",
      "--seal-threshold", "1",
      "--platform-membership-mist", "1000000",
      "--agent-subscription-mist", "1000000",
      "--delegation-budget-mist", "1000000",
      "--membership-settlement-share-mist", "800000",
      "--access-duration-ms", "2592000000"
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
      "--walrus-epochs", "5",
      "--seal-key-server-object-id", "0x" + "55".repeat(32),
      "--seal-key-server-aggregator-url", "https://seal-aggregator.mainnet.example",
      "--seal-threshold", "1",
      "--platform-membership-mist", "1000000",
      "--agent-subscription-mist", "1000000",
      "--delegation-budget-mist", "1000000",
      "--membership-settlement-share-mist", "800000",
      "--access-duration-ms", "2592000000"
    ], {});
    const budget = assertProductionAcceptanceCanExecute(config);

    expect(budget.totalBudgetMist).toBe(103_800_000n);
    expect(config.accessDurationMs).toBe(2_592_000_000);
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

  it("summarizes freshness and proof evidence without storing sensitive proof material", async () => {
    expect(productionAcceptanceFreshnessEvidence({ maxEpoch: 105 }, 100)).toEqual({
      maxEpoch: 105,
      currentEpoch: 100,
      epochsRemaining: 5
    });
    await expect(zkProofEvidence({
      proofPoints: { a: ["1"] },
      issBase64Details: { value: "issuer" },
      headerBase64: "header",
      addressSeed: "seed"
    })).resolves.toEqual({
      hasProofPoints: true,
      hasIssBase64Details: true,
      hasHeaderBase64: true,
      hasAddressSeed: true,
      addressSeedSha256: expect.stringMatching(/^[0-9a-f]{64}$/)
    });
  });

  it("records non-sensitive proof address-seed binding evidence", async () => {
    const idToken = [
      Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url"),
      Buffer.from(JSON.stringify({ iss: "https://accounts.google.com", sub: "user-1", aud: "client-1" })).toString("base64url"),
      "signature"
    ].join(".");
    const addressSeed = genAddressSeed("123456789", "sub", "user-1", "client-1").toString();

    await expect(zkProofEvidence(
      {
        proofPoints: { a: ["1"] },
        issBase64Details: { value: "issuer" },
        headerBase64: "header",
        addressSeed
      },
      { idToken, salt: "123456789" },
      "0x" + "aa".repeat(32)
    )).resolves.toMatchObject({
      hasAddressSeed: true,
      addressSeedMatchesDerivedAddress: true,
      addressSeedSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      derivedAddress: "0x" + "aa".repeat(32)
    });
  });

  it("records non-sensitive zkLogin prover endpoint evidence", async () => {
    const evidence = await productionAcceptanceProverEvidence("https://prover.mainnet.example/v1");

    expect(evidence.configured).toBe(true);
    expect(evidence.urlSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(evidence.urlSha256).not.toContain("prover.mainnet.example");
    await expect(productionAcceptanceProverEvidence("   ")).rejects.toThrow(/ZKLOGIN_PROVER_URL/);
  });

  it("normalizes Sui balanceChanges and computes actual sender spend from negative SUI amounts", () => {
    const buyer = "0x" + "00".repeat(31) + "aa";
    const agent = "0x" + "bb".repeat(32);
    const changes = normalizeProductionAcceptanceBalanceChanges([
      { owner: { AddressOwner: buyer }, coinType: "0x2::sui::SUI", amount: "-1000" },
      {
        owner: { AddressOwner: buyer },
        coinType: "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI",
        amount: "250"
      },
      { owner: { AddressOwner: agent }, coinType: "0x2::sui::SUI", amount: "-7" },
      { owner: { AddressOwner: buyer }, coinType: "0x3::other::COIN", amount: "-999" },
      { owner: "Immutable", coinType: "0x2::sui::SUI", amount: "-123" }
    ]);

    expect(changes).toEqual([
      { owner: buyer, coinType: "0x2::sui::SUI", amount: "-1000" },
      {
        owner: buyer,
        coinType: "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI",
        amount: "250"
      },
      { owner: agent, coinType: "0x2::sui::SUI", amount: "-7" },
      { owner: buyer, coinType: "0x3::other::COIN", amount: "-999" },
      { owner: "Immutable", coinType: "0x2::sui::SUI", amount: "-123" }
    ]);
    expect(productionAcceptanceSuiSpentMist(changes, buyer)).toBe(1000n);
    expect(productionAcceptanceSuiSpentMist(changes, agent)).toBe(7n);
  });

  it("summarizes actual acceptance spend against the explicit cap", () => {
    const buyer = "0x" + "aa".repeat(32);
    const agent = "0x" + "bb".repeat(32);
    const summary = summarizeProductionAcceptanceSpend({
      buyerAddress: buyer,
      agentAddress: agent,
      maxSpendMist: 1200n,
      transactions: [
        {
          digest: "tx-buyer",
          balanceChanges: [
            { owner: buyer, coinType: "0x2::sui::SUI", amount: "-1000" },
            { owner: buyer, coinType: "0x2::sui::SUI", amount: "10" }
          ]
        },
        {
          digest: "tx-agent",
          balanceChanges: [{ owner: agent, coinType: "0x2::sui::SUI", amount: "-250" }]
        }
      ]
    });

    expect(summary).toEqual({
      buyerSpentMist: "1000",
      agentSpentMist: "250",
      totalSpentMist: "1250",
      maxSpendMist: "1200",
      withinCap: false,
      transactionCount: 2
    });
  });

  it("rejects transaction spend metadata that does not match balanceChanges", () => {
    const buyer = "0x" + "aa".repeat(32);

    expect(() =>
      summarizeProductionAcceptanceSpend({
        buyerAddress: buyer,
        agentAddress: "0x" + "bb".repeat(32),
        maxSpendMist: 1200n,
        transactions: [{
          digest: "tx-buyer",
          signerAddress: buyer,
          suiSpentMist: "999",
          balanceChanges: [{ owner: buyer, coinType: "0x2::sui::SUI", amount: "-1000" }]
        }]
      })
    ).toThrow(/spend metadata does not match balanceChanges/);
  });

  it("allows net-positive signer transactions while keeping zero spend self-consistent", () => {
    const buyer = "0x" + "aa".repeat(32);
    const summary = summarizeProductionAcceptanceSpend({
      buyerAddress: buyer,
      agentAddress: "0x" + "bb".repeat(32),
      maxSpendMist: 1200n,
      transactions: [{
        digest: "tx-claim",
        signerAddress: buyer,
        suiSpentMist: "0",
        balanceChanges: [{ owner: buyer, coinType: "0x2::sui::SUI", amount: "1000" }]
      }]
    });

    expect(summary.buyerSpentMist).toBe("0");
    expect(summary.withinCap).toBe(true);
  });

  it("rejects transaction spend evidence without a signer SUI balance change", () => {
    const buyer = "0x" + "aa".repeat(32);
    const other = "0x" + "cc".repeat(32);

    expect(() =>
      summarizeProductionAcceptanceSpend({
        buyerAddress: buyer,
        agentAddress: "0x" + "bb".repeat(32),
        maxSpendMist: 1200n,
        transactions: [{
          digest: "tx-buyer",
          signerAddress: buyer,
          suiSpentMist: "0",
          balanceChanges: [{ owner: other, coinType: "0x2::sui::SUI", amount: "-1000" }]
        }]
      })
    ).toThrow(/has no SUI balance change/);
  });

  it("requires successful buyer-signed delegation funding evidence before issuing execute receipts", () => {
    const buyer = "0x" + "aa".repeat(32);
    const packageId = "0x" + "11".repeat(32);
    const fundSpend = {
      digest: "fundtx",
      signerLabel: "buyer",
      signerAddress: buyer,
      suiSpentMist: "1000",
      balanceChanges: [{ owner: buyer, coinType: "0x2::sui::SUI", amount: "-1000" }],
      eventTypes: [`${packageId}::delegation::DelegationFunded`],
      txStatus: "success"
    };

    expect(productionAcceptanceDelegationFundingMeta({
      fundDigest: "fundtx",
      fundSpend,
      buyerAddress: buyer,
      packageId
    })).toMatchObject({
      fundDigest: "fundtx",
      fundSigner: "buyer",
      fundSignerAddress: buyer,
      fundSuiSpentMist: "1000",
      fundEventTypes: [`${packageId}::delegation::DelegationFunded`],
      fundTxStatus: "success"
    });

    expect(() =>
      productionAcceptanceDelegationFundingMeta({
        fundDigest: "fundtx",
        buyerAddress: buyer,
        packageId
      })
    ).toThrow(/missing from the acceptance transaction ledger/);

    expect(() =>
      productionAcceptanceDelegationFundingMeta({
        fundDigest: "fundtx",
        fundSpend: { ...fundSpend, txStatus: "failure" },
        buyerAddress: buyer,
        packageId
      })
    ).toThrow(/did not succeed/);

    expect(() =>
      productionAcceptanceDelegationFundingMeta({
        fundDigest: "fundtx",
        fundSpend: { ...fundSpend, signerAddress: "0x" + "bb".repeat(32) },
        buyerAddress: buyer,
        packageId
      })
    ).toThrow(/does not match buyer/);

    expect(() =>
      productionAcceptanceDelegationFundingMeta({
        fundDigest: "fundtx",
        fundSpend: { ...fundSpend, eventTypes: [`${packageId}::delegation::DelegationCreated`] },
        buyerAddress: buyer,
        packageId
      })
    ).toThrow(/missing DelegationFunded/);

    expect(() =>
      productionAcceptanceDelegationFundingMeta({
        fundDigest: "fundtx",
        fundSpend: { ...fundSpend, suiSpentMist: "999" },
        buyerAddress: buyer,
        packageId
      })
    ).toThrow(/spend metadata does not match/);
  });
});
