CREATE TABLE events (
  id BIGSERIAL PRIMARY KEY,
  tx_digest TEXT NOT NULL,
  event_seq BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ,
  UNIQUE(tx_digest, event_seq)
);

CREATE TABLE research_assets (
  id TEXT PRIMARY KEY,
  sui_object_id TEXT UNIQUE NOT NULL,
  title TEXT,
  slug TEXT,
  version TEXT,
  type_mask BIGINT,
  abstract TEXT,
  walrus_blob_id TEXT,
  manifest_hash TEXT,
  repo_url TEXT,
  repo_commit TEXT,
  owner_address TEXT,
  creator_address TEXT,
  created_at TIMESTAMPTZ,
  indexed_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  sui_object_id TEXT UNIQUE,
  source_asset_id TEXT REFERENCES research_assets(id),
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  description TEXT,
  relation TEXT,
  walrus_blob_id TEXT,
  manifest_hash TEXT,
  access JSONB,
  owner_address TEXT,
  created_at TIMESTAMPTZ
);

CREATE TABLE relationships (
  id BIGSERIAL PRIMARY KEY,
  src_id TEXT NOT NULL,
  dst_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  weight NUMERIC DEFAULT 1,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(src_id, dst_id, relation_type)
);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  sui_object_id TEXT,
  owner_address TEXT,
  name TEXT,
  metadata JSONB,
  reputation NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ
);

CREATE TABLE research_reports (
  id TEXT PRIMARY KEY,
  sui_object_id TEXT UNIQUE,
  agent TEXT NOT NULL,
  asset_id TEXT REFERENCES research_assets(id),
  title TEXT,
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'encrypted', 'private_delegation')),
  required_tier INTEGER DEFAULT 0,
  walrus_blob_id TEXT NOT NULL,
  seal_id TEXT,
  ciphertext_hash TEXT,
  plaintext_commitment TEXT,
  free_preview_hash TEXT,
  delegation_job_id TEXT,
  created_at TIMESTAMPTZ
);

CREATE TABLE agent_channels (
  id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  metadata_hash TEXT,
  created_at TIMESTAMPTZ
);

CREATE TABLE platform_memberships (
  pass_id TEXT PRIMARY KEY,
  owner_address TEXT,
  tier INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);

CREATE TABLE agent_subscriptions (
  pass_id TEXT PRIMARY KEY,
  owner_address TEXT,
  agent TEXT NOT NULL,
  tier INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);

CREATE TABLE access_receipts (
  id TEXT PRIMARY KEY,
  period_id BIGINT NOT NULL,
  user_address TEXT NOT NULL,
  report_id TEXT REFERENCES research_reports(id),
  agent TEXT NOT NULL,
  access_type TEXT NOT NULL CHECK (access_type IN ('platform_member', 'agent_subscription')),
  created_at TIMESTAMPTZ,
  UNIQUE(period_id, user_address, report_id)
);

CREATE TABLE delegation_jobs (
  id TEXT PRIMARY KEY,
  buyer TEXT NOT NULL,
  agent TEXT NOT NULL,
  budget NUMERIC DEFAULT 0,
  deadline_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  result_report_id TEXT REFERENCES research_reports(id),
  arbitrator TEXT,
  payout NUMERIC DEFAULT 0,
  refund NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);

CREATE TABLE membership_settlements (
  id TEXT PRIMARY KEY,
  period_id BIGINT NOT NULL,
  user_address TEXT NOT NULL,
  report_id TEXT REFERENCES research_reports(id),
  agent TEXT,
  report_count INTEGER DEFAULT 0,
  net_amount NUMERIC DEFAULT 0,
  amount_per_report NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ
);

CREATE TABLE agent_earnings (
  agent TEXT PRIMARY KEY,
  total_earned NUMERIC DEFAULT 0,
  total_claimed NUMERIC DEFAULT 0,
  updated_at TIMESTAMPTZ
);

CREATE TABLE search_documents (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  title TEXT,
  body TEXT,
  tags TEXT[],
  metadata JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);
