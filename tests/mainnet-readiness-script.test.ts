import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("mainnet readiness script", () => {
  it("reports missing receipts as structured failures instead of crashing", async () => {
    let stdout = "";
    let stderr = "";
    try {
      await execFileAsync("npx", [
        "tsx",
        "scripts/mainnet-readiness.ts",
        "--stage", "mainnet-config",
        "--testnet-preflight-receipt", ".research-network/acceptance/missing-preflight.json",
        "--testnet-execute-receipt", ".research-network/acceptance/missing-execute.json",
        "--skip-chain",
        "--json"
      ], {
        cwd: process.cwd(),
        env: { ...process.env, NODE_ENV: "" }
      });
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; code?: number };
      stdout = failure.stdout ?? "";
      stderr = failure.stderr ?? "";
      expect(failure.code).toBe(1);
    }

    expect(stderr).toBe("");
    const report = JSON.parse(stdout) as { ready: boolean; checks: Array<{ name: string; status: string; message: string }> };
    expect(report.ready).toBe(false);
    expect(report.checks.some((check) =>
      check.name === "receipt.testnet-preflight" &&
      check.status === "failed" &&
      /missing/.test(check.message)
    )).toBe(true);
    expect(report.checks.some((check) =>
      check.name === "receipt.testnet-execute" &&
      check.status === "failed" &&
      /missing/.test(check.message)
    )).toBe(true);
  });
});
