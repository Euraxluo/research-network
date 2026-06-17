import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import type { ProductionAcceptanceReceipt, ProductionAcceptanceStep } from "../src/core/production-acceptance.js";

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

  it("passes when receipts and all mainnet config surfaces agree", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rn-readiness-"));
    try {
      const preflightPath = path.join(dir, "testnet-preflight.json");
      const executePath = path.join(dir, "testnet-execute.json");
      await fs.writeFile(preflightPath, JSON.stringify(makePreflightReceipt(), null, 2), "utf8");
      await fs.writeFile(executePath, JSON.stringify(makeExecuteReceipt(), null, 2), "utf8");

      const { stdout, stderr } = await execFileAsync("npx", [
        "tsx",
        "scripts/mainnet-readiness.ts",
        "--stage", "mainnet-config",
        "--testnet-preflight-receipt", preflightPath,
        "--testnet-execute-receipt", executePath,
        "--skip-chain",
        "--json"
      ], {
        cwd: process.cwd(),
        env: readinessEnv()
      });

      expect(stderr).toBe("");
      const report = JSON.parse(stdout) as { ready: boolean; checks: Array<{ name: string; status: string }> };
      expect(report.ready).toBe(true);
      expect(report.checks.some((check) => check.name === "config.consistency.package_id" && check.status === "passed")).toBe(true);
      expect(report.checks.some((check) => check.status === "failed")).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("fails when acceptance and Web mainnet object ids diverge", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rn-readiness-"));
    let stdout = "";
    let stderr = "";
    try {
      const preflightPath = path.join(dir, "testnet-preflight.json");
      const executePath = path.join(dir, "testnet-execute.json");
      await fs.writeFile(preflightPath, JSON.stringify(makePreflightReceipt(), null, 2), "utf8");
      await fs.writeFile(executePath, JSON.stringify(makeExecuteReceipt(), null, 2), "utf8");

      try {
        await execFileAsync("npx", [
          "tsx",
          "scripts/mainnet-readiness.ts",
          "--stage", "mainnet-config",
          "--testnet-preflight-receipt", preflightPath,
          "--testnet-execute-receipt", executePath,
          "--skip-chain",
          "--json"
        ], {
          cwd: process.cwd(),
          env: readinessEnv({ VITE_RN_PACKAGE_ID: "0x" + "99".repeat(32) })
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
        check.name === "config.consistency.package_id" &&
        check.status === "failed" &&
        /does not match/.test(check.message)
      )).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("fails when acceptance and Web mainnet economic parameters diverge", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rn-readiness-"));
    let stdout = "";
    let stderr = "";
    try {
      const preflightPath = path.join(dir, "testnet-preflight.json");
      const executePath = path.join(dir, "testnet-execute.json");
      await fs.writeFile(preflightPath, JSON.stringify(makePreflightReceipt(), null, 2), "utf8");
      await fs.writeFile(executePath, JSON.stringify(makeExecuteReceipt(), null, 2), "utf8");

      try {
        await execFileAsync("npx", [
          "tsx",
          "scripts/mainnet-readiness.ts",
          "--stage", "mainnet-config",
          "--testnet-preflight-receipt", preflightPath,
          "--testnet-execute-receipt", executePath,
          "--skip-chain",
          "--json"
        ], {
          cwd: process.cwd(),
          env: readinessEnv({ VITE_RN_PLATFORM_MEMBERSHIP_PRICE_MIST: "2000000" })
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
        check.name === "config.consistency.platform_membership_price" &&
        check.status === "failed" &&
        /does not match/.test(check.message)
      )).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("fails mainnet-final when mainnet receipts do not match the current acceptance env", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rn-readiness-"));
    let stdout = "";
    let stderr = "";
    try {
      const testnetPreflightPath = path.join(dir, "testnet-preflight.json");
      const testnetExecutePath = path.join(dir, "testnet-execute.json");
      const mainnetPreflightPath = path.join(dir, "mainnet-preflight.json");
      const mainnetExecutePath = path.join(dir, "mainnet-execute.json");
      await fs.writeFile(testnetPreflightPath, JSON.stringify(makePreflightReceipt(), null, 2), "utf8");
      await fs.writeFile(testnetExecutePath, JSON.stringify(makeExecuteReceipt(), null, 2), "utf8");
      await fs.writeFile(mainnetPreflightPath, JSON.stringify(makePreflightReceipt("mainnet"), null, 2), "utf8");
      await fs.writeFile(
        mainnetExecutePath,
        JSON.stringify(makeExecuteReceipt("mainnet", {
          config: {
            ...mainnetConfig(),
            packageId: "0x" + "99".repeat(32)
          }
        }), null, 2),
        "utf8"
      );

      try {
        await execFileAsync("npx", [
          "tsx",
          "scripts/mainnet-readiness.ts",
          "--stage", "mainnet-final",
          "--testnet-preflight-receipt", testnetPreflightPath,
          "--testnet-execute-receipt", testnetExecutePath,
          "--mainnet-preflight-receipt", mainnetPreflightPath,
          "--mainnet-execute-receipt", mainnetExecutePath,
          "--skip-chain",
          "--json"
        ], {
          cwd: process.cwd(),
          env: readinessEnv()
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
        check.name === "receipt.mainnet-execute.config.package_id" &&
        check.status === "failed" &&
        /does not match/.test(check.message)
      )).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("fails mainnet-final when live chain checks are skipped", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rn-readiness-"));
    let stdout = "";
    let stderr = "";
    try {
      const testnetPreflightPath = path.join(dir, "testnet-preflight.json");
      const testnetExecutePath = path.join(dir, "testnet-execute.json");
      const mainnetPreflightPath = path.join(dir, "mainnet-preflight.json");
      const mainnetExecutePath = path.join(dir, "mainnet-execute.json");
      await fs.writeFile(testnetPreflightPath, JSON.stringify(makePreflightReceipt(), null, 2), "utf8");
      await fs.writeFile(testnetExecutePath, JSON.stringify(makeExecuteReceipt(), null, 2), "utf8");
      await fs.writeFile(mainnetPreflightPath, JSON.stringify(makePreflightReceipt("mainnet"), null, 2), "utf8");
      await fs.writeFile(mainnetExecutePath, JSON.stringify(makeExecuteReceipt("mainnet"), null, 2), "utf8");

      try {
        await execFileAsync("npx", [
          "tsx",
          "scripts/mainnet-readiness.ts",
          "--stage", "mainnet-final",
          "--testnet-preflight-receipt", testnetPreflightPath,
          "--testnet-execute-receipt", testnetExecutePath,
          "--mainnet-preflight-receipt", mainnetPreflightPath,
          "--mainnet-execute-receipt", mainnetExecutePath,
          "--skip-chain",
          "--json"
        ], {
          cwd: process.cwd(),
          env: readinessEnv()
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
        check.name === "chain.mainnet.required" &&
        check.status === "failed" &&
        /requires live mainnet chain checks/.test(check.message)
      )).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("fails mainnet-final when mainnet receipts are older than the final approval freshness window", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rn-readiness-"));
    let stdout = "";
    let stderr = "";
    try {
      const testnetPreflightPath = path.join(dir, "testnet-preflight.json");
      const testnetExecutePath = path.join(dir, "testnet-execute.json");
      const mainnetPreflightPath = path.join(dir, "mainnet-preflight.json");
      const mainnetExecutePath = path.join(dir, "mainnet-execute.json");
      await fs.writeFile(testnetPreflightPath, JSON.stringify(makePreflightReceipt(), null, 2), "utf8");
      await fs.writeFile(testnetExecutePath, JSON.stringify(makeExecuteReceipt(), null, 2), "utf8");
      await fs.writeFile(mainnetPreflightPath, JSON.stringify(makePreflightReceipt("mainnet"), null, 2), "utf8");
      await fs.writeFile(mainnetExecutePath, JSON.stringify(makeExecuteReceipt("mainnet"), null, 2), "utf8");

      try {
        await execFileAsync("npx", [
          "tsx",
          "scripts/mainnet-readiness.ts",
          "--stage", "mainnet-final",
          "--testnet-preflight-receipt", testnetPreflightPath,
          "--testnet-execute-receipt", testnetExecutePath,
          "--mainnet-preflight-receipt", mainnetPreflightPath,
          "--mainnet-execute-receipt", mainnetExecutePath,
          "--mainnet-receipt-max-age-ms", "1",
          "--skip-chain",
          "--json"
        ], {
          cwd: process.cwd(),
          env: readinessEnv()
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
        check.name === "receipt.mainnet-execute.freshness" &&
        check.status === "failed" &&
        /stale/.test(check.message)
      )).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("fails mainnet-final when protocol shared objects are from a different package", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rn-readiness-"));
    let stdout = "";
    let stderr = "";
    let mainnetExecuteReceipt: ProductionAcceptanceReceipt | null = null;
    const wrongPackageId = "0x" + "99".repeat(32);
    const server = http.createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { id: unknown; method: string; params: unknown[] };
      response.setHeader("content-type", "application/json");
      if (body.method === "sui_multiGetObjects") {
        const ids = body.params[0] as string[];
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: ids.map((id) => ({
            data: {
              objectId: id,
              type: chainObjectType(id, wrongPackageId)
            }
          }))
        }));
        return;
      }
      if (body.method === "sui_multiGetTransactionBlocks") {
        const digests = body.params[0] as string[];
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: digests.map((digest) => chainTransactionBlock(digest, mainnetExecuteReceipt))
        }));
        return;
      }
      if (body.method === "sui_getObject") {
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: walrusSiteObject()
        }));
        return;
      }
      if (body.method === "suix_getDynamicFieldObject") {
        const field = body.params[1] as { value?: { path?: string } };
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: walrusSiteResourceObject(field.value?.path ?? "/index.html")
        }));
        return;
      }
      response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { message: "unexpected method" } }));
    });
    try {
      const rpcUrl = await listen(server);
      const env = readinessEnv({
        RN_SUI_RPC_URL: rpcUrl,
        VITE_RN_SUI_RPC_URL: rpcUrl,
        WALRUS_SUI_RPC_URL: rpcUrl,
        AUTH_SUI_RPC_URL: rpcUrl
      });
      const testnetPreflightPath = path.join(dir, "testnet-preflight.json");
      const testnetExecutePath = path.join(dir, "testnet-execute.json");
      const mainnetPreflightPath = path.join(dir, "mainnet-preflight.json");
      const mainnetExecutePath = path.join(dir, "mainnet-execute.json");
      await fs.writeFile(testnetPreflightPath, JSON.stringify(makePreflightReceipt(), null, 2), "utf8");
      await fs.writeFile(testnetExecutePath, JSON.stringify(makeExecuteReceipt(), null, 2), "utf8");
      await fs.writeFile(mainnetPreflightPath, JSON.stringify(makePreflightReceipt("mainnet"), null, 2), "utf8");
      mainnetExecuteReceipt = makeExecuteReceipt("mainnet", {
        config: {
          ...mainnetConfig(),
          suiRpcUrl: rpcUrl
        }
      });
      await fs.writeFile(mainnetExecutePath, JSON.stringify(mainnetExecuteReceipt, null, 2), "utf8");

      try {
        await execFileAsync("npx", [
          "tsx",
          "scripts/mainnet-readiness.ts",
          "--stage", "mainnet-final",
          "--testnet-preflight-receipt", testnetPreflightPath,
          "--testnet-execute-receipt", testnetExecutePath,
          "--mainnet-preflight-receipt", mainnetPreflightPath,
          "--mainnet-execute-receipt", mainnetExecutePath,
          "--json"
        ], {
          cwd: process.cwd(),
          env
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
        check.name === "chain.mainnet.settlement-config.type" &&
        check.status === "failed" &&
        /does not match/.test(check.message)
      )).toBe(true);
    } finally {
      server.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("fails mainnet-final when the chain RPC omits a receipt transaction", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rn-readiness-"));
    let stdout = "";
    let stderr = "";
    let mainnetExecuteReceipt: ProductionAcceptanceReceipt | null = null;
    const server = http.createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { id: unknown; method: string; params: unknown[] };
      response.setHeader("content-type", "application/json");
      if (body.method === "sui_multiGetObjects") {
        const ids = body.params[0] as string[];
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: ids.map((id) => ({
            data: {
              objectId: id,
              type: chainObjectType(id)
            }
          }))
        }));
        return;
      }
      if (body.method === "sui_multiGetTransactionBlocks") {
        const digests = body.params[0] as string[];
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: digests.slice(0, -1).map((digest) => chainTransactionBlock(digest, mainnetExecuteReceipt))
        }));
        return;
      }
      if (body.method === "sui_getObject") {
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: walrusSiteObject()
        }));
        return;
      }
      if (body.method === "suix_getDynamicFieldObject") {
        const field = body.params[1] as { value?: { path?: string } };
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: walrusSiteResourceObject(field.value?.path ?? "/index.html")
        }));
        return;
      }
      response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { message: "unexpected method" } }));
    });
    try {
      const rpcUrl = await listen(server);
      const env = readinessEnv({
        RN_SUI_RPC_URL: rpcUrl,
        VITE_RN_SUI_RPC_URL: rpcUrl,
        WALRUS_SUI_RPC_URL: rpcUrl,
        AUTH_SUI_RPC_URL: rpcUrl
      });
      const testnetPreflightPath = path.join(dir, "testnet-preflight.json");
      const testnetExecutePath = path.join(dir, "testnet-execute.json");
      const mainnetPreflightPath = path.join(dir, "mainnet-preflight.json");
      const mainnetExecutePath = path.join(dir, "mainnet-execute.json");
      await fs.writeFile(testnetPreflightPath, JSON.stringify(makePreflightReceipt(), null, 2), "utf8");
      await fs.writeFile(testnetExecutePath, JSON.stringify(makeExecuteReceipt(), null, 2), "utf8");
      await fs.writeFile(mainnetPreflightPath, JSON.stringify(makePreflightReceipt("mainnet"), null, 2), "utf8");
      mainnetExecuteReceipt = makeExecuteReceipt("mainnet", {
        config: {
          ...mainnetConfig(),
          suiRpcUrl: rpcUrl
        }
      });
      await fs.writeFile(
        mainnetExecutePath,
        JSON.stringify(mainnetExecuteReceipt, null, 2),
        "utf8"
      );

      try {
        await execFileAsync("npx", [
          "tsx",
          "scripts/mainnet-readiness.ts",
          "--stage", "mainnet-final",
          "--testnet-preflight-receipt", testnetPreflightPath,
          "--testnet-execute-receipt", testnetExecutePath,
          "--mainnet-preflight-receipt", mainnetPreflightPath,
          "--mainnet-execute-receipt", mainnetExecutePath,
          "--json"
        ], {
          cwd: process.cwd(),
          env
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
        check.name.startsWith("chain.mainnet.transaction.") &&
        check.status === "failed" &&
        /was not found, did not succeed, or emitted different events/.test(check.message)
      )).toBe(true);
    } finally {
      server.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("fails mainnet-final when live transaction events do not match the receipt", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rn-readiness-"));
    let stdout = "";
    let stderr = "";
    let mainnetExecuteReceipt: ProductionAcceptanceReceipt | null = null;
    const server = http.createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { id: unknown; method: string; params: unknown[] };
      response.setHeader("content-type", "application/json");
      if (body.method === "sui_multiGetObjects") {
        const ids = body.params[0] as string[];
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: ids.map((id) => ({
            data: {
              objectId: id,
              type: chainObjectType(id)
            }
          }))
        }));
        return;
      }
      if (body.method === "sui_multiGetTransactionBlocks") {
        const digests = body.params[0] as string[];
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: digests.map((digest) => ({
            digest,
            effects: { status: { status: "success" } },
            events: [{ type: `${MAINNET.packageId}::other::UnrelatedEvent` }]
          }))
        }));
        return;
      }
      if (body.method === "sui_getObject") {
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: walrusSiteObject()
        }));
        return;
      }
      if (body.method === "suix_getDynamicFieldObject") {
        const field = body.params[1] as { value?: { path?: string } };
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: walrusSiteResourceObject(field.value?.path ?? "/index.html")
        }));
        return;
      }
      response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { message: "unexpected method" } }));
    });
    try {
      const rpcUrl = await listen(server);
      const env = readinessEnv({
        RN_SUI_RPC_URL: rpcUrl,
        VITE_RN_SUI_RPC_URL: rpcUrl,
        WALRUS_SUI_RPC_URL: rpcUrl,
        AUTH_SUI_RPC_URL: rpcUrl
      });
      const testnetPreflightPath = path.join(dir, "testnet-preflight.json");
      const testnetExecutePath = path.join(dir, "testnet-execute.json");
      const mainnetPreflightPath = path.join(dir, "mainnet-preflight.json");
      const mainnetExecutePath = path.join(dir, "mainnet-execute.json");
      await fs.writeFile(testnetPreflightPath, JSON.stringify(makePreflightReceipt(), null, 2), "utf8");
      await fs.writeFile(testnetExecutePath, JSON.stringify(makeExecuteReceipt(), null, 2), "utf8");
      await fs.writeFile(mainnetPreflightPath, JSON.stringify(makePreflightReceipt("mainnet"), null, 2), "utf8");
      await fs.writeFile(
        mainnetExecutePath,
        JSON.stringify(makeExecuteReceipt("mainnet", {
          config: {
            ...mainnetConfig(),
            suiRpcUrl: rpcUrl
          }
        }), null, 2),
        "utf8"
      );

      try {
        await execFileAsync("npx", [
          "tsx",
          "scripts/mainnet-readiness.ts",
          "--stage", "mainnet-final",
          "--testnet-preflight-receipt", testnetPreflightPath,
          "--testnet-execute-receipt", testnetExecutePath,
          "--mainnet-preflight-receipt", mainnetPreflightPath,
          "--mainnet-execute-receipt", mainnetExecutePath,
          "--json"
        ], {
          cwd: process.cwd(),
          env
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
        check.name.startsWith("chain.mainnet.transaction.") &&
        check.status === "failed" &&
        /emitted different events/.test(check.message)
      )).toBe(true);
    } finally {
      server.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("fails mainnet-final when a shared receipt digest omits one expected event set", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rn-readiness-"));
    let stdout = "";
    let stderr = "";
    let mainnetExecuteReceipt: ProductionAcceptanceReceipt | null = null;
    let sharedDigest = "";
    const server = http.createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { id: unknown; method: string; params: unknown[] };
      response.setHeader("content-type", "application/json");
      if (body.method === "sui_multiGetObjects") {
        const ids = body.params[0] as string[];
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: ids.map((id) => ({
            data: {
              objectId: id,
              type: chainObjectType(id)
            }
          }))
        }));
        return;
      }
      if (body.method === "sui_multiGetTransactionBlocks") {
        const digests = body.params[0] as string[];
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: digests.map((digest) => {
            if (digest === sharedDigest) {
              return {
                digest,
                effects: { status: { status: "success" } },
                events: eventTypesFor("buyer.record_access_receipt", MAINNET.packageId).map((type) => ({ type }))
              };
            }
            return chainTransactionBlock(digest, mainnetExecuteReceipt);
          })
        }));
        return;
      }
      if (body.method === "sui_getObject") {
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: walrusSiteObject()
        }));
        return;
      }
      if (body.method === "suix_getDynamicFieldObject") {
        const field = body.params[1] as { value?: { path?: string } };
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: walrusSiteResourceObject(field.value?.path ?? "/index.html")
        }));
        return;
      }
      response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { message: "unexpected method" } }));
    });
    try {
      const rpcUrl = await listen(server);
      const env = readinessEnv({
        RN_SUI_RPC_URL: rpcUrl,
        VITE_RN_SUI_RPC_URL: rpcUrl,
        WALRUS_SUI_RPC_URL: rpcUrl,
        AUTH_SUI_RPC_URL: rpcUrl
      });
      const testnetPreflightPath = path.join(dir, "testnet-preflight.json");
      const testnetExecutePath = path.join(dir, "testnet-execute.json");
      const mainnetPreflightPath = path.join(dir, "mainnet-preflight.json");
      const mainnetExecutePath = path.join(dir, "mainnet-execute.json");
      await fs.writeFile(testnetPreflightPath, JSON.stringify(makePreflightReceipt(), null, 2), "utf8");
      await fs.writeFile(testnetExecutePath, JSON.stringify(makeExecuteReceipt(), null, 2), "utf8");
      await fs.writeFile(mainnetPreflightPath, JSON.stringify(makePreflightReceipt("mainnet"), null, 2), "utf8");
      mainnetExecuteReceipt = makeExecuteReceipt("mainnet", {
        config: {
          ...mainnetConfig(),
          suiRpcUrl: rpcUrl
        }
      });
      const membershipStep = mainnetExecuteReceipt.steps.find((step) => step.name === "buyer.buy_platform_membership");
      const accessReceiptStep = mainnetExecuteReceipt.steps.find((step) => step.name === "buyer.record_access_receipt");
      if (!membershipStep?.digest || !accessReceiptStep) throw new Error("test fixture missing receipt steps");
      sharedDigest = membershipStep.digest;
      accessReceiptStep.digest = sharedDigest;
      await fs.writeFile(mainnetExecutePath, JSON.stringify(mainnetExecuteReceipt, null, 2), "utf8");

      try {
        await execFileAsync("npx", [
          "tsx",
          "scripts/mainnet-readiness.ts",
          "--stage", "mainnet-final",
          "--testnet-preflight-receipt", testnetPreflightPath,
          "--testnet-execute-receipt", testnetExecutePath,
          "--mainnet-preflight-receipt", mainnetPreflightPath,
          "--mainnet-execute-receipt", mainnetExecutePath,
          "--json"
        ], {
          cwd: process.cwd(),
          env
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
        check.name.startsWith("chain.mainnet.transaction.") &&
        check.status === "failed" &&
        /emitted different events/.test(check.message)
      )).toBe(true);
    } finally {
      server.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("fails mainnet-final when the mainnet Walrus Site is missing required content resources", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rn-readiness-"));
    let stdout = "";
    let stderr = "";
    let mainnetExecuteReceipt: ProductionAcceptanceReceipt | null = null;
    const server = http.createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { id: unknown; method: string; params: unknown[] };
      response.setHeader("content-type", "application/json");
      if (body.method === "sui_multiGetObjects") {
        const ids = body.params[0] as string[];
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: ids.map((id) => ({
            data: {
              objectId: id,
              type: chainObjectType(id)
            }
          }))
        }));
        return;
      }
      if (body.method === "sui_multiGetTransactionBlocks") {
        const digests = body.params[0] as string[];
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: digests.map((digest) => chainTransactionBlock(digest, mainnetExecuteReceipt))
        }));
        return;
      }
      if (body.method === "sui_getObject") {
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: walrusSiteObject()
        }));
        return;
      }
      if (body.method === "suix_getDynamicFieldObject") {
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { error: { code: "notFound" } }
        }));
        return;
      }
      response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { message: "unexpected method" } }));
    });
    try {
      const rpcUrl = await listen(server);
      const env = readinessEnv({
        RN_SUI_RPC_URL: rpcUrl,
        VITE_RN_SUI_RPC_URL: rpcUrl,
        WALRUS_SUI_RPC_URL: rpcUrl,
        AUTH_SUI_RPC_URL: rpcUrl
      });
      const testnetPreflightPath = path.join(dir, "testnet-preflight.json");
      const testnetExecutePath = path.join(dir, "testnet-execute.json");
      const mainnetPreflightPath = path.join(dir, "mainnet-preflight.json");
      const mainnetExecutePath = path.join(dir, "mainnet-execute.json");
      await fs.writeFile(testnetPreflightPath, JSON.stringify(makePreflightReceipt(), null, 2), "utf8");
      await fs.writeFile(testnetExecutePath, JSON.stringify(makeExecuteReceipt(), null, 2), "utf8");
      await fs.writeFile(mainnetPreflightPath, JSON.stringify(makePreflightReceipt("mainnet"), null, 2), "utf8");
      mainnetExecuteReceipt = makeExecuteReceipt("mainnet", {
        config: {
          ...mainnetConfig(),
          suiRpcUrl: rpcUrl
        }
      });
      await fs.writeFile(mainnetExecutePath, JSON.stringify(mainnetExecuteReceipt, null, 2), "utf8");

      try {
        await execFileAsync("npx", [
          "tsx",
          "scripts/mainnet-readiness.ts",
          "--stage", "mainnet-final",
          "--testnet-preflight-receipt", testnetPreflightPath,
          "--testnet-execute-receipt", testnetExecutePath,
          "--mainnet-preflight-receipt", mainnetPreflightPath,
          "--mainnet-execute-receipt", mainnetExecutePath,
          "--json"
        ], {
          cwd: process.cwd(),
          env
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
        check.name === "chain.mainnet.walrus_site.index_html" &&
        check.status === "failed" &&
        /missing required resource/.test(check.message)
      )).toBe(true);
    } finally {
      server.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

const ALL_STEPS = [
  "config.validate",
  "accounts.validate",
  "balances.validate",
  "agent.publish_encrypted_report",
  "buyer.buy_platform_membership",
  "buyer.decrypt_report",
  "buyer.record_access_receipt",
  "buyer.buy_agent_subscription",
  "buyer.decrypt_report_with_subscription",
  "platform.settle_membership_receipt",
  "agent.claim_membership_earnings",
  "buyer.create_and_fund_delegation",
  "agent.publish_private_result",
  "buyer.decrypt_private_result",
  "buyer.complete_delegation",
  "budget.actual_spend_cap"
];

const MAINNET = {
  rpc: "https://fullnode.mainnet.sui.io:443",
  packageId: "0x" + "11".repeat(32),
  settlementConfigId: "0x" + "22".repeat(32),
  agentEarningsId: "0x" + "33".repeat(32),
  receiptRegistryId: "0x" + "44".repeat(32),
  walrusPublisher: "https://publisher.walrus.space",
  walrusAggregator: "https://aggregator.walrus.space",
  sealKeyServer: "0x" + "55".repeat(32),
  sealAggregator: "https://seal-aggregator.mainnet.example",
  walrusSite: "0x" + "66".repeat(32)
};

function readinessEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: "",
    ZKLOGIN_PROVER_URL: "https://prover.mainnet.example",
    RN_SUI_RPC_URL: MAINNET.rpc,
    RN_PACKAGE_ID: MAINNET.packageId,
    RN_SETTLEMENT_CONFIG_ID: MAINNET.settlementConfigId,
    RN_AGENT_EARNINGS_ID: MAINNET.agentEarningsId,
    RN_MEMBERSHIP_RECEIPT_REGISTRY_ID: MAINNET.receiptRegistryId,
    RN_WALRUS_PUBLISHER_URL: MAINNET.walrusPublisher,
    RN_WALRUS_AGGREGATOR_URL: MAINNET.walrusAggregator,
    RN_SEAL_KEY_SERVER_OBJECT_ID: MAINNET.sealKeyServer,
    RN_SEAL_KEY_SERVER_AGGREGATOR_URL: MAINNET.sealAggregator,
    RN_WALRUS_EPOCHS: "5",
    RN_SEAL_THRESHOLD: "1",
    RN_PLATFORM_MEMBERSHIP_PRICE_MIST: "1000000",
    RN_AGENT_SUBSCRIPTION_PRICE_MIST: "1000000",
    RN_DELEGATION_BUDGET_MIST: "1000000",
    RN_MEMBERSHIP_SETTLEMENT_SHARE_MIST: "800000",
    RN_ACCESS_DURATION_MS: "2592000000",
    VITE_RN_NETWORK: "mainnet",
    VITE_RN_SUI_RPC_URL: MAINNET.rpc,
    VITE_RN_PACKAGE_ID: MAINNET.packageId,
    VITE_RN_SETTLEMENT_CONFIG_ID: MAINNET.settlementConfigId,
    VITE_RN_AGENT_EARNINGS_ID: MAINNET.agentEarningsId,
    VITE_RN_MEMBERSHIP_RECEIPT_REGISTRY_ID: MAINNET.receiptRegistryId,
    VITE_RN_WALRUS_PUBLISHER_URL: MAINNET.walrusPublisher,
    VITE_RN_WALRUS_AGGREGATOR_URL: MAINNET.walrusAggregator,
    VITE_RN_SEAL_KEY_SERVER_OBJECT_ID: MAINNET.sealKeyServer,
    VITE_RN_SEAL_KEY_SERVER_AGGREGATOR_URL: MAINNET.sealAggregator,
    VITE_RN_WALRUS_EPOCHS: "5",
    VITE_RN_SEAL_THRESHOLD: "1",
    VITE_RN_PLATFORM_MEMBERSHIP_PRICE_MIST: "1000000",
    VITE_RN_AGENT_SUBSCRIPTION_PRICE_MIST: "1000000",
    VITE_RN_DELEGATION_BUDGET_MIST: "1000000",
    VITE_RN_MEMBERSHIP_SETTLEMENT_SHARE_MIST: "800000",
    VITE_RN_ACCESS_DURATION_MS: "2592000000",
    WALRUS_SITE_OBJECT_ID: MAINNET.walrusSite,
    WALRUS_SUI_RPC_URL: MAINNET.rpc,
    WALRUS_AGGREGATOR_URL: MAINNET.walrusAggregator,
    AUTH_SUI_RPC_URL: MAINNET.rpc,
    ...overrides
  };
}

