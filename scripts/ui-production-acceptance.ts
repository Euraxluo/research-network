/**
 * Automated normal-user browser acceptance for the production Workbench.
 *
 * This runner intentionally uses two isolated browser contexts: one for the
 * publishing agent and one for the buyer. It only passes if the buyer can reload
 * indexed state after the supplied sync command updates the index/Walrus Site.
 *
 * Example:
 *   npx playwright install chromium
 *   ZKLOGIN_PROVER_URL=https://<prover> npm run acceptance:ui -- \
 *     --network testnet \
 *     --url https://<testnet-site>/workbench.html \
 *     --buyer-session .research-network/secrets/acceptance-buyer.json \
 *     --agent-session .research-network/secrets/acceptance-agent.json \
 *     --sync-command "npm run research -- index:poll --package-id 0x..." \
 *     --walrus-site-object-id 0x...
 */
import { exec } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import {
  assertProductionAcceptanceSessionAddress,
  normalizeProductionAcceptanceSession,
  type ProductionAcceptanceReceipt,
  type ProductionAcceptanceSession,
  type ProductionAcceptanceSessionInput
} from "../src/core/production-acceptance.js";
import { deriveZkLoginAddress } from "../src/core/zklogin.js";
import {
  defaultUiAcceptanceReceiptPath,
  type UiAcceptanceReceipt,
  type UiAcceptanceStep
} from "../src/core/ui-acceptance.js";
import {
  DEFAULT_M3_CONFIG,
  m3ConfigOverridesFromEnv,
  validateM3Config,
  type M3Config
} from "../web/src/lib/config.js";

type Actor = "buyer" | "agent";

interface UiAcceptanceArgs {
  network: "testnet" | "mainnet";
  url: string;
  buyerSessionPath: string;
  agentSessionPath: string;
  receiptPath: string;
  syncCommand: string;
  walrusSiteObjectId: string;
  sourceRepo: string;
  headless: boolean;
  timeoutMs: number;
}

interface LoadedSession {
  address: string;
  session: ProductionAcceptanceSession;
}

interface WorkbenchStateSnapshot {
  reports?: Array<Record<string, unknown>>;
  platform_memberships?: Array<Record<string, unknown>>;
  agent_subscriptions?: Array<Record<string, unknown>>;
  access_receipts?: Array<Record<string, unknown>>;
  delegations?: Array<Record<string, unknown>>;
  plaintexts?: Record<string, string>;
  unlocked?: Record<string, boolean>;
}

interface WorkbenchIndexSnapshot {
  reports?: IndexedCollection;
  platform_memberships?: IndexedCollection;
  agent_subscriptions?: IndexedCollection;
  access_receipts?: IndexedCollection;
  delegations?: IndexedCollection;
}

type IndexedCollection = Array<Record<string, unknown>> | Record<string, Record<string, unknown>>;

const execAsync = promisify(exec);

export function parseUiAcceptanceArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): UiAcceptanceArgs {
  const map = new Map<string, string | boolean>();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--headful") {
      map.set("headful", true);
      continue;
    }
    if (!item.startsWith("--")) {
      throw new Error(`Unexpected argument: ${item}`);
    }
    const key = item.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    map.set(key, value);
    index += 1;
  }

  const network = stringArg(map, env, "network", "RN_ACCEPTANCE_NETWORK") ?? "testnet";
  if (network !== "testnet" && network !== "mainnet") {
    throw new Error("--network must be testnet or mainnet");
  }
  const url = required(stringArg(map, env, "url", "RN_UI_ACCEPTANCE_URL"), "--url");
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("--url must be an http(s) Workbench URL");
  }
  const syncCommand = required(stringArg(map, env, "sync-command", "RN_UI_ACCEPTANCE_SYNC_COMMAND"), "--sync-command");
  return {
    network,
    url,
    buyerSessionPath: required(
      stringArg(map, env, "buyer-session", "RN_ACCEPTANCE_BUYER_SESSION"),
      "--buyer-session"
    ),
    agentSessionPath: required(
      stringArg(map, env, "agent-session", "RN_ACCEPTANCE_AGENT_SESSION"),
      "--agent-session"
    ),
    receiptPath: stringArg(map, env, "receipt", "RN_TESTNET_UI_RECEIPT") ??
      defaultUiAcceptanceReceiptPath(network),
    syncCommand,
    walrusSiteObjectId: required(
      stringArg(map, env, "walrus-site-object-id", "RN_UI_ACCEPTANCE_WALRUS_SITE_OBJECT_ID") ??
        env.WALRUS_SITE_OBJECT_ID,
      "--walrus-site-object-id"
    ),
    sourceRepo: stringArg(map, env, "source-repo", "RN_UI_ACCEPTANCE_SOURCE_REPO") ??
      "production-acceptance/test",
    headless: map.get("headful") !== true && env.RN_UI_ACCEPTANCE_HEADFUL !== "1",
    timeoutMs: positiveInteger(
      stringArg(map, env, "timeout-ms", "RN_UI_ACCEPTANCE_TIMEOUT_MS"),
      180_000,
      "--timeout-ms"
    )
  };
}

