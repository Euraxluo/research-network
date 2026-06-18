// GitHub account/organization scope + repo selection logic.
// Ported verbatim from web-workbench.ts accountItems/repoItems/selectedRepo so
// the org-multiselect -> repo-dropdown UX stays byte-identical during M2.

import type { GithubBinding, GithubInstallation, GithubRepoRef } from "./types.js";

export function repoOwner(name: string): string {
  const parts = String(name || "").split("/");
  return parts.length > 1 ? parts[0] : "";
}

export function syntheticScopeId(account?: string | null): string {
  return "owner:" + String(account || "GitHub");
}

export interface AccountScopeItem {
  id: string;
  account: string;
  accountType: string;
  installed: boolean;
  repos: string[];
}

export function accountItems(gh: GithubBinding | null): AccountScopeItem[] {
  if (!gh) return [];
  // Bind to a non-null const so the nested addRepo closure keeps the narrowed
  // type (TS does not carry parameter narrowing into nested function scopes).
  const binding: GithubBinding = gh;
  const scopes = Array.isArray(binding.organization_scopes) ? binding.organization_scopes : [];
  if (scopes.length) {
    return scopes
      .map((scope) => ({
        id: String(scope.id || scope.installation_id || "uninstalled:" + scope.account),
        account: scope.account || "GitHub",
        accountType: scope.accountType || scope.account_type || "Account",
        installed: scope.installed !== false,
        repos: Array.isArray(scope.repos) ? scope.repos : []
      }))
      .sort((a, b) => {
        if (a.installed !== b.installed) return a.installed ? -1 : 1;
        return a.account.localeCompare(b.account);
      });
  }

  const installations = Array.isArray(binding.installations) ? binding.installations : [];
  if (installations.length) {
    const byAccount: Record<string, AccountScopeItem> = {};
    installations.forEach((installation) => {
      const account = installation.account || "GitHub";
      const accountType = installation.accountType || installation.account_type || "Account";
      const key = account + "\u0000" + accountType;
      if (!byAccount[key]) {
        byAccount[key] = {
          id: String(installation.id),
          account,
          accountType,
          installed: true,
          repos: []
        };
      }
      (installation.repos || []).forEach((repo) => {
        if (byAccount[key].repos.indexOf(repo) === -1) byAccount[key].repos.push(repo);
      });
    });
    return Object.keys(byAccount).map((key) => byAccount[key]);
  }

  const accounts: Record<string, AccountScopeItem> = {};
  const scopeByOwner: Record<string, string> = {};

  function addRepo(
    name: string,
    installationId: number | string | null,
    account: string | null,
    accountType: string | null
  ): void {
    if (!name) return;
    const owner = repoOwner(name) || account || binding.login || "GitHub";
    const resolvedType =
      (account && owner === account ? accountType : null) ||
      (binding.login && owner === binding.login ? "User" : "Account") ||
      "Account";
    const existingId = scopeByOwner[owner];
    const id = installationId ? String(installationId) : existingId || syntheticScopeId(owner);
    if (installationId && existingId && existingId !== id && accounts[existingId]) {
      accounts[id] = accounts[existingId];
      accounts[id].id = id;
      delete accounts[existingId];
    }
    scopeByOwner[owner] = id;
    if (!accounts[id]) {
      accounts[id] = { id, account: owner, accountType: resolvedType, installed: true, repos: [] };
    }
    if (accounts[id].repos.indexOf(name) === -1) accounts[id].repos.push(name);
  }

  (binding.available_repos || []).forEach((repo) => {
    const name = typeof repo === "string" ? repo : repo.full_name;
    const granted = typeof repo === "string" ? true : repo.granted !== false;
    if (!granted) return;
    addRepo(
      name,
      typeof repo === "string" ? (binding.installation_id ?? null) : (repo.installation_id ?? null),
      typeof repo === "string" ? binding.account || null : repo.installation_account || null,
      typeof repo === "string" ? binding.account_type || null : repo.installation_account_type || null
    );
  });
  (binding.repos || []).forEach((name) => {
    addRepo(name, binding.installation_id || null, binding.account || null, binding.account_type || null);
  });
  return Object.keys(accounts)
    .map((id) => accounts[id])
    .sort((a, b) => a.account.localeCompare(b.account));
}

