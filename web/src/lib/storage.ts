// localStorage-backed helpers, ported verbatim from the original WORKBENCH_JS /
// account inline scripts so behavior stays identical during the M2 migration.

import type {
  AccessDecision,
  Actor,
  ActorId,
  DelegationJob,
  GithubBinding,
  ResearchReport,
  WorkbenchIndex,
  WorkbenchState,
  ZkLoginSession
} from "./types";

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function readSession(): ZkLoginSession | null {
  return readJson<ZkLoginSession | null>("rn_session", null);
}

export function readGithub(): GithubBinding | null {
  return readJson<GithubBinding | null>("rn_github", null);
}

export function emptyWorkbenchState(): WorkbenchState {
  return {
    reports: [],
    platform_memberships: [],
    agent_subscriptions: [],
    access_receipts: [],
    delegations: [],
    plaintexts: {},
    unlocked: {},
    actor: "outsider",
    selected_report_id: ""
  };
}

export function readWorkbench(): WorkbenchState {
  const raw = readJson<Partial<WorkbenchState>>("rn_workbench_state", {});
  const base = emptyWorkbenchState();
  return {
    reports: Array.isArray(raw.reports) ? raw.reports : base.reports,
    platform_memberships: Array.isArray(raw.platform_memberships)
      ? raw.platform_memberships
      : base.platform_memberships,
    agent_subscriptions: Array.isArray(raw.agent_subscriptions)
      ? raw.agent_subscriptions
      : base.agent_subscriptions,
    access_receipts: Array.isArray(raw.access_receipts)
      ? raw.access_receipts
      : base.access_receipts,
    delegations: Array.isArray(raw.delegations) ? raw.delegations : base.delegations,
    plaintexts: raw.plaintexts || base.plaintexts,
    unlocked: raw.unlocked || base.unlocked,
    actor: raw.actor || base.actor,
    selected_report_id: raw.selected_report_id || base.selected_report_id
  };
}

export function saveWorkbench(state: WorkbenchState): void {
  writeJson("rn_workbench_state", state);
}

export function readWorkbenchIndex(): WorkbenchIndex {
  const w = window as unknown as { __WORKBENCH_INDEX__?: WorkbenchIndex };
  return w.__WORKBENCH_INDEX__ || {};
}

// FNV-1a hash, identical to the original workbench helper. M2 keeps using it to
// synthesize demo ids; M3 replaces these with real on-chain/Walrus ids.
export function hash(text: string): string {
  const input = String(text || "");
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function mergeById<T>(base: T[] | undefined, local: T[] | undefined, idKey: keyof T): T[] {
  const out: Record<string, T> = {};
  (base || []).forEach((item) => {
    const key = item ? (item as Record<string, unknown>)[idKey as string] : undefined;
    if (key !== undefined && key !== null && key !== "") out[String(key)] = item;
  });
  (local || []).forEach((item) => {
    const key = item ? (item as Record<string, unknown>)[idKey as string] : undefined;
    if (key !== undefined && key !== null && key !== "") out[String(key)] = item;
  });
  return Object.keys(out).map((id) => out[id]);
}

export const ACTORS: Actor[] = [
  { id: "agent", label: "Publishing agent", address: "0xAGENT" },
  { id: "buyer", label: "Delegation buyer", address: "0xBUYER" },
  { id: "member", label: "Platform member", address: "0xMEMBER" },
  { id: "subscriber", label: "Agent subscriber", address: "0xSUBSCRIBER" },
  { id: "arbitrator", label: "Platform arbitrator", address: "0xARBITRATOR" },
  { id: "outsider", label: "Outsider", address: "0xOUTSIDER" }
];

export function activeActor(state: WorkbenchState, agentAddress?: string): Actor {
  const actors = agentAddress
    ? ACTORS.map((a) => (a.id === "agent" ? { ...a, address: agentAddress } : a))
    : ACTORS;
  return actors.find((a) => a.id === state.actor) || actors[actors.length - 1];
}

export function isActive(expiresAt?: string): boolean {
  return !expiresAt || new Date(expiresAt).getTime() > Date.now();
}

export function hasMembership(
  memberships: WorkbenchState["platform_memberships"],
  address: string,
  tier: number
): boolean {
  return memberships.some(
    (pass) =>
      pass.owner_address === address &&
      Number(pass.tier || 0) >= Number(tier || 0) &&
      isActive(pass.expires_at)
  );
}

export function hasSubscription(
  subs: WorkbenchState["agent_subscriptions"],
  address: string,
  agent: string,
  tier: number
): boolean {
  return subs.some(
    (pass) =>
      pass.owner_address === address &&
      pass.agent === agent &&
      Number(pass.tier || 0) >= Number(tier || 0) &&
      isActive(pass.expires_at)
  );
}

export function jobForReport(
  delegations: DelegationJob[],
  report: ResearchReport
): DelegationJob | null {
  return (
    delegations.find(
      (job) => job.result_report_id === report.id || job.id === report.delegation_job_id
    ) || null
  );
}

export function accessDecision(
  view: {
    platform_memberships: WorkbenchState["platform_memberships"];
    agent_subscriptions: WorkbenchState["agent_subscriptions"];
    delegations: DelegationJob[];
  },
  report: ResearchReport,
  actor: Actor
): AccessDecision {
  if (!report) return { allowed: false, reason: "missing" };
  if (report.visibility === "public") return { allowed: true, reason: "public" };
  if (actor.address === report.agent) return { allowed: true, reason: "author" };
  if (report.visibility === "encrypted") {
    if (hasSubscription(view.agent_subscriptions, actor.address, report.agent, report.required_tier)) {
      return { allowed: true, reason: "agent_subscription", receiptType: "agent_subscription" };
    }
    if (hasMembership(view.platform_memberships, actor.address, report.required_tier)) {
      return { allowed: true, reason: "platform_member", receiptType: "platform_member" };
    }
    return { allowed: false, reason: "needs_membership_or_subscription" };
  }
  if (report.visibility === "private_delegation") {
    const job = jobForReport(view.delegations, report);
    if (job && actor.address === job.buyer) return { allowed: true, reason: "delegation_buyer" };
    if (job && job.status === "disputed" && actor.address === (job.arbitrator || ""))
      return { allowed: true, reason: "dispute_arbitrator" };
    return { allowed: false, reason: "private_delegation" };
  }
  return { allowed: false, reason: "unknown" };
}

export function actorById(id: ActorId, agentAddress?: string): Actor {
  const list = agentAddress
    ? ACTORS.map((a) => (a.id === "agent" ? { ...a, address: agentAddress } : a))
    : ACTORS;
  return list.find((a) => a.id === id) || list[list.length - 1];
}

export type { ActorId };