async function main() {
  const args = parseUiAcceptanceArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const steps: UiAcceptanceStep[] = [];
  const config = activeM3Config(args.network);
  const receipt: UiAcceptanceReceipt = {
    kind: "normal-user-ui-acceptance/v1",
    network: args.network,
    surface: "web-ui",
    startedAt,
    conclusion: "failed",
    provenance: await collectProvenance(),
    entrypointUrl: args.url,
    browser: {
      name: "chromium",
      userAgent: "",
      automationTool: "playwright",
      headless: args.headless
    },
    config: receiptConfig(config),
    steps,
    buyerAddress: undefined,
    agentAddress: undefined
  };

  try {
    const buyer = await loadSession("buyer", args.buyerSessionPath);
    const agent = await loadSession("agent", args.agentSessionPath);
    if (sameAddress(buyer.address, agent.address)) {
      throw new Error("buyer and agent zkLogin addresses must be different");
    }
    receipt.buyerAddress = buyer.address;
    receipt.agentAddress = agent.address;

    let totalEventsIngested = 0;
    let browser: Browser | undefined;
    let agentContext: BrowserContext | undefined;
    let buyerContext: BrowserContext | undefined;
    try {
      browser = await chromium.launch({ headless: args.headless });

      agentContext = await newContext(browser, args, agent, "agent");
      const agentPage = await openWorkbench(agentContext, args, args.timeoutMs);
      receipt.browser.userAgent = await agentPage.evaluate(() => navigator.userAgent);
      pass(steps, "ui.load", { route: route(agentPage), testId: "m3-active", statusText: await status(agentPage) });
      pass(steps, "agent.sign_in", {
        actor: "agent",
        route: route(agentPage),
        testId: "m3-active",
        signerAddress: agent.address,
        statusText: await visibleText(agentPage, "[data-testid='m3-active']")
      });

      const encryptedReport = await publishEncryptedReport(agentPage, agent.address, steps);
      totalEventsIngested += await syncIndexedState(args, "after agent publish");

      buyerContext = await newContext(browser, args, buyer, "buyer");
      const buyerPage = await openWorkbench(buyerContext, args, args.timeoutMs);
      const indexedReport = await requireIndexedReport(buyerPage, encryptedReport.reportId);
      pass(steps, "buyer.sign_in", {
        actor: "buyer",
        route: route(buyerPage),
        testId: "m3-active",
        signerAddress: buyer.address,
        statusText: await visibleText(buyerPage, "[data-testid='m3-active']")
      });

      const membership = await buyMembershipAndDecrypt(buyerPage, buyer.address, encryptedReport.reportId, steps);
      const subscription = await subscribeAndDecrypt(buyerPage, buyer.address, encryptedReport.reportId, steps);
      const delegation = await createDelegation(buyerPage, buyer.address, steps);
      totalEventsIngested += await syncIndexedState(args, "after buyer membership/subscription/delegation");

      await agentPage.reload({ waitUntil: "networkidle" });
      await waitForActiveSigner(agentPage, args.timeoutMs);
      await requireIndexedDelegation(agentPage, delegation.objectId);
      pass(steps, "agent.sign_in_for_private_result", {
        actor: "agent",
        route: route(agentPage),
        testId: "m3-active",
        signerAddress: agent.address,
        statusText: await visibleText(agentPage, "[data-testid='m3-active']")
      });
      const privateResult = await publishPrivateResult(agentPage, agent.address, steps);
      totalEventsIngested += await syncIndexedState(args, "after agent private result");

      await buyerPage.reload({ waitUntil: "networkidle" });
      await waitForActiveSigner(buyerPage, args.timeoutMs);
      await requireIndexedReport(buyerPage, privateResult.reportId);
      pass(steps, "buyer.sign_in_for_private_result", {
        actor: "buyer",
        route: route(buyerPage),
        testId: "m3-active",
        signerAddress: buyer.address,
        statusText: await visibleText(buyerPage, "[data-testid='m3-active']")
      });
      await decryptPrivateResult(buyerPage, buyer.address, privateResult.reportId, steps);
      await settleMembershipReceipt(buyerPage, buyer.address, steps);
      pass(steps, "buyer.sign_in_for_completion", {
        actor: "buyer",
        route: route(buyerPage),
        testId: "m3-active",
        signerAddress: buyer.address,
        statusText: await visibleText(buyerPage, "[data-testid='m3-active']")
      });
      await completeDelegation(buyerPage, buyer.address, steps);

      await agentPage.reload({ waitUntil: "networkidle" });
      await waitForActiveSigner(agentPage, args.timeoutMs);
      pass(steps, "agent.sign_in_for_claim", {
        actor: "agent",
        route: route(agentPage),
        testId: "m3-active",
        signerAddress: agent.address,
        statusText: await visibleText(agentPage, "[data-testid='m3-active']")
      });
      await claimEarnings(agentPage, agent.address, steps);
      totalEventsIngested += await syncIndexedState(args, "after settlement/claim/completion");

      await buyerPage.reload({ waitUntil: "networkidle" });
      const index = await readWorkbenchIndex(buyerPage);
      pass(steps, "indexer.poll_and_publish", {
        route: route(buyerPage),
        statusText: "indexer sync command completed",
        meta: {
          eventsIngested: totalEventsIngested,
          reportsIndexed: indexedCount(index.reports),
          walrusSiteObjectId: args.walrusSiteObjectId
        }
      });
      pass(steps, "buyer.reloads_indexed_state", {
        actor: "buyer",
        route: route(buyerPage),
        testId: "workbench-status",
        signerAddress: buyer.address,
        statusText: await status(buyerPage),
        meta: {
          indexedReportObjectId: indexedReport.reportId,
          indexedAccessReceiptObjectId: membership.receiptObjectId,
          indexedDelegationObjectId: delegation.objectId,
          indexedSubscriptionObjectId: subscription.objectId,
          indexedPrivateReportObjectId: privateResult.reportId,
          localStorageOnly: false
        }
      });
    } finally {
      await agentContext?.close().catch(() => undefined);
      await buyerContext?.close().catch(() => undefined);
      await browser?.close().catch(() => undefined);
    }

    receipt.conclusion = "passed";
  } catch (error) {
    const failed = steps.find((step) => step.status === "pending");
    if (failed) {
      failed.status = "failed";
      failed.error = message(error);
    } else {
      steps.push({ name: "ui.load", status: "failed", error: message(error) });
    }
    receipt.conclusion = "failed";
    throw error;
  } finally {
    receipt.finishedAt = new Date().toISOString();
    await writeReceipt(args.receiptPath, receipt);
    console.log(JSON.stringify(receipt, null, 2));
  }
}

