export type AssetType =
  | "paper"
  | "skill"
  | "workflow"
  | "dataset"
  | "experiment"
  | "benchmark"
  | "code"
  | "review";

export interface ResearchAuthor {
  name: string;
  type: "human" | "agent" | "organization";
  wallet?: string;
  github?: string;
  agent_id?: string;
}

export interface RevenueSplit {
  recipient: string;
  role: string;
  weight_bps: number;
}

export type ResearchAccessVisibility = "public" | "encrypted" | "private_delegation";

export interface ResearchAccessPolicy {
  visibility: ResearchAccessVisibility;
  seal_id?: string;
  walrus_blob_id?: string;
  ciphertext_hash?: string;
  plaintext_commitment?: string;
  required_tier?: number;
  free_preview?: string;
  channel_id?: string;
  delegation_job_id?: string;
}

export interface ResearchAssetManifest {
  schema: "research-asset/v0.1";
  id?: string | null;
  title: string;
  slug?: string;
  version: string;
  types: AssetType[];
  abstract?: string;
  categories?: string[];
  authors: ResearchAuthor[];
  assets?: {
    paper?: {
      path?: string;
      source?: string;
      bib?: string;
    };
    skills?: Array<{
      name?: string;
      path: string;
      relation?: ResearchSkillManifest["relation"];
    }>;
    workflow?: {
      path: string;
    };
    [key: string]: unknown;
  };
  generated_by?: Record<string, unknown>;
  derived_from?: Array<Record<string, unknown>>;
  references?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
  access?: ResearchAccessPolicy;
  legal_terms?: Record<string, unknown>;
  commerce?: {
    purchasable?: boolean;
    price_policy?: Record<string, unknown>;
    revenue_split?: RevenueSplit[];
  };
  publish: {
    storage: "walrus";
    chain: "sui";
    visibility?: "public" | "unlisted" | "encrypted" | "private_delegation";
    register_on_chain?: boolean;
  };
}

export interface ResearchSkillManifest {
  schema: "research-skill/v0.1";
  name: string;
  version: string;
  description: string;
  capabilities: string[];
  relation: "owned" | "forked" | "dependency" | "referenced" | "vendored";
  derived_from?: Record<string, unknown> | null;
  depends_on?: Array<Record<string, unknown>>;
  entry?: string;
  access?: ResearchAccessPolicy;
  tests?: string[];
}

export interface ResearchWorkflowManifest {
  schema: "research-workflow/v0.1";
  name: string;
  version: string;
  description?: string;
  inputs?: unknown[];
  outputs?: unknown[];
  stages: Array<{
    id: string;
    name: string;
    instructions: string;
    [key: string]: unknown;
  }>;
  quality_gates?: unknown[];
  tools?: unknown[];
}

export interface ValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  path?: string;
}

export interface ValidationReport {
  valid: boolean;
  root: string;
  asset?: ResearchAssetManifest;
  detected_assets: {
    papers: number;
    skills: number;
    workflows: number;
    datasets: number;
    code: number;
  };
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface ReleaseFile {
  path: string;
  size: number;
  sha256: string;
}

export interface ReleaseManifest {
  schema: "research-asset-manifest/v0.1";
  repo: string;
  commit: string;
  asset_yaml_hash: string;
  content_hash: string;
  manifest_hash: string;
  created_at: string;
  files: ReleaseFile[];
  assets: ResearchAssetManifest;
  skills: Array<{
    id: string;
    manifest_id?: string;
    source_asset_id?: string;
    path: string;
    manifest: ResearchSkillManifest;
  }>;
  workflows: Array<{
    id: string;
    manifest_id?: string;
    source_asset_id?: string;
    path: string;
    manifest: ResearchWorkflowManifest;
  }>;
  relationships: Array<{
    src_id: string;
    dst_id: string;
    relation_type: string;
    metadata?: Record<string, unknown>;
  }>;
}

export interface PackageResult {
  releaseDir: string;
  stagingDir: string;
  manifestPath: string;
  checksumsPath: string;
  archivePath: string;
  manifest: ReleaseManifest;
}

export interface ProtocolEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  tx_digest: string;
  event_seq: number;
  event_type: string;
  checkpoint: number;
  timestamp_ms: number;
  payload: TPayload;
}

