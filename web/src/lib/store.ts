// Zustand store for the workbench. Replaces the scattered localStorage reads in
// the original WORKBENCH_JS. The store persists to the same localStorage keys
// (rn_workbench_state / rn_session / rn_github) so existing demo sessions keep
// working across the M2 migration.

import { create } from "zustand";
import {
  ACTORS,
  accessDecision,
  activeActor,
  emptyWorkbenchState,
  jobForReport,
  mergeById,
  readGithub,
  readSession,
  readWorkbench,
  readWorkbenchIndex,
  saveWorkbench,
  writeJson,
  hash
} from "./storage";
import {
  buyAgentSubscriptionOnChain,
  buyPlatformMembershipOnChain,
  claimAgentEarningsOnChain,
  completeDelegationJobOnChain,
  createDelegationJobOnChain,
  decryptReport as decryptReportOnChain,
  fundDelegationJobOnChain,
  openDisputeOnChain,
  publishPrivateResultOnChain,
  publishReport,
  publishReportDemo,
  recordPlatformAccessReceiptOnChain,
  settleMembershipReportOnChain,
  submitPrivateResultDemo
} from "./clients";
import { loadM3Config } from "./config";
import type { M3Signer } from "./clients";
import type {
  AccessReceipt,
  ActorId,
  DelegationJob,
  PlatformMembership,
  AgentSubscription,
  ResearchReport,
  WorkbenchIndex,
  WorkbenchState,
  ZkLoginSession,
  GithubBinding
} from "./types";

export interface WorkbenchView {
  reports: ResearchReport[];
  platform_memberships: PlatformMembership[];
  agent_subscriptions: AgentSubscription[];
  access_receipts: AccessReceipt[];
  delegations: DelegationJob[];
}

interface WorkbenchStore extends WorkbenchState {
  index: WorkbenchIndex;
  session: ZkLoginSession | null;
  github: GithubBinding | null;
  demoMode: boolean;
  statusText: string;
  statusError: boolean;
  /** When set, publish/decrypt use the real Walrus+Seal+Sui path (M3).
   *  When null (no wallet/zkLogin signer), they fall back to demo ids. */
  signer: M3Signer | null;

  // selectors
  view: () => WorkbenchView;
  activeActor: () => ReturnType<typeof activeActor>;

  // actions
  reload: () => void;
  setActor: (id: ActorId) => void;
  setStatus: (text: string, isError?: boolean) => void;
  setSigner: (signer: M3Signer | null) => void;

  publish: (input: {
    title: string;
    visibility: ResearchReport["visibility"];
    tier: number;
    preview: string;
    plaintext: string;
  }) => void;
  buyMembership: () => void;
  subscribeAgent: () => void;
  createDelegation: () => void;
  submitPrivateResult: () => void;
  openDispute: () => void;
  completeDelegation: () => void;
  settleLatestMembershipReceipt: () => void;
  claimAgentEarnings: () => void;
  decryptReport: (id: string) => void;
  seedDemo: () => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isDemoMode(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.has("rn_demo") || localStorage.getItem("rn_workbench_demo") === "1";
  } catch {
    return false;
  }
}

function currentPeriod(): number {
  const d = new Date();
  return d.getUTCFullYear() * 100 + d.getUTCMonth() + 1;
}

function sameAddress(left?: string, right?: string): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function actorLabelForAddress(address?: string, agentAddress?: string): string {
  if (!address) return "the receipt owner";
  const actors = agentAddress
    ? ACTORS.map((a) => (a.id === "agent" ? { ...a, address: agentAddress } : a))
    : ACTORS;
  return actors.find((a) => sameAddress(a.address, address))?.label || address;
}

function isSuiId(value?: string): boolean {
  return Boolean(value && /^0x[0-9a-fA-F]{64}$/.test(value));
}

function shouldBlockMainnetDemoFallback(signer: M3Signer | null): boolean {
  if (signer) return false;
  try {
    return loadM3Config().network === "mainnet";
  } catch {
    return true;
  }
}

function signerMatchesActor(signer: M3Signer, actor: ReturnType<typeof activeActor>): boolean {
  return sameAddress(actor.address, signer.address);
}

function expiresAtFromNow(durationMs: number): string {
  return new Date(Date.now() + durationMs).toISOString();
}

