import { useEffect, useMemo, useRef, useState } from "react";
import { readGithub, readSession, writeJson } from "../lib/storage";
import {
  accountItems,
  persistRepoSelection,
  repoItems,
  selectedInstallationIds,
  selectedRepo,
  type RepoItem
} from "../lib/github-scope";
import type { GithubBinding, ZkLoginSession } from "../lib/types";

interface LiveIndexAsset {
  id?: string;
  title?: string;
  authors?: string;
  href?: string;
  created_at?: string;
  abstract?: string;
  tags?: string[];
  manifest_hash?: string;
  repo_url?: string;
  repo_commit?: string;
  sui_object_id?: string;
  tx_digest?: string;
  tx_sender?: string;
  event_owner_address?: string;
  creator_address?: string;
  walrus_blob_id?: string;
}

interface LiveIndexEvent {
  event_type?: string;
  created_at?: string;
  tx_digest?: string;
  signer?: string;
  gas_owner?: string;
  subject_address?: string;
  object_id?: string;
  agent_address?: string;
  job_id?: string;
  buyer?: string;
  agent?: string;
  arbitrator?: string;
  report_id?: string;
  budget_mist?: string;
  amount_mist?: string;
  sui_spent_mist?: string;
}

interface LiveIndexResponse {
  generated_at?: string;
  source?: string;
  assets?: LiveIndexAsset[];
  membership?: {
    counts?: Record<string, number>;
    recent_events?: LiveIndexEvent[];
  };
  delegations?: {
    counts?: Record<string, number>;
    recent_events?: LiveIndexEvent[];
  };
}

type LiveStatus = "idle" | "loading" | "ready" | "error";

function storageItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function hasServerAttestation(gh: GithubBinding | null): boolean {
  const payload = gh?.binding_attestation_payload as { sub?: string; installation_id?: number | string } | undefined;
  return Boolean(
    gh &&
      gh.binding_attestation &&
      payload &&
      payload.sub === gh.sui_address &&
      String(payload.installation_id) === String(gh.installation_id)
  );
}

async function verifyServerAttestation(gh: GithubBinding | null): Promise<boolean> {
  if (!gh?.binding_attestation) return false;
  try {
    const res = await fetch("/api/github-binding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        binding_attestation: gh.binding_attestation,
        sui_address: gh.sui_address,
        installation_id: Number(gh.installation_id),
        repos: gh.repos || []
      })
    });
    if (!res.ok) return false;
    const body = await res.json();
    const payload = body?.payload as { sub?: string; installation_id?: number | string } | undefined;
    return Boolean(
      body?.valid &&
        payload &&
        payload.sub === gh.sui_address &&
        String(payload.installation_id) === String(gh.installation_id)
    );
  } catch {
    return false;
  }
}

async function fetchLiveIndex(): Promise<LiveIndexResponse> {
  const res = await fetch("/api/index?limit=20", { cache: "no-store" });
  if (!res.ok) throw new Error("index API HTTP " + res.status);
  return await res.json() as LiveIndexResponse;
}

function shortText(value: string | undefined, head = 10, tail = 8): string {
  const text = value || "";
  if (!text || text.length <= head + tail + 3) return text;
  return text.slice(0, head) + "..." + text.slice(-tail);
}

