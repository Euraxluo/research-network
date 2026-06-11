import fs from "node:fs/promises";
import path from "node:path";
import {
  type AgentPassport,
  type AuthLoginIntent,
  type AuthState,
  type IndexState,
  type LicenseRecord,
  type PlatformAccount,
  type ProtocolEvent
} from "./types.js";
import { DEFAULT_LOCALNET_DIR } from "./paths.js";
import { pathExists, readJsonFile, writeJsonFile } from "./fs.js";

export interface LocalStorePaths {
  root: string;
  walrusDir: string;
  eventsPath: string;
  indexPath: string;
  paymentsPath: string;
  authPath: string;
}

export function localStorePaths(root = DEFAULT_LOCALNET_DIR): LocalStorePaths {
  return {
    root,
    walrusDir: path.join(root, "walrus"),
    eventsPath: path.join(root, "events.ndjson"),
    indexPath: path.join(root, "index.json"),
    paymentsPath: path.join(root, "payments.json"),
    authPath: path.join(root, "auth.json")
  };
}

export function emptyIndexState(): IndexState {
  return {
    events: [],
    assets: {},
    skills: {},
    relationships: {},
    agents: {},
    licenses: {},
    search_documents: {},
    processed_event_keys: [],
    updated_at: new Date(0).toISOString()
  };
}

export function emptyAuthState(): AuthState {
  return {
    intents: {},
    accounts: {}
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
  return readJsonFile<IndexState>(paths.indexPath, emptyIndexState());
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

export async function upsertAgent(agent: AgentPassport, root = DEFAULT_LOCALNET_DIR): Promise<AgentPassport> {
  const index = await readIndex(root);
  index.agents[agent.id] = agent;
  index.search_documents[agent.id] = {
    id: agent.id,
    entity_type: "agent",
    entity_id: agent.id,
    title: agent.name,
    body: JSON.stringify(agent.metadata),
    tags: ["agent"],
    metadata: { owner_address: agent.owner_address },
    updated_at: new Date().toISOString()
  };
  index.updated_at = new Date().toISOString();
  await writeIndex(index, root);
  return agent;
}

export async function upsertLicense(license: LicenseRecord, root = DEFAULT_LOCALNET_DIR): Promise<LicenseRecord> {
  const index = await readIndex(root);
  index.licenses[license.id] = license;
  index.updated_at = new Date().toISOString();
  await writeIndex(index, root);
  return license;
}
