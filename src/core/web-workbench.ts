import type { IndexState } from "./types.js";

const WORKBENCH_SCRIPT_VERSION = "20260618-demo-flow-closure";

function escapeHtml(input: unknown): string {
  return String(input ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function jsonForInlineScript(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

export function renderWorkbenchBody(index: IndexState): string {
  const reports = Object.values(index.reports);
  const assets = Object.values(index.assets).map((asset) => ({
    id: asset.id,
    title: asset.title,
    author: asset.manifest.assets.authors?.[0]?.name ?? asset.owner_address,
    agent: asset.owner_address,
    href: `/abs/${encodeURIComponent(asset.id)}.html`,
    visibility: asset.manifest.assets.access?.visibility ?? asset.manifest.assets.publish.visibility ?? "public"
  }));
  const data = {
    generated_at: new Date().toISOString(),
    assets,
    reports,
    platform_memberships: Object.values(index.platform_memberships),
    agent_subscriptions: Object.values(index.agent_subscriptions),
    access_receipts: Object.values(index.access_receipts),
    delegations: Object.values(index.delegations),
    membership_settlements: Object.values(index.membership_settlements),
    agent_earnings: Object.values(index.agent_earnings)
  };
  return `
<h1>Research Network</h1>
<p class="muted">Publish encrypted research assets, connect GitHub scope, manage access, and settle research payments.</p>
<div id="workbench-root" class="workbench-root"><p class="muted">Loading Research Network...</p></div>
<script>window.__WORKBENCH_INDEX__ = ${jsonForInlineScript(data)};</script>
<script src="/workbench.js?v=${WORKBENCH_SCRIPT_VERSION}" defer></script>`;
}

export const WORKBENCH_JS = `
(function () {
  "use strict";
  var root = document.getElementById("workbench-root");
  if (!root) return;
  var indexed = window.__WORKBENCH_INDEX__ || {};
  var now = function () { return new Date().toISOString(); };
  var demoMode = false;
  var lastStatus = { text: "", isError: false };
  try {
    var params = new URLSearchParams(window.location.search);
    demoMode = params.has("rn_demo") || localStorage.getItem("rn_workbench_demo") === "1";
  } catch (e) {}

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function hash(text) {
    var input = String(text || "");
    var h = 2166136261;
    for (var i = 0; i < input.length; i += 1) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }
  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
  function readSession() {
    return readJson("rn_session", null);
  }
  function readGithub() {
    return readJson("rn_github", null);
  }
  function readWorkbench() {
    var state = readJson("rn_workbench_state", {});
    return {
      reports: Array.isArray(state.reports) ? state.reports : [],
      platform_memberships: Array.isArray(state.platform_memberships) ? state.platform_memberships : [],
      agent_subscriptions: Array.isArray(state.agent_subscriptions) ? state.agent_subscriptions : [],
      access_receipts: Array.isArray(state.access_receipts) ? state.access_receipts : [],
      delegations: Array.isArray(state.delegations) ? state.delegations : [],
      plaintexts: state.plaintexts || {},
      unlocked: state.unlocked || {},
      actor: state.actor || "outsider",
      selected_report_id: state.selected_report_id || ""
    };
  }
  function saveWorkbench(state) {
    writeJson("rn_workbench_state", state);
  }
  function runtimeNetwork() {
    var config = window.__RN_M3_CONFIG__ || {};
    return String(config.network || window.__RN_NETWORK__ || "testnet");
  }
  function blockMainnetDemoFallback(action) {
    if (runtimeNetwork() !== "mainnet") return false;
    setStatus("Mainnet " + action + " requires a live zkLogin signer.", true);
    return true;
  }
  function mergeById(base, local, idKey) {
    var out = {};
    (base || []).forEach(function (item) { if (item && item[idKey]) out[String(item[idKey])] = item; });
    (local || []).forEach(function (item) { if (item && item[idKey]) out[String(item[idKey])] = item; });
    return Object.keys(out).map(function (id) { return out[id]; });
  }
  function stateView() {
    var state = readWorkbench();
    return {
      state: state,
      reports: mergeById(indexed.reports, state.reports, "id"),
      platform_memberships: mergeById(indexed.platform_memberships, state.platform_memberships, "pass_id"),
      agent_subscriptions: mergeById(indexed.agent_subscriptions, state.agent_subscriptions, "pass_id"),
      access_receipts: mergeById(indexed.access_receipts, state.access_receipts, "id"),
      delegations: mergeById(indexed.delegations, state.delegations, "id")
    };
  }
  function repoOwner(name) {
    var parts = String(name || "").split("/");
    return parts.length > 1 ? parts[0] : "";
  }
  function syntheticScopeId(account) {
    return "owner:" + String(account || "GitHub");
  }
  function accountItems(gh) {
    var scopes = gh && Array.isArray(gh.organization_scopes) ? gh.organization_scopes : [];
    if (scopes.length) {
      return scopes.map(function (scope) {
        return {
          id: String(scope.id || scope.installation_id || ("uninstalled:" + scope.account)),
          account: scope.account || "GitHub",
          accountType: scope.accountType || scope.account_type || "Account",
          installed: scope.installed !== false,
          repos: Array.isArray(scope.repos) ? scope.repos : []
        };
      }).sort(function (a, b) {
        if (a.installed !== b.installed) return a.installed ? -1 : 1;
        return a.account.localeCompare(b.account);
      });
    }
    var installations = gh && Array.isArray(gh.installations) ? gh.installations : [];
    if (installations.length) {
      var byAccount = {};
      installations.forEach(function (installation) {
        var account = installation.account || "GitHub";
        var accountType = installation.accountType || installation.account_type || "Account";
        var key = account + "\u0000" + accountType;
        if (!byAccount[key]) {
          byAccount[key] = { id: String(installation.id), account: account, accountType: accountType, installed: true, repos: [] };
        }
        (installation.repos || []).forEach(function (repo) {
          if (byAccount[key].repos.indexOf(repo) === -1) byAccount[key].repos.push(repo);
        });
      });
      return Object.keys(byAccount).map(function (key) { return byAccount[key]; });
    }
    var accounts = {};
    var scopeByOwner = {};
    function addRepo(name, installationId, account, accountType) {
      if (!name) return;
      var owner = repoOwner(name) || account || (gh && gh.login) || "GitHub";
      var resolvedType = (account && owner === account ? accountType : null) || (gh && gh.login && owner === gh.login ? "User" : "Account");
      var existingId = scopeByOwner[owner];
      var id = installationId ? String(installationId) : (existingId || syntheticScopeId(owner));
      if (installationId && existingId && existingId !== id && accounts[existingId]) {
        accounts[id] = accounts[existingId];
        accounts[id].id = id;
        delete accounts[existingId];
      }
      scopeByOwner[owner] = id;
      if (!accounts[id]) {
        accounts[id] = {
          id: id,
          account: owner,
          accountType: resolvedType,
          installed: true,
          repos: []
        };
      }
      if (accounts[id].repos.indexOf(name) === -1) accounts[id].repos.push(name);
    }
    (gh && gh.available_repos || []).forEach(function (repo) {
      var name = typeof repo === "string" ? repo : repo.full_name;
      var granted = typeof repo === "string" ? true : repo.granted !== false;
      if (!granted) return;
      addRepo(
        name,
        typeof repo === "string" ? gh.installation_id : repo.installation_id || null,
        typeof repo === "string" ? gh.account || null : repo.installation_account || null,
        typeof repo === "string" ? gh.account_type || null : repo.installation_account_type || null
      );
    });
    (gh && gh.repos || []).forEach(function (name) {
      addRepo(name, gh && gh.installation_id || null, gh && gh.account || null, gh && gh.account_type || null);
    });
    return Object.keys(accounts).map(function (id) { return accounts[id]; }).sort(function (a, b) { return a.account.localeCompare(b.account); });
  }
  function selectedInstallationIds(gh) {
    var accounts = accountItems(gh);
    var selectable = accounts.filter(function (item) { return item.installed !== false; });
    var selected = gh && Array.isArray(gh.selected_installation_ids) ? gh.selected_installation_ids : selectable.map(function (item) { return item.id; });
    var valid = {};
    selectable.forEach(function (account) { valid[String(account.id)] = true; });
    var normalized = selected.map(function (id) { return String(id); }).filter(function (id) { return valid[id]; });
    if (Array.isArray(gh && gh.selected_installation_ids) && selected.length > 0 && !normalized.length) {
      return selectable.map(function (account) { return String(account.id); });
    }
    return normalized;
  }
  function repoItems(gh) {
    var seen = {};
    var out = [];
    var selected = {};
    selectedInstallationIds(gh).forEach(function (id) { selected[String(id)] = true; });
    (gh && gh.installations || []).forEach(function (installation) {
      var id = installation && installation.id;
      if (!id || !selected[String(id)]) return;
      (installation.repos || []).forEach(function (name) {
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
    (gh && gh.available_repos || []).forEach(function (repo) {
      var name = typeof repo === "string" ? repo : repo.full_name;
      var account = typeof repo === "string" ? repoOwner(name) || gh.account || null : repo.installation_account || repoOwner(name) || null;
      var accountType = typeof repo === "string" ? gh.account_type || null : repo.installation_account_type || null;
      var installationId = typeof repo === "string" ? gh.installation_id : repo.installation_id || null;
      var scopeId = installationId ? String(installationId) : syntheticScopeId(account);
      var granted = typeof repo === "string" ? true : repo.granted !== false;
      if (!name || seen[name] || !granted || !selected[scopeId]) return;
      seen[name] = true;
      out.push({
        full_name: name,
        installation_id: installationId || scopeId,
        installation_account: account,
        installation_account_type: accountType
      });
    });
    var fallbackInstallationId = gh && gh.installation_id ? String(gh.installation_id) : "";
    var hasInstallations = Boolean(gh && gh.installations && gh.installations.length);
    (gh && gh.repos || []).forEach(function (name) {
      if (!name || seen[name]) return;
      var account = repoOwner(name) || gh.account || null;
      var scopeId = fallbackInstallationId || syntheticScopeId(account);
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
    out.sort(function (a, b) { return a.full_name.localeCompare(b.full_name); });
    return out;
  }
  function selectedRepo(gh) {
    var repos = repoItems(gh);
    var selected = gh && gh.selected_repo;
    for (var i = 0; selected && i < repos.length; i += 1) {
      if (repos[i].full_name === selected) return repos[i];
    }
    return repos[0] || null;
  }
  function persistRepoSelection(gh, repo) {
    if (!gh || !repo) return;
    gh.selected_repo = repo.full_name;
    if (repo.installation_id && !String(repo.installation_id).startsWith("owner:")) {
      gh.installation_id = Number(repo.installation_id || gh.installation_id || 0);
    }
    gh.account = repo.installation_account || gh.account || null;
    gh.account_type = repo.installation_account_type || gh.account_type || null;
    var installation = (gh.installations || []).filter(function (item) { return String(item.id) === String(repo.installation_id); })[0];
    if (installation && installation.repos) gh.repos = installation.repos;
    writeJson("rn_github", gh);
  }
  function accountScopeHtml(gh) {
    var installations = accountItems(gh);
    if (!installations.length) return '<p class="muted">No GitHub accounts or organizations are connected.</p>';
    var selected = {};
    selectedInstallationIds(gh).forEach(function (id) { selected[String(id)] = true; });
    var hasOrgScope = installations.some(function (installation) { return String(installation.accountType || installation.account_type || "").toLowerCase() === "organization"; });
    var orgHint = hasOrgScope ? "" : '<p class="muted repo-account-hint">Organization repositories appear after installing or approving the GitHub App in that organization.</p>';
    return '<fieldset class="repo-account-scope"><legend>GitHub account / organization</legend>' +
      installations.map(function (installation) {
        var id = String(installation.id);
        var label = (installation.account || "GitHub") + (installation.accountType || installation.account_type ? " · " + (installation.accountType || installation.account_type) : "");
        var installed = installation.installed !== false;
        var detail = installed ? ((installation.repos || []).length + " authorized repo option(s)") : "Not authorized yet";
        return '<label class="repo-account' + (installed ? "" : " unavailable") + '"><input class="rn-workbench-installation" type="checkbox" value="' + esc(id) + '"' + (selected[id] && installed ? " checked" : "") + (installed ? "" : " disabled") + '><span><b>' + esc(label) + '</b><br><span class="muted">' + esc(detail) + '</span></span></label>';
      }).join("") +
      orgHint +
      '</fieldset>';
  }
  function repoSelectHtml(gh) {
    var repos = repoItems(gh);
    if (!repos.length) return '<p class="muted" data-testid="repo-empty">No repositories available for the selected scope.</p>';
    var selected = selectedRepo(gh);
    return '<label class="field-label" for="workbench-repo">Research repo</label>' +
      '<select id="workbench-repo" class="repo-select" data-testid="repo-select">' +
      repos.map(function (repo) {
        var label = repo.full_name + (repo.installation_account ? " · " + repo.installation_account : "");
        return '<option value="' + esc(repo.full_name) + '" data-installation-id="' + esc(repo.installation_id || "") + '" data-installation-account="' + esc(repo.installation_account || "") + '" data-installation-account-type="' + esc(repo.installation_account_type || "") + '"' + (selected && selected.full_name === repo.full_name ? " selected" : "") + '>' + esc(label) + '</option>';
      }).join("") +
      '</select>';
  }
  function actorList(agentAddress) {
    return [
      { id: "agent", label: "Publishing agent", address: agentAddress || "0xAGENT" },
      { id: "buyer", label: "Delegation buyer", address: "0xBUYER" },
      { id: "member", label: "Platform member", address: "0xMEMBER" },
      { id: "subscriber", label: "Agent subscriber", address: "0xSUBSCRIBER" },
      { id: "arbitrator", label: "Platform arbitrator", address: "0xARBITRATOR" },
      { id: "outsider", label: "Outsider", address: "0xOUTSIDER" }
    ];
  }
  function activeActor(state, agentAddress) {
    var actors = actorList(agentAddress);
    for (var i = 0; i < actors.length; i += 1) {
      if (actors[i].id === state.actor) return actors[i];
    }
    return actors[actors.length - 1];
  }
  function actorLabelForAddress(address, agentAddress) {
    var actors = actorList(agentAddress);
    for (var i = 0; i < actors.length; i += 1) {
      if (actors[i].address && address && actors[i].address.toLowerCase() === String(address).toLowerCase()) {
        return actors[i].label;
      }
    }
    return address || "the receipt owner";
  }
  function isActive(expiresAt) {
    return !expiresAt || new Date(expiresAt).getTime() > Date.now();
  }
  function hasMembership(view, address, tier) {
    return view.platform_memberships.some(function (pass) {
      return pass.owner_address === address && Number(pass.tier || 0) >= Number(tier || 0) && isActive(pass.expires_at);
    });
  }
  function hasSubscription(view, address, agent, tier) {
    return view.agent_subscriptions.some(function (pass) {
      return pass.owner_address === address && pass.agent === agent && Number(pass.tier || 0) >= Number(tier || 0) && isActive(pass.expires_at);
    });
  }
  function jobForReport(view, report) {
    return view.delegations.filter(function (job) {
      return job.result_report_id === report.id || job.id === report.delegation_job_id;
    })[0] || null;
  }
  function accessDecision(view, report, actor) {
    if (!report) return { allowed: false, reason: "missing" };
    if (report.visibility === "public") return { allowed: true, reason: "public" };
    if (actor.address === report.agent) return { allowed: true, reason: "author" };
    if (report.visibility === "encrypted") {
      if (hasSubscription(view, actor.address, report.agent, report.required_tier)) {
        return { allowed: true, reason: "agent_subscription", receiptType: "agent_subscription" };
      }
      if (hasMembership(view, actor.address, report.required_tier)) {
        return { allowed: true, reason: "platform_member", receiptType: "platform_member" };
      }
      return { allowed: false, reason: "needs_membership_or_subscription" };
    }
    if (report.visibility === "private_delegation") {
      var job = jobForReport(view, report);
      if (job && actor.address === job.buyer) return { allowed: true, reason: "delegation_buyer" };
      if (job && actor.address === job.agent) return { allowed: true, reason: "delegation_agent" };
      if (job && job.status === "disputed" && actor.address === job.arbitrator) return { allowed: true, reason: "dispute_arbitrator" };
      return { allowed: false, reason: "private_delegation" };
    }
    return { allowed: false, reason: "unknown" };
  }
  function reportPlaintext(state, report) {
    return state.plaintexts[report.id] || "Decrypted research payload for " + (report.title || report.id) + ".";
  }
  function recordReceipt(view, state, report, actor, type) {
    if (!type) return;
    var period = new Date().getUTCFullYear() * 100 + new Date().getUTCMonth() + 1;
    var id = "read:" + hash(period + ":" + actor.address + ":" + report.id);
    var exists = view.access_receipts.some(function (receipt) { return receipt.id === id; });
    if (exists) return;
    state.access_receipts.push({
      id: id,
      period_id: period,
      user: actor.address,
      report_id: report.id,
      agent: report.agent,
      access_type: type,
      created_at: now(),
      source: "demo"
    });
  }
  function maybeSelectedReport(view, state) {
    if (state.selected_report_id) {
      var found = view.reports.filter(function (report) { return report.id === state.selected_report_id; })[0];
      if (found) return found;
    }
    return view.reports[0] || null;
  }
  function seedDemo() {
    localStorage.setItem("rn_workbench_demo", "1");
    writeJson("rn_session", {
      provider: "google",
      address: "0xAGENT",
      sub: "demo-agent",
      email: "agent@example.com",
      iss: "https://accounts.google.com",
      ts: Date.now()
    });
    writeJson("rn_github", {
      sui_address: "0xAGENT",
      login: "octo-agent",
      installation_id: 101,
      account: "octo-agent",
      account_type: "User",
      selected_installation_ids: ["101", "202"],
      selected_repo: "octo-agent/research-alpha",
      repos: ["octo-agent/research-alpha", "octo-agent/open-notes"],
      installations: [
        { id: 101, account: "octo-agent", accountType: "User", repos: ["octo-agent/research-alpha", "octo-agent/open-notes"] },
        { id: 202, account: "research-org", accountType: "Organization", repos: ["research-org/private-alpha", "research-org/encrypted-lab"] }
      ],
      available_repos: [
        { full_name: "octo-agent/research-alpha", installation_id: 101, installation_account: "octo-agent", installation_account_type: "User" },
        { full_name: "octo-agent/open-notes", installation_id: 101, installation_account: "octo-agent", installation_account_type: "User" },
        { full_name: "research-org/private-alpha", installation_id: 202, installation_account: "research-org", installation_account_type: "Organization" },
        { full_name: "research-org/encrypted-lab", installation_id: 202, installation_account: "research-org", installation_account_type: "Organization" }
      ],
      binding_attestation: "demo-attestation",
      binding_attestation_payload: { sub: "0xAGENT", installation_id: 101 }
    });
    var state = readWorkbench();
    state.actor = "agent";
    saveWorkbench(state);
    setStatus("Local demo identity seeded; publishing as Publishing agent.");
    render();
  }
  function publishReport(event) {
    event.preventDefault();
    var session = readSession();
    var gh = readGithub();
    var state = readWorkbench();
    var repo = selectedRepo(gh);
    var form = event.currentTarget;
    var title = form.querySelector("[name=title]").value.trim();
    var visibility = form.querySelector("[name=visibility]").value;
    var preview = form.querySelector("[name=preview]").value.trim();
    var plaintext = form.querySelector("[name=plaintext]").value.trim();
    var tier = Number(form.querySelector("[name=tier]").value || 1);
    if (!session || !session.address) {
      setStatus("Sign in before publishing.", true);
      return;
    }
    if (!repo || !repo.full_name) {
      setStatus("Select a GitHub repo before publishing.", true);
      return;
    }
    if (!title) {
      setStatus("Report title is required.", true);
      return;
    }
    if (blockMainnetDemoFallback("publishing")) return;
    var stamp = Date.now();
    var id = "report:ui:" + hash(session.address + ":" + title + ":" + stamp);
    var report = {
      id: id,
      sui_object_id: "0x" + hash(id + ":object"),
      agent: session.address,
      visibility: visibility,
      required_tier: visibility === "public" ? 0 : tier,
      walrus_blob_id: visibility === "public" ? "walrus:public:" + hash(id) : "walrus:ciphertext:" + hash(id),
      seal_id: visibility === "public" ? undefined : "seal:" + hash(id + ":seal"),
      ciphertext_hash: visibility === "public" ? undefined : "sha256:cipher:" + hash(plaintext || preview || title),
      plaintext_commitment: visibility === "public" ? "sha256:plain:" + hash(preview || title) : "sha256:plain:" + hash(plaintext || preview || title),
      title: title,
      free_preview: preview || "No preview supplied.",
      created_at: now(),
      source_repo: repo.full_name
    };
    state.reports.push(report);
    if (visibility !== "public") {
      state.plaintexts[id] = plaintext || "Encrypted research body for " + title + ".";
    }
    state.selected_report_id = id;
    state.actor = "agent";
    saveWorkbench(state);
    setStatus("Published " + visibility + " report from " + repo.full_name + ".");
    form.reset();
    render();
  }
  function setStatus(text, isError) {
    lastStatus = { text: text || "", isError: !!isError };
    var status = document.getElementById("workbench-status");
    if (status) {
      status.textContent = lastStatus.text;
      status.className = isError ? "notice error" : "notice success";
    }
  }
  function buyMembership() {
    if (blockMainnetDemoFallback("membership purchase")) return;
    var session = readSession();
    var view = stateView();
    var state = view.state;
    var actor = activeActor(state, session && session.address);
    var id = "pm:" + hash(actor.address + ":" + Date.now());
    state.platform_memberships.push({
      pass_id: id,
      owner_address: actor.address,
      tier: 1,
      started_at: now(),
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      source: "demo"
    });
    saveWorkbench(state);
    setStatus("Platform membership active for " + actor.label + ".");
    render();
  }
  function subscribeAgent() {
    if (blockMainnetDemoFallback("agent subscription")) return;
    var session = readSession();
    var view = stateView();
    var state = view.state;
    var actor = activeActor(state, session && session.address);
    var report = maybeSelectedReport(view, state);
    var agent = report ? report.agent : (session && session.address) || "0xAGENT";
    var id = "sub:" + hash(actor.address + ":" + agent + ":" + Date.now());
    state.agent_subscriptions.push({
      pass_id: id,
      owner_address: actor.address,
      agent: agent,
      tier: 1,
      started_at: now(),
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      source: "demo"
    });
    saveWorkbench(state);
    setStatus("Agent subscription active for " + actor.label + ".");
    render();
  }
  function createDelegation() {
    if (blockMainnetDemoFallback("delegation creation")) return;
    var session = readSession();
    var state = readWorkbench();
    var agent = session && session.address ? session.address : "0xAGENT";
    var id = "job:" + hash("delegation:" + Date.now());
    state.delegations.push({
      id: id,
      buyer: "0xBUYER",
      agent: agent,
      budget: 1200,
      status: "funded",
      source: "demo",
      created_at: now(),
      updated_at: now()
    });
    saveWorkbench(state);
    setStatus("Private delegation job created and funded (demo).");
    render();
  }
  function submitDelegationResult() {
    if (blockMainnetDemoFallback("private result submission")) return;
    var session = readSession();
    var view = stateView();
    var state = view.state;
    var job = view.delegations.filter(function (item) { return item.status === "open" || item.status === "accepted" || item.status === "funded"; })[0] || view.delegations[view.delegations.length - 1];
    if (!job) {
      setStatus("Create a delegation job first.", true);
      return;
    }
    var reportId = "report:private:" + hash(job.id + ":" + Date.now());
    var title = "Private result for " + job.id;
    job.status = "submitted";
    job.result_report_id = reportId;
    job.updated_at = now();
    var localJob = state.delegations.filter(function (item) { return item.id === job.id; })[0];
    if (localJob) {
      localJob.status = job.status;
      localJob.result_report_id = reportId;
      localJob.updated_at = job.updated_at;
    } else {
      state.delegations.push(job);
    }
    state.reports.push({
      id: reportId,
      sui_object_id: "0x" + hash(reportId + ":object"),
      agent: job.agent || (session && session.address) || "0xAGENT",
      visibility: "private_delegation",
      required_tier: 0,
      walrus_blob_id: "walrus:private:" + hash(reportId),
      seal_id: "seal:" + hash(reportId + ":seal"),
      ciphertext_hash: "sha256:cipher:" + hash(reportId),
      plaintext_commitment: "sha256:plain:" + hash(reportId),
      free_preview_hash: "sha256:preview:" + hash(reportId),
      delegation_job_id: job.id,
      title: title,
      free_preview: "Private delegation result metadata only.",
      created_at: now()
    });
    state.plaintexts[reportId] = "Private delegation research result. Buyer and agent can decrypt by default.";
    state.selected_report_id = reportId;
    saveWorkbench(state);
    setStatus("Private result submitted with Seal access.");
    render();
  }
  function openDispute() {
    if (blockMainnetDemoFallback("dispute handling")) return;
    var view = stateView();
    var state = view.state;
    var job = view.delegations.filter(function (item) { return item.result_report_id; })[0] || view.delegations[0];
    if (!job) {
      setStatus("Create a delegation job first.", true);
      return;
    }
    job.status = "disputed";
    job.arbitrator = "0xARBITRATOR";
    job.updated_at = now();
    var localJob = state.delegations.filter(function (item) { return item.id === job.id; })[0];
    if (localJob) {
      localJob.status = job.status;
      localJob.arbitrator = job.arbitrator;
      localJob.updated_at = job.updated_at;
    } else {
      state.delegations.push(job);
    }
    saveWorkbench(state);
    setStatus("Dispute opened; arbitrator has temporary Seal access.");
    render();
  }
  function completeDelegation() {
    if (blockMainnetDemoFallback("delegation completion")) return;
    var view = stateView();
    var state = view.state;
    var job = view.delegations.filter(function (item) { return item.status === "submitted"; })[0];
    if (!job) {
      setStatus("Submit a delegation result before completing the job.", true);
      return;
    }
    job.status = "completed";
    job.updated_at = now();
    var localJob = state.delegations.filter(function (item) { return item.id === job.id; })[0];
    if (localJob) {
      localJob.status = job.status;
      localJob.updated_at = job.updated_at;
    }
    saveWorkbench(state);
    setStatus("Delegation completed (demo).");
    render();
  }
  function claimAgentEarnings() {
    if (blockMainnetDemoFallback("earnings claim")) return;
    var session = readSession();
    var view = stateView();
    var actor = activeActor(view.state, session && session.address);
    var claimable = view.access_receipts.filter(function (receipt) {
      return receipt.access_type === "platform_member" &&
        receipt.source !== "sui" &&
        !!receipt.settlement_tx_digest &&
        receipt.agent === actor.address;
    });
    if (!claimable.length) {
      var pendingForAgent = view.access_receipts.filter(function (receipt) {
        return receipt.access_type === "platform_member" &&
          receipt.source !== "sui" &&
          !receipt.settlement_tx_digest &&
          receipt.agent === actor.address;
      }).reverse()[0];
      if (pendingForAgent) {
        setStatus("Settle the pending membership receipt as " + actorLabelForAddress(pendingForAgent.user, session && session.address) + " first, then return to " + actor.label + " to claim earnings.", true);
      } else {
        setStatus("Settle a demo membership receipt for this agent before claiming earnings.", true);
      }
      return;
    }
    setStatus("Agent earnings claimed (demo) from " + claimable.length + " settled receipt(s).");
  }
  function settleLatestMembershipReceipt() {
    if (blockMainnetDemoFallback("receipt settlement")) return;
    var session = readSession();
    var view = stateView();
    var state = view.state;
    var actor = activeActor(state, session && session.address);
    var receipt = view.access_receipts.filter(function (item) {
      return item.access_type === "platform_member" &&
        item.source !== "sui" &&
        !item.settlement_tx_digest &&
        item.user === actor.address;
    }).reverse()[0];
    if (!receipt) {
      var pending = view.access_receipts.filter(function (item) {
        return item.access_type === "platform_member" &&
          item.source !== "sui" &&
          !item.settlement_tx_digest;
      }).reverse()[0];
      if (pending) {
        setStatus("No pending membership receipt for " + actor.label + ". Switch to " + actorLabelForAddress(pending.user, session && session.address) + " to settle this receipt, then switch to Publishing agent to claim.", true);
      } else {
        setStatus("Buy and decrypt as the platform member or delegation buyer before settling.", true);
      }
      return;
    }
    var localReceipt = state.access_receipts.filter(function (item) { return item.id === receipt.id; })[0];
    if (localReceipt) {
      localReceipt.settlement_tx_digest = "demo:settle:" + hash(receipt.id + ":" + Date.now());
      localReceipt.settled_at = now();
      saveWorkbench(state);
    }
    setStatus("Membership receipt settled (demo); agent earnings are ready to claim.");
    render();
  }
  function decryptReport(id) {
    var session = readSession();
    var view = stateView();
    var state = view.state;
    var actor = activeActor(state, session && session.address);
    var report = view.reports.filter(function (item) { return item.id === id; })[0];
    var decision = accessDecision(view, report, actor);
    if (!decision.allowed) {
      setStatus("Seal denied access: " + decision.reason + ".", true);
      return;
    }
    if (decision.receiptType) recordReceipt(view, state, report, actor, decision.receiptType);
    state.unlocked[actor.address + ":" + report.id] = true;
    state.selected_report_id = report.id;
    saveWorkbench(state);
    setStatus("Seal decrypt authorized for " + actor.label + " via " + decision.reason + ".");
    render();
  }
  function reportCards(view, state, actor) {
    if (!view.reports.length) return '<p class="muted">No reports yet.</p>';
    return '<div class="workbench-report-list">' + view.reports.map(function (report) {
      var decision = accessDecision(view, report, actor);
      var unlocked = state.unlocked[actor.address + ":" + report.id] || report.visibility === "public";
      var accessClass = decision.allowed ? "access-ok" : "access-locked";
      var sealMeta = report.visibility === "public" ? "" : '<dl class="mini-meta"><div><dt>Walrus</dt><dd>' + esc(report.walrus_blob_id || "") + '</dd></div><div><dt>Seal</dt><dd>' + esc(report.seal_id || "") + '</dd></div><div><dt>Cipher</dt><dd>' + esc(report.ciphertext_hash || "") + '</dd></div></dl>';
      var body = unlocked && decision.allowed
        ? '<div class="decrypted" data-testid="decrypted-' + esc(report.id) + '">' + esc(reportPlaintext(state, report)) + '</div>'
        : '<p class="muted access-state" data-testid="access-state">' + esc(decision.allowed ? "Ready to decrypt" : "Locked: " + decision.reason) + '</p>';
      var decryptButton = report.visibility === "public" ? "" : '<button class="button decrypt-report" type="button" data-report-id="' + esc(report.id) + '"' + (decision.allowed ? "" : " disabled") + '>Decrypt report</button>';
      return '<article class="workbench-report ' + accessClass + '" data-report-id="' + esc(report.id) + '" data-visibility="' + esc(report.visibility) + '">' +
        '<div class="report-head"><strong>' + esc(report.title || report.id) + '</strong><span class="pill">' + esc(report.visibility) + '</span></div>' +
        '<p class="muted">' + esc(report.free_preview || report.free_preview_hash || "No public preview.") + '</p>' +
        '<p class="muted">Agent <code>' + esc(report.agent) + '</code>' + (report.source_repo ? ' · Repo <code>' + esc(report.source_repo) + '</code>' : '') + '</p>' +
        sealMeta +
        body +
        decryptButton +
        '</article>';
    }).join("") + '</div>';
  }
  function receiptRows(receipts) {
    if (!receipts.length) return '<p class="muted">No access receipts recorded.</p>';
    return '<table class="data-table"><thead><tr><th>Receipt</th><th>User</th><th>Report</th><th>Type</th><th>Source</th><th>Settlement</th></tr></thead><tbody>' +
      receipts.map(function (receipt) {
        return '<tr><td>' + esc(receipt.id) + '</td><td>' + esc(receipt.user) + '</td><td>' + esc(receipt.report_id) + '</td><td>' + esc(receipt.access_type) + '</td><td>' + esc(receipt.source || "") + '</td><td>' + esc(receipt.settlement_tx_digest ? "settled" : "pending") + '</td></tr>';
      }).join("") +
      '</tbody></table>';
  }
  function delegationRows(jobs) {
    if (!jobs.length) return '<p class="muted">No delegation jobs yet.</p>';
    return '<table class="data-table"><thead><tr><th>Job</th><th>Status</th><th>Buyer</th><th>Agent</th><th>Result</th></tr></thead><tbody>' +
      jobs.map(function (job) {
        return '<tr><td>' + esc(job.id) + '</td><td>' + esc(job.status) + '</td><td>' + esc(job.buyer) + '</td><td>' + esc(job.agent) + '</td><td>' + esc(job.result_report_id || "") + '</td></tr>';
      }).join("") +
      '</tbody></table>';
  }
  function actorSelectHtml(state, agentAddress) {
    var actors = actorList(agentAddress);
    return '<label class="field-label" for="actor-select">Current role</label>' +
      '<select id="actor-select" class="repo-select" data-testid="actor-select">' +
      actors.map(function (actor) {
        return '<option value="' + esc(actor.id) + '"' + (state.actor === actor.id ? " selected" : "") + '>' + esc(actor.label + " · " + actor.address) + '</option>';
      }).join("") +
      '</select>';
  }
  function render() {
    var session = readSession();
    var gh = readGithub();
    var view = stateView();
    var state = view.state;
    var actor = activeActor(state, session && session.address);
    var repo = selectedRepo(gh);
    var selectedReport = maybeSelectedReport(view, state);
    var signedIn = session && session.address;
    root.innerHTML =
      '<div id="workbench-status" class="notice" aria-live="polite"></div>' +
      (demoMode
      ? '<p class="notice muted" data-testid="m3-demo">Demo session: actions use local sample records until this browser tab has a live zkLogin signer.</p>'
        : '<p class="notice muted" data-testid="m3-demo">Sign in to publish research assets and unlock signer-backed Walrus, Seal, and Sui actions.</p>') +
      (!signedIn
        ? '<section class="workbench-panel"><h2>Identity</h2><p class="muted">No browser session is active.</p><a class="button" href="/login.html">Sign in</a>' + (demoMode ? '<button class="button" id="seed-demo" type="button" data-testid="seed-demo">Seed local test identity</button>' : '') + '</section>'
        : '<section class="workbench-panel"><h2>Identity</h2><dl class="verification"><div><dt>zkLogin address</dt><dd>' + esc(session.address) + '</dd></div><div><dt>GitHub</dt><dd>' + esc((gh && gh.login) || "not connected") + '</dd></div></dl></section>') +
      '<section class="workbench-panel"><h2>Repository Scope</h2>' +
        accountScopeHtml(gh) +
        '<div id="workbench-repo-wrap">' + repoSelectHtml(gh) + '</div>' +
        '<p class="muted">Selected repo: <code data-testid="selected-repo">' + esc(repo && repo.full_name || "none") + '</code></p>' +
        '<p class="repo-actions"><a class="button" href="/login.html">Refresh GitHub repos</a><a class="button" href="/account.html">Add GitHub account/org access</a></p>' +
      '</section>' +
      '<section class="workbench-panel"><h2>Publish Research</h2>' +
        '<form id="publish-form" class="workbench-form">' +
          '<label class="field-label">Report title<input name="title" data-testid="publish-title" value="Market structure notes"></label>' +
          '<label class="field-label">Visibility<select name="visibility" data-testid="visibility-select"><option value="public">public</option><option value="encrypted" selected>encrypted</option></select></label>' +
          '<label class="field-label">Required tier<input name="tier" type="number" min="1" max="10" value="1"></label>' +
          '<label class="field-label">Free preview<textarea name="preview" data-testid="publish-preview">Public abstract and preview only.</textarea></label>' +
          '<label class="field-label">Research body<textarea name="plaintext" data-testid="publish-plaintext">Encrypted analysis visible only after Seal authorization.</textarea></label>' +
          '<button class="button" type="submit" data-testid="publish-submit">Publish report</button>' +
        '</form>' +
      '</section>' +
      '<section class="workbench-panel"><h2>Access and subscriptions</h2>' +
        actorSelectHtml(state, session && session.address) +
        '<p class="workbench-actions"><button class="button" id="buy-membership" type="button" data-testid="buy-membership">Buy platform membership</button><button class="button" id="subscribe-agent" type="button" data-testid="subscribe-agent">Subscribe to agent</button></p>' +
        '<p class="muted">Selected report: <code>' + esc(selectedReport && selectedReport.id || "none") + '</code></p>' +
        reportCards(view, state, actor) +
      '</section>' +
      '<section class="workbench-panel"><h2>Private Delegation</h2>' +
        '<p class="workbench-actions"><button class="button" id="create-delegation" type="button" data-testid="create-delegation">Create delegation</button><button class="button" id="submit-private-result" type="button" data-testid="submit-private-result">Submit private result</button><button class="button" id="open-dispute" type="button" data-testid="open-dispute">Open dispute</button><button class="button" id="complete-delegation" type="button" data-testid="complete-delegation">Complete delegation</button></p>' +
        delegationRows(view.delegations) +
      '</section>' +
      '<section class="workbench-panel"><h2>Access Receipts</h2><p class="workbench-actions"><button class="button" id="settle-membership-receipt" type="button" data-testid="settle-membership-receipt">Settle latest receipt</button><button class="button" id="claim-agent-earnings" type="button" data-testid="claim-agent-earnings">Claim earnings</button></p>' + receiptRows(view.access_receipts) + '</section>';
    if (lastStatus.text) setStatus(lastStatus.text, lastStatus.isError);

    var seed = document.getElementById("seed-demo");
    if (seed) seed.addEventListener("click", seedDemo);
    var form = document.getElementById("publish-form");
    if (form) form.addEventListener("submit", publishReport);
    var actorSelect = document.getElementById("actor-select");
    if (actorSelect) actorSelect.addEventListener("change", function () {
      var s = readWorkbench();
      s.actor = actorSelect.value;
      saveWorkbench(s);
      render();
    });
    var repoSelect = document.getElementById("workbench-repo");
    if (repoSelect) repoSelect.addEventListener("change", function () {
      var opt = repoSelect.options[repoSelect.selectedIndex];
      persistRepoSelection(readGithub(), {
        full_name: repoSelect.value,
        installation_id: opt.getAttribute("data-installation-id"),
        installation_account: opt.getAttribute("data-installation-account"),
        installation_account_type: opt.getAttribute("data-installation-account-type")
      });
      render();
    });
    Array.prototype.forEach.call(document.querySelectorAll(".rn-workbench-installation"), function (input) {
      input.addEventListener("change", function () {
        var ghNow = readGithub();
        if (!ghNow) return;
        ghNow.selected_installation_ids = Array.prototype.slice.call(document.querySelectorAll(".rn-workbench-installation"))
          .filter(function (el) { return el.checked; })
          .map(function (el) { return String(el.value); });
        var nextRepo = selectedRepo(ghNow);
        if (nextRepo) persistRepoSelection(ghNow, nextRepo);
        else writeJson("rn_github", ghNow);
        render();
      });
    });
    var membership = document.getElementById("buy-membership");
    if (membership) membership.addEventListener("click", buyMembership);
    var subscription = document.getElementById("subscribe-agent");
    if (subscription) subscription.addEventListener("click", subscribeAgent);
    var createJob = document.getElementById("create-delegation");
    if (createJob) createJob.addEventListener("click", createDelegation);
    var submitResult = document.getElementById("submit-private-result");
    if (submitResult) submitResult.addEventListener("click", submitDelegationResult);
    var dispute = document.getElementById("open-dispute");
    if (dispute) dispute.addEventListener("click", openDispute);
    var completeJob = document.getElementById("complete-delegation");
    if (completeJob) completeJob.addEventListener("click", completeDelegation);
    var settleReceipt = document.getElementById("settle-membership-receipt");
    if (settleReceipt) settleReceipt.addEventListener("click", settleLatestMembershipReceipt);
    var claim = document.getElementById("claim-agent-earnings");
    if (claim) claim.addEventListener("click", claimAgentEarnings);
    Array.prototype.forEach.call(document.querySelectorAll(".decrypt-report"), function (button) {
      button.addEventListener("click", function () { decryptReport(button.getAttribute("data-report-id")); });
    });
  }
  render();
})();
`;