function makePreflightReceipt(network: "testnet" | "mainnet" = "testnet"): ProductionAcceptanceReceipt {
  return {
    network,
    execute: false,
    preflight: true,
    startedAt: "2026-06-17T00:00:00.000Z",
    finishedAt: "2026-06-17T00:01:00.000Z",
    buyerAddress: "0x" + "aa".repeat(32),
    agentAddress: "0x" + "bb".repeat(32),
    budget: baseBudget("0"),
    config: network === "mainnet" ? mainnetConfig() : testnetConfig(),
    steps: ALL_STEPS.map((name) => {
      if (["config.validate", "accounts.validate", "balances.validate"].includes(name)) {
        if (name === "accounts.validate") {
          return {
            name,
            status: "passed",
            meta: {
              buyerProof: proofMeta("buyer"),
              agentProof: proofMeta("agent"),
              prover: proverMeta(),
              buyerFreshness: { maxEpoch: 123, currentEpoch: 120, epochsRemaining: 3 },
              agentFreshness: { maxEpoch: 123, currentEpoch: 120, epochsRemaining: 3 }
            }
          };
        }
        if (name === "balances.validate") {
          return { name, status: "passed", meta: balanceMeta() };
        }
        return { name, status: "passed" };
      }
      return { name, status: "skipped", meta: { reason: "preflight_no_transactions" } };
    }),
    conclusion: "passed"
  };
}