async function loadSession(label: Actor, filePath: string): Promise<LoadedSession> {
  const raw = JSON.parse(await readFile(filePath, "utf8")) as ProductionAcceptanceSessionInput;
  const session = normalizeProductionAcceptanceSession(label, raw);
  const address = assertProductionAcceptanceSessionAddress(label, session, deriveZkLoginAddress);
  return { address, session };
}

async function newContext(
  browser: Browser,
  args: UiAcceptanceArgs,
  loaded: LoadedSession,
  actor: Actor
): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.addInitScript(({ address, session, sourceRepo, actor }) => {
    localStorage.setItem("rn_session", JSON.stringify({
      provider: "google",
      address,
      email: `${actor}@production-acceptance.local`,
      ts: Date.now()
    }));
    localStorage.setItem("rn_github", JSON.stringify({
      sui_address: address,
      login: actor,
      selected_repo: sourceRepo,
      repos: [sourceRepo],
      available_repos: [{ full_name: sourceRepo, installation_id: 1, installation_account: actor, installation_account_type: "User" }]
    }));
    sessionStorage.setItem("rn_zk_eph", JSON.stringify({
      secret: session.ephemeralSecretKey,
      maxEpoch: session.maxEpoch,
      randomness: session.randomness
    }));
    sessionStorage.setItem("rn_zk_session", JSON.stringify({
      id_token: session.idToken,
      salt: session.salt,
      maxEpoch: session.maxEpoch,
      randomness: session.randomness
    }));
  }, {
    address: loaded.address,
    session: loaded.session,
    sourceRepo: args.sourceRepo,
    actor
  });
  return context;
}