export function selectedInstallationIds(gh: GithubBinding | null): string[] {
  const items = accountItems(gh);
  const selectable = items.filter((item) => item.installed !== false);
  const selected = Array.isArray(gh?.selected_installation_ids)
    ? (gh!.selected_installation_ids as (number | string)[])
    : selectable.map((item) => item.id);
  const valid: Record<string, boolean> = {};
  selectable.forEach((item) => {
    valid[String(item.id)] = true;
  });
  const normalized = selected
    .map((id) => String(id))
    .filter((id) => valid[id]);
  if (Array.isArray(gh?.selected_installation_ids) && selected.length > 0 && !normalized.length) {
    return selectable.map((item) => String(item.id));
  }
  return normalized;
}

export interface RepoItem {
  full_name: string;
  installation_id: string | number;
  installation_account: string | null;
  installation_account_type: string | null;
}

export function repoItems(gh: GithubBinding | null): RepoItem[] {
  if (!gh) return [];
  const seen: Record<string, boolean> = {};
  const out: RepoItem[] = [];
  const selected: Record<string, boolean> = {};
  selectedInstallationIds(gh).forEach((id) => {
    selected[String(id)] = true;
  });

  (gh.installations || []).forEach((installation: GithubInstallation) => {
    const id = installation && installation.id;
    if (!id || !selected[String(id)]) return;
    (installation.repos || []).forEach((name) => {
      if (!name || seen[name]) return;
      seen[name] = true;
      out.push({
        full_name: name,
        installation_id: id,
        installation_account: installation.account || null,
        installation_account_type: installation.accountType || installation.account_type || null
      });
    });
  });

  (gh.available_repos || []).forEach((repo) => {
    const name = typeof repo === "string" ? repo : repo.full_name;
    const account =
      typeof repo === "string"
        ? repoOwner(name) || gh.account || null
        : repo.installation_account || repoOwner(name) || null;
    const accountType =
      typeof repo === "string" ? gh.account_type || null : repo.installation_account_type || null;
    const installationId =
      typeof repo === "string" ? gh.installation_id : repo.installation_id || null;
    const scopeId = installationId ? String(installationId) : syntheticScopeId(account);
    const granted = typeof repo === "string" ? true : repo.granted !== false;
    if (!name || seen[name] || !granted || !selected[scopeId]) return;
    seen[name] = true;
    out.push({
      full_name: name,
      installation_id: (installationId as string | number) || scopeId,
      installation_account: account,
      installation_account_type: accountType
    });
  });

  const fallbackInstallationId = gh.installation_id ? String(gh.installation_id) : "";
  const hasInstallations = Boolean(gh.installations && gh.installations.length);
  (gh.repos || []).forEach((name) => {
    if (!name || seen[name]) return;
    const account = repoOwner(name) || gh.account || null;
    const scopeId = fallbackInstallationId || syntheticScopeId(account);
    if (hasInstallations && (!fallbackInstallationId || !selected[fallbackInstallationId])) return;
    if (!selected[scopeId]) return;
    seen[name] = true;
    out.push({
      full_name: name,
      installation_id: gh.installation_id || scopeId,
      installation_account: account,
      installation_account_type: gh.account && account === gh.account ? gh.account_type || null : null
    });
  });

  out.sort((a, b) => a.full_name.localeCompare(b.full_name));
  return out;
}

export function selectedRepo(gh: GithubBinding | null): RepoItem | null {
  const repos = repoItems(gh);
  const selected = gh?.selected_repo;
  for (let i = 0; selected && i < repos.length; i += 1) {
    if (repos[i].full_name === selected) return repos[i];
  }
  return repos[0] || null;
}

export function persistRepoSelection(gh: GithubBinding | null, repo: RepoItem | null): GithubBinding | null {
  if (!gh || !repo) return gh;
  gh.selected_repo = repo.full_name;
  const installationKey = repo.installation_id ? String(repo.installation_id) : "";
  if (repo.installation_id && !String(repo.installation_id).startsWith("owner:")) {
    gh.installation_id = Number(repo.installation_id || gh.installation_id || 0);
  }
  gh.account = repo.installation_account || gh.account || null;
  gh.account_type = repo.installation_account_type || gh.account_type || null;
  const installation = (gh.installations || []).find(
    (item) => String(item.id) === String(repo.installation_id)
  );
  if (installation && installation.repos) gh.repos = installation.repos;
  const attestation = installationKey ? gh.binding_attestations?.[installationKey] : null;
  if (attestation) {
    gh.binding_attestation = attestation.binding_attestation || gh.binding_attestation;
    gh.binding_attestation_payload = attestation.binding_attestation_payload || gh.binding_attestation_payload;
  }
  localStorage.setItem("rn_github", JSON.stringify(gh));
  return gh;
}