function makeExecuteReceipt(
  network: "testnet" | "mainnet" = "testnet",
  overrides: Partial<ProductionAcceptanceReceipt> = {}
): ProductionAcceptanceReceipt {
  const config = network === "mainnet" ? mainnetConfig() : testnetConfig();
  return {
    network,
    execute: true,
    preflight: false,
    startedAt: "2026-06-17T00:00:00.000Z",
    finishedAt: "2026-06-17T00:01:00.000Z",
    buyerAddress: "0x" + "aa".repeat(32),
    agentAddress: "0x" + "bb".repeat(32),
    budget: baseBudget("110000000"),
    config,
    spend: spendSummary(),
    steps: executeSteps(config.packageId ?? ""),
    conclusion: "passed",
    ...overrides
  };
}

function executeSteps(packageId: string): ProductionAcceptanceStep[] {
  return ALL_STEPS.map((name) => {
    const step: ProductionAcceptanceStep = { name, status: "passed" };
    if ([
      "agent.publish_encrypted_report",
      "buyer.buy_platform_membership",
      "buyer.record_access_receipt",
      "buyer.buy_agent_subscription",
      "platform.settle_membership_receipt",
      "agent.claim_membership_earnings",
      "buyer.create_and_fund_delegation",
      "agent.publish_private_result",
      "buyer.complete_delegation"
    ].includes(name)) {
      step.digest = digestFor(name);
    }
    if ([
      "agent.publish_encrypted_report",
      "buyer.buy_platform_membership",
      "buyer.record_access_receipt",
      "buyer.buy_agent_subscription",
      "buyer.create_and_fund_delegation",
      "agent.publish_private_result"
    ].includes(name)) {
      step.objectId = "0x" + "cc".repeat(32);
    }
    if (name === "buyer.create_and_fund_delegation") {
      step.meta = {
        fundDigest: digestFor("fund"),
        fundSignerAddress: "0x" + "aa".repeat(32),
        fundSuiSpentMist: "2000000",
        fundBalanceChanges: [{ owner: "0x" + "aa".repeat(32), coinType: "0x2::sui::SUI", amount: "-2000000" }],
        fundEventTypes: eventTypesFor("buyer.fund_delegation", packageId),
        fundTxStatus: "success"
      };
    }
    if (name === "agent.publish_encrypted_report" || name === "agent.publish_private_result") {
      step.meta = reportMeta(name);
    }
    if (name === "buyer.decrypt_report") {
      step.meta = decryptMeta("platform_member");
    }
    if (name === "buyer.decrypt_report_with_subscription") {
      step.meta = decryptMeta("agent_subscription");
    }
    if (name === "buyer.decrypt_private_result") {
      step.meta = decryptMeta("private_delegation");
    }
    if (step.digest) {
      step.meta = { ...(step.meta ?? {}), ...spendMeta(name, packageId) };
    }
    if (name === "budget.actual_spend_cap") {
      step.meta = spendSummary();
    }
    return step;
  });
}

