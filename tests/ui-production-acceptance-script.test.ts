import { describe, expect, it } from "vitest";
import {
  parseCommandJson,
  parseUiAcceptanceArgs
} from "../scripts/ui-production-acceptance.js";

describe("UI production acceptance script helpers", () => {
  it("parses required browser acceptance arguments from argv", () => {
    const args = parseUiAcceptanceArgs([
      "--network", "testnet",
      "--url", "https://testnet.example/workbench.html",
      "--buyer-session", ".research-network/secrets/buyer.json",
      "--agent-session", ".research-network/secrets/agent.json",
      "--sync-command", "npm run sync:testnet",
      "--walrus-site-object-id", "0x" + "12".repeat(32),
      "--source-repo", "org/research",
      "--timeout-ms", "60000",
      "--headful"
    ], {});

    expect(args).toMatchObject({
      network: "testnet",
      url: "https://testnet.example/workbench.html",
      buyerSessionPath: ".research-network/secrets/buyer.json",
      agentSessionPath: ".research-network/secrets/agent.json",
      syncCommand: "npm run sync:testnet",
      sourceRepo: "org/research",
      timeoutMs: 60000,
      headless: false
    });
    expect(args.receiptPath).toBe(".research-network/acceptance/testnet-ui.json");
  });

  it("uses environment variables for CI-style acceptance runs", () => {
    const args = parseUiAcceptanceArgs([], {
      RN_ACCEPTANCE_NETWORK: "testnet",
      RN_UI_ACCEPTANCE_URL: "https://testnet.example/workbench.html",
      RN_ACCEPTANCE_BUYER_SESSION: ".research-network/secrets/buyer.json",
      RN_ACCEPTANCE_AGENT_SESSION: ".research-network/secrets/agent.json",
      RN_UI_ACCEPTANCE_SYNC_COMMAND: "npm run sync:testnet",
      RN_UI_ACCEPTANCE_WALRUS_SITE_OBJECT_ID: "0x" + "34".repeat(32)
    });

    expect(args.url).toBe("https://testnet.example/workbench.html");
    expect(args.syncCommand).toBe("npm run sync:testnet");
    expect(args.walrusSiteObjectId).toBe("0x" + "34".repeat(32));
  });

  it("rejects missing or non-http Workbench URLs", () => {
    expect(() => parseUiAcceptanceArgs([], {})).toThrow(/--url/);
    expect(() => parseUiAcceptanceArgs([
      "--url", "file:///tmp/workbench.html",
      "--buyer-session", "buyer.json",
      "--agent-session", "agent.json",
      "--sync-command", "sync",
      "--walrus-site-object-id", "0x" + "12".repeat(32)
    ], {})).toThrow(/http/);
  });

  it("parses JSON from noisy sync command output", () => {
    expect(parseCommandJson("polling...\n{\"events_ingested\":3,\"ok\":true}\n")).toMatchObject({
      events_ingested: 3,
      ok: true
    });
  });

  it("rejects sync command output without JSON evidence", () => {
    expect(() => parseCommandJson("done but no json")).toThrow(/sync-command/);
  });
});
