import fs from "node:fs/promises";
import path from "node:path";
import {
  type AgentPassport,
  type AuthLoginIntent,
  type AuthState,
  type CliAuthSession,
  type GithubRepositoryBinding,
  type IndexState,
  type PlatformAccount,
  type ProtocolEvent,
  type SuiEventPollerState
} from "./types.js";
import { DEFAULT_LOCALNET_DIR } from "./paths.js";
import { pathExists, readJsonFile, writeJsonFile } from "./fs.js";
import { shortHash } from "./crypto.js";

export interface LocalStorePaths {
  root: string;
  walrusDir: string;
  eventsPath: string;
  indexPath: string;
  paymentsPath: string;
  authPath: string;
  suiEventCursorPath: string;
}

export function localStorePaths(root = DEFAULT_LOCALNET_DIR): LocalStorePaths {
  return {
    root,
    walrusDir: path.join(root, "walrus"),
    eventsPath: path.join(root, "events.ndjson"),
    indexPath: path.join(root, "index.json"),
    paymentsPath: path.join(root, "payments.json"),
    authPath: path.join(root, "auth.json"),
    suiEventCursorPath: path.join(root, "sui-event-cursors.json")
  };
}

export function emptyIndexState(): IndexState {
  return {
    events: [],
    assets: {},
    skills: {},
    relationships: {},
    agents: {},
    reports: {},
    agent_channels: {},
    platform_memberships: {},
    agent_subscriptions: {},
    access_receipts: {},
    delegations: {},
    membership_settlements: {},
    agent_earnings: {},
    revenue_pools: {},
    payments: {},
    reputations: {},
    badges: {},
    search_documents: {},
    processed_event_keys: [],
    updated_at: new Date(0).toISOString()
  };
}

/// Backfill maps that may be missing from an index.json written by an older version,
/// so consumers never hit `undefined` on the newer fields.
export function hydrateIndexState(index: IndexState): IndexState {
  const base = emptyIndexState();
  return {
    ...base,
    ...index,
    assets: index.assets ?? base.assets,
    skills: index.skills ?? base.skills,
    relationships: index.relationships ?? base.relationships,
    agents: index.agents ?? base.agents,
    reports: index.reports ?? base.reports,
    agent_channels: index.agent_channels ?? base.agent_channels,
    platform_memberships: index.platform_memberships ?? base.platform_memberships,
    agent_subscriptions: index.agent_subscriptions ?? base.agent_subscriptions,
    access_receipts: index.access_receipts ?? base.access_receipts,
    delegations: index.delegations ?? base.delegations,
    membership_settlements: index.membership_settlements ?? base.membership_settlements,
    agent_earnings: index.agent_earnings ?? base.agent_earnings,
    revenue_pools: index.revenue_pools ?? base.revenue_pools,
    payments: index.payments ?? base.payments,
    reputations: index.reputations ?? base.reputations,
    badges: index.badges ?? base.badges,
    search_documents: index.search_documents ?? base.search_documents,
    events: index.events ?? base.events,
    processed_event_keys: index.processed_event_keys ?? base.processed_event_keys
  };
}

export function emptyAuthState(): AuthState {
  return {
    intents: {},
    accounts: {}
  };
}

export function emptySuiEventPollerState(): SuiEventPollerState {
  return {
    module_cursors: {},
    last_checkpoints: {},
    pages_fetched: 0,
    events_seen: 0,
    events_ingested: 0,
    updated_at: new Date(0).toISOString()
  };
}

export async function ensureLocalStore(root = DEFAULT_LOCALNET_DIR): Promise<LocalStorePaths> {
  const paths = localStorePaths(root);
  await fs.mkdir(paths.walrusDir, { recursive: true });
  if (!(await pathExists(paths.eventsPath))) {
    await fs.writeFile(paths.eventsPath, "", "utf8");
  }
  if (!(await pathExists(paths.indexPath))) {
    await writeJsonFile(paths.indexPath, emptyIndexState());
  }
  if (!(await pathExists(paths.paymentsPath))) {
    await writeJsonFile(paths.paymentsPath, []);
  }
  if (!(await pathExists(paths.authPath))) {
    await writeJsonFile(paths.authPath, emptyAuthState());
  }
  if (!(await pathExists(paths.suiEventCursorPath))) {
    await writeJsonFile(paths.suiEventCursorPath, emptySuiEventPollerState());
  }
  return paths;
}

export async function appendEvents(events: ProtocolEvent[], root = DEFAULT_LOCALNET_DIR): Promise<void> {
  const paths = await ensureLocalStore(root);
  const body = events.map((event) => JSON.stringify(event)).join("\n");
  await fs.appendFile(paths.eventsPath, body ? `${body}\n` : "", "utf8");
}

