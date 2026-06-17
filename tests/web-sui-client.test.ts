import { describe, expect, it } from "vitest";

describe("web Sui PTB payment builders", () => {
  it("passes the split coin result, not the whole split result vector, into payment Move calls", async () => {
    const modulePath = "../web/src/lib/sui-client.ts";
    const {
      buildBuyAgentSubscription,
      buildBuyPlatformMembership,
      buildFundDelegationJob,
      buildSettleMembershipReport
    } = await import(modulePath);
    const builders = [
      buildBuyPlatformMembership({
        configObjectId: "0x" + "11".repeat(32),
        paymentMist: "1000",
        tier: 1,
        durationMs: 1000,
        packageId: "0x" + "aa".repeat(32)
      }),
      buildBuyAgentSubscription({
        configObjectId: "0x" + "11".repeat(32),
        earningsObjectId: "0x" + "22".repeat(32),
        agent: "0x" + "33".repeat(32),
        paymentMist: "1000",
        tier: 1,
        durationMs: 1000,
        packageId: "0x" + "aa".repeat(32)
      }),
      buildFundDelegationJob({
        jobObjectId: "0x" + "44".repeat(32),
        budgetMist: "1000",
        packageId: "0x" + "aa".repeat(32)
      }),
      buildSettleMembershipReport({
        earningsObjectId: "0x" + "22".repeat(32),
        receiptObjectId: "0x" + "55".repeat(32),
        amountMist: "1000",
        reportCount: 1,
        packageId: "0x" + "aa".repeat(32)
      })
    ];

    for (const tx of builders) {
      const data = tx.getData();
      expect(data.commands[0]?.$kind).toBe("SplitCoins");
      expect(data.commands[1]?.$kind).toBe("MoveCall");
      const moveCall = data.commands[1]?.MoveCall;
      const paymentArg = moveCall?.arguments.find(
        (arg: { NestedResult?: [number, number] }) =>
          "NestedResult" in arg && arg.NestedResult?.[0] === 0 && arg.NestedResult?.[1] === 0
      );
      expect(paymentArg).toBeTruthy();
      expect(moveCall?.arguments.some((arg: { Result?: number }) => "Result" in arg && arg.Result === 0)).toBe(false);
    }
  });
});