export const useWorkbench = create<WorkbenchStore>((set, get) => ({
  ...emptyWorkbenchState(),
  index: readWorkbenchIndex(),
  session: readSession(),
  github: readGithub(),
  demoMode: isDemoMode(),
  statusText: "",
  statusError: false,
  signer: null,

  view: () => {
    const s = get();
    return {
      reports: mergeById(s.index.reports, s.reports, "id"),
      platform_memberships: mergeById(s.index.platform_memberships, s.platform_memberships, "pass_id"),
      agent_subscriptions: mergeById(s.index.agent_subscriptions, s.agent_subscriptions, "pass_id"),
      access_receipts: mergeById(s.index.access_receipts, s.access_receipts, "id"),
      delegations: mergeById(s.index.delegations, s.delegations, "id")
    };
  },

  activeActor: () => {
    const s = get();
    const actor = activeActor(s, s.session?.address);
    if (s.signer && actor.id !== "outsider") {
      return { ...actor, address: s.signer.address };
    }
    return actor;
  },

  reload: () => {
    const state = readWorkbench();
    set({
      ...state,
      index: readWorkbenchIndex(),
      session: readSession(),
      github: readGithub(),
      demoMode: isDemoMode()
    });
  },

  setActor: (id) => {
    const state = readWorkbench();
    state.actor = id;
    saveWorkbench(state);
    set({ actor: id });
  },

  setStatus: (text, isError = false) => set({ statusText: text, statusError: isError }),

  setSigner: (signer) => set({ signer }),

  publish: async ({ title, visibility, tier, preview, plaintext }) => {
    const session = get().session;
    if (!session?.address) {
      get().setStatus("Sign in before publishing.", true);
      return;
    }
    const gh = get().github;
    const selectedRepo = gh?.selected_repo;
    if (!selectedRepo) {
      get().setStatus("Select a GitHub repo before publishing.", true);
      return;
    }
    if (!title) {
      get().setStatus("Report title is required.", true);
      return;
    }
    const signer = get().signer;
    // Real M3 path when a signer is wired; otherwise demo (synthetic ids).
    let report: ResearchReport;
    let stored = "";
    try {
      if (signer) {
        get().setStatus("Publishing on-chain (Walrus + Sui)...");
        const result = await publishReport(
          {
            title,
            visibility,
            requiredTier: tier,
            freePreview: preview,
            plaintext,
            agent: session.address,
            sourceRepo: selectedRepo
          },
          signer
        );
        report = result.report;
        stored = result.plaintext;
      } else {
        if (shouldBlockMainnetDemoFallback(signer)) {
          get().setStatus("Mainnet publishing requires a live zkLogin signer; demo fallback is disabled.", true);
          return;
        }
        const demo = publishReportDemo({
          title,
          visibility,
          requiredTier: tier,
          freePreview: preview,
          plaintext,
          agent: session.address,
          sourceRepo: selectedRepo
        });
        report = demo.report;
        stored = demo.plaintext;
      }
    } catch (err) {
      get().setStatus("Publish failed: " + String((err as Error)?.message || err), true);
      return;
    }
    const next = readWorkbench();
    next.reports.push(report);
    if (visibility !== "public") next.plaintexts[report.id] = stored;
    next.selected_report_id = report.id;
    next.actor = "agent";
    saveWorkbench(next);
    get().reload();
    get().setStatus(
      (signer ? "Published on-chain " : "Published (demo) ") + visibility + " report from " + selectedRepo + "."
    );
  },

  buyMembership: async () => {
    const actor = get().activeActor();
    const signer = get().signer;
    if (signer) {
      const config = loadM3Config();
      if (!signerMatchesActor(signer, actor)) {
        get().setStatus("Select the current zkLogin signer before buying a real membership.", true);
        return;
      }
      try {
        get().setStatus("Buying platform membership on Sui...");
        const result = await buyPlatformMembershipOnChain({ signer, tier: 1 });
        const next = readWorkbench();
        next.platform_memberships.push({
          pass_id: result.objectId,
          owner_address: signer.address,
          tier: 1,
          started_at: nowIso(),
          expires_at: expiresAtFromNow(config.accessDurationMs),
          tx_digest: result.digest,
          source: "sui"
        });
        saveWorkbench(next);
        get().reload();
        get().setStatus("Platform membership active on-chain for " + actor.label + ".");
      } catch (err) {
        get().setStatus("Membership purchase failed: " + String((err as Error)?.message || err), true);
      }
      return;
    }
    if (shouldBlockMainnetDemoFallback(signer)) {
      get().setStatus("Mainnet membership purchase requires a live zkLogin signer.", true);
      return;
    }
    const config = loadM3Config();
    const next = readWorkbench();
    const id = "pm:" + hash(actor.address + ":" + Date.now());
    next.platform_memberships.push({
      pass_id: id,
      owner_address: actor.address,
      tier: 1,
      started_at: nowIso(),
      expires_at: expiresAtFromNow(config.accessDurationMs),
      source: "demo"
    });
    saveWorkbench(next);
    get().reload();
    get().setStatus("Platform membership active for " + actor.label + ".");
  },

  subscribeAgent: async () => {
    const v = get().view();
    const actor = get().activeActor();
    const selected = v.reports.find((r) => r.id === get().selected_report_id) || v.reports[0];
    const agent = selected?.agent || get().session?.address || "0xAGENT";
    const signer = get().signer;
    if (signer) {
      const config = loadM3Config();
      if (!signerMatchesActor(signer, actor)) {
        get().setStatus("Select the current zkLogin signer before buying a real agent subscription.", true);
        return;
      }
      if (!isSuiId(agent)) {
        get().setStatus("Select a report with a real Sui agent address before subscribing on-chain.", true);
        return;
      }
      try {
        get().setStatus("Buying agent subscription on Sui...");
        const result = await buyAgentSubscriptionOnChain({ signer, agent, tier: 1 });
        const next = readWorkbench();
        next.agent_subscriptions.push({
          pass_id: result.objectId,
          owner_address: signer.address,
          agent,
          tier: 1,
          started_at: nowIso(),
          expires_at: expiresAtFromNow(config.accessDurationMs),
          tx_digest: result.digest,
          source: "sui"
        });
        saveWorkbench(next);
        get().reload();
        get().setStatus("Agent subscription active on-chain for " + actor.label + ".");
      } catch (err) {
        get().setStatus("Agent subscription failed: " + String((err as Error)?.message || err), true);
      }
      return;
    }
    if (shouldBlockMainnetDemoFallback(signer)) {
      get().setStatus("Mainnet agent subscription requires a live zkLogin signer.", true);
      return;
    }
    const config = loadM3Config();
    const next = readWorkbench();
    const id = "sub:" + hash(actor.address + ":" + agent + ":" + Date.now());
    next.agent_subscriptions.push({
      pass_id: id,
      owner_address: actor.address,
      agent,
      tier: 1,
      started_at: nowIso(),
      expires_at: expiresAtFromNow(config.accessDurationMs),
      source: "demo"
    });
    saveWorkbench(next);
    get().reload();
    get().setStatus("Agent subscription active for " + actor.label + ".");
  },

  createDelegation: async () => {
    const signer = get().signer;
    const actor = get().activeActor();
    const v = get().view();
    const selected = v.reports.find((r) => r.id === get().selected_report_id) || v.reports[0];
    if (signer) {
      const config = loadM3Config();
      if (!signerMatchesActor(signer, actor)) {
        get().setStatus("Select the current zkLogin signer before creating a real delegation.", true);
        return;
      }
      if (!selected || !isSuiId(selected.agent)) {
        get().setStatus("Select a report from the target real Sui agent before creating an on-chain delegation.", true);
        return;
      }
      const agent = selected.agent;
      try {
        get().setStatus("Creating and funding delegation on Sui...");
        const created = await createDelegationJobOnChain({
          signer,
          agent,
          question: selected?.title ? "Private research request for " + selected.title : "Private research request",
          sourceArtifact: selected?.source_repo || selected?.id || "workbench"
        });
        const fundDigest = await fundDelegationJobOnChain({ signer, jobObjectId: created.objectId });
        const next = readWorkbench();
        next.delegations.push({
          id: created.objectId,
          buyer: signer.address,
          agent,
          budget: Number(config.delegationBudgetMist),
          status: "funded",
          tx_digest: created.digest,
          fund_tx_digest: fundDigest,
          source: "sui",
          created_at: nowIso(),
          updated_at: nowIso()
        });
        saveWorkbench(next);
        get().reload();
        get().setStatus("Private delegation job created and funded on-chain.");
      } catch (err) {
        get().setStatus("Delegation creation failed: " + String((err as Error)?.message || err), true);
      }
      return;
    }
    if (shouldBlockMainnetDemoFallback(signer)) {
      get().setStatus("Mainnet delegation creation requires a live zkLogin signer.", true);
      return;
    }
    const agent = get().session?.address || "0xAGENT";
    const next = readWorkbench();
    const id = "job:" + hash("delegation:" + Date.now());
    next.delegations.push({
      id,
      buyer: "0xBUYER",
      agent,
      budget: 1200,
      status: "funded",
      source: "demo",
      created_at: nowIso(),
      updated_at: nowIso()
    });
    saveWorkbench(next);
    get().reload();
    get().setStatus("Private delegation job created and funded (demo).");
  },

  submitPrivateResult: async () => {
    const v = get().view();
    const signer = get().signer;
    if (signer) {
      const actor = get().activeActor();
      if (!signerMatchesActor(signer, actor)) {
        get().setStatus("Select the current zkLogin signer before submitting a real private result.", true);
        return;
      }
      const job =
        v.delegations.find((j) => isSuiId(j.id) && (j.status === "funded" || j.status === "accepted")) ||
        v.delegations.find((j) => isSuiId(j.id));
      if (!job) {
        get().setStatus("Create and fund a real delegation job first.", true);
        return;
      }
      if (!sameAddress(signer.address, job.agent)) {
        get().setStatus("Only the delegated agent can submit the real private result.", true);
        return;
      }
      if (!(job.status === "funded" || job.status === "accepted")) {
        get().setStatus("The delegation must be funded or accepted before submitting a real result.", true);
        return;
      }
      try {
        get().setStatus("Publishing private delegation result with Walrus + Seal + Sui...");
        const selectedRepo = get().github?.selected_repo || "private-delegation";
        const result = await publishPrivateResultOnChain({
          signer,
          jobObjectId: job.id,
          title: "Private result for " + job.id,
          freePreview: "Private delegation result metadata only.",
          plaintext: "Private delegation research result. Buyer and agent can decrypt by default.",
          sourceRepo: selectedRepo
        });
        const next = readWorkbench();
        const localJob = next.delegations.find((j) => j.id === job.id);
        if (localJob) {
          localJob.status = "submitted";
          localJob.result_report_id = result.report.id;
          localJob.result_tx_digest = result.txDigest;
          localJob.updated_at = nowIso();
        } else {
          next.delegations.push({
            ...job,
            status: "submitted",
            result_report_id: result.report.id,
            result_tx_digest: result.txDigest,
            updated_at: nowIso()
          });
        }
        next.reports.push(result.report);
        next.plaintexts[result.report.id] = result.plaintext;
        next.selected_report_id = result.report.id;
        saveWorkbench(next);
        get().reload();
        get().setStatus("Private result submitted on-chain with Seal access.");
      } catch (err) {
        get().setStatus("Private result submission failed: " + String((err as Error)?.message || err), true);
      }
      return;
    }
    if (shouldBlockMainnetDemoFallback(signer)) {
      get().setStatus("Mainnet private result submission requires a live zkLogin signer.", true);
      return;
    }
    const job =
      v.delegations.find((j) => j.status === "open" || j.status === "accepted" || j.status === "funded") ||
      v.delegations[v.delegations.length - 1];
    if (!job) {
      get().setStatus("Create a delegation job first.", true);
      return;
    }
    const agent = job.agent || get().session?.address || "0xAGENT";
    const { report, plaintext } = submitPrivateResultDemo({ jobId: job.id, agent });
    const next = readWorkbench();
    const localJob = next.delegations.find((j) => j.id === job.id);
    if (localJob) {
      localJob.status = "submitted";
      localJob.result_report_id = report.id;
      localJob.updated_at = nowIso();
    } else {
      next.delegations.push({ ...job, status: "submitted", result_report_id: report.id, updated_at: nowIso() });
    }
    next.reports.push(report);
    next.plaintexts[report.id] = plaintext;
    next.selected_report_id = report.id;
    saveWorkbench(next);
    get().reload();
    get().setStatus("Private result submitted with Seal access.");
  },

  openDispute: async () => {
    const v = get().view();
    const signer = get().signer;
    if (signer) {
      const actor = get().activeActor();
      if (!signerMatchesActor(signer, actor)) {
        get().setStatus("Select the current zkLogin signer before opening a real dispute.", true);
        return;
      }
      const job =
        v.delegations.find((j) => isSuiId(j.id) && (j.status === "submitted" || j.status === "funded")) ||
        v.delegations.find((j) => isSuiId(j.id));
      if (!job) {
        get().setStatus("Create a real delegation job first.", true);
        return;
      }
      if (!sameAddress(signer.address, job.buyer) && !sameAddress(signer.address, job.agent)) {
        get().setStatus("Only the buyer or agent can open a real delegation dispute.", true);
        return;
      }
      if (!(job.status === "submitted" || job.status === "funded")) {
        get().setStatus("The delegation must be funded or submitted before opening a dispute.", true);
        return;
      }
      try {
        const arbitrator = loadM3Config().defaultArbitratorAddress || signer.address;
        get().setStatus("Opening delegation dispute on Sui...");
        const digest = await openDisputeOnChain({
          signer,
          jobObjectId: job.id,
          arbitrator,
          reason: "Workbench dispute request"
        });
        const next = readWorkbench();
        const localJob = next.delegations.find((j) => j.id === job.id);
        if (localJob) {
          localJob.status = "disputed";
          localJob.arbitrator = arbitrator;
          localJob.dispute_tx_digest = digest;
          localJob.updated_at = nowIso();
        } else {
          next.delegations.push({
            ...job,
            status: "disputed",
            arbitrator,
            dispute_tx_digest: digest,
            updated_at: nowIso()
          });
        }
        saveWorkbench(next);
        get().reload();
        get().setStatus("Dispute opened on-chain; configured arbitrator has Seal access.");
      } catch (err) {
        get().setStatus("Dispute failed: " + String((err as Error)?.message || err), true);
      }
      return;
    }
    if (shouldBlockMainnetDemoFallback(signer)) {
      get().setStatus("Mainnet dispute handling requires a live zkLogin signer.", true);
      return;
    }
    const job = v.delegations.find((j) => j.result_report_id) || v.delegations[0];
    if (!job) {
      get().setStatus("Create a delegation job first.", true);
      return;
    }
    const next = readWorkbench();
    const localJob = next.delegations.find((j) => j.id === job.id);
    if (localJob) {
      localJob.status = "disputed";
      localJob.arbitrator = "0xARBITRATOR";
      localJob.updated_at = nowIso();
    } else {
      next.delegations.push({ ...job, status: "disputed", arbitrator: "0xARBITRATOR", updated_at: nowIso() });
    }
    saveWorkbench(next);
    get().reload();
    get().setStatus("Dispute opened; arbitrator has temporary Seal access.");
  },

  completeDelegation: async () => {
    const v = get().view();
    const signer = get().signer;
    if (signer) {
      const actor = get().activeActor();
      if (!signerMatchesActor(signer, actor)) {
        get().setStatus("Select the current zkLogin signer before completing a real delegation.", true);
        return;
      }
      const job = v.delegations.find((j) => isSuiId(j.id) && j.status === "submitted");
      if (!job) {
        get().setStatus("Submit a real delegation result before completing the job.", true);
        return;
      }
      if (!sameAddress(signer.address, job.buyer)) {
        get().setStatus("Only the buyer can complete and release a real delegation escrow.", true);
        return;
      }
      try {
        get().setStatus("Completing delegation and releasing escrow on Sui...");
        const digest = await completeDelegationJobOnChain({ signer, jobObjectId: job.id });
        const next = readWorkbench();
        const localJob = next.delegations.find((j) => j.id === job.id);
        if (localJob) {
          localJob.status = "completed";
          localJob.complete_tx_digest = digest;
          localJob.updated_at = nowIso();
        }
        saveWorkbench(next);
        get().reload();
        get().setStatus("Delegation completed on-chain; escrow released to the agent.");
      } catch (err) {
        get().setStatus("Delegation completion failed: " + String((err as Error)?.message || err), true);
      }
      return;
    }
    if (shouldBlockMainnetDemoFallback(signer)) {
      get().setStatus("Mainnet delegation completion requires a live zkLogin signer.", true);
      return;
    }
    const job = v.delegations.find((j) => j.status === "submitted");
    if (!job) {
      get().setStatus("Submit a delegation result before completing the job.", true);
      return;
    }
    const next = readWorkbench();
    const localJob = next.delegations.find((j) => j.id === job.id);
    if (localJob) {
      localJob.status = "completed";
      localJob.updated_at = nowIso();
    }
    saveWorkbench(next);
    get().reload();
    get().setStatus("Delegation completed (demo).");
  },

  settleLatestMembershipReceipt: async () => {
    const signer = get().signer;
    if (!signer) {
      if (shouldBlockMainnetDemoFallback(signer)) {
        get().setStatus("Mainnet receipt settlement requires a live zkLogin signer.", true);
        return;
      }
      const actor = get().activeActor();
      const receipt = get()
        .view()
        .access_receipts.filter(
          (item) =>
            item.access_type === "platform_member" &&
            item.source !== "sui" &&
            !item.settlement_tx_digest &&
            sameAddress(item.user, actor.address)
        )
        .reverse()[0];
      if (!receipt) {
        const pending = get()
          .view()
          .access_receipts.filter(
            (item) =>
              item.access_type === "platform_member" &&
              item.source !== "sui" &&
              !item.settlement_tx_digest
          )
          .reverse()[0];
        if (pending) {
          const owner = actorLabelForAddress(pending.user, get().session?.address);
          get().setStatus(
            "No pending membership receipt for " +
              actor.label +
              ". Switch to " +
              owner +
              " to settle this receipt, then switch to Publishing agent to claim.",
            true
          );
        } else {
          get().setStatus("Buy and decrypt as the platform member or delegation buyer before settling.", true);
        }
        return;
      }
      const next = readWorkbench();
      const localReceipt = next.access_receipts.find((item) => item.id === receipt.id);
      if (localReceipt) {
        localReceipt.settlement_tx_digest = "demo:settle:" + hash(receipt.id + ":" + Date.now());
        localReceipt.settled_at = nowIso();
        saveWorkbench(next);
        get().reload();
      }
      get().setStatus("Membership receipt settled (demo); agent earnings are ready to claim.");
      return;
    }
    const actor = get().activeActor();
    if (!signerMatchesActor(signer, actor)) {
      get().setStatus("Select the current zkLogin signer before settling a membership receipt.", true);
      return;
    }
    const receipt = get()
      .view()
      .access_receipts.filter(
        (item) =>
          item.access_type === "platform_member" &&
          isSuiId(item.id) &&
          !item.settlement_tx_digest &&
          sameAddress(item.user, signer.address)
      )
      .reverse()[0];
    if (!receipt) {
      get().setStatus("Sign in as the platform member who owns a real access receipt before settlement.", true);
      return;
    }
    try {
      get().setStatus("Settling membership receipt into agent earnings on Sui...");
      const digest = await settleMembershipReportOnChain({ signer, receiptObjectId: receipt.id });
      const next = readWorkbench();
      const localReceipt = next.access_receipts.find((item) => item.id === receipt.id);
      if (localReceipt) {
        localReceipt.settlement_tx_digest = digest;
        localReceipt.settled_at = nowIso();
        saveWorkbench(next);
        get().reload();
      }
      get().setStatus("Membership receipt settled on-chain: " + digest + ".");
    } catch (err) {
      get().setStatus("Settlement failed: " + String((err as Error)?.message || err), true);
    }
  },

  claimAgentEarnings: async () => {
    const signer = get().signer;
    if (!signer) {
      if (shouldBlockMainnetDemoFallback(signer)) {
        get().setStatus("Mainnet earnings claim requires a live zkLogin signer.", true);
        return;
      }
      const actor = get().activeActor();
      const claimable = get()
        .view()
        .access_receipts.filter(
          (receipt) =>
            receipt.access_type === "platform_member" &&
            receipt.source !== "sui" &&
            Boolean(receipt.settlement_tx_digest) &&
            sameAddress(receipt.agent, actor.address)
        );
      if (claimable.length === 0) {
        const pendingForAgent = get()
          .view()
          .access_receipts.filter(
            (receipt) =>
              receipt.access_type === "platform_member" &&
              receipt.source !== "sui" &&
              !receipt.settlement_tx_digest &&
              sameAddress(receipt.agent, actor.address)
          )
          .reverse()[0];
        if (pendingForAgent) {
          const owner = actorLabelForAddress(pendingForAgent.user, get().session?.address);
          get().setStatus(
            "Settle the pending membership receipt as " +
              owner +
              " first, then return to " +
              actor.label +
              " to claim earnings.",
            true
          );
        } else {
          get().setStatus("Settle a demo membership receipt for this agent before claiming earnings.", true);
        }
        return;
      }
      get().setStatus("Agent earnings claimed (demo) from " + claimable.length + " settled receipt(s).");
      return;
    }
    const actor = get().activeActor();
    if (!signerMatchesActor(signer, actor)) {
      get().setStatus("Select the current zkLogin signer before claiming real earnings.", true);
      return;
    }
    try {
      get().setStatus("Claiming agent earnings on Sui...");
      const digest = await claimAgentEarningsOnChain({ signer });
      get().setStatus("Agent earnings claimed on-chain: " + digest + ".");
    } catch (err) {
      get().setStatus("Claim failed: " + String((err as Error)?.message || err), true);
    }
  },

  decryptReport: async (id) => {
    const v = get().view();
    const actor = get().activeActor();
    const report = v.reports.find((r) => r.id === id);
    if (!report) return;
    const decision = accessDecision(v, report, actor);
    if (!decision.allowed) {
      get().setStatus("Seal denied access: " + decision.reason + ".", true);
      return;
    }
    const signer = get().signer;
    const reportObjectId = report.sui_object_id || report.id;
    const canUseRealDecrypt =
      signer &&
      report.visibility !== "public" &&
      isSuiId(reportObjectId) &&
      isSuiId(report.seal_id) &&
      Boolean(report.walrus_blob_id);

    if (canUseRealDecrypt) {
      if (!signerMatchesActor(signer, actor)) {
        get().setStatus("Select the current zkLogin signer before decrypting a real report.", true);
        return;
      }

      let moduleFn:
        | "seal_approve_report_author"
        | "seal_approve_report_with_platform_membership"
        | "seal_approve_report_with_agent_subscription"
        | "seal_approve_private_result";
      let passObjectId: string | undefined;
      let delegationJobId: string | undefined;

      if (decision.reason === "author") {
        moduleFn = "seal_approve_report_author";
      } else if (decision.reason === "platform_member") {
        const pass = v.platform_memberships.find(
          (item) =>
            sameAddress(item.owner_address, signer.address) &&
            Number(item.tier || 0) >= Number(report.required_tier || 0) &&
            isSuiId(item.pass_id)
        );
        if (!pass) {
          get().setStatus("A real platform membership pass is required for on-chain decrypt.", true);
          return;
        }
        moduleFn = "seal_approve_report_with_platform_membership";
        passObjectId = pass.pass_id;
      } else if (decision.reason === "agent_subscription") {
        const pass = v.agent_subscriptions.find(
          (item) =>
            sameAddress(item.owner_address, signer.address) &&
            sameAddress(item.agent, report.agent) &&
            Number(item.tier || 0) >= Number(report.required_tier || 0) &&
            isSuiId(item.pass_id)
        );
        if (!pass) {
          get().setStatus("A real agent subscription pass is required for on-chain decrypt.", true);
          return;
        }
        moduleFn = "seal_approve_report_with_agent_subscription";
        passObjectId = pass.pass_id;
      } else {
        const job = jobForReport(v.delegations, report);
        if (!job || !isSuiId(job.id)) {
          get().setStatus("A real delegation job is required for private result decrypt.", true);
          return;
        }
        moduleFn = "seal_approve_private_result";
        delegationJobId = job.id;
      }

      try {
        get().setStatus("Decrypting with Seal key servers...");
        const plaintext = await decryptReportOnChain(report, moduleFn, signer, passObjectId, delegationJobId);
        if (!plaintext) {
          get().setStatus("Seal decrypt returned no plaintext.", true);
          return;
        }
        const next = readWorkbench();
        if (decision.reason === "platform_member" && passObjectId) {
          const period = currentPeriod();
          const exists = next.access_receipts.some(
            (receipt) =>
              receipt.period_id === period &&
              sameAddress(receipt.user, signer.address) &&
              receipt.report_id === report.id &&
              receipt.access_type === "platform_member"
          );
          if (!exists) {
            const receipt = await recordPlatformAccessReceiptOnChain({
              signer,
              passObjectId,
              reportObjectId,
              periodId: period
            });
            next.access_receipts.push({
              id: receipt.objectId,
              period_id: period,
              user: signer.address,
              report_id: report.id,
              agent: report.agent,
              access_type: "platform_member",
              created_at: nowIso(),
              tx_digest: receipt.digest,
              source: "sui"
            });
          }
        }
        next.plaintexts[report.id] = plaintext;
        next.unlocked[actor.address + ":" + report.id] = true;
        next.selected_report_id = report.id;
        saveWorkbench(next);
        get().reload();
        get().setStatus("Seal decrypt authorized on-chain for " + actor.label + " via " + decision.reason + ".");
      } catch (err) {
        get().setStatus("Decrypt failed: " + String((err as Error)?.message || err), true);
      }
      return;
    }

    if (signer && report.visibility !== "public" && (isSuiId(reportObjectId) || isSuiId(report.seal_id))) {
      get().setStatus("This report is missing the real Walrus/Seal metadata required for on-chain decrypt.", true);
      return;
    }

    const next = readWorkbench();
    if (decision.receiptType) {
      const period = currentPeriod();
      const receiptId = "read:" + hash(period + ":" + actor.address + ":" + report.id);
      const exists = next.access_receipts.some((r) => r.id === receiptId);
      if (!exists) {
        next.access_receipts.push({
          id: receiptId,
          period_id: period,
          user: actor.address,
          report_id: report.id,
          agent: report.agent,
          access_type: decision.receiptType,
          created_at: nowIso(),
          source: "demo"
        });
      }
    }
    next.unlocked[actor.address + ":" + report.id] = true;
    next.selected_report_id = report.id;
    saveWorkbench(next);
    get().reload();
    get().setStatus("Seal decrypt authorized for " + actor.label + " via " + decision.reason + ".");
  },

  seedDemo: () => {
    localStorage.setItem("rn_workbench_demo", "1");
    writeJson("rn_session", {
      provider: "google",
      address: "0xAGENT",
      sub: "demo-agent",
      email: "agent@example.com",
      iss: "https://accounts.google.com",
      ts: Date.now()
    });
    writeJson("rn_github", {
      sui_address: "0xAGENT",
      login: "octo-agent",
      installation_id: 101,
      account: "octo-agent",
      account_type: "User",
      selected_installation_ids: ["101", "202"],
      selected_repo: "octo-agent/research-alpha",
      repos: ["octo-agent/research-alpha", "octo-agent/open-notes"],
      installations: [
        { id: 101, account: "octo-agent", accountType: "User", repos: ["octo-agent/research-alpha", "octo-agent/open-notes"] },
        { id: 202, account: "research-org", accountType: "Organization", repos: ["research-org/private-alpha", "research-org/encrypted-lab"] }
      ],
      available_repos: [
        { full_name: "octo-agent/research-alpha", installation_id: 101, installation_account: "octo-agent", installation_account_type: "User" },
        { full_name: "octo-agent/open-notes", installation_id: 101, installation_account: "octo-agent", installation_account_type: "User" },
        { full_name: "research-org/private-alpha", installation_id: 202, installation_account: "research-org", installation_account_type: "Organization" },
        { full_name: "research-org/encrypted-lab", installation_id: 202, installation_account: "research-org", installation_account_type: "Organization" }
      ],
      binding_attestation: "demo-attestation",
      binding_attestation_payload: { sub: "0xAGENT", installation_id: 101 }
    });
    const state = readWorkbench();
    state.actor = "agent";
    saveWorkbench(state);
    get().reload();
    get().setStatus("Local demo identity seeded; publishing as Publishing agent.");
  }
}));

export { ACTORS };