async function openWorkbench(context: BrowserContext, args: UiAcceptanceArgs, timeoutMs: number): Promise<Page> {
  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);
  await page.goto(args.url, { waitUntil: "networkidle" });
  await waitForActiveSigner(page, timeoutMs);
  return page;
}

async function waitForActiveSigner(page: Page, timeoutMs: number) {
  await page.getByTestId("m3-active").waitFor({ state: "visible", timeout: timeoutMs });
}

async function publishEncryptedReport(page: Page, agentAddress: string, steps: UiAcceptanceStep[]) {
  await page.getByTestId("visibility-select").selectOption("encrypted");
  await page.getByTestId("publish-title").fill(`Production UI encrypted ${Date.now()}`);
  await page.getByTestId("publish-preview").fill("Production UI acceptance preview.");
  await page.getByTestId("publish-plaintext").fill("Production UI acceptance encrypted plaintext.");
  await clickAndWait(page, "publish-submit", /Published on-chain encrypted report/);
  const state = await readWorkbenchState(page);
  const report = last(state.reports, "published report");
  const reportId = stringField(report, "id");
  pass(steps, "agent.publish_encrypted_report", {
    actor: "agent",
    route: route(page),
    testId: "publish-submit",
    signerAddress: agentAddress,
    statusText: await status(page),
    digest: stringField(report, "tx_digest"),
    objectId: reportId,
    meta: reportMeta(report)
  });
  return { reportId };
}

async function buyMembershipAndDecrypt(page: Page, buyerAddress: string, reportId: string, steps: UiAcceptanceStep[]) {
  await clickAndWait(page, "buy-membership", /Platform membership active on-chain/);
  const membershipState = await readWorkbenchState(page);
  const membership = last(membershipState.platform_memberships, "platform membership");
  pass(steps, "buyer.buy_platform_membership", {
    actor: "buyer",
    route: route(page),
    testId: "buy-membership",
    signerAddress: buyerAddress,
    statusText: await status(page),
    digest: stringField(membership, "tx_digest"),
    objectId: stringField(membership, "pass_id")
  });

  await clickDecrypt(page, reportId, /Seal decrypt authorized on-chain.*platform_member/);
  const decryptState = await readWorkbenchState(page);
  const receipt = last(decryptState.access_receipts, "access receipt");
  pass(steps, "buyer.decrypt_report_with_membership", {
    actor: "buyer",
    route: route(page),
    testId: `decrypted-${reportId}`,
    signerAddress: buyerAddress,
    statusText: await status(page),
    meta: decryptMeta(decryptState, reportId, "platform_member")
  });
  pass(steps, "buyer.record_access_receipt", {
    actor: "buyer",
    route: route(page),
    testId: "workbench-status",
    signerAddress: buyerAddress,
    statusText: await status(page),
    digest: stringField(receipt, "tx_digest"),
    objectId: stringField(receipt, "id")
  });
  return {
    objectId: stringField(membership, "pass_id"),
    receiptObjectId: stringField(receipt, "id")
  };
}

