import { useEffect, useMemo, useState } from "react";
import { readGithub, readSession, writeJson } from "../lib/storage";
import {
  accountItems,
  persistRepoSelection,
  repoItems,
  selectedInstallationIds,
  selectedRepo,
  type RepoItem
} from "../lib/github-scope";
import { downloadAcceptanceSession } from "../lib/acceptance-session";
import type { GithubBinding, ZkLoginSession } from "../lib/types";

interface AssetDirectoryItem {
  id: string;
  title: string;
  href: string;
  githubs?: string[];
}

function readDirectory(): AssetDirectoryItem[] {
  const w = window as unknown as { __ASSET_DIRECTORY__?: AssetDirectoryItem[] };
  return w.__ASSET_DIRECTORY__ || [];
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

export function AccountPage() {
  const [session, setSession] = useState<ZkLoginSession | null>(() => readSession());
  const [gh, setGh] = useState<GithubBinding | null>(() => readGithub());
  const [attested, setAttested] = useState<boolean>(() => hasServerAttestation(readGithub()));
  const [checking, setChecking] = useState<boolean>(() => hasServerAttestation(readGithub()));
  const [exportStatus, setExportStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const directory = useMemo(() => readDirectory(), []);

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

  // Periodically re-sync from localStorage so post-OAuth redirect writes show up.
  useEffect(() => {
    const id = window.setInterval(() => {
      setSession(readSession());
      setGh(readGithub());
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!session?.address) {
    return (
      <>
        <h1>Account</h1>
        <p className="muted">Not signed in.</p>
        <p>
          <a className="button" href="/login.html">
            Sign in with Google (zkLogin)
          </a>
        </p>
      </>
    );
  }

  function signOut() {
    ["rn_session", "rn_github", "rn_zk_attestation", "rn_gh_state"].forEach((k) => localStorage.removeItem(k));
    ["rn_zk_session", "rn_zk_eph", "rn_oauth_state", "rn_gh_state"].forEach((k) => sessionStorage.removeItem(k));
    location.href = "/login.html";
  }

  function exportAcceptanceSession(role: "buyer" | "agent") {
    try {
      const filename = downloadAcceptanceSession(role);
      setExportStatus({
        text: `Downloaded ${filename}. Move it to .research-network/secrets/${filename} before running production acceptance.`
      });
    } catch (error) {
      setExportStatus({
        text: error instanceof Error ? error.message : String(error),
        error: true
      });
    }
  }

  const connected = gh && gh.sui_address === session.address && gh.installation_id;
  const mine = gh?.login
    ? directory.filter((a) => (a.githubs || []).indexOf(gh.login!) !== -1)
    : [];

  return (
    <>
      <h1>Account</h1>
      <div id="account-root">
        <h2>Sui identity</h2>
        <dl className="verification">
          <div>
            <dt>zkLogin address</dt>
            <dd>{session.address}</dd>
          </div>
          {session.email ? (
            <div>
              <dt>Email</dt>
              <dd>{session.email}</dd>
            </div>
          ) : null}
          <div>
            <dt>Provider</dt>
            <dd>{session.iss || session.provider || "google"}</dd>
          </div>
        </dl>

        <h2>Production acceptance session</h2>
        <p className="muted">
          Export only from the same browser tab that completed Google zkLogin. These files contain sensitive zkLogin
          material for capped testnet/mainnet acceptance and must stay out of git.
        </p>
        <p className="repo-actions">
          <button
            className="button"
            type="button"
            data-testid="export-acceptance-buyer"
            onClick={() => exportAcceptanceSession("buyer")}
          >
            Export buyer session
          </button>
          <button
            className="button"
            type="button"
            data-testid="export-acceptance-agent"
            onClick={() => exportAcceptanceSession("agent")}
          >
            Export agent session
          </button>
        </p>
        {exportStatus ? (
          <p
            id="acceptance-session-export-status"
            className={exportStatus.error ? "error" : "muted"}
            data-testid="acceptance-session-export-status"
          >
            {exportStatus.text}
          </p>
        ) : null}

        <h2>Connected GitHub repositories</h2>
        {connected ? (
          <AccountGithubControls
            gh={gh!}
            attested={attested}
            checking={checking}
            onChange={setGh}
          />
        ) : (
          <>
            <p className="muted">No repositories connected yet.</p>
            <p>
              <a className="button" href="/login.html">
                Connect GitHub
              </a>
            </p>
          </>
        )}

        <h2>My publications</h2>
        {mine.length ? (
          <ul className="small-list">
            {mine.map((a) => (
              <li key={a.id}>
                <a href={a.href}>{a.title}</a> <span className="muted">{a.id}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            No indexed publications are linked to this account yet
            {gh?.login ? " (matched by GitHub author handle)." : " — connect GitHub so publications can be matched to you."}
          </p>
        )}

        <p style={{ marginTop: "24px" }}>
          <button className="button" id="signout" type="button" onClick={signOut}>
            Sign out
          </button>
        </p>
      </div>
    </>
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
          {checking ? " · checking attestation…" : attested ? " · server-attested" : " · local binding"}
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