function balanceMeta(): Record<string, string> {
  return {
    buyerBalanceMist: "110000000",
    buyerMinimumMist: "53800000",
    agentBalanceMist: "60000000",
    agentMinimumMist: "50000000"
  };
}

function proofMeta(role: "buyer" | "agent"): Record<string, string | boolean> {
  const derivedAddress = role === "buyer" ? "0x" + "aa".repeat(32) : "0x" + "bb".repeat(32);
  return {
    hasProofPoints: true,
    hasIssBase64Details: true,
    hasHeaderBase64: true,
    hasAddressSeed: true,
    addressSeedMatchesDerivedAddress: true,
    addressSeedSha256: role === "buyer" ? "1".repeat(64) : "2".repeat(64),
    derivedAddress
  };
}

function proverMeta(): Record<string, string | boolean> {
  return {
    configured: true,
    urlSha256: "a".repeat(64)
  };
}

function reportMeta(name: string): Record<string, string> {
  return {
    reportObjectId: "0x" + "cc".repeat(32),
    txDigest: digestFor(name),
    sealId: "0x" + "dd".repeat(32),
    walrusBlobId: "walrus-blob",
    ciphertextHash: "sha256:cipher",
    plaintextCommitment: "sha256:plain",
    visibility: name === "agent.publish_private_result" ? "private_delegation" : "encrypted"
  };
}

