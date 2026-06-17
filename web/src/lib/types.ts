// Shared domain types for the Research Network web app.
// These mirror the local-protocol shape in src/core/types.ts so the workbench
// can reuse the same index/session data that the backend emits.

export type Visibility = "public" | "encrypted" | "private_delegation";

export interface ResearchReport {
  id: string;
  sui_object_id?: string;
  tx_digest?: string;
  agent: string;
  visibility: Visibility;
  required_tier: number;
  walrus_blob_id?: string;
  walrus_readback_verified?: boolean;
  walrus_readback_bytes?: number;
  walrus_readback_hash?: string;
  seal_id?: string;
  ciphertext_hash?: string;
  plaintext_commitment?: string;
  free_preview_hash?: string;
  delegation_job_id?: string;
  title: string;
  free_preview?: string;
  created_at: string;
  source_repo?: string;
}

export interface PlatformMembership {
  pass_id: string;
  owner_address: string;
  tier: number;
  started_at: string;
  expires_at: string;
  tx_digest?: string;
  source?: "demo" | "sui";
}

export interface AgentSubscription {
  pass_id: string;
  owner_address: string;
  agent: string;
  tier: number;
  started_at: string;
  expires_at: string;
  tx_digest?: string;
  source?: "demo" | "sui";
}

export interface AccessReceipt {
  id: string;
  period_id: number;
  user: string;
  report_id: string;
  agent: string;
  access_type: string;
  created_at: string;
  tx_digest?: string;
  settlement_tx_digest?: string;
  settled_at?: string;
  source?: "demo" | "sui";
}

export interface DelegationJob {
  id: string;
  buyer: string;
  agent: string;
  budget?: number;
  status: string;
  arbitrator?: string;
  result_report_id?: string;
  tx_digest?: string;
  fund_tx_digest?: string;
  accept_tx_digest?: string;
  result_tx_digest?: string;
  complete_tx_digest?: string;
  dispute_tx_digest?: string;
  source?: "demo" | "sui";
  created_at: string;
  updated_at: string;
}

// GitHub binding persisted to localStorage key "rn_github".
export interface GithubRepoRef {
  full_name: string;
  installation_id?: number | string | null;
  installation_account?: string | null;
  installation_account_type?: string | null;
  granted?: boolean;
}

export interface GithubInstallation {
  id: number | string;
  account?: string;
  accountType?: string;
  account_type?: string;
  repos?: string[];
}

export interface GithubOrganizationScope {
  id?: number | string;
  installation_id?: number | string;
  account: string;
  accountType?: string;
  account_type?: string;
  installed?: boolean;
  repos?: string[];
}

export interface GithubBinding {
  sui_address?: string;
  login?: string;
  installation_id?: number;
  account?: string | null;
  account_type?: string | null;
  selected_installation_ids?: (number | string)[];
  selected_repo?: string;
  repos?: string[];
  installations?: GithubInstallation[];
  available_repos?: (string | GithubRepoRef)[];
  organization_scopes?: GithubOrganizationScope[];
  binding_attestation?: string;
  binding_attestation_payload?: unknown;
}

export interface ZkLoginSession {
  provider?: string;
  address: string;
  sub?: string;
  email?: string;
  iss?: string;
  ts?: number;
}

export type ActorId =
  | "agent"
  | "buyer"
  | "member"
  | "subscriber"
  | "arbitrator"
  | "outsider";

export interface Actor {
  id: ActorId;
  label: string;
  address: string;
}

export interface AccessDecision {
  allowed: boolean;
  reason: string;
  receiptType?: "platform_member" | "agent_subscription";
}

// The injected seed index that the shell writes to window.__WORKBENCH_INDEX__.
// Mirrors renderWorkbenchBody() payload in src/core/web-workbench.ts.
export interface WorkbenchIndex {
  generated_at?: string;
  assets?: Array<{
    id: string;
    title: string;
    author?: string;
    agent?: string;
    href?: string;
    visibility?: Visibility;
  }>;
  reports?: ResearchReport[];
  platform_memberships?: PlatformMembership[];
  agent_subscriptions?: AgentSubscription[];
  access_receipts?: AccessReceipt[];
  delegations?: DelegationJob[];
  membership_settlements?: unknown[];
  agent_earnings?: unknown[];
}

export interface WorkbenchState {
  reports: ResearchReport[];
  platform_memberships: PlatformMembership[];
  agent_subscriptions: AgentSubscription[];
  access_receipts: AccessReceipt[];
  delegations: DelegationJob[];
  plaintexts: Record<string, string>;
  unlocked: Record<string, boolean>;
  actor: ActorId;
  selected_report_id: string;
}
