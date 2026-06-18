import { createElement } from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dom: JSDOM;
let root: ReturnType<typeof createRoot> | null = null;

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
      address: "0x" + "12".repeat(32),
      email: "reader@example.com",
      provider: "google"
    })
  );
}

describe("AccountPage production UI", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    root = null;
    installDom();
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root!.unmount();
      });
    }
    dom.window.close();
    vi.restoreAllMocks();
  });

  it("shows product account sections for a signed-in user", async () => {
    seedSignedInSession();
    await renderAccountPage();

    const text = dom.window.document.body.textContent || "";
    expect(text).toContain("Sui identity");
    expect(text).toContain("Connected GitHub repositories");
    expect(text).toContain("My publications");
    expect(text).toContain("reader@example.com");
  });

  it("does not expose production acceptance controls in the user account page", async () => {
    seedSignedInSession();
    await renderAccountPage();

    const text = dom.window.document.body.textContent || "";
    expect(text).not.toContain("Production acceptance session");
    expect(text).not.toContain("Export buyer session");
    expect(text).not.toContain("Export agent session");
    expect(dom.window.document.querySelector('[data-testid="export-acceptance-buyer"]')).toBeNull();
    expect(dom.window.document.querySelector('[data-testid="export-acceptance-agent"]')).toBeNull();
  });
});