export interface IndexedAsset {
  id: string;
  sui_object_id: string;
  title: string;
  slug?: string;
  version: string;
  types: AssetType[];
  abstract?: string;
  categories: string[];
  walrus_blob_id: string;
  manifest_hash: string;
  content_hash: string;
  repo_url: string;
  repo_commit: string;
  owner_address: string;
  creator_address: string;
  created_at: string;
  manifest: ReleaseManifest;
}

export interface IndexedSkill {
  id: string;
  sui_object_id: string;
  source_asset_id: string;
  name: string;
  version: string;
  description: string;
  relation: ResearchSkillManifest["relation"];
  walrus_blob_id: string;
  manifest_hash: string;
  access?: ResearchAccessPolicy;
  owner_address: string;
  created_at: string;
  manifest: ResearchSkillManifest;
}

export interface IndexedRelationship {
  id: string;
  src_id: string;
  dst_id: string;
  relation_type: string;
  weight: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AgentPassport {
  id: string;
  sui_object_id: string;
  owner_address: string;
  name: string;
  metadata: Record<string, unknown>;
  reputation: number;
  created_at: string;
}

export type GitProvider = "github" | "gitlab" | "gitea";

export type CrossChainAuthProvider =
  | "privy"
  | "dynamic"
  | "web3auth"
  | "particle"
  | "lit"
  | "custom-oidc";

export interface AuthLoginIntent {
  id: string;
  provider: GitProvider | CrossChainAuthProvider;
  provider_kind: "git" | "cross-chain";
  authorization_url: string;
  redirect_uri: string;
  client_id: string;
  scopes: string[];
  state: string;
  nonce: string;
  created_at: string;
  expires_at: string;
  /** Set when the intent has been completed; a consumed intent cannot be completed again. */
  consumed_at?: string;
  zklogin: {
    enabled: boolean;
    issuer?: string;
    salt_strategy: "platform-derived" | "provider-managed" | "user-held";
    prover_url?: string;
  };
  git?: {
    provider: GitProvider;
    repository_permissions_required: string[];
  };
  external?: {
    provider: CrossChainAuthProvider;
    issuer: string;
    supports_wallets: string[];
    supports_git_linking: boolean;
  };
}

export interface GitIdentity {
  provider: GitProvider;
  user_id: string;
  username: string;
  email?: string;
  installation_id?: string;
  scopes: string[];
}

export interface GithubRepositoryBinding {
  provider: "github";
  github_login: string | null;
  sui_address: string;
  installation_id: number;
  account: string | null;
  repos: string[];
  selected_repo?: string | null;
  binding_attestation: string;
  binding_attestation_payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface WalletBinding {
  chain: "sui" | "evm" | "solana" | "bitcoin" | "other";
  address: string;
  verified_by: "zklogin" | "external-auth" | "wallet-signature";
}

export interface ZkLoginBinding {
  issuer: string;
  subject: string;
  audience?: string;
  address: string;
  salt_hash: string;
  nonce: string;
  provider: GitProvider | CrossChainAuthProvider;
}

export interface PlatformAccount {
  id: string;
  display_name: string;
  primary_provider: GitProvider | CrossChainAuthProvider;
  git?: GitIdentity;
  github_bindings?: GithubRepositoryBinding[];
  zklogin?: ZkLoginBinding;
  wallets: WalletBinding[];
  roles: string[];
  created_at: string;
  updated_at: string;
}

export interface CliAuthSession {
  provider: "google";
  account_id: string;
  address: string;
  email?: string;
  issuer: string;
  subject: string;
  audience: string;
  encrypted_id_token: {
    alg: "aes-256-gcm";
    kid: string;
    iv: string;
    tag: string;
    ciphertext: string;
  };
  created_at: string;
  updated_at: string;
  expires_at?: string;
}

export interface AuthState {
  intents: Record<string, AuthLoginIntent>;
  accounts: Record<string, PlatformAccount>;
  cli_session?: CliAuthSession;
}

export interface RevenuePoolRecord {
  id: string;
  asset_id: string;
  recipients: string[];
  weights_bps: number[];
  total_received: number;
  total_claimed: number;
  claimed_by: Record<string, number>;
  created_at: string;
  updated_at: string;
}

export interface ResearchReportRecord {
  id: string;
  sui_object_id: string;
  agent: string;
  visibility: ResearchAccessVisibility;
  required_tier: number;
  walrus_blob_id: string;
  seal_id?: string;
  ciphertext_hash?: string;
  plaintext_commitment?: string;
  free_preview_hash?: string;
  delegation_job_id?: string;
  asset_id?: string;
  title?: string;
  free_preview?: string;
  created_at: string;
}

export interface AgentChannelRecord {
  id: string;
  agent: string;
  metadata_hash: string;
  created_at: string;
}

export interface PlatformMembershipRecord {
  pass_id: string;
  owner_address: string;
  tier: number;
  started_at: string;
  expires_at: string;
}

export interface AgentSubscriptionRecord {
  pass_id: string;
  owner_address: string;
  agent: string;
  tier: number;
  started_at: string;
  expires_at: string;
}

export interface AccessReceiptRecord {
  id: string;
  period_id: number;
  user: string;
  report_id: string;
  agent: string;
  access_type: "platform_member" | "agent_subscription";
  created_at: string;
}

export interface DelegationJobRecord {
  id: string;
  buyer: string;
  agent: string;
  budget: number;
  deadline_at?: string;
  status: "open" | "accepted" | "funded" | "submitted" | "completed" | "refunded" | "disputed" | "resolved" | "expired";
  result_report_id?: string;
  arbitrator?: string;
  payout?: number;
  refund?: number;
  created_at: string;
  updated_at: string;
}

export interface MembershipSettlementRecord {
  id: string;
  period_id: number;
  user: string;
  report_id?: string;
  agent?: string;
  report_count: number;
  net_amount: number;
  amount_per_report: number;
  created_at: string;
}

export interface AgentEarningsRecord {
  agent: string;
  total_earned: number;
  total_claimed: number;
  updated_at: string;
}

export interface CrossChainPaymentRecord {
  order_hash: string;
  source_chain: string;
  source_tx: string;
  buyer: string;
  amount: number;
  created_at: string;
}

export interface ReputationRecord {
  id: string;
  owner_address: string;
  score: number;
  created_at: string;
  updated_at: string;
}

export interface BadgeRecord {
  id: string;
  asset_id: string;
  recipient: string;
  issuer: string;
  badge_type: number;
  metadata_hash?: string;
  created_at: string;
}

export interface SearchDocument {
  id: string;
  entity_type: "asset" | "skill" | "workflow" | "agent" | "report" | "channel" | "delegation";
  entity_id: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  updated_at: string;
}

export interface IndexState {
  events: ProtocolEvent[];
  assets: Record<string, IndexedAsset>;
  skills: Record<string, IndexedSkill>;
  relationships: Record<string, IndexedRelationship>;
  agents: Record<string, AgentPassport>;
  reports: Record<string, ResearchReportRecord>;
  agent_channels: Record<string, AgentChannelRecord>;
  platform_memberships: Record<string, PlatformMembershipRecord>;
  agent_subscriptions: Record<string, AgentSubscriptionRecord>;
  access_receipts: Record<string, AccessReceiptRecord>;
  delegations: Record<string, DelegationJobRecord>;
  membership_settlements: Record<string, MembershipSettlementRecord>;
  agent_earnings: Record<string, AgentEarningsRecord>;
  revenue_pools: Record<string, RevenuePoolRecord>;
  payments: Record<string, CrossChainPaymentRecord>;
  reputations: Record<string, ReputationRecord>;
  badges: Record<string, BadgeRecord>;
  search_documents: Record<string, SearchDocument>;
  processed_event_keys: string[];
  updated_at: string;
}

export interface SuiEventCursor {
  txDigest: string;
  eventSeq: string | number;
}

export interface SuiEventPollerState {
  package_id?: string;
  rpc_url?: string;
  module_cursors: Record<string, SuiEventCursor | null>;
  last_checkpoints: Record<string, number>;
  pages_fetched: number;
  events_seen: number;
  events_ingested: number;
  updated_at: string;
}

export interface PublishResult {
  validation: ValidationReport;
  package: PackageResult;
  walrus: {
    blobId: string;
    objectId: string;
    size: number;
    contentHash: string;
    manifestPath: string;
    archivePath: string;
  };
  sui: {
    txDigest: string;
    assetId: string;
    objectId: string;
    events: ProtocolEvent[];
  };
  index: IndexState;
}