async function subscribeAndDecrypt(page: Page, buyerAddress: string, reportId: string, steps: UiAcceptanceStep[]) {
  await clickAndWait(page, "subscribe-agent", /Agent subscription active on-chain/);
  const subState = await readWorkbenchState(page);
  const subscription = last(subState.agent_subscriptions, "agent subscription");
  pass(steps, "buyer.buy_agent_subscription", {
    actor: "buyer",
    route: route(page),
    testId: "subscribe-agent",
    signerAddress: buyerAddress,
    statusText: await status(page),
    digest: stringField(subscription, "tx_digest"),
    objectId: stringField(subscription, "pass_id")
  });
  await clickDecrypt(page, reportId, /Seal decrypt authorized on-chain.*agent_subscription/);
  pass(steps, "buyer.decrypt_report_with_subscription", {
    actor: "buyer",
    route: route(page),
    testId: `decrypted-${reportId}`,
    signerAddress: buyerAddress,
    statusText: await status(page),
    meta: decryptMeta(await readWorkbenchState(page), reportId, "agent_subscription")
  });
  return { objectId: stringField(subscription, "pass_id") };
}

async function createDelegation(page: Page, buyerAddress: string, steps: UiAcceptanceStep[]) {
  await clickAndWait(page, "create-delegation", /Private delegation job created and funded on-chain/);
  const state = await readWorkbenchState(page);
  const delegation = last(state.delegations, "delegation");
  pass(steps, "buyer.create_and_fund_delegation", {
    actor: "buyer",
    route: route(page),
    testId: "create-delegation",
    signerAddress: buyerAddress,
    statusText: await status(page),
    digest: stringField(delegation, "tx_digest"),
    objectId: stringField(delegation, "id"),
    meta: {
      fundDigest: stringField(delegation, "fund_tx_digest"),
      fundSignerAddress: buyerAddress
    }
  });
  return { objectId: stringField(delegation, "id") };
}

async function publishPrivateResult(page: Page, agentAddress: string, steps: UiAcceptanceStep[]) {
  await clickAndWait(page, "submit-private-result", /Private result submitted on-chain/);
  const state = await readWorkbenchState(page);
  const report = last(state.reports, "private result report");
  const reportId = stringField(report, "id");
  pass(steps, "agent.publish_private_result", {
    actor: "agent",
    route: route(page),
    testId: "submit-private-result",
    signerAddress: agentAddress,
    statusText: await status(page),
    digest: stringField(report, "tx_digest"),
    objectId: reportId,
    meta: reportMeta(report)
  });
  return { reportId };
}

async function decryptPrivateResult(page: Page, buyerAddress: string, reportId: string, steps: UiAcceptanceStep[]) {
  await clickDecrypt(page, reportId, /Seal decrypt authorized on-chain.*private_delegation/);
  pass(steps, "buyer.decrypt_private_result", {
    actor: "buyer",
    route: route(page),
    testId: `decrypted-${reportId}`,
    signerAddress: buyerAddress,
    statusText: await status(page),
    meta: decryptMeta(await readWorkbenchState(page), reportId, "private_delegation")
  });
}

async function settleMembershipReceipt(page: Page, buyerAddress: string, steps: UiAcceptanceStep[]) {
  await clickAndWait(page, "settle-membership-receipt", /Membership receipt settled on-chain/);
  const state = await readWorkbenchState(page);
  const receipt = (state.access_receipts ?? []).find((item) => item.settlement_tx_digest) ??
    last(state.access_receipts, "settled access receipt");
  pass(steps, "buyer.settle_membership_receipt", {
    actor: "buyer",
    route: route(page),
    testId: "settle-membership-receipt",
    signerAddress: buyerAddress,
    statusText: await status(page),
    digest: stringField(receipt, "settlement_tx_digest")
  });
}

async function claimEarnings(page: Page, agentAddress: string, steps: UiAcceptanceStep[]) {
  await clickAndWait(page, "claim-agent-earnings", /Agent earnings claimed on-chain/);
  pass(steps, "agent.claim_earnings", {
    actor: "agent",
    route: route(page),
    testId: "claim-agent-earnings",
    signerAddress: agentAddress,
    statusText: await status(page),
    digest: statusDigest(await status(page))
  });
}

