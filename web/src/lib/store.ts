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
  mergeById,
  readGithub,
  readSession,
  readWorkbench,
  readWorkbenchIndex,
  saveWorkbench,
  writeJson,
  hash
} from "./storage";
import { publishReportDemo, submitPrivateResultDemo } from "./clients";
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

  // selectors
  view: () => WorkbenchView;
  activeActor: () => ReturnType<typeof activeActor>;

  // actions
  reload: () => void;
  setActor: (id: ActorId) => void;
  setStatus: (text: string, isError?: boolean) => void;

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

export const useWorkbench = create<WorkbenchStore>((set, get) => ({
  ...emptyWorkbenchState(),
  index: readWorkbenchIndex(),
  session: readSession(),
  github: readGithub(),
  demoMode: isDemoMode(),
  statusText: "",
  statusError: false,

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

  activeActor: () => activeActor(get(), get().session?.address),

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

  publish: ({ title, visibility, tier, preview, plaintext }) => {
    const session = get().session;
    if (!session?.address) {
      get().setStatus("Sign in before publishing.", true);
      return;
    }
    // need selected repo from github binding
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
    const { report, plaintext: stored } = publishReportDemo({
      title,
      visibility,
      requiredTier: tier,
      freePreview: preview,
      plaintext,
      agent: session.address,
      sourceRepo: selectedRepo
    });
    const next = readWorkbench();
    next.reports.push(report);
    if (visibility !== "public") next.plaintexts[report.id] = stored;
    next.selected_report_id = report.id;
    saveWorkbench(next);
    get().reload();
    get().setStatus("Published " + visibility + " report from " + selectedRepo + ".");
  },

  buyMembership: () => {
    const actor = get().activeActor();
    const next = readWorkbench();
    const id = "pm:" + hash(actor.address + ":" + Date.now());
    next.platform_memberships.push({
      pass_id: id,
      owner_address: actor.address,
      tier: 1,
      started_at: nowIso(),
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    });
    saveWorkbench(next);
    get().reload();
    get().setStatus("Platform membership active for " + actor.label + ".");
  },

  subscribeAgent: () => {
    const v = get().view();
    const actor = get().activeActor();
    const selected = v.reports.find((r) => r.id === get().selected_report_id) || v.reports[0];
    const agent = selected?.agent || get().session?.address || "0xAGENT";
    const next = readWorkbench();
    const id = "sub:" + hash(actor.address + ":" + agent + ":" + Date.now());
    next.agent_subscriptions.push({
      pass_id: id,
      owner_address: actor.address,
      agent,
      tier: 1,
      started_at: nowIso(),
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    });
    saveWorkbench(next);
    get().reload();
    get().setStatus("Agent subscription active for " + actor.label + ".");
  },

  createDelegation: () => {
    const agent = get().session?.address || "0xAGENT";
    const next = readWorkbench();
    const id = "job:" + hash("delegation:" + Date.now());
    next.delegations.push({
      id,
      buyer: "0xBUYER",
      agent,
      budget: 1200,
      status: "open",
      created_at: nowIso(),
      updated_at: nowIso()
    });
    saveWorkbench(next);
    get().reload();
    get().setStatus("Private delegation job created.");
  },

  submitPrivateResult: () => {
    const v = get().view();
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

  openDispute: () => {
    const v = get().view();
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

  decryptReport: (id) => {
    const v = get().view();
    const actor = get().activeActor();
    const report = v.reports.find((r) => r.id === id);
    if (!report) return;
    const decision = accessDecision(v, report, actor);
    if (!decision.allowed) {
      get().setStatus("Seal denied access: " + decision.reason + ".", true);
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
          created_at: nowIso()
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
    get().reload();
    get().setStatus("Local test identity seeded.");
  }
}));

export { ACTORS };