function digestFor(seed: string): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  let digest = "";
  for (let index = 0; index < 44; index += 1) {
    hash = (hash * 1664525 + 1013904223) >>> 0;
    digest += alphabet[hash % alphabet.length];
  }
  return digest;
}

function decryptMeta(accessPath: string): Record<string, string | number | boolean> {
  return {
    ...reportMeta("agent.publish_encrypted_report"),
    accessPath,
    plaintextBytes: 42,
    plaintextMatched: true
  };
}

function spendMeta(name: string, packageId: string): Record<string, unknown> {
  const signerAddress = name.startsWith("agent.") ? "0x" + "bb".repeat(32) : "0x" + "aa".repeat(32);
  const suiSpentMist = name.startsWith("agent.") ? "1500000" : "5000000";
  return {
    signer: name.startsWith("agent.") ? "agent" : "buyer",
    signerAddress,
    suiSpentMist,
    balanceChanges: [{ owner: signerAddress, coinType: "0x2::sui::SUI", amount: `-${suiSpentMist}` }],
    eventTypes: eventTypesFor(name, packageId),
    txStatus: "success"
  };
}

function eventTypesFor(name: string, packageId: string): string[] {
  const pkg = packageId;
  const map: Record<string, string[]> = {
    "agent.publish_encrypted_report": [`${pkg}::report::ResearchReportPublished`],
    "buyer.buy_platform_membership": [
      `${pkg}::access::PlatformMembershipPurchased`,
      `${pkg}::settlement::PlatformMembershipPaid`
    ],
    "buyer.record_access_receipt": [`${pkg}::access::AccessReceiptRecorded`],
    "buyer.buy_agent_subscription": [
      `${pkg}::access::AgentSubscriptionPurchased`,
      `${pkg}::settlement::AgentSubscriptionPaid`
    ],
    "platform.settle_membership_receipt": [
      `${pkg}::settlement::MembershipSettlementCreated`,
      `${pkg}::settlement::MembershipReportSettled`
    ],
    "agent.claim_membership_earnings": [`${pkg}::settlement::AgentEarningsClaimed`],
    "buyer.create_and_fund_delegation": [`${pkg}::delegation::DelegationCreated`],
    "buyer.fund_delegation": [`${pkg}::delegation::DelegationFunded`],
    "agent.publish_private_result": [
      `${pkg}::delegation::DelegationResultSubmitted`,
      `${pkg}::report::ResearchReportPublished`
    ],
    "buyer.complete_delegation": [`${pkg}::delegation::DelegationCompleted`]
  };
  return map[name] ?? [];
}