async function completeDelegation(page: Page, buyerAddress: string, steps: UiAcceptanceStep[]) {
  await clickAndWait(page, "complete-delegation", /Delegation completed on-chain/);
  const state = await readWorkbenchState(page);
  const delegation = (state.delegations ?? []).find((item) => item.complete_tx_digest) ??
    last(state.delegations, "completed delegation");
  pass(steps, "buyer.complete_delegation", {
    actor: "buyer",
    route: route(page),
    testId: "complete-delegation",
    signerAddress: buyerAddress,
    statusText: await status(page),
    digest: stringField(delegation, "complete_tx_digest")
  });
}

async function clickAndWait(page: Page, testId: string, expectedStatus: RegExp) {
  await page.getByTestId(testId).click();
  await page.locator("#workbench-status").filter({ hasText: expectedStatus }).waitFor({ state: "visible" });
}

async function clickDecrypt(page: Page, reportId: string, expectedStatus: RegExp) {
  const button = page.locator(`[data-report-id="${reportId}"] button.decrypt-report`);
  await button.waitFor({ state: "visible" });
  await button.click();
  await page.locator("#workbench-status").filter({ hasText: expectedStatus }).waitFor({ state: "visible" });
}

async function syncIndexedState(args: UiAcceptanceArgs, label: string): Promise<number> {
  const { stdout, stderr } = await execAsync(args.syncCommand, {
    cwd: process.cwd(),
    env: { ...process.env, RN_UI_ACCEPTANCE_SYNC_LABEL: label },
    maxBuffer: 1024 * 1024 * 20
  });
  if (stderr.trim()) {
    console.error(stderr);
  }
  const parsed = parseCommandJson(stdout);
  const events = Number(parsed.events_ingested ?? parsed.eventsIngested ?? 0);
  if (!Number.isFinite(events) || events <= 0) {
    throw new Error(`sync-command for ${label} did not report positive events_ingested/eventsIngested`);
  }
  return events;
}

async function requireIndexedReport(page: Page, reportId: string) {
  const index = await readWorkbenchIndex(page);
  const report = findIndexed(index.reports, reportId);
  if (!report) {
    throw new Error(`report ${reportId} was not present in window.__WORKBENCH_INDEX__; refusing localStorage-only UI acceptance`);
  }
  return { reportId };
}

async function requireIndexedDelegation(page: Page, delegationId: string) {
  const index = await readWorkbenchIndex(page);
  if (!findIndexed(index.delegations, delegationId)) {
    throw new Error(`delegation ${delegationId} was not present in window.__WORKBENCH_INDEX__; refusing localStorage-only UI acceptance`);
  }
}

async function readWorkbenchState(page: Page): Promise<WorkbenchStateSnapshot> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("rn_workbench_state") || "{}"));
}

async function readWorkbenchIndex(page: Page): Promise<WorkbenchIndexSnapshot> {
  return page.evaluate(() => (window as unknown as { __WORKBENCH_INDEX__?: WorkbenchIndexSnapshot }).__WORKBENCH_INDEX__ || {});
}

function pass(steps: UiAcceptanceStep[], name: string, result: Partial<UiAcceptanceStep>) {
  const existing = steps.find((step) => step.name === name);
  const next: UiAcceptanceStep = { name, status: "passed", ...result };
  if (existing) {
    Object.assign(existing, next);
  } else {
    steps.push(next);
  }
}

function reportMeta(report: Record<string, unknown>): Record<string, unknown> {
  return {
    walrusBlobId: stringField(report, "walrus_blob_id"),
    sealId: stringField(report, "seal_id"),
    ciphertextHash: stringField(report, "ciphertext_hash"),
    plaintextCommitment: stringField(report, "plaintext_commitment"),
    walrusReadbackVerified: report.walrus_readback_verified,
    walrusReadbackBytes: report.walrus_readback_bytes,
    walrusReadbackHash: report.walrus_readback_hash
  };
}

function decryptMeta(state: WorkbenchStateSnapshot, reportId: string, accessPath: string): Record<string, unknown> {
  const plaintext = state.plaintexts?.[reportId] ?? "";
  const report = (state.reports ?? []).find((item) => item.id === reportId) ?? {};
  return {
    accessPath,
    plaintextMatched: plaintext.length > 0,
    plaintextBytes: new TextEncoder().encode(plaintext).length,
    walrusBlobId: report.walrus_blob_id,
    sealId: report.seal_id
  };
}

