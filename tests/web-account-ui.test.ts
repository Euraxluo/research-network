import { createElement } from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dom: JSDOM;
let root: ReturnType<typeof createRoot> | null = null;
let capturedBlob: Blob | null = null;
let clickedDownload: { download: string; href: string } | null = null;

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
  Object.defineProperty(dom.window.URL, "createObjectURL", {
    value: vi.fn((blob: Blob) => {
      capturedBlob = blob;
      return "blob:acceptance-session";
    }),
    configurable: true
  });
  Object.defineProperty(dom.window.URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
  vi.spyOn(dom.window.HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clickedDownload = { download: this.download, href: this.href };
  });
}

async function renderAccountPage(): Promise<void> {
  const modulePath = "../web/src/pages/AccountPage.tsx";
  const { AccountPage } = await import(modulePath);
  const rootEl = dom.window.document.getElementById("root");
  expect(rootEl).toBeTruthy();
  root = createRoot(rootEl!);
  await act(async () => {
    root!.render(createElement(AccountPage));
  });
}

function seedSignedInSession(includeEphemeralKey = true): void {
  dom.window.localStorage.setItem(
    "rn_session",
    JSON.stringify({
      address: "0x" + "12".repeat(32),
      email: "buyer@example.com",
      provider: "google"
    })
  );
  dom.window.sessionStorage.setItem(
    "rn_zk_session",
    JSON.stringify({
      id_token: "header.payload.sig",
      salt: "123456",
      maxEpoch: 321,
      randomness: "999"
    })
  );
  if (includeEphemeralKey) {
    dom.window.sessionStorage.setItem(
      "rn_zk_eph",
      JSON.stringify({
        secret: "suiprivkey1secret",
        maxEpoch: 321,
        randomness: "999"
      })
    );
  }
}

function byTestId(testId: string): { textContent: string | null; dispatchEvent(event: Event): boolean } {
  const el = dom.window.document.querySelector(`[data-testid="${testId}"]`);
  expect(el, `missing [data-testid="${testId}"]`).toBeTruthy();
  return el as unknown as { textContent: string | null; dispatchEvent(event: Event): boolean };
}

async function clickByTestId(testId: string): Promise<void> {
  await act(async () => {
    byTestId(testId).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
}

describe("AccountPage acceptance session export UI", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    capturedBlob = null;
    clickedDownload = null;
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

  it("downloads the current same-tab zkLogin session from the buyer button", async () => {
    seedSignedInSession();
    await renderAccountPage();

    await clickByTestId("export-acceptance-buyer");

    expect(clickedDownload).toEqual({
      download: "acceptance-buyer.json",
      href: "blob:acceptance-session"
    });
    expect(capturedBlob).toBeTruthy();
    const exported = JSON.parse(await capturedBlob!.text()) as {
      address: string;
      ephemeralSecretKey: string;
      idToken: string;
      rn_zk_eph: { secret: string };
      rn_zk_session: { id_token: string };
    };
    expect(exported.address).toBe("0x" + "12".repeat(32));
    expect(exported.ephemeralSecretKey).toBe("suiprivkey1secret");
    expect(exported.idToken).toBe("header.payload.sig");
    expect(exported.rn_zk_eph.secret).toBe("suiprivkey1secret");
    expect(exported.rn_zk_session.id_token).toBe("header.payload.sig");
    expect(byTestId("acceptance-session-export-status").textContent).toContain(
      ".research-network/secrets/acceptance-buyer.json"
    );
  });

  it("shows a closed-fail status when the same-tab ephemeral key is unavailable", async () => {
    seedSignedInSession(false);
    await renderAccountPage();

    await clickByTestId("export-acceptance-agent");

    expect(clickedDownload).toBeNull();
    expect(capturedBlob).toBeNull();
    expect(byTestId("acceptance-session-export-status").textContent).toContain("rn_zk_eph.secret");
  });
});
