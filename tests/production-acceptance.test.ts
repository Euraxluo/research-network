import { describe, expect, it } from "vitest";
import {
  assertProductionAcceptanceCanExecute,
  calculateProductionAcceptanceBudget,
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

    expect(() => assertProductionAcceptanceCanExecute(config)).toThrow(/buyer-session, agent-session, max-spend-mist/);
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
});