function spendSummary() {
  return {
    buyerSpentMist: "50000000",
    agentSpentMist: "10000000",
    totalSpentMist: "60000000",
    maxSpendMist: "110000000",
    withinCap: true,
    transactionCount: 10
  };
}

function baseBudget(maxSpendMist: string): ProductionAcceptanceReceipt["budget"] {
  return {
    committedSpendMist: "3800000",
    gasReserveMist: "50000000",
    buyerMinimumMist: "53800000",
    agentMinimumMist: "50000000",
    totalBudgetMist: "103800000",
    maxSpendMist
  };
}

function testnetConfig(): ProductionAcceptanceReceipt["config"] {
  return {
    suiRpcUrl: "https://sui-testnet-rpc.publicnode.com",
    packageId: "0x5ecd097d8f13e995493d23c9b033c815bd6a8bf771331c389c027296e8b8231e",
    settlementConfigId: "0x612c971a021e8139e0cd4e63bfef162f4301e72532b808a840d3d16512125ea4",
    agentEarningsId: "0xb637059cb77aca697e36673afa2e8639f7f82d16b8f0eba8eb6a1f5bd12eda2b",
    membershipReceiptRegistryId: "0x5a25a789a4032c8460afa68b26b839a081c770372fa04e567207c606b68ad748",
    walrusPublisherUrl: "https://publisher.walrus-testnet.walrus.space",
    walrusAggregatorUrl: "https://aggregator.walrus-testnet.walrus.space",
    walrusEpochs: 5,
    sealKeyServerObjectId: "0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98",
    sealKeyServerAggregatorUrl: "https://seal-aggregator-testnet.mystenlabs.com",
    sealThreshold: 1,
    platformMembershipPriceMist: "1000000",
    agentSubscriptionPriceMist: "1000000",
    delegationBudgetMist: "1000000",
    membershipSettlementShareMist: "800000",
    accessDurationMs: 2592000000
  };
}

