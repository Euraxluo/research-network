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
  license TEXT,
  price_policy JSONB,
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

CREATE TABLE licenses (
  id TEXT PRIMARY KEY,
  sui_object_id TEXT UNIQUE,
  skill_id TEXT REFERENCES skills(id),
  owner_address TEXT,
  license_type TEXT,
  expires_at TIMESTAMPTZ,
  commercial BOOLEAN,
  agent_allowed BOOLEAN,
  seats INTEGER
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
