import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendEvents,
  buildAuthAssets,
  buildStaticWeb,
  buildVercelAuthShell,
  initPdfOnlyWorkspace,
  initWorkspace,
  publishWorkspace,
  replayIndexer
} from "../src/index.js";
import { routeSegment } from "../src/core/web.js";
import { serveStaticSite } from "../src/core/web-serve.js";

let tempRoot: string;

async function makeTempDir(name: string) {
  const dir = path.join(tempRoot, name);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function sitePath(serverUrl: string, routePath: string): string {
  return `${serverUrl}/${routePath.replace(/^\//, "")}`;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadWorkbenchDom(siteDir: string, beforeParse?: (window: any) => void): Promise<JSDOM> {
  const html = await fs.readFile(path.join(siteDir, "workbench.html"), "utf8");
  const js = await fs.readFile(path.join(siteDir, "workbench.js"), "utf8");
  const inlined = html.replace(/<script src="\/workbench\.js[^"]*" defer><\/script>/, `<script>${js}</script>`);
  const dom = new JSDOM(inlined, {
    url: "http://127.0.0.1/workbench.html?rn_demo=1",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse
  });
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  return dom;
}

function testId(dom: JSDOM, id: string) {
  const el = dom.window.document.querySelector(`[data-testid="${id}"]`);
  expect(el, `missing [data-testid="${id}"]`).toBeTruthy();
  return el as unknown as { value: string; checked: boolean; click(): void; dispatchEvent(event: Event): boolean; textContent: string | null };
}

function selectValue(dom: JSDOM, selector: string, value: string): void {
  const el = dom.window.document.querySelector(selector) as unknown as { value: string; dispatchEvent(event: Event): boolean } | null;
  expect(el, `missing selector ${selector}`).toBeTruthy();
  el!.value = value;
  el!.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}

function submit(dom: JSDOM, selector: string): void {
  const el = dom.window.document.querySelector(selector);
  expect(el, `missing form ${selector}`).toBeTruthy();
  el!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
}

describe("static web E2E", () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "research-web-e2e-"));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("builds, serves, and returns all key routes with expected content", async () => {
    const workspace = await initWorkspace({
      target: await makeTempDir("workspace"),
      title: "E2E Test Paper",
      author: "E2E Agent",
      agentId: "agent:e2e",
      force: true
    });
    const texPath = path.join(workspace, "paper", "main.tex");
    await fs.writeFile(
      texPath,
      (await fs.readFile(texPath, "utf8")).replace("\\section{Conclusion}", "A compact test equation $E=mc^2$ should trigger MathJax.\n\\section{Conclusion}"),
      "utf8"
    );
    const localnet = path.join(tempRoot, "localnet");
    const published = await publishWorkspace(workspace, localnet);
    await replayIndexer({ localnetRoot: localnet });
    const siteDir = path.join(tempRoot, "site");
    await buildStaticWeb(siteDir, localnet);

    const assetSeg = routeSegment(published.sui.assetId);
    const server = await serveStaticSite(siteDir, 0);
    try {
      const routes: Array<{ path: string; expect: RegExp | string }> = [
        { path: "/", expect: /Recent submissions|E2E Test Paper/ },
        { path: "/index.html", expect: /logo-chi/ },
        { path: "/search.html", expect: /Filter assets, skills/ },
        { path: "/dashboard.html", expect: /Events/ },
        { path: "/workbench.html", expect: /Protocol Workbench/ },
        { path: "/membership.html", expect: /Membership/ },
        { path: "/delegations.html", expect: /Delegations/ },
        { path: "/site-data.json", expect: /"assets"/ },
        { path: "/styles.css", expect: /--arxiv-red/ },
        { path: "/site.js", expect: /setupPaperViewer/ },
        { path: "/workbench.js", expect: /Publish Research/ },
        { path: `/abs/${assetSeg}.html`, expect: /format-nav/ },
        { path: `/abs/${assetSeg}.html`, expect: /format-nav/ },
        { path: `/abs/${assetSeg}.html`, expect: /pdfjs-viewer/ },
        { path: `/abs/${assetSeg}.html`, expect: /id="tex"/ },
        { path: `/abs/${assetSeg}.html`, expect: /tex-source/ },
        { path: `/paper/${assetSeg}/main.pdf`, expect: "%PDF" },
        { path: `/paper/${assetSeg}/main.tex`, expect: /\\documentclass/ },
        { path: `/graph/${assetSeg}.html`, expect: /graph-canvas/ }
      ];

      for (const route of routes) {
        const response = await fetch(sitePath(server.url, route.path));
        expect(response.status, `${route.path} should return 200`).toBe(200);
        const body = await response.text();
        if (route.expect instanceof RegExp) {
          expect(body, `${route.path} body`).toMatch(route.expect);
        } else {
          expect(body, `${route.path} body`).toContain(route.expect);
        }
      }

      const indexHtml = await (await fetch(sitePath(server.url, "/"))).text();
      expect(indexHtml).toContain(`/paper/${assetSeg}/main.pdf`);
      expect(indexHtml).not.toContain("ra:local:");
      expect(indexHtml).toContain("Content-Security-Policy");
      expect(indexHtml).toContain("script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com");

      const siteData = await (await fetch(sitePath(server.url, "/site-data.json"))).json() as { assets: Array<{ href: string }> };
      expect(siteData.assets.some((asset) => asset.href === `/abs/${assetSeg}.html`)).toBe(true);

      const absHtml = await (await fetch(sitePath(server.url, `/abs/${assetSeg}.html`))).text();
      expect(absHtml).not.toContain("<iframe");
      expect(absHtml).not.toContain("paper-frame");
      expect(absHtml).toContain("integrity=\"sha384-");
      expect(absHtml).toContain("mathjax@3.2.2");

      const siteJs = await (await fetch(sitePath(server.url, "/site.js"))).text();
      expect(siteJs).toContain("PDFJS_SCRIPT_INTEGRITY");
      expect(siteJs).toContain("sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e");
      expect(siteJs).toContain("s.crossOrigin = \"anonymous\"");
    } finally {
      await server.close();
    }
  });

  it("renders indexed Seal Access commerce state on the dashboard and membership pages", async () => {
    const workspace = await initWorkspace({
      target: await makeTempDir("eco-ws"),
      title: "Economics Paper",
      author: "Eco Agent",
      agentId: "agent:eco",
      force: true
    });
    const localnet = path.join(tempRoot, "eco-localnet");
    const published = await publishWorkspace(workspace, localnet);
    const skillId = Object.keys(published.index.skills)[0];
    const ms = 1_700_000_000_000;
    await appendEvents(
      [
        { tx_digest: "tx_eco", event_seq: 0, event_type: "RevenuePoolCreated", checkpoint: ms, timestamp_ms: ms, payload: { pool_id: "pool:web", asset_id: published.sui.assetId, recipients: ["0xA"], weights_bps: [10000] } },
        { tx_digest: "tx_eco", event_seq: 1, event_type: "RevenueDeposited", checkpoint: ms, timestamp_ms: ms, payload: { pool_id: "pool:web", amount: 750, total_received: 750 } },
        { tx_digest: "tx_eco", event_seq: 2, event_type: "ResearchReportPublished", checkpoint: ms, timestamp_ms: ms, payload: { report_id: "rep:web", agent: "0xA", asset_id: published.sui.assetId, title: "Economics Report", visibility: "encrypted", required_tier: 1, walrus_blob_id: "walrus:report", seal_id: "seal:web", ciphertext_hash: "cipher", plaintext_commitment: "plain", free_preview: "member preview" } },
        { tx_digest: "tx_eco", event_seq: 3, event_type: "AccessReceiptRecorded", checkpoint: ms, timestamp_ms: ms, payload: { receipt_id: "read:web", period_id: 202606, user: "0xBUYER", report_id: "rep:web", agent: "0xA", access_type: "platform_member" } },
        { tx_digest: "tx_eco", event_seq: 4, event_type: "MembershipReportSettled", checkpoint: ms, timestamp_ms: ms, payload: { period_id: 202606, user: "0xBUYER", report_id: "rep:web", agent: "0xA", amount: 750 } },
        { tx_digest: "tx_eco", event_seq: 5, event_type: "DelegationCreated", checkpoint: ms, timestamp_ms: ms, payload: { job_id: "job:web", buyer: "0xBUYER", agent: "0xA", budget: 1200 } },
        { tx_digest: "tx_eco", event_seq: 6, event_type: "CrossChainPaymentReceived", checkpoint: ms, timestamp_ms: ms, payload: { order_hash: "ord:web", source_chain: "ethereum", source_tx: "0xweb", buyer: "0xBUYER", amount: 750 } }
      ],
      localnet
    );
    await replayIndexer({ localnetRoot: localnet });
    const siteDir = path.join(tempRoot, "eco-site");
    await buildStaticWeb(siteDir, localnet);

    const server = await serveStaticSite(siteDir, 0);
    try {
      const dashboard = await (await fetch(sitePath(server.url, "/dashboard.html"))).text();
      expect(dashboard).toContain("Seal Access");
      expect(dashboard).toContain("Cross-chain Payments");
      expect(dashboard).toContain("pool:web");
      expect(dashboard).toContain("rep:web");
      expect(dashboard).toContain("read:web");
      expect(dashboard).toContain("job:web");
      expect(dashboard).toContain("750");

      const membership = await (await fetch(sitePath(server.url, "/membership.html"))).text();
      expect(membership).toContain("read:web");
      expect(membership).toContain("rep:web");
      const delegations = await (await fetch(sitePath(server.url, "/delegations.html"))).text();
      expect(delegations).toContain("job:web");
      expect(skillId).toBeTruthy();
    } finally {
      await server.close();
    }
  });

  it("generates and serves static login, zkLogin, and GitHub callback assets", async () => {
    const localnet = await makeTempDir("auth-localnet");
    const siteDir = path.join(tempRoot, "auth-site");
    await buildStaticWeb(siteDir, localnet);
    await buildAuthAssets(siteDir, {
      googleClientId: "test-client.apps.googleusercontent.com",
      callbackPath: "/auth/callback.html",
      githubInstallUrl: "https://github.com/apps/research-network-app/installations/new",
      githubClientId: "Iv23test",
      githubCallbackPath: "/auth/github-callback.html",
      suiRpcUrl: "https://sui-testnet-rpc.publicnode.com",
      saltServicePath: "/api/zklogin-salt",
      githubOauthPath: "/api/github-oauth",
      githubBindingPath: "/api/github-binding"
    });

    const server = await serveStaticSite(siteDir, 0);
    try {
      const login = await fetch(sitePath(server.url, "/login.html"));
      expect(login.status).toBe(200);
      const loginHtml = await login.text();
      expect(loginHtml).toContain("Sign in with Google");
      expect(loginHtml).toContain("Connect GitHub repos");
      expect(loginHtml).toContain("/auth/login.js");
      expect(loginHtml).toContain("Content-Security-Policy");
      expect(loginHtml).toContain("script-src 'self'");

      const loginJs = await fetch(sitePath(server.url, "/auth/login.js"));
      expect(loginJs.status).toBe(200);
      const loginScript = await loginJs.text();
      expect(loginScript).toContain("Refresh GitHub repos");
      expect(loginScript).toContain("repoSelectorHtml");
      expect(loginScript).toContain("selected_repo");
      expect(loginScript).toContain("selected_installation_ids");
      expect(loginScript).toContain("repo-account-scope");
      expect(loginScript).toContain("rn-session-repo-select");
      expect(loginScript).toContain("rn-installation-scope");
      expect(loginScript).toContain("server-attested");

      const config = await fetch(sitePath(server.url, "/auth/config.js"));
      expect(config.status).toBe(200);
      const configJs = await config.text();
      expect(configJs).toContain("test-client.apps.googleusercontent.com");
      expect(configJs).toContain("research-network-app/installations/new");

      const githubCallback = await fetch(sitePath(server.url, "/auth/github-callback.html"));
      expect(githubCallback.status).toBe(200);
      const githubCallbackHtml = await githubCallback.text();
      expect(githubCallbackHtml).toContain("Connecting to GitHub");
      expect(githubCallbackHtml).toContain("/auth/github-callback.js");

      const githubCallbackJs = await fetch(sitePath(server.url, "/auth/github-callback.js"));
      expect(githubCallbackJs.status).toBe(200);
      const callbackJs = await githubCallbackJs.text();
      expect(callbackJs).toContain("installation_id");
      expect(callbackJs).toContain("id_token");
      expect(callbackJs).toContain("body.sui_address !== session.address");
      expect(callbackJs).toContain("localStorage.setItem");
      expect(callbackJs).toContain("function esc");
      expect(callbackJs).toContain("available_repositories");
      expect(callbackJs).toContain("selected_repo");
      expect(callbackJs).toContain("selected_installation_ids");
      expect(callbackJs).toContain("binding_attestations");
      expect(callbackJs).toContain("repo-account-scope");
      expect(callbackJs).toContain("binding_attestation");
      expect(callbackJs).toContain("binding_attestation_payload");
      expect(callbackJs).toContain("server_persisted");
      expect(callbackJs).toContain("account_id");
      expect(callbackJs).toContain("rn-repo-select");
      expect(callbackJs).toContain("Add GitHub account/org access");
      expect(callbackJs).not.toContain("repo-list");
      expect(callbackJs).toContain("readGithubState");
      expect(callbackJs).toContain("localStorage.getItem(\"rn_gh_state\")");
      expect(callbackJs).toContain("Repository access updated");
      expect(callbackJs).toContain("setup_action");
      expect(callbackJs).toContain("readGithubRecovery");
      expect(callbackJs).toContain("recoverGithubStateMismatch");
      expect(callbackJs).toContain("rn_gh_recovery");
      expect(callbackJs).toContain("GitHub authorization state expired");

      const zkBundle = await fetch(sitePath(server.url, "/zklogin-browser.js"));
      expect(zkBundle.status).toBe(200);
      expect((await zkBundle.text()).length).toBeGreaterThan(100_000);
    } finally {
      await server.close();
    }
  });

  it("supports interactive workbench publishing and multi-account Seal access checks", async () => {
    const localnet = await makeTempDir("workbench-localnet");
    const siteDir = path.join(tempRoot, "workbench-site");
    await buildStaticWeb(siteDir, localnet);

    const dom = await loadWorkbenchDom(siteDir);
    const doc = dom.window.document;

    testId(dom, "seed-demo").click();
    expect(testId(dom, "selected-repo").textContent).toBe("octo-agent/research-alpha");

    const personalScope = doc.querySelector('.rn-workbench-installation[value="101"]') as unknown as { checked: boolean; click(): void } | null;
    expect(personalScope).toBeTruthy();
    personalScope!.click();
    expect(testId(dom, "selected-repo").textContent).toBe("research-org/encrypted-lab");

    testId(dom, "publish-title").value = "Encrypted Alpha Memo";
    testId(dom, "publish-preview").value = "Preview visible to everyone.";
    testId(dom, "publish-plaintext").value = "Confidential encrypted memo body.";
    submit(dom, "#publish-form");

    const encryptedReport = doc.querySelector('[data-visibility="encrypted"]');
    expect(encryptedReport?.textContent).toContain("Encrypted Alpha Memo");
    expect(encryptedReport?.textContent).toContain("Locked: needs_membership_or_subscription");
    expect((encryptedReport?.querySelector(".decrypt-report") as HTMLButtonElement | null)?.disabled).toBe(true);

    selectValue(dom, "#actor-select", "member");
    testId(dom, "buy-membership").click();
    const memberDecrypt = doc.querySelector('[data-visibility="encrypted"] .decrypt-report') as HTMLButtonElement | null;
    expect(memberDecrypt?.disabled).toBe(false);
    memberDecrypt!.click();
    expect(doc.body.textContent).toContain("Confidential encrypted memo body.");
    expect(doc.body.textContent).toContain("platform_member");

    selectValue(dom, "#actor-select", "subscriber");
    testId(dom, "subscribe-agent").click();
    const subscriberDecrypt = doc.querySelector('[data-visibility="encrypted"] .decrypt-report') as HTMLButtonElement | null;
    expect(subscriberDecrypt?.disabled).toBe(false);
    subscriberDecrypt!.click();
    expect(doc.body.textContent).toContain("agent_subscription");

    testId(dom, "create-delegation").click();
    testId(dom, "submit-private-result").click();
    const privateReport = doc.querySelector('[data-visibility="private_delegation"]');
    expect(privateReport?.textContent).toContain("Private result");

    selectValue(dom, "#actor-select", "outsider");
    const outsiderPrivateDecrypt = doc.querySelector('[data-visibility="private_delegation"] .decrypt-report') as HTMLButtonElement | null;
    expect(outsiderPrivateDecrypt?.disabled).toBe(true);

    selectValue(dom, "#actor-select", "buyer");
    const buyerPrivateDecrypt = doc.querySelector('[data-visibility="private_delegation"] .decrypt-report') as HTMLButtonElement | null;
    expect(buyerPrivateDecrypt?.disabled).toBe(false);
    buyerPrivateDecrypt!.click();
    expect(doc.body.textContent).toContain("Private delegation research result.");

    selectValue(dom, "#actor-select", "arbitrator");
    const arbitratorBeforeDispute = doc.querySelector('[data-visibility="private_delegation"] .decrypt-report') as HTMLButtonElement | null;
    expect(arbitratorBeforeDispute?.disabled).toBe(true);
    testId(dom, "open-dispute").click();
    selectValue(dom, "#actor-select", "arbitrator");
    const arbitratorAfterDispute = doc.querySelector('[data-visibility="private_delegation"] .decrypt-report') as HTMLButtonElement | null;
    expect(arbitratorAfterDispute?.disabled).toBe(false);
    arbitratorAfterDispute!.click();
    expect(doc.body.textContent).toContain("dispute_arbitrator");

    dom.window.close();
  });

  it("derives workbench account scopes from real repo bindings without installations", async () => {
    const localnet = await makeTempDir("workbench-fallback-localnet");
    const siteDir = path.join(tempRoot, "workbench-fallback-site");
    await buildStaticWeb(siteDir, localnet);

    const dom = await loadWorkbenchDom(siteDir, (window) => {
      window.localStorage.setItem("rn_session", JSON.stringify({
        provider: "google",
        address: "0xREAL",
        email: "real@example.com"
      }));
      window.localStorage.setItem("rn_github", JSON.stringify({
        sui_address: "0xREAL",
        login: "Euraxluo",
        account: "Euraxluo",
        account_type: "User",
        selected_repo: "Euraxluo/seal-101",
        repos: ["Euraxluo/seal-101", "Euraxluo/demo", "nutsdb/nutsdb"]
      }));
    });
    const doc = dom.window.document;

    const workbenchText = doc.getElementById("workbench-root")?.textContent ?? "";
    expect(workbenchText).not.toContain("No GitHub accounts or organizations are connected");
    expect(workbenchText).toContain("Euraxluo · User");
    expect(workbenchText).toContain("nutsdb · Account");
    expect(testId(dom, "selected-repo").textContent).toBe("Euraxluo/seal-101");

    const personalScope = doc.querySelector('.rn-workbench-installation[value="owner:Euraxluo"]') as unknown as { click(): void } | null;
    expect(personalScope).toBeTruthy();
    personalScope!.click();

    expect(testId(dom, "selected-repo").textContent).toBe("nutsdb/nutsdb");
    const repoOptions = Array.from(doc.querySelectorAll("#workbench-repo option")).map((option) => option.textContent ?? "");
    expect(repoOptions).toEqual(["nutsdb/nutsdb · nutsdb"]);

    dom.window.close();
  });

  it("deduplicates stale owner scopes once a real GitHub installation exists", async () => {
    const localnet = await makeTempDir("workbench-stale-scope-localnet");
    const siteDir = path.join(tempRoot, "workbench-stale-scope-site");
    await buildStaticWeb(siteDir, localnet);

    const dom = await loadWorkbenchDom(siteDir, (window) => {
      window.localStorage.setItem("rn_session", JSON.stringify({
        provider: "google",
        address: "0xREAL",
        email: "real@example.com"
      }));
      window.localStorage.setItem("rn_github", JSON.stringify({
        sui_address: "0xREAL",
        login: "Euraxluo",
        account: "Euraxluo",
        account_type: "User",
        installation_id: 139753991,
        selected_installation_ids: ["139753991", "owner:Euraxluo"],
        selected_repo: "Euraxluo/seal-101",
        repos: ["Euraxluo/seal-101", "Euraxluo/demo"],
        installations: [],
        available_repos: [
          { full_name: "Euraxluo/seal-101", installation_id: 139753991, installation_account: "Euraxluo", installation_account_type: "User" },
          { full_name: "Euraxluo/demo", installation_id: 139753991, installation_account: "Euraxluo", installation_account_type: "User" }
        ]
      }));
    });
    const doc = dom.window.document;
    const scopes = Array.from(doc.querySelectorAll(".rn-workbench-installation")).map((input) => (input as HTMLInputElement).value);
    const repoOptions = Array.from(doc.querySelectorAll("#workbench-repo option")).map((option) => option.textContent ?? "");

    expect(scopes).toEqual(["139753991"]);
    expect(repoOptions).toEqual(["Euraxluo/demo · Euraxluo", "Euraxluo/seal-101 · Euraxluo"]);
    expect(testId(dom, "selected-repo").textContent).toBe("Euraxluo/seal-101");

    dom.window.close();
  });

  it("builds a Vercel auth shell without shadowing Walrus content pages", async () => {
    const shellDir = path.join(tempRoot, "vercel-shell");
    await buildVercelAuthShell(shellDir, {
      googleClientId: "test-client.apps.googleusercontent.com",
      callbackPath: "/auth/callback.html",
      githubInstallUrl: "https://github.com/apps/research-network-app/installations/new",
      githubClientId: "Iv23test",
      githubCallbackPath: "/auth/github-callback.html",
      suiRpcUrl: "https://sui-testnet-rpc.publicnode.com",
      saltServicePath: "/api/zklogin-salt",
      githubOauthPath: "/api/github-oauth",
      githubBindingPath: "/api/github-binding"
    });

    expect(await exists(path.join(shellDir, "health.txt"))).toBe(true);
    expect(await exists(path.join(shellDir, "login.html"))).toBe(true);
    expect(await exists(path.join(shellDir, "account.html"))).toBe(true);
    expect(await exists(path.join(shellDir, "workbench.html"))).toBe(true);
    expect(await exists(path.join(shellDir, "workbench.js"))).toBe(true);
    expect(await exists(path.join(shellDir, "styles.css"))).toBe(true);
    expect(await exists(path.join(shellDir, "auth", "callback.js"))).toBe(true);
    expect(await exists(path.join(shellDir, "zklogin-browser.js"))).toBe(true);
    expect(await exists(path.join(shellDir, "index.html"))).toBe(false);
    expect(await exists(path.join(shellDir, "dashboard.html"))).toBe(false);

    const accountHtml = await fs.readFile(path.join(shellDir, "account.html"), "utf8");
    expect(accountHtml).toContain('fetch("/site-data.json"');
    expect(accountHtml).toContain("Sign in with Google");
    expect(accountHtml).toContain("rn-account-repo-select");
    expect(accountHtml).toContain("selected_repo");
    expect(accountHtml).toContain("selected_installation_ids");
    expect(accountHtml).toContain("repo-account-scope");
    expect(accountHtml).toContain("Add GitHub account/org access");
    expect(accountHtml).toContain("binding_attestation");
    expect(accountHtml).toContain("server-attested");
    expect(accountHtml).toContain("Refresh GitHub repos");
    expect(accountHtml).not.toContain("Grant more repo access on GitHub");

    const workbenchHtml = await fs.readFile(path.join(shellDir, "workbench.html"), "utf8");
    expect(workbenchHtml).toContain("Protocol Workbench");
    expect(workbenchHtml).toContain("/workbench.js?v=");
    expect(workbenchHtml).toContain("window.__WORKBENCH_INDEX__");
  });

  it("serves a PDF-only asset with embedded PDF and no TeX source", async () => {
    const workspace = await initPdfOnlyWorkspace({
      target: await makeTempDir("pdf-only"),
      title: "PDF Only Note",
      author: "PDF Agent",
      agentId: "agent:pdf",
      force: true
    });
    const localnet = path.join(tempRoot, "localnet-pdf");
    const published = await publishWorkspace(workspace, localnet);
    await replayIndexer({ localnetRoot: localnet });
    const siteDir = path.join(tempRoot, "site-pdf");
    await buildStaticWeb(siteDir, localnet);

    const assetSeg = routeSegment(published.sui.assetId);
    const server = await serveStaticSite(siteDir, 0);
    try {
      const absHtml = await (await fetch(sitePath(server.url, `/abs/${assetSeg}.html`))).text();
      expect(absHtml).toContain("pdfjs-viewer");
      expect(absHtml).toContain('href="#paper">HTML</a>');
      expect(absHtml).not.toContain("main.tex");

      const pdf = await fetch(sitePath(server.url, `/paper/${assetSeg}/main.pdf`));
      expect(pdf.status).toBe(200);
      expect((await pdf.text()).startsWith("%PDF")).toBe(true);

      const indexHtml = await (await fetch(sitePath(server.url, "/"))).text();
      expect(indexHtml).toContain("PDF Only Note");
      expect(indexHtml).toContain(`/paper/${assetSeg}/main.pdf`);
      expect(indexHtml).not.toContain("tex");
    } finally {
      await server.close();
    }
  });

  it("serves the checked-in web/dist when present", async () => {
    const distDir = path.resolve("web/dist");
    try {
      await fs.stat(path.join(distDir, "index.html"));
    } catch {
      await buildStaticWeb(distDir);
    }

    const server = await serveStaticSite(distDir, 0);
    try {
      const index = await fetch(sitePath(server.url, "/"));
      expect(index.status).toBe(200);
      const html = await index.text();
      expect(html).toContain("research");
      expect(html).toContain("Recent submissions");

      const absFiles = await fs.readdir(path.join(distDir, "abs"));
      expect(absFiles.length).toBeGreaterThan(0);
      const abs = await fetch(sitePath(server.url, `/abs/${absFiles[0]}`));
      expect(abs.status).toBe(200);
      expect(await abs.text()).toMatch(/format-nav|pdfjs-viewer/);
    } finally {
      await server.close();
    }
  });
});