function mainnetConfig(): ProductionAcceptanceReceipt["config"] {
  return {
    suiRpcUrl: MAINNET.rpc,
    packageId: MAINNET.packageId,
    settlementConfigId: MAINNET.settlementConfigId,
    agentEarningsId: MAINNET.agentEarningsId,
    membershipReceiptRegistryId: MAINNET.receiptRegistryId,
    walrusPublisherUrl: MAINNET.walrusPublisher,
    walrusAggregatorUrl: MAINNET.walrusAggregator,
    walrusEpochs: 5,
    sealKeyServerObjectId: MAINNET.sealKeyServer,
    sealKeyServerAggregatorUrl: MAINNET.sealAggregator,
    sealThreshold: 1,
    platformMembershipPriceMist: "1000000",
    agentSubscriptionPriceMist: "1000000",
    delegationBudgetMist: "1000000",
    membershipSettlementShareMist: "800000",
    accessDurationMs: 2592000000
  };
}

function chainObjectType(objectId: string, packageId = MAINNET.packageId): string {
  if (objectId === MAINNET.settlementConfigId) return `${packageId}::settlement::SettlementConfig`;
  if (objectId === MAINNET.agentEarningsId) return `${packageId}::settlement::AgentEarnings`;
  if (objectId === MAINNET.receiptRegistryId) return `${packageId}::settlement::MembershipReceiptRegistry`;
  if (objectId === MAINNET.sealKeyServer) return `${packageId}::key_server::KeyServer`;
  return `${packageId}::package::Package`;
}

