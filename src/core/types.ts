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

export interface ResearchAssetManifest {
  schema: "research-asset/v0.1";
  id?: string | null;
  title: string;
  slug?: string;
  version: string;
  types: AssetType[];
  abstract?: string;
  tags?: string[];
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
  license: Record<string, unknown>;
  commerce?: {
    purchasable?: boolean;
    price_policy?: Record<string, unknown>;
    revenue_split?: RevenueSplit[];
  };
  publish: {
    storage: "walrus";
    chain: "sui";
    visibility?: "public" | "unlisted" | "encrypted";
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
  license: string;
  price_policy?: Record<string, unknown>;
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
    path: string;
    manifest: ResearchSkillManifest;
  }>;
  workflows: Array<{
    id: string;
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
  tags: string[];
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
  license: string;
  price_policy?: Record<string, unknown>;
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
  zklogin?: ZkLoginBinding;
  wallets: WalletBinding[];
  roles: string[];
  created_at: string;
  updated_at: string;
}

export interface AuthState {
  intents: Record<string, AuthLoginIntent>;
  accounts: Record<string, PlatformAccount>;
}

export interface LicenseRecord {
  id: string;
  sui_object_id: string;
  skill_id: string;
  owner_address: string;
  license_type: string;
  expires_at?: string;
  commercial: boolean;
  agent_allowed: boolean;
  seats: number;
}

export interface SearchDocument {
  id: string;
  entity_type: "asset" | "skill" | "workflow" | "agent" | "license";
  entity_id: string;
  title: string;
  body: string;
  tags: string[];
  metadata: Record<string, unknown>;
  updated_at: string;
}

export interface IndexState {
  events: ProtocolEvent[];
  assets: Record<string, IndexedAsset>;
  skills: Record<string, IndexedSkill>;
  relationships: Record<string, IndexedRelationship>;
  agents: Record<string, AgentPassport>;
  licenses: Record<string, LicenseRecord>;
  search_documents: Record<string, SearchDocument>;
  processed_event_keys: string[];
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