export async function readEvents(root = DEFAULT_LOCALNET_DIR): Promise<ProtocolEvent[]> {
  const paths = await ensureLocalStore(root);
  const body = await fs.readFile(paths.eventsPath, "utf8");
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ProtocolEvent);
}

export async function readIndex(root = DEFAULT_LOCALNET_DIR): Promise<IndexState> {
  const paths = await ensureLocalStore(root);
  return hydrateIndexState(await readJsonFile<IndexState>(paths.indexPath, emptyIndexState()));
}

export async function writeIndex(index: IndexState, root = DEFAULT_LOCALNET_DIR): Promise<void> {
  const paths = await ensureLocalStore(root);
  await writeJsonFile(paths.indexPath, index);
}

export async function readAuthState(root = DEFAULT_LOCALNET_DIR): Promise<AuthState> {
  const paths = await ensureLocalStore(root);
  return readJsonFile<AuthState>(paths.authPath, emptyAuthState());
}

export async function writeAuthState(auth: AuthState, root = DEFAULT_LOCALNET_DIR): Promise<void> {
  const paths = await ensureLocalStore(root);
  await writeJsonFile(paths.authPath, auth);
}

export async function readSuiEventPollerState(root = DEFAULT_LOCALNET_DIR): Promise<SuiEventPollerState> {
  const paths = await ensureLocalStore(root);
  return {
    ...emptySuiEventPollerState(),
    ...(await readJsonFile<SuiEventPollerState>(paths.suiEventCursorPath, emptySuiEventPollerState()))
  };
}

export async function writeSuiEventPollerState(state: SuiEventPollerState, root = DEFAULT_LOCALNET_DIR): Promise<void> {
  const paths = await ensureLocalStore(root);
  await writeJsonFile(paths.suiEventCursorPath, state);
}

export async function upsertAuthIntent(intent: AuthLoginIntent, root = DEFAULT_LOCALNET_DIR): Promise<AuthLoginIntent> {
  const auth = await readAuthState(root);
  auth.intents[intent.id] = intent;
  await writeAuthState(auth, root);
  return intent;
}

export async function upsertPlatformAccount(account: PlatformAccount, root = DEFAULT_LOCALNET_DIR): Promise<PlatformAccount> {
  const auth = await readAuthState(root);
  auth.accounts[account.id] = account;
  await writeAuthState(auth, root);
  return account;
}

function findAccountBySuiAddress(auth: AuthState, suiAddress: string): PlatformAccount | undefined {
  return Object.values(auth.accounts).find((account) =>
    account.zklogin?.address === suiAddress ||
    account.wallets.some((wallet) => wallet.chain === "sui" && wallet.address === suiAddress) ||
    account.github_bindings?.some((binding) => binding.sui_address === suiAddress)
  );
}

export async function upsertGithubRepositoryBinding(
  binding: GithubRepositoryBinding,
  root = DEFAULT_LOCALNET_DIR
): Promise<PlatformAccount> {
  const auth = await readAuthState(root);
  const now = new Date().toISOString();
  const existing = findAccountBySuiAddress(auth, binding.sui_address);
  const account: PlatformAccount = existing ?? {
    id: `acct:${shortHash(`github-binding:${binding.sui_address}`, 18)}`,
    display_name: binding.github_login ?? binding.account ?? binding.sui_address,
    primary_provider: "github",
    wallets: [{ chain: "sui", address: binding.sui_address, verified_by: "zklogin" }],
    roles: ["user"],
    created_at: now,
    updated_at: now
  };
  const bindings = account.github_bindings ?? [];
  const nextBinding = {
    ...binding,
    created_at: bindings.find((candidate) => candidate.installation_id === binding.installation_id)?.created_at ?? binding.created_at,
    updated_at: now
  };
  account.github_bindings = [
    ...bindings.filter((candidate) => candidate.installation_id !== binding.installation_id),
    nextBinding
  ];
  account.updated_at = now;
  auth.accounts[account.id] = account;
  await writeAuthState(auth, root);
  return account;
}

export async function writeCliAuthSession(session: CliAuthSession | undefined, root = DEFAULT_LOCALNET_DIR): Promise<void> {
  const auth = await readAuthState(root);
  if (session) {
    auth.cli_session = session;
  } else {
    delete auth.cli_session;
  }
  await writeAuthState(auth, root);
}

export async function upsertAgent(agent: AgentPassport, root = DEFAULT_LOCALNET_DIR): Promise<AgentPassport> {
  const index = await readIndex(root);
  index.agents[agent.id] = agent;
  index.search_documents[agent.id] = {
    id: agent.id,
    entity_type: "agent",
    entity_id: agent.id,
    title: agent.name,
    body: JSON.stringify(agent.metadata),
    metadata: { owner_address: agent.owner_address },
    updated_at: new Date().toISOString()
  };
  index.updated_at = new Date().toISOString();
  await writeIndex(index, root);
  return agent;
}
