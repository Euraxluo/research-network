import { createElement } from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dom: JSDOM;
let root: ReturnType<typeof createRoot> | null = null;
const TEST_ADDRESS = "0xb178126020d69bb24ecd6a39ac5db18a8badae973dae0e9b20a889a68b609d7f";

function installDom(): void {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "http://127.0.0.1/account.html",
    pretendToBeVisual: true
  });
  const globals: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    sessionStorage: dom.window.sessionStorage,
    navigator: dom.window.navigator,
    location: dom.window.location,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    HTMLElement: dom.window.HTMLElement,
    HTMLAnchorElement: dom.window.HTMLAnchorElement,
    URL: dom.window.URL,
    Blob,
    IS_REACT_ACT_ENVIRONMENT: true
  };
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
}

async function renderAccountPage(): Promise<void> {
  const pageModulePath = "../web/src/pages/AccountPage.tsx";
  const { AccountPage } = await import(pageModulePath);
  const rootEl = dom.window.document.getElementById("root");
  expect(rootEl).toBeTruthy();
  root = createRoot(rootEl!);
  await act(async () => {
    root!.render(createElement(AccountPage));
  });
}

function seedSignedInSession(): void {
  dom.window.localStorage.setItem(
    "rn_session",
    JSON.stringify({
      address: TEST_ADDRESS,
      email: "reader@example.com",
      provider: "google",
      sub: "google-subject",
      iss: "https://accounts.google.com",
      ts: Date.now()
    })
  );
}

function seedGithubBinding(): void {
  dom.window.localStorage.setItem(
    "rn_github",
    JSON.stringify({
      sui_address: TEST_ADDRESS,
      login: "echo",
      installation_id: 101,
      account: "echo",
      account_type: "User",
      repos: ["echo/loop-engine"],
      available_repos: ["echo/loop-engine"],
      selected_repo: "echo/loop-engine"
    })
  );
}

function mockIndexResponse(body: Record<string, unknown>): void {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/index")) {
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ valid: false }), { status: 200, headers: { "content-type": "application/json" } });
  }));
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("AccountPage production UI", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    root = null;
    installDom();
    mockIndexResponse({
      assets: [],
      membership: { recent_events: [] },
      delegations: { recent_events: [] }
    });
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root!.unmount();
      });
    }
    dom.window.close();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows product account sections for a signed-in user", async () => {
    seedSignedInSession();
    await renderAccountPage();

    const text = dom.window.document.body.textContent || "";
    expect(text).toContain("Current profile");
    expect(text).toContain("Identity and scopes");
    expect(text).toContain("Sui identity");
    expect(text).toContain("Connected GitHub repositories");
    expect(text).toContain("My assets");
    expect(text).toContain("Recent proofs");
    expect(text).toContain("reader@example.com");
  });

  it("clears QA-seeded local sessions instead of showing fake zkLogin addresses", async () => {
    dom.window.localStorage.setItem(
      "rn_session",
      JSON.stringify({
        address: "0x" + "17".repeat(32),
        email: "euraxluo@gmail.com",
        provider: "google"
      })
    );
    dom.window.localStorage.setItem(
      "rn_github",
      JSON.stringify({
        sui_address: "0x" + "17".repeat(32),
        login: "Euraxluo",
        installation_id: 139753991,
        repos: ["Euraxluo/research-network"]
      })
    );

    await renderAccountPage();

    const text = dom.window.document.body.textContent || "";
    expect(text).toContain("Not signed in.");
    expect(text).not.toContain("0x1717171717171717");
    expect(dom.window.localStorage.getItem("rn_session")).toBeNull();
    expect(dom.window.localStorage.getItem("rn_github")).toBeNull();
  });

  it("ships inside the same public site shell as the rest of researchχiv", async () => {
    const html = await fs.readFile("web/account.html", "utf8");
    expect(html).toContain('class="logo" href="/"');
    expect(html).toContain("research<span");
    expect(html).toContain('href="/search.html"');
    expect(html).toContain('href="/dashboard.html"');
    expect(html).toContain('href="/workbench.html"');
    expect(html).toContain('href="/account.html"');
    expect(html).toContain('<main class="wrap">');
    expect(html).not.toContain('class="container" style=');
  });

  it("does not expose production acceptance controls in the user account page", async () => {
    seedSignedInSession();
    await renderAccountPage();

    const text = dom.window.document.body.textContent || "";
    expect(text).not.toContain("Production acceptance session");
    expect(text).not.toContain("Export buyer session");
    expect(text).not.toContain("Export agent session");
    expect(text).not.toContain("Copy buyer session");
    expect(text).not.toContain("Reveal buyer session");
    expect(text).not.toContain("Start buyer acceptance login");
    expect(dom.window.document.querySelector('[data-testid="export-acceptance-buyer"]')).toBeNull();
    expect(dom.window.document.querySelector('[data-testid="export-acceptance-agent"]')).toBeNull();
    expect(dom.window.document.querySelector('[data-testid="debug-reveal-acceptance-buyer"]')).toBeNull();
    expect(dom.window.document.querySelector('[data-testid="debug-start-acceptance-buyer-login"]')).toBeNull();
  });

  it("loads this profile's assets and activity from the live index API", async () => {
    const address = TEST_ADDRESS;
    seedSignedInSession();
    seedGithubBinding();
    mockIndexResponse({
      assets: [
        {
          id: "ra:loop-engine",
          title: "Loop Engine Research Report",
          authors: "Echo (@echo)",
          repo_url: "https://github.com/echo/loop-engine",
          sui_object_id: "0x" + "34".repeat(32),
          tx_digest: "tx-loop",
          tx_sender: address,
          created_at: "2026-06-23T10:00:00.000Z"
        }
      ],
      membership: {
        recent_events: [
          {
            event_type: "PlatformMembershipPurchased",
            subject_address: address,
            tx_digest: "tx-member",
            amount_mist: "1000000",
            created_at: "2026-06-23T10:01:00.000Z"
          }
        ]
      },
      delegations: {
        recent_events: [
          {
            event_type: "DelegationCreated",
            buyer: address,
            agent: address,
            tx_digest: "tx-delegation",
            budget_mist: "1000000",
            created_at: "2026-06-23T10:02:00.000Z"
          }
        ]
      }
    });

    await renderAccountPage();
    await flushEffects();

    const text = dom.window.document.body.textContent || "";
    expect(text).toContain("@echo");
    expect(text).toContain("echo/loop-engine");
    expect(text).toContain("Loop Engine Research Report");
    expect(text).toContain("PlatformMembershipPurchased");
    expect(text).toContain("DelegationCreated");
    expect(fetch).toHaveBeenCalledWith("/api/index?limit=20", { cache: "no-store" });
  });
});