function normalizeAddress(value: string | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function sameAddress(left: string | undefined, right: string | undefined): boolean {
  const a = normalizeAddress(left);
  const b = normalizeAddress(right);
  return Boolean(a && b && a === b);
}

function formatDate(value: string | undefined): string {
  if (!value) return "live";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function repoFullNames(gh: GithubBinding | null): string[] {
  if (!gh) return [];
  const names = new Set<string>();
  (gh.repos || []).forEach((name) => names.add(name.toLowerCase()));
  (gh.available_repos || []).forEach((repo) => {
    const name = typeof repo === "string" ? repo : repo.full_name;
    if (name) names.add(name.toLowerCase());
  });
  (gh.installations || []).forEach((installation) => {
    (installation.repos || []).forEach((name) => names.add(name.toLowerCase()));
  });
  return [...names];
}

function githubHandles(gh: GithubBinding | null): string[] {
  if (!gh) return [];
  const handles = new Set<string>();
  if (gh.login) handles.add(gh.login.toLowerCase());
  if (gh.account) handles.add(gh.account.toLowerCase());
  accountItems(gh).forEach((account) => {
    if (account.account) handles.add(String(account.account).toLowerCase());
  });
  return [...handles];
}

function repoMatchesAsset(asset: LiveIndexAsset, repos: string[]): boolean {
  const repoUrl = String(asset.repo_url || "").toLowerCase().replace(/\.git$/, "").replace(/\/$/, "");
  if (!repoUrl) return false;
  return repos.some((repo) => repoUrl.endsWith("/" + repo));
}

function handleMatchesAsset(asset: LiveIndexAsset, handles: string[]): boolean {
  const haystack = [asset.authors, asset.repo_url].filter(Boolean).join(" ").toLowerCase();
  return handles.some((handle) => haystack.includes("@" + handle) || haystack.includes("github.com/" + handle + "/"));
}

function assetBelongsToProfile(asset: LiveIndexAsset, session: ZkLoginSession, gh: GithubBinding | null): boolean {
  const address = session.address;
  if (
    sameAddress(asset.tx_sender, address) ||
    sameAddress(asset.event_owner_address, address) ||
    sameAddress(asset.creator_address, address)
  ) {
    return true;
  }
  const usableGithub = gh?.sui_address === address ? gh : null;
  return repoMatchesAsset(asset, repoFullNames(usableGithub)) || handleMatchesAsset(asset, githubHandles(usableGithub));
}

function eventBelongsToProfile(event: LiveIndexEvent, session: ZkLoginSession): boolean {
  const address = session.address;
  return [
    event.signer,
    event.gas_owner,
    event.subject_address,
    event.agent_address,
    event.buyer,
    event.agent,
    event.arbitrator
  ].some((item) => sameAddress(item, address));
}

function assetHref(asset: LiveIndexAsset): string {
  if (asset.href) return asset.href;
  const id = asset.sui_object_id || asset.id;
  return id ? "/asset.html?id=" + encodeURIComponent(id) : "/search.html";
}

function explorerTx(tx: string | undefined): string | undefined {
  return tx ? "https://suiscan.xyz/testnet/tx/" + tx : undefined;
}

function explorerObject(id: string | undefined): string | undefined {
  return id ? "https://suiscan.xyz/testnet/object/" + id : undefined;
}

function eventAmount(event: LiveIndexEvent): string {
  const value = event.budget_mist || event.amount_mist || event.sui_spent_mist;
  if (!value) return "event";
  const mist = Number(value);
  if (!Number.isFinite(mist)) return value + " MIST";
  return (mist / 1_000_000_000).toFixed(4).replace(/0+$/, "").replace(/\.$/, "") + " SUI";
}

export function AccountPage() {
  const [session, setSession] = useState<ZkLoginSession | null>(() => readSession());
  const [gh, setGh] = useState<GithubBinding | null>(() => readGithub());
  const sessionRaw = useRef<string | null>(storageItem("rn_session"));
  const githubRaw = useRef<string | null>(storageItem("rn_github"));
  const [attested, setAttested] = useState<boolean>(() => hasServerAttestation(readGithub()));
  const [checking, setChecking] = useState<boolean>(() => hasServerAttestation(readGithub()));
  const [liveIndex, setLiveIndex] = useState<LiveIndexResponse | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("idle");
  const [liveError, setLiveError] = useState<string>("");

  useEffect(() => {
    if (!hasServerAttestation(gh)) {
      setChecking(false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    verifyServerAttestation(gh).then((valid) => {
      if (cancelled) return;
      setAttested(valid);
      setChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [gh]);

  useEffect(() => {
    if (!session?.address || typeof fetch !== "function") {
      setLiveStatus("idle");
      return;
    }
    let cancelled = false;
    setLiveStatus("loading");
    setLiveError("");
    fetchLiveIndex().then((data) => {
      if (cancelled) return;
      setLiveIndex(data);
      setLiveStatus("ready");
    }).catch((error) => {
      if (cancelled) return;
      setLiveIndex(null);
      setLiveStatus("error");
      setLiveError(error instanceof Error ? error.message : "request failed");
    });
    return () => {
      cancelled = true;
    };
  }, [session?.address]);

  // Periodically re-sync from localStorage so post-OAuth redirect writes show up.
  useEffect(() => {
    const id = window.setInterval(() => {
      const nextSessionRaw = storageItem("rn_session");
      if (nextSessionRaw !== sessionRaw.current) {
        sessionRaw.current = nextSessionRaw;
        setSession(readSession());
      }
      const nextGithubRaw = storageItem("rn_github");
      if (nextGithubRaw !== githubRaw.current) {
        githubRaw.current = nextGithubRaw;
        setGh(readGithub());
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!session?.address) {
    return (
      <div className="account-shell">
        <section className="account-profile">
          <div className="account-avatar">RN</div>
          <div className="account-profile-main">
            <p className="account-kicker">Profile</p>
            <h1>Account</h1>
            <p className="muted">Not signed in.</p>
          </div>
          <a className="button" href="/login.html">
            Sign in with Google (zkLogin)
          </a>
        </section>
      </div>
    );
  }

  function signOut() {
    ["rn_session", "rn_github", "rn_zk_attestation", "rn_gh_state"].forEach((k) => localStorage.removeItem(k));
    ["rn_zk_session", "rn_zk_eph", "rn_oauth_state", "rn_gh_state"].forEach((k) => sessionStorage.removeItem(k));
    location.href = "/login.html";
  }

  const connected = Boolean(gh && gh.sui_address === session.address && gh.installation_id);
  const displayName = connected && gh?.login ? "@" + gh.login : session.email || "Sui profile";
  const selected = gh ? selectedRepo(gh) : null;
  const accounts = gh && gh.sui_address === session.address ? accountItems(gh) : [];
  const assets = liveIndex?.assets || [];
  const ownAssets = assets.filter((asset) => assetBelongsToProfile(asset, session, gh));
  const membershipEvents = (liveIndex?.membership?.recent_events || []).filter((event) => eventBelongsToProfile(event, session));
  const delegationEvents = (liveIndex?.delegations?.recent_events || []).filter((event) => eventBelongsToProfile(event, session));
  const relatedEvents = [...membershipEvents, ...delegationEvents]
    .sort((a, b) => Date.parse(b.created_at || "") - Date.parse(a.created_at || ""))
    .slice(0, 8);

  return (
    <div className="account-shell">
      <section className="account-profile">
        <div className="account-avatar">{profileInitial(displayName)}</div>
        <div className="account-profile-main">
          <p className="account-kicker">Current profile</p>
          <h1>{displayName}</h1>
          <p className="account-subtitle">
            {session.email || session.provider || "zkLogin"} · {shortText(session.address, 12, 10)}
          </p>
        </div>
        <div className="account-profile-actions">
          <a className="button" href="/workbench.html">
            Open Workbench
          </a>
          <button className="button" id="signout" type="button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </section>

      <div className="account-grid">
        <section className="account-panel account-panel-wide">
          <div className="account-panel-head">
            <div>
              <p className="account-kicker">Accounts</p>
              <h2>Identity and scopes</h2>
            </div>
            <span className="chain-status chain-status-verified">current</span>
          </div>
          <div className="account-list">
            <AccountRow
              title="Sui identity"
              label="zkLogin address"
              detail={session.address}
              meta={session.iss || session.provider || "google"}
            />
            {session.email ? (
              <AccountRow title="Google profile" label={session.email} detail="OAuth subject binds to the same Sui address" />
            ) : null}
            {connected && gh ? (
              <AccountRow
                title="GitHub profile"
                label={gh.login ? "@" + gh.login : "GitHub"}
                detail={selected ? selected.full_name : repoItems(gh).length + " authorized repo(s)"}
                meta={checking ? "checking attestation" : attested ? "server-attested" : "local binding"}
              />
            ) : (
              <AccountRow title="GitHub profile" label="Not connected" detail="Connect GitHub to bind repos to this Sui profile" />
            )}
            {accounts.map((account) => (
              <AccountRow
                key={String(account.id)}
                title={account.accountType || "GitHub scope"}
                label={account.account}
                detail={account.installed === false ? "Not authorized yet" : account.repos.length + " authorized repo(s)"}
                meta={String(account.id)}
              />
            ))}
          </div>
        </section>

        <section className="account-panel">
          <div className="account-panel-head">
            <div>
              <p className="account-kicker">Live index</p>
              <h2>My assets</h2>
            </div>
            <span className={"chain-status " + (liveStatus === "ready" ? "chain-status-verified" : "chain-status-pending")}>
              {liveStatus}
            </span>
          </div>
          <AccountLiveAssets status={liveStatus} error={liveError} assets={ownAssets} allAssetCount={assets.length} />
        </section>

        <section className="account-panel">
          <div className="account-panel-head">
            <div>
              <p className="account-kicker">Protocol activity</p>
              <h2>Recent proofs</h2>
            </div>
          </div>
          <AccountEvents status={liveStatus} events={relatedEvents} />
        </section>
      </div>

      <section className="account-panel account-panel-wide">
        <div className="account-panel-head">
          <div>
            <p className="account-kicker">Repository access</p>
            <h2>Connected GitHub repositories</h2>
          </div>
        </div>
        {connected && gh ? (
          <AccountGithubControls
            gh={gh}
            attested={attested}
            checking={checking}
            onChange={setGh}
          />
        ) : (
          <p>
            <a className="button" href="/login.html">
              Connect GitHub
            </a>
          </p>
        )}
      </section>
    </div>
  );
}

function profileInitial(value: string): string {
  const normalized = value.replace(/^@/, "").trim();
  return (normalized.slice(0, 2) || "RN").toUpperCase();
}

function AccountRow({ title, label, detail, meta }: { title: string; label: string; detail: string; meta?: string }) {
  return (
    <div className="account-row">
      <div>
        <p className="account-row-title">{title}</p>
        <strong>{label}</strong>
        <p className="muted">{detail}</p>
      </div>
      {meta ? <code>{shortText(meta, 14, 8)}</code> : null}
    </div>
  );
}

function AccountLiveAssets({
  status,
  error,
  assets,
  allAssetCount
}: {
  status: LiveStatus;
  error: string;
  assets: LiveIndexAsset[];
  allAssetCount: number;
}) {
  if (status === "loading" || status === "idle") {
    return <p className="muted">Loading live assets from /api/index...</p>;
  }
  if (status === "error") {
    return <p className="muted">Could not load live index: {error}</p>;
  }
  if (!assets.length) {
    return (
      <div className="account-empty">
        <strong>No live assets tied to this profile yet.</strong>
        <p className="muted">
          The backend returned {allAssetCount} live asset(s), but none matched this Sui address or connected GitHub scope.
        </p>
      </div>
    );
  }
  return (
    <ul className="account-asset-list">
      {assets.map((asset) => (
        <li key={asset.sui_object_id || asset.id || asset.tx_digest}>
          <a href={assetHref(asset)}>{asset.title || asset.id || "Untitled live asset"}</a>
          <p className="muted">
            {formatDate(asset.created_at)} · {asset.repo_url || "no repo recorded"}
          </p>
          <p className="account-proof-links">
            {asset.sui_object_id ? <a href={explorerObject(asset.sui_object_id)}>object {shortText(asset.sui_object_id, 8, 6)}</a> : null}
            {asset.tx_digest ? <a href={explorerTx(asset.tx_digest)}>tx {shortText(asset.tx_digest, 8, 6)}</a> : null}
          </p>
        </li>
      ))}
    </ul>
  );
}

function AccountEvents({ status, events }: { status: LiveStatus; events: LiveIndexEvent[] }) {
  if (status === "loading" || status === "idle") {
    return <p className="muted">Loading live membership and delegation events...</p>;
  }
  if (!events.length) {
    return (
      <div className="account-empty">
        <strong>No membership or delegation event is linked to this profile yet.</strong>
        <p className="muted">Only events returned by the live Sui index are shown here.</p>
      </div>
    );
  }
  return (
    <ul className="account-event-list">
      {events.map((event, index) => (
        <li key={(event.tx_digest || "") + ":" + index}>
          <div>
            <strong>{event.event_type || "ProtocolEvent"}</strong>
            <p className="muted">{formatDate(event.created_at)} · {eventAmount(event)}</p>
          </div>
          {event.tx_digest ? <a href={explorerTx(event.tx_digest)}>tx {shortText(event.tx_digest, 8, 6)}</a> : null}
        </li>
      ))}
    </ul>
  );
}

function AccountGithubControls({
  gh,
  attested,
  checking,
  onChange
}: {
  gh: GithubBinding;
  attested: boolean;
  checking: boolean;
  onChange: (gh: GithubBinding) => void;
}) {
  const accounts = useMemo(() => accountItems(gh), [gh]);
  const selectedInstIds = useMemo(() => selectedInstallationIds(gh), [gh]);
  const selectedSet = useMemo(() => {
    const m: Record<string, boolean> = {};
    selectedInstIds.forEach((id) => {
      m[String(id)] = true;
    });
    return m;
  }, [selectedInstIds]);
  const repos = useMemo(() => repoItems(gh), [gh]);
  const current = useMemo(() => selectedRepo(gh), [gh]);
  const hasOrgScope = accounts.some((a) => String(a.accountType || "").toLowerCase() === "organization");

  const repoCount = repos.length;
  const selectedCount = selectedInstIds.length;

  function toggleAccount(id: string, checked: boolean) {
    const next: GithubBinding = { ...gh };
    const items = accountItems(gh).filter((a) => a.installed);
    const valid: Record<string, boolean> = {};
    items.forEach((a) => {
      valid[String(a.id)] = true;
    });
    const base = (gh.selected_installation_ids || []).map((x) => String(x)).filter((x) => valid[x]);
    const set = new Set(base);
    if (checked) set.add(String(id));
    else set.delete(String(id));
    let arr = Array.from(set);
    if (arr.length === 0) arr = items.map((a) => String(a.id));
    next.selected_installation_ids = arr;
    const repo = selectedRepo(next);
    if (repo) persistRepoSelection(next, repo);
    else writeJson("rn_github", next);
    onChange({ ...next });
  }

  function onRepoChange(fullName: string) {
    const match: RepoItem | null = repos.find((r) => r.full_name === fullName) || null;
    const next = persistRepoSelection({ ...gh }, match);
    onChange({ ...(next || gh) });
  }

  return (
    <>
      <p className="muted">
        {gh.login || "GitHub"} · {selectedCount} selected account/org scope(s), {repoCount} repo option(s)
        <span id="rn-account-attestation-status">
          {checking ? " · checking attestation..." : attested ? " · server-attested" : " · local binding"}
        </span>
      </p>
      <div className="repo-control">
        {accounts.length ? (
          <fieldset className="repo-account-scope" data-organization-scope={JSON.stringify(gh.organization_scopes || [])}>
            <legend>GitHub account / organization</legend>
            {accounts.map((a) => {
              const id = String(a.id);
              const label = a.account + (a.accountType ? " · " + a.accountType : "");
              const installed = a.installed !== false;
              const detail = installed ? (a.repos.length + " authorized repo(s)") : "Not authorized yet";
              return (
                <label className={"repo-account" + (installed ? "" : " unavailable")} key={id}>
                  <input
                    className="rn-account-installation-scope"
                    type="checkbox"
                    value={id}
                    checked={Boolean(selectedSet[id] && installed)}
                    disabled={!installed}
                    onChange={(e) => toggleAccount(id, e.target.checked)}
                  />
                  <span>
                    <b>{label}</b>
                    <br />
                    <span className="muted">{detail}</span>
                  </span>
                </label>
              );
            })}
            {!hasOrgScope ? (
              <p className="muted repo-account-hint">
                Organization repositories appear after installing or approving the GitHub App in that organization.
              </p>
            ) : null}
          </fieldset>
        ) : null}

        <div id="rn-account-repo-picker">
          {repos.length === 0 ? (
            <p className="muted">No repositories available in the selected accounts/orgs.</p>
          ) : (
            <>
              <label className="muted" htmlFor="rn-account-repo-select">
                Research repo
              </label>
              <br />
              <select
                id="rn-account-repo-select"
                className="repo-select"
                value={current?.full_name || ""}
                onChange={(e) => onRepoChange(e.target.value)}
              >
                {repos.map((r) => (
                  <option key={r.full_name} value={r.full_name}>
                    {r.full_name + (r.installation_account ? " · " + r.installation_account : "")}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      </div>
      <p className="repo-actions">
        <a className="button" href="/login.html">
          Refresh GitHub repos
        </a>
        <a className="button" href="/login.html">
          Add GitHub account/org access
        </a>
      </p>
    </>
  );
}