function walrusSiteObject() {
  return {
    data: {
      objectId: MAINNET.walrusSite,
      type: `${MAINNET.packageId}::site::Site`
    }
  };
}

function walrusSiteResourceObject(resourcePath: string) {
  return {
    data: {
      objectId: "0x" + "88".repeat(32),
      content: {
        fields: {
          name: { fields: { path: resourcePath } },
          value: {
            fields: {
              blob_id: "12345",
              headers: { fields: { contents: [] } },
              path: resourcePath
            }
          }
        }
      }
    }
  };
}

function chainTransactionBlock(digest: string, receipt: ProductionAcceptanceReceipt | null) {
  return {
    digest,
    effects: { status: { status: "success" } },
    events: receiptEventTypesForDigest(receipt, digest).map((type) => ({ type }))
  };
}

function receiptEventTypesForDigest(receipt: ProductionAcceptanceReceipt | null, digest: string): string[] {
  if (!receipt) return [];
  for (const step of receipt.steps) {
    if (step.digest === digest && Array.isArray(step.meta?.eventTypes)) {
      return step.meta.eventTypes.filter((type): type is string => typeof type === "string");
    }
    if (step.meta?.fundDigest === digest && Array.isArray(step.meta?.fundEventTypes)) {
      return step.meta.fundEventTypes.filter((type): type is string => typeof type === "string");
    }
  }
  return [];
}

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("test RPC server did not bind to a TCP port");
  }
  return `http://127.0.0.1:${address.port}`;
}