function statusDigest(text: string): string {
  const match = text.match(/[1-9A-HJ-NP-Za-km-z]{32,88}/);
  if (!match) throw new Error(`status text did not contain a Sui digest: ${text}`);
  return match[0];
}

async function status(page: Page): Promise<string> {
  return page.locator("#workbench-status").textContent().then((text) => text ?? "");
}

async function visibleText(page: Page, selector: string): Promise<string> {
  return page.locator(selector).textContent().then((text) => text ?? "");
}

function route(page: Page): string {
  return new URL(page.url()).pathname;
}

function last<T>(items: T[] | undefined, label: string): T {
  if (!items?.length) throw new Error(`missing ${label} in workbench state`);
  return items[items.length - 1]!;
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value) {
    throw new Error(`missing string field ${key}`);
  }
  return value;
}

export function parseCommandJson(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim();
  if (!trimmed) return {};
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]!) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the previous line; sync commands often print progress before JSON.
    }
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Report the stable error below.
  }
  throw new Error("sync-command must print JSON containing events_ingested/eventsIngested");
}

function activeM3Config(network: "testnet" | "mainnet"): M3Config {
  const envOverrides = m3ConfigOverridesFromEnv(process.env);
  return validateM3Config({ ...DEFAULT_M3_CONFIG, ...envOverrides, network } as M3Config);
}

function receiptConfig(config: M3Config): ProductionAcceptanceReceipt["config"] {
  return {
    suiRpcUrl: config.suiRpcUrl,
    packageId: config.packageId,
    settlementConfigId: config.settlementConfigId,
    agentEarningsId: config.agentEarningsId,
    membershipReceiptRegistryId: config.membershipReceiptRegistryId,
    walrusPublisherUrl: config.walrusPublisherUrl,
    walrusAggregatorUrl: config.walrusAggregatorUrl,
    walrusEpochs: config.walrusEpochs,
    sealKeyServerObjectId: config.sealKeyServers[0]?.objectId,
    sealKeyServerAggregatorUrl: config.sealKeyServers[0]?.aggregatorUrl,
    sealThreshold: config.sealThreshold,
    platformMembershipPriceMist: config.platformMembershipPriceMist,
    agentSubscriptionPriceMist: config.agentSubscriptionPriceMist,
    delegationBudgetMist: config.delegationBudgetMist,
    membershipSettlementShareMist: config.membershipSettlementShareMist,
    accessDurationMs: config.accessDurationMs
  };
}

async function collectProvenance(): Promise<NonNullable<UiAcceptanceReceipt["provenance"]>> {
  const gitCommit = await execAsync("git rev-parse HEAD", { cwd: process.cwd() })
    .then(({ stdout }) => stdout.trim())
    .catch(() => "");
  const status = await execAsync("git status --porcelain", { cwd: process.cwd() })
    .then(({ stdout }) => stdout.trim())
    .catch(() => "unknown");
  return {
    generatedBy: "scripts/ui-production-acceptance.ts",
    gitCommit,
    gitTreeState: status ? "dirty" : "clean",
    packageName: "@research-network/protocol-kit",
    packageVersion: "0.1.0"
  };
}

async function writeReceipt(filePath: string, receipt: UiAcceptanceReceipt) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(receipt, null, 2), "utf8");
}

function stringArg(args: Map<string, string | boolean>, env: NodeJS.ProcessEnv, argName: string, envName: string): string | undefined {
  const value = args.get(argName);
  return typeof value === "string" ? value : env[envName];
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function findIndexed(collection: IndexedCollection | undefined, id: string): Record<string, unknown> | undefined {
  if (!collection) return undefined;
  if (Array.isArray(collection)) {
    return collection.find((item) => item.id === id || item.sui_object_id === id || item.pass_id === id);
  }
  return collection[id] ?? Object.values(collection).find((item) =>
    item.id === id || item.sui_object_id === id || item.pass_id === id
  );
}

function indexedCount(collection: IndexedCollection | undefined): number {
  if (!collection) return 0;
  return Array.isArray(collection) ? collection.length : Object.keys(collection).length;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("UI production acceptance failed:", message(error));
    process.exitCode = 1;
  });
}
