import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ZKLOGIN_ENTRY = path.resolve(HERE, "..", "web-auth", "zklogin-entry.ts");
const SECRETS_DIR = path.join(process.cwd(), ".research-network", "secrets");

export const DEFAULT_AUTH_SUI_RPC_URL = "https://sui-testnet-rpc.publicnode.com";
type AuthNetwork = "testnet" | "mainnet" | "devnet";

export interface AuthSiteConfig {
  googleClientId?: string;
  callbackPath: string;
  githubInstallUrl?: string;
  /** GitHub App OAuth client id (public) — enables the Cursor-style authorize flow. */
  githubClientId?: string;
  githubCallbackPath: string;
  /** Sui fullnode used by the login page to fetch the current epoch for maxEpoch. */
  suiRpcUrl: string;
  /** Server endpoint returning the deterministic per-user salt (api/zklogin-salt.ts). */
  saltServicePath: string;
  /** Server endpoint exchanging the GitHub OAuth code (api/github-oauth.ts). */
  githubOauthPath: string;
  /** Server endpoint verifying browser-stored GitHub binding attestations. */
  githubBindingPath: string;
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Load login config from the gitignored secrets dir or build-time env vars (Vercel).
 *  Returns null when nothing is configured (so a plain `buildStaticWeb` simply omits login pages). */
export async function loadAuthSiteConfig(secretsDir = SECRETS_DIR): Promise<AuthSiteConfig | null> {
  const oauth = await readJsonIfExists<{ google?: { client_id?: string } }>(path.join(secretsDir, "oauth.json"));
  const github = await readJsonIfExists<{ slug?: string; install_url?: string; client_id?: string }>(path.join(secretsDir, "github.json"));
  const googleClientId = oauth?.google?.client_id ?? process.env.GOOGLE_CLIENT_ID;
  const githubSlug = github?.slug ?? process.env.GITHUB_APP_SLUG;
  const githubClientId = github?.client_id ?? process.env.GITHUB_APP_CLIENT_ID;
  const githubInstallUrl =
    github?.install_url ??
    (githubSlug ? `https://github.com/apps/${githubSlug}/installations/new` : undefined) ??
    process.env.GITHUB_INSTALL_URL;
  if (!googleClientId && !githubInstallUrl) {
    return null;
  }
  const suiRpcUrl = resolveAuthSuiRpcUrl(process.env);
  return {
    googleClientId,
    callbackPath: "/auth/callback.html",
    githubInstallUrl,
    githubClientId,
    githubCallbackPath: "/auth/github-callback.html",
    suiRpcUrl,
    saltServicePath: "/api/zklogin-salt",
    githubOauthPath: "/api/github-oauth",
    githubBindingPath: "/api/github-binding"
  };
}

export function resolveAuthSuiRpcUrl(env: NodeJS.ProcessEnv = process.env): string {
  const network = env.AUTH_NETWORK || env.RN_WEB_NETWORK || env.RN_NETWORK || "testnet";
  if (network !== "testnet" && network !== "mainnet" && network !== "devnet") {
    throw new Error("AUTH_NETWORK/RN_WEB_NETWORK must be testnet, mainnet, or devnet");
  }
  const explicitRpc = env.AUTH_SUI_RPC_URL;
  const rpc = explicitRpc ?? DEFAULT_AUTH_SUI_RPC_URL;
  if (network === "mainnet") {
    if (!explicitRpc) {
      throw new Error("mainnet auth shell requires explicit AUTH_SUI_RPC_URL");
    }
    if (isTestnetRpc(explicitRpc)) {
      throw new Error("mainnet auth shell rejects testnet AUTH_SUI_RPC_URL");
    }
  }
  return rpc;
}

function isTestnetRpc(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.includes("testnet") || normalized.includes("sui-testnet-rpc.publicnode.com");
}

function cspMetaTag(config: AuthSiteConfig): string {
  const rpcOrigin = new URL(config.suiRpcUrl).origin;
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${rpcOrigin}`,
    "img-src 'self' data:",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join("; ");
  return `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
}

/** Generate the static login surface into the site: a browser-bundled zkLogin lib, an injected
 *  public config, and the login + callback pages. All client-side — works on a static host;
 *  the salt service and GitHub code exchange are the only server dependencies. */
export async function buildAuthAssets(
  outputDir: string,
  config: AuthSiteConfig,
  options: { emitLoginHtml?: boolean } = {}
): Promise<void> {
  const emitLoginHtml = options.emitLoginHtml ?? true;
  await fs.mkdir(path.join(outputDir, "auth"), { recursive: true });

  await esbuild.build({
    entryPoints: [ZKLOGIN_ENTRY],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    minify: true,
    outfile: path.join(outputDir, "zklogin-browser.js")
  });

  const configJs = `window.RN_AUTH_CONFIG = ${JSON.stringify({
    googleClientId: config.googleClientId ?? null,
    callbackPath: config.callbackPath,
    githubInstallUrl: config.githubInstallUrl ?? null,
    githubClientId: config.githubClientId ?? null,
    githubCallbackPath: config.githubCallbackPath,
    suiRpcUrl: config.suiRpcUrl,
    saltServicePath: config.saltServicePath,
    githubOauthPath: config.githubOauthPath,
    githubBindingPath: config.githubBindingPath
  })};\n`;

  const csp = cspMetaTag(config);
  await fs.writeFile(path.join(outputDir, "auth", "config.js"), configJs, "utf8");
  await fs.writeFile(path.join(outputDir, "auth", "login.js"), LOGIN_JS, "utf8");
  await fs.writeFile(path.join(outputDir, "auth", "callback.js"), CALLBACK_JS, "utf8");
  await fs.writeFile(path.join(outputDir, "auth", "github-callback.js"), GITHUB_CALLBACK_JS, "utf8");
  // In the Vercel shell path, index.html / login.html / account.html / workbench.html are
  // produced by the Vite build (web/src/entries/*), so we skip the legacy
  // string-templated login.html there to avoid clobbering it.
  if (emitLoginHtml) {
    await fs.writeFile(path.join(outputDir, "login.html"), loginHtml(csp), "utf8");
  }
  await fs.writeFile(path.join(outputDir, "auth", "callback.html"), callbackHtml(csp), "utf8");
  await fs.writeFile(path.join(outputDir, "auth", "github-callback.html"), githubCallbackHtml(csp), "utf8");
}

/** Build the Vercel-only auth shell. Product pages (index/login/account/workbench) and
 *  content pages (dashboard/abs/*) intentionally
 *  stay absent so Vercel's catch-all rewrite proxies them to the current Walrus Site.
 *  The interactive pages (index/login/account/workbench) + styles.css + workbench.js +
 *  assets/ are produced by the Vite build (web/), which runs AFTER this in the Vercel
 *  buildCommand. auth/* + zklogin-browser.js + health.txt are owned here and emitted
 *  with emitLoginHtml:false so the legacy string login.html does not clobber Vite's. */
export async function buildVercelAuthShell(outputDir: string, config?: AuthSiteConfig | null): Promise<string> {
  const authConfig = config ?? await loadAuthSiteConfig();
  if (!authConfig) {
    throw new Error("Vercel auth shell requires GOOGLE_CLIENT_ID or GitHub auth env/secrets");
  }
  // The shell dir is co-owned by this function (auth/* + zklogin-browser.js +
  // health.txt) and the Vite build (index.html / login.html / account.html / workbench.html /
  // workbench.js / styles.css + assets/). Wiping the whole dir would delete the
  // Vite output when both run in sequence, so we only remove known auth-owned
  // files plus stale Vite hashed assets. emptyOutDir:false on the Vite side
  // completes the handshake (Vite never wipes auth assets either).
  await fs.mkdir(outputDir, { recursive: true });
  await fs.rm(path.join(outputDir, "auth"), { recursive: true, force: true });
  await fs.rm(path.join(outputDir, "assets"), { recursive: true, force: true });
  await fs.rm(path.join(outputDir, "zklogin-browser.js"), { force: true });
  await fs.rm(path.join(outputDir, "index.html"), { force: true });
  await fs.writeFile(path.join(outputDir, "health.txt"), "ok\n", "utf8");
  await buildAuthAssets(outputDir, authConfig, { emitLoginHtml: false });
  return outputDir;
}

const AUTH_STYLE = `<style>
.auth-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin:18px 0}
.auth-card{border:1px solid var(--line,#ddd);border-radius:6px;padding:18px 20px;background:#fff}
.auth-card h2{margin:0 0 6px;font-size:16px}
.btn{display:inline-block;margin-top:10px;padding:9px 16px;border:1px solid var(--line,#ccc);border-radius:6px;background:#fafafa;font:inherit;cursor:pointer;text-decoration:none;color:#111}
.btn:hover{background:#f0f0f0}
.btn[disabled],.btn.disabled{opacity:.5;cursor:not-allowed}
.addr{font-family:monospace;word-break:break-all;background:#f6f6f6;padding:4px 8px;border-radius:4px;display:inline-block}
.error{color:#b00}
.spinner{display:inline-block;width:14px;height:14px;border:2px solid #ccc;border-top-color:#555;border-radius:50%;animation:rnspin .8s linear infinite;vertical-align:-2px;margin-right:8px}
@keyframes rnspin{to{transform:rotate(360deg)}}
.repo-select{width:min(520px,100%);margin-top:4px;padding:8px 10px;border:1px solid var(--line,#ccc);border-radius:6px;background:#fff;color:#111;font:inherit}
.repo-select:focus{outline:2px solid rgba(0,104,172,.25);border-color:#0068ac}
.repo-account-scope{margin:0 0 12px;padding:0;border:0}
.repo-account-scope legend{margin:0 0 6px;color:#686868}
.repo-account{display:flex;gap:8px;align-items:flex-start;margin:6px 0}
.repo-account input{margin-top:3px}
.repo-account.unavailable{opacity:.68}
.repo-summary{margin:8px 0 0;color:#686868}
.repo-actions{margin-top:10px}
.repo-actions a{margin-right:14px}
</style>`;

const loginHtml = (csp: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
${csp}
<title>Sign in · Research Network</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/styles.css">${AUTH_STYLE}</head>
<body><main class="container" style="max-width:860px;margin:0 auto;padding:28px 18px">
<p><a href="/">← Research Network</a></p>
<h1>Sign in</h1>
<p class="muted">zkLogin derives your Sui address from a Google sign-in (no wallet/seed). Connect GitHub afterwards to pick which research repos to link to your address.</p>
<div class="auth-grid">
  <div class="auth-card">
    <h2>1 · Sui identity · zkLogin</h2>
    <p class="muted">Sign in with Google → get a Sui address derived in-browser via @mysten/sui.</p>
    <button id="google" class="button btn">Sign in with Google</button>
    <p id="google-status" class="muted"></p>
  </div>
  <div class="auth-card">
    <h2>2 · Connect GitHub</h2>
    <p class="muted">Authorize the GitHub App on only the repos you choose. Least-privilege, read-only. Repos are bound to your Sui address.</p>
    <a id="github" class="button btn" href="#">Connect GitHub repos</a>
    <p id="github-status" class="muted"></p>
  </div>
</div>
<div id="session"></div>
</main>
<script src="/zklogin-browser.js"></script>
<script src="/auth/config.js"></script>
<script src="/auth/login.js"></script>
</body></html>`;

const callbackHtml = (csp: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
${csp}
<title>Signing in · Research Network</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/styles.css">${AUTH_STYLE}</head>
<body><main class="container" style="max-width:860px;margin:0 auto;padding:28px 18px">
<p><a href="/">← Research Network</a></p>
<div id="out"><p class="muted"><span class="spinner"></span>Completing sign-in…</p></div>
</main>
<script src="/zklogin-browser.js"></script>
<script src="/auth/config.js"></script>
<script src="/auth/callback.js"></script>
</body></html>`;

const githubCallbackHtml = (csp: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
${csp}
<title>Connecting GitHub · Research Network</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/styles.css">${AUTH_STYLE}</head>
<body><main class="container" style="max-width:860px;margin:0 auto;padding:28px 18px">
<p><a href="/">← Research Network</a></p>
<div id="out"><p class="muted"><span class="spinner"></span>Connecting to GitHub… checking installations</p></div>
</main>
<script src="/auth/config.js"></script>
<script src="/auth/github-callback.js"></script>
</body></html>`;

const LOGIN_JS = `(function(){
  function esc(v){ return String(v == null ? "" : v).replace(/[&<>"']/g,function(c){ return ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]; }); }
  function randomHex(n){ var b = crypto.getRandomValues(new Uint8Array(n)); var h = ""; for (var i = 0; i < b.length; i++) h += ("0" + b[i].toString(16)).slice(-2); return h; }
  function repoOwner(name){ var parts = String(name || "").split("/"); return parts.length > 1 ? parts[0] : ""; }
  function syntheticScopeId(account){ return "owner:" + String(account || "GitHub"); }
  function repoItems(binding){
    var seen = {};
    var out = [];
    var selected = selectedInstallationIds(binding);
    var selectedMap = {};
    selected.forEach(function(id){ selectedMap[String(id)] = true; });
    (binding && binding.available_repos || []).forEach(function(repo){
      var name = typeof repo === "string" ? repo : repo.full_name;
      var installationId = typeof repo === "string" ? binding.installation_id : repo.installation_id || null;
      var granted = typeof repo === "string" ? true : repo.granted !== false;
      var account = typeof repo === "string" ? repoOwner(name) || binding.account || null : repo.installation_account || repoOwner(name) || null;
      var accountType = typeof repo === "string" ? binding.account_type || null : repo.installation_account_type || null;
      var scopeId = installationId ? String(installationId) : syntheticScopeId(account);
      if (!name || seen[name] || !granted || !selectedMap[scopeId]) return;
      seen[name] = true;
      out.push({
        full_name: name,
        granted: true,
        installation_id: installationId || scopeId,
        installation_account: account,
        installation_account_type: accountType
      });
    });
    (binding && binding.installations || []).forEach(function(installation){
      var installationId = installation && installation.id;
      if (!installationId || !selectedMap[String(installationId)]) return;
      (installation.repos || []).forEach(function(name){
        if (!name || seen[name]) return;
        seen[name] = true;
        out.push({
          full_name: name,
          granted: true,
          installation_id: installationId,
          installation_account: installation.account || null,
          installation_account_type: installation.accountType || installation.account_type || null
        });
      });
    });
    var fallbackInstallationId = binding && binding.installation_id ? String(binding.installation_id) : "";
    var hasInstallations = Boolean(binding && binding.installations && binding.installations.length);
    (binding && binding.repos || []).forEach(function(name){
      if (!name || seen[name]) return;
      var account = repoOwner(name) || binding.account || null;
      var scopeId = fallbackInstallationId || syntheticScopeId(account);
      if (hasInstallations && (!fallbackInstallationId || !selectedMap[fallbackInstallationId])) return;
      if (!selectedMap[scopeId]) return;
      seen[name] = true;
      out.push({
        full_name: name,
        granted: true,
        installation_id: binding.installation_id || scopeId,
        installation_account: account,
        installation_account_type: binding.account && account === binding.account ? binding.account_type || null : null
      });
    });
    out.sort(function(a,b){ return a.full_name.localeCompare(b.full_name); });
    return out;
  }
  function accountItems(binding){
    var scopes = binding && Array.isArray(binding.organization_scopes) ? binding.organization_scopes : [];
    if (scopes.length) {
      return scopes.map(function(scope){
        return {
          id: String(scope.id || scope.installation_id || ("uninstalled:" + scope.account)),
          account: scope.account || "GitHub",
          accountType: scope.accountType || scope.account_type || "Account",
          installed: scope.installed !== false,
          repos: Array.isArray(scope.repos) ? scope.repos : []
        };
      }).sort(function(a,b){
        if (a.installed !== b.installed) return a.installed ? -1 : 1;
        return a.account.localeCompare(b.account);
      });
    }
    var installations = binding && Array.isArray(binding.installations) ? binding.installations : [];
    if (installations.length) {
      var byAccount = {};
      installations.forEach(function(installation){
        var account = installation.account || "GitHub";
        var accountType = installation.accountType || installation.account_type || "Account";
        var key = account + "\u0000" + accountType;
        if (!byAccount[key]) byAccount[key] = { id: String(installation.id), account: account, accountType: accountType, installed: true, repos: [] };
        (installation.repos || []).forEach(function(repo){ if (byAccount[key].repos.indexOf(repo) === -1) byAccount[key].repos.push(repo); });
      });
      return Object.keys(byAccount).map(function(key){ return byAccount[key]; });
    }
    var accounts = {};
    var scopeByOwner = {};
    function addRepo(name, installationId, account, accountType){
      if (!name) return;
      var owner = repoOwner(name) || account || (binding && binding.login) || "GitHub";
      var resolvedType = (account && owner === account ? accountType : null) || (binding && binding.login && owner === binding.login ? "User" : "Account");
      var existingId = scopeByOwner[owner];
      var id = installationId ? String(installationId) : (existingId || syntheticScopeId(owner));
      if (installationId && existingId && existingId !== id && accounts[existingId]) {
        accounts[id] = accounts[existingId];
        accounts[id].id = id;
        delete accounts[existingId];
      }
      scopeByOwner[owner] = id;
      if (!accounts[id]) accounts[id] = { id: id, account: owner, accountType: resolvedType, installed: true, repos: [] };
      if (accounts[id].repos.indexOf(name) === -1) accounts[id].repos.push(name);
    }
    (binding && binding.available_repos || []).forEach(function(repo){
      var name = typeof repo === "string" ? repo : repo.full_name;
      var granted = typeof repo === "string" ? true : repo.granted !== false;
      if (!granted) return;
      addRepo(name, typeof repo === "string" ? binding.installation_id : repo.installation_id || null, typeof repo === "string" ? binding.account || null : repo.installation_account || null, typeof repo === "string" ? binding.account_type || null : repo.installation_account_type || null);
    });
    (binding && binding.repos || []).forEach(function(name){
      addRepo(name, binding && binding.installation_id || null, binding && binding.account || null, binding && binding.account_type || null);
    });
    return Object.keys(accounts).map(function(id){ return accounts[id]; }).sort(function(a,b){ return a.account.localeCompare(b.account); });
  }
  function selectedInstallationIds(binding){
    var accounts = accountItems(binding);
    var selectable = accounts.filter(function(account){ return account.installed !== false; });
    var ids = binding && binding.selected_installation_ids;
    if (Array.isArray(ids)) {
      var valid = {};
      selectable.forEach(function(account){ valid[String(account.id)] = true; });
      var normalized = ids.map(function(id){ return String(id); }).filter(function(id){ return valid[id]; });
      if (ids.length > 0 && !normalized.length) return selectable.map(function(account){ return account.id; });
      return normalized;
    }
    return selectable.map(function(account){ return account.id; });
  }
  function selectedRepoItem(binding, repos){
    var selected = binding && binding.selected_repo;
    for (var i = 0; selected && i < repos.length; i++) {
      if (repos[i].full_name === selected && repos[i].granted) return repos[i];
    }
    for (var j = 0; j < repos.length; j++) {
      if (repos[j].granted) return repos[j];
    }
    return repos[0] || null;
  }
  function installationForRepo(binding, repo){
    if (!binding || !repo || !repo.installation_id) return null;
    var id = String(repo.installation_id);
    var installations = binding.installations || [];
    for (var i = 0; i < installations.length; i++) {
      if (String(installations[i].id) === id) return installations[i];
    }
    return null;
  }
  function applySelectedRepo(binding, repo){
    if (!binding || !repo || !repo.full_name) return binding;
    binding.selected_repo = repo.full_name;
    if (repo.granted && repo.installation_id && !String(repo.installation_id).startsWith("owner:")) {
      var installation = installationForRepo(binding, repo);
      binding.installation_id = Number(repo.installation_id);
      binding.account = repo.installation_account || (installation && installation.account) || binding.account || null;
      binding.account_type = repo.installation_account_type || (installation && installation.accountType) || binding.account_type || null;
      binding.repos = installation && installation.repos ? installation.repos : [repo.full_name];
      var attestation = binding.binding_attestations && binding.binding_attestations[String(binding.installation_id)];
      if (attestation) {
        binding.binding_attestation = attestation.binding_attestation || binding.binding_attestation;
        binding.binding_attestation_payload = attestation.binding_attestation_payload || binding.binding_attestation_payload;
      }
    } else {
      binding.account = repo.installation_account || binding.account || null;
      binding.account_type = repo.installation_account_type || binding.account_type || null;
    }
    return binding;
  }
  function syncCurrentRepo(binding){
    var repos = repoItems(binding);
    var selected = selectedRepoItem(binding, repos);
    if (selected) applySelectedRepo(binding, selected);
    return selected;
  }
  function accountSelectorHtml(binding){
    var accounts = accountItems(binding);
    if (!accounts.length) return "";
    var selected = {};
    selectedInstallationIds(binding).forEach(function(id){ selected[String(id)] = true; });
    var hasOrgScope = accounts.some(function(account){ return String(account.accountType || account.account_type || "").toLowerCase() === "organization"; });
    var orgHint = hasOrgScope ? "" : '<p class="muted repo-account-hint">Organization repositories appear after installing or approving the GitHub App in that organization.</p>';
    return '<fieldset class="repo-account-scope"><legend>GitHub account / organization</legend>'
      + accounts.map(function(account){
        var label = account.account + (account.accountType ? " · " + account.accountType : "");
        var installed = account.installed !== false;
        var detail = installed ? (account.repos.length + " authorized repo(s)") : "Not authorized yet";
        return '<label class="repo-account' + (installed ? "" : " unavailable") + '"><input class="rn-installation-scope" type="checkbox" value="' + esc(account.id) + '"' + (selected[account.id] && installed ? " checked" : "") + (installed ? "" : " disabled") + '><span><b>' + esc(label) + '</b><br><span class="muted">' + esc(detail) + '</span></span></label>';
      }).join("")
      + orgHint
      + '</fieldset>';
  }
  function repoSelectorHtml(binding, selectId){
    var repos = repoItems(binding);
    if (!repos.length) return '<p class="muted">No repositories available in the selected accounts/orgs.</p>';
    var selected = selectedRepoItem(binding, repos);
    return '<label class="muted" for="' + esc(selectId) + '">Research repo</label><br>'
      + '<select id="' + esc(selectId) + '" class="repo-select">'
      + repos.map(function(repo){
          var label = repo.full_name + (repo.installation_account ? " · " + repo.installation_account : "");
          return '<option value="' + esc(repo.full_name) + '" data-installation-id="' + esc(repo.installation_id || "") + '" data-installation-account="' + esc(repo.installation_account || "") + '" data-installation-account-type="' + esc(repo.installation_account_type || "") + '"' + (selected && repo.full_name === selected.full_name ? " selected" : "") + '>' + esc(label) + '</option>';
        }).join("")
      + '</select>';
  }
  function selectedOptionRepo(select){
    var option = select.options[select.selectedIndex];
    return {
      full_name: select.value,
      granted: !option.disabled,
      installation_id: option.getAttribute("data-installation-id") || null,
      installation_account: option.getAttribute("data-installation-account") || null,
      installation_account_type: option.getAttribute("data-installation-account-type") || null
    };
  }
  function wireRepoControls(binding, selectId, pickerId){
    if (!binding) return;
    function persist(){ localStorage.setItem("rn_github", JSON.stringify(binding)); }
    function wireSelect(){
      var select = document.getElementById(selectId);
      if (!select) return;
      if (select.value && binding.selected_repo !== select.value) {
        applySelectedRepo(binding, selectedOptionRepo(select));
        persist();
      }
      select.addEventListener("change", function(){
        applySelectedRepo(binding, selectedOptionRepo(select));
        persist();
      });
    }
    Array.prototype.forEach.call(document.querySelectorAll(".rn-installation-scope"), function(input){
      input.addEventListener("change", function(){
        var checked = Array.prototype.slice.call(document.querySelectorAll(".rn-installation-scope"))
          .filter(function(el){ return el.checked; })
          .map(function(el){ return String(el.value); });
        binding.selected_installation_ids = checked;
        syncCurrentRepo(binding);
        var picker = document.getElementById(pickerId);
        if (picker) picker.innerHTML = repoSelectorHtml(binding, selectId);
        persist();
        wireSelect();
      });
    });
    wireSelect();
  }
  function hasServerAttestation(binding){
    var payload = binding && binding.binding_attestation_payload;
    return Boolean(
      binding &&
      binding.binding_attestation &&
      payload &&
      payload.sub === binding.sui_address &&
      String(payload.installation_id) === String(binding.installation_id)
    );
  }
  function verifyServerAttestation(binding, onDone){
    if (!binding || !binding.binding_attestation) { onDone(false); return; }
    fetch(CFG.githubBindingPath || "/api/github-binding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        binding_attestation: binding.binding_attestation,
        sui_address: binding.sui_address,
        installation_id: Number(binding.installation_id),
        repos: binding.repos || []
      })
    }).then(function(r){ return r.ok ? r.json() : null; }).then(function(body){
      var payload = body && body.payload;
      onDone(Boolean(body && body.valid && payload && payload.sub === binding.sui_address && String(payload.installation_id) === String(binding.installation_id)));
    }).catch(function(){ onDone(false); });
  }
  function saveGithubState(value){
    var encoded = JSON.stringify(value);
    sessionStorage.setItem("rn_gh_state", encoded);
    try { localStorage.setItem("rn_gh_state", encoded); } catch (e) {}
  }
  var CFG = window.RN_AUTH_CONFIG || {};
  var session = null;
  try { session = JSON.parse(localStorage.getItem("rn_session") || "null"); } catch (e) {}
  var binding = null;
  try { binding = JSON.parse(localStorage.getItem("rn_github") || "null"); } catch (e) {}
  function startGithubAuthorize(){
    var csrf = randomHex(16);
    saveGithubState({ csrf: csrf, address: session.address, ts: Date.now() });
    var url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", CFG.githubClientId);
    url.searchParams.set("redirect_uri", location.origin + CFG.githubCallbackPath);
    url.searchParams.set("state", csrf);
    location.href = url.toString();
  }

  // --- zkLogin (Google) ---
  var g = document.getElementById("google");
  var gStatus = document.getElementById("google-status");
  if (!CFG.googleClientId) { g.disabled = true; g.textContent = "Google not configured"; }
  g.addEventListener("click", function(){
    if (!window.RN_ZK) { gStatus.textContent = "zkLogin library failed to load"; gStatus.className = "error"; return; }
    g.disabled = true; gStatus.textContent = "Fetching current Sui epoch…";
    fetch(CFG.suiRpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "suix_getLatestSuiSystemState", params: [] })
    }).then(function(r){ return r.json(); }).then(function(body){
      var epoch = Number(body && body.result && body.result.epoch);
      if (!isFinite(epoch)) { throw new Error("Could not read current epoch from " + CFG.suiRpcUrl); }
      var maxEpoch = epoch + 14; // ephemeral key valid ~2 weeks of testnet epochs
      var eph = RN_ZK.newEphemeralKey();
      var randomness = RN_ZK.generateRandomness();
      var nonce = RN_ZK.generateNonce(eph.getPublicKey(), maxEpoch, randomness);
      var state = randomHex(16);
      sessionStorage.setItem("rn_zk_eph", JSON.stringify({ secret: eph.getSecretKey(), randomness: String(randomness), maxEpoch: maxEpoch, nonce: nonce }));
      sessionStorage.setItem("rn_oauth_state", state);
      var url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", CFG.googleClientId);
      url.searchParams.set("response_type", "id_token");
      url.searchParams.set("redirect_uri", location.origin + CFG.callbackPath);
      url.searchParams.set("scope", "openid email profile");
      url.searchParams.set("nonce", nonce);
      url.searchParams.set("state", state);
      url.searchParams.set("prompt", "select_account");
      location.href = url.toString();
    }).catch(function(e){
      g.disabled = false; gStatus.textContent = (e && e.message) ? e.message : String(e); gStatus.className = "error";
    });
  });

  // --- GitHub (requires zkLogin session first — binding hangs off the Sui address) ---
  var gh = document.getElementById("github");
  var ghStatus = document.getElementById("github-status");
  if (!session || !session.address) {
    gh.classList.add("disabled"); gh.removeAttribute("href");
    ghStatus.textContent = "Sign in with Google first — repos are bound to your Sui address.";
  } else if (!CFG.githubClientId) {
    gh.classList.add("disabled"); gh.removeAttribute("href");
    ghStatus.textContent = "GitHub OAuth not configured.";
  } else if (binding && binding.sui_address === session.address && binding.installation_id) {
    gh.textContent = "Refresh GitHub repos";
    ghStatus.textContent = (binding.repos && binding.repos.length ? binding.repos.length : 0) + " repo(s) currently connected. Choose the active repo below.";
    gh.addEventListener("click", function(ev){
      ev.preventDefault();
      startGithubAuthorize();
    });
  } else {
    gh.addEventListener("click", function(ev){
      ev.preventDefault();
      startGithubAuthorize();
    });
  }

  // --- session card ---
  if (session && session.address) {
    var html = '<div class="auth-card"><b>Signed in</b><br>Sui address: <code class="addr">' + esc(session.address) + '</code><br><span class="muted">' + esc(session.email || session.sub || "") + '</span>';
    if (binding && binding.repos && binding.repos.length) {
      html += '<br><span class="muted">GitHub: ' + esc(binding.login || "") + '<span id="rn-attestation-status">' + (hasServerAttestation(binding) ? ' · checking attestation…' : '') + '</span></span>';
      html += '<div style="margin-top:10px">' + accountSelectorHtml(binding) + '<div id="rn-session-repo-picker">' + repoSelectorHtml(binding, "rn-session-repo-select") + '</div></div>';
    }
    html += '<p class="repo-actions"><a class="button" href="/account.html">Account &rarr;</a></p></div>';
    document.getElementById("session").innerHTML = html;
    wireRepoControls(binding, "rn-session-repo-select", "rn-session-repo-picker");
    verifyServerAttestation(binding, function(valid){
      var el = document.getElementById("rn-attestation-status");
      if (el) el.textContent = valid ? " · server-attested" : "";
    });
  }
})();`;

const CALLBACK_JS = `(function(){
  function esc(v){ return String(v == null ? "" : v).replace(/[&<>"']/g,function(c){ return ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]; }); }
  function out(html){ document.getElementById("out").innerHTML = html; }
  function fail(msg){ out('<h2>Sign-in failed</h2><p class="error">' + esc(msg) + '</p><p><a class="button" href="/login.html">Try again</a></p>'); }
  function decode(t){ var seg = t.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"); var pad = "=".repeat((4 - seg.length % 4) % 4); return JSON.parse(decodeURIComponent(escape(atob(seg + pad)))); }
  var CFG = window.RN_AUTH_CONFIG || {};
  var p = new URLSearchParams(location.hash.slice(1));
  var idToken = p.get("id_token");
  if (location.hash && history && history.replaceState) {
    try { history.replaceState(null, document.title, location.pathname + location.search); } catch (e) {}
  }
  if (!idToken) { fail("No id_token returned. " + (p.get("error_description") || p.get("error") || "")); return; }
  if (!window.RN_ZK) { fail("zkLogin library failed to load."); return; }

  // CSRF: the state we sent must round-trip (HANDOFF §6.1-4).
  var expectedState = sessionStorage.getItem("rn_oauth_state");
  sessionStorage.removeItem("rn_oauth_state");
  if (!expectedState || p.get("state") !== expectedState) { fail("OAuth state mismatch — please retry the sign-in from this site."); return; }

  var claims;
  try { claims = decode(idToken); } catch (e) { fail("Malformed id_token."); return; }

  // Nonce: the JWT must be bound to the ephemeral key we generated (HANDOFF §6.1-2).
  var eph = null;
  try { eph = JSON.parse(sessionStorage.getItem("rn_zk_eph") || "null"); } catch (e) {}
  if (!eph || !eph.nonce || claims.nonce !== eph.nonce) { fail("Login nonce mismatch — please retry the sign-in from this site."); return; }

  // Deterministic salt from the salt service => same address on every device (HANDOFF §6.1-1).
  out('<p class="muted"><span class="spinner"></span>Deriving your Sui address…</p>');
  fetch(CFG.saltServicePath || "/api/zklogin-salt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id_token: idToken })
  }).then(function(r){
    return r.json().then(function(body){ return { status: r.status, body: body }; });
  }).then(function(res){
    if (res.status !== 200 || !res.body || !res.body.salt) {
      var why = res.body && res.body.error === "salt_service_not_configured"
        ? "Salt service is not configured on the server (ZKLOGIN_SALT_SECRET missing)."
        : "Salt service rejected the sign-in (" + ((res.body && res.body.error) || ("HTTP " + res.status)) + ").";
      throw new Error(why);
    }
    var salt = String(res.body.salt);
    var address = RN_ZK.jwtToAddress(idToken, salt);
    var zkAttestation = res.body.session_attestation || null;
    var zkAttestationPayload = res.body.session_attestation_payload || null;
    if (zkAttestationPayload && zkAttestationPayload.sub && zkAttestationPayload.sub !== address) {
      throw new Error("Salt service session proof did not match the derived zkLogin address.");
    }
    localStorage.removeItem("rn_zk_salts"); // legacy random per-browser salts
    // Non-sensitive session only; the token + salt live in sessionStorage for this tab's lifetime.
    localStorage.setItem("rn_session", JSON.stringify({ provider: "google", address: address, sub: claims.sub, email: claims.email || null, iss: claims.iss, ts: Date.now() }));
    if (zkAttestation) {
      localStorage.setItem("rn_zk_attestation", JSON.stringify({
        address: address,
        session_attestation: zkAttestation,
        session_attestation_payload: zkAttestationPayload,
        exp: zkAttestationPayload && zkAttestationPayload.exp || null,
        ts: Date.now()
      }));
    } else {
      localStorage.removeItem("rn_zk_attestation");
    }
    sessionStorage.setItem("rn_zk_session", JSON.stringify({ id_token: idToken, salt: salt, maxEpoch: eph.maxEpoch, randomness: eph.randomness }));
    var acceptanceRole = sessionStorage.getItem("rn_acceptance_debug_role") || "";
    var acceptanceHtml = "";
    if (acceptanceRole === "buyer" || acceptanceRole === "agent") {
      sessionStorage.setItem("rn_acceptance_last_role", acceptanceRole);
      acceptanceHtml = '<section aria-labelledby="acceptance-session-heading"><h2 id="acceptance-session-heading">Acceptance session ready</h2><p class="muted">This ' + esc(acceptanceRole) + ' session is available only in the dedicated debug tools for this browser tab.</p><p><a class="button" href="/debug.html">Open debug tools</a></p></section>';
    }
    out('<h2>Signed in &#10003;</h2><p>Your Sui zkLogin address:</p><p><code class="addr">' + esc(address) + '</code></p><p class="muted">' + esc(claims.email || claims.sub) + ' · ' + esc(claims.iss) + '</p><p class="muted">Same Google account &rArr; same address on every device (server-side deterministic salt).</p>' + acceptanceHtml + '<p class="repo-actions"><a class="button" href="/account.html">Account &rarr;</a><a class="button" href="/login.html">Connect GitHub</a><a class="button" href="/">&larr; Back to site</a></p>');
  }).catch(function(e){
    fail((e && e.message) ? e.message : String(e));
  });
})();`;

const GITHUB_CALLBACK_JS = `(function(){
  function esc(v){ return String(v == null ? "" : v).replace(/[&<>"']/g,function(c){ return ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]; }); }
  function out(h){ document.getElementById("out").innerHTML = h; }
  function fail(msg){ out('<h2>GitHub connection failed</h2><p class="error">' + esc(msg) + '</p><p><a class="button" href="/login.html">Back to sign in</a></p>'); }
  function randomHex(n){ var b = crypto.getRandomValues(new Uint8Array(n)); var h = ""; for (var i = 0; i < b.length; i++) h += ("0" + b[i].toString(16)).slice(-2); return h; }
  function repoOwner(name){ var parts = String(name || "").split("/"); return parts.length > 1 ? parts[0] : ""; }
  function syntheticScopeId(account){ return "owner:" + String(account || "GitHub"); }
  function repoItems(binding){
    var seen = {};
    var out = [];
    var selected = selectedInstallationIds(binding);
    var selectedMap = {};
    selected.forEach(function(id){ selectedMap[String(id)] = true; });
    (binding && binding.available_repos || []).forEach(function(repo){
      var name = typeof repo === "string" ? repo : repo.full_name;
      var installationId = typeof repo === "string" ? binding.installation_id : repo.installation_id || null;
      var granted = typeof repo === "string" ? true : repo.granted !== false;
      var account = typeof repo === "string" ? repoOwner(name) || binding.account || null : repo.installation_account || repoOwner(name) || null;
      var accountType = typeof repo === "string" ? binding.account_type || null : repo.installation_account_type || null;
      var scopeId = installationId ? String(installationId) : syntheticScopeId(account);
      if (!name || seen[name] || !granted || !selectedMap[scopeId]) return;
      seen[name] = true;
      out.push({
        full_name: name,
        granted: true,
        installation_id: installationId || scopeId,
        installation_account: account,
        installation_account_type: accountType
      });
    });
    (binding && binding.installations || []).forEach(function(installation){
      var installationId = installation && installation.id;
      if (!installationId || !selectedMap[String(installationId)]) return;
      (installation.repos || []).forEach(function(name){
        if (!name || seen[name]) return;
        seen[name] = true;
        out.push({
          full_name: name,
          granted: true,
          installation_id: installationId,
          installation_account: installation.account || null,
          installation_account_type: installation.accountType || installation.account_type || null
        });
      });
    });
    var fallbackInstallationId = binding && binding.installation_id ? String(binding.installation_id) : "";
    var hasInstallations = Boolean(binding && binding.installations && binding.installations.length);
    (binding && binding.repos || []).forEach(function(name){
      if (!name || seen[name]) return;
      var account = repoOwner(name) || binding.account || null;
      var scopeId = fallbackInstallationId || syntheticScopeId(account);
      if (hasInstallations && (!fallbackInstallationId || !selectedMap[fallbackInstallationId])) return;
      if (!selectedMap[scopeId]) return;
      seen[name] = true;
      out.push({
        full_name: name,
        granted: true,
        installation_id: binding.installation_id || scopeId,
        installation_account: account,
        installation_account_type: binding.account && account === binding.account ? binding.account_type || null : null
      });
    });
    out.sort(function(a,b){ return a.full_name.localeCompare(b.full_name); });
    return out;
  }
  function accountItems(binding){
    var scopes = binding && Array.isArray(binding.organization_scopes) ? binding.organization_scopes : [];
    if (scopes.length) {
      return scopes.map(function(scope){
        return {
          id: String(scope.id || scope.installation_id || ("uninstalled:" + scope.account)),
          account: scope.account || "GitHub",
          accountType: scope.accountType || scope.account_type || "Account",
          installed: scope.installed !== false,
          repos: Array.isArray(scope.repos) ? scope.repos : []
        };
      }).sort(function(a,b){
        if (a.installed !== b.installed) return a.installed ? -1 : 1;
        return a.account.localeCompare(b.account);
      });
    }
    var installations = binding && Array.isArray(binding.installations) ? binding.installations : [];
    if (installations.length) {
      var byAccount = {};
      installations.forEach(function(installation){
        var account = installation.account || "GitHub";
        var accountType = installation.accountType || installation.account_type || "Account";
        var key = account + "\u0000" + accountType;
        if (!byAccount[key]) byAccount[key] = { id: String(installation.id), account: account, accountType: accountType, installed: true, repos: [] };
        (installation.repos || []).forEach(function(repo){ if (byAccount[key].repos.indexOf(repo) === -1) byAccount[key].repos.push(repo); });
      });
      return Object.keys(byAccount).map(function(key){ return byAccount[key]; });
    }
    var accounts = {};
    var scopeByOwner = {};
    function addRepo(name, installationId, account, accountType){
      if (!name) return;
      var owner = repoOwner(name) || account || (binding && binding.login) || "GitHub";
      var resolvedType = (account && owner === account ? accountType : null) || (binding && binding.login && owner === binding.login ? "User" : "Account");
      var existingId = scopeByOwner[owner];
      var id = installationId ? String(installationId) : (existingId || syntheticScopeId(owner));
      if (installationId && existingId && existingId !== id && accounts[existingId]) {
        accounts[id] = accounts[existingId];
        accounts[id].id = id;
        delete accounts[existingId];
      }
      scopeByOwner[owner] = id;
      if (!accounts[id]) accounts[id] = { id: id, account: owner, accountType: resolvedType, installed: true, repos: [] };
      if (accounts[id].repos.indexOf(name) === -1) accounts[id].repos.push(name);
    }
    (binding && binding.available_repos || []).forEach(function(repo){
      var name = typeof repo === "string" ? repo : repo.full_name;
      var granted = typeof repo === "string" ? true : repo.granted !== false;
      if (!granted) return;
      addRepo(name, typeof repo === "string" ? binding.installation_id : repo.installation_id || null, typeof repo === "string" ? binding.account || null : repo.installation_account || null, typeof repo === "string" ? binding.account_type || null : repo.installation_account_type || null);
    });
    (binding && binding.repos || []).forEach(function(name){
      addRepo(name, binding && binding.installation_id || null, binding && binding.account || null, binding && binding.account_type || null);
    });
    return Object.keys(accounts).map(function(id){ return accounts[id]; }).sort(function(a,b){ return a.account.localeCompare(b.account); });
  }
  function selectedInstallationIds(binding){
    var accounts = accountItems(binding);
    var selectable = accounts.filter(function(account){ return account.installed !== false; });
    var ids = binding && binding.selected_installation_ids;
    if (Array.isArray(ids)) {
      var valid = {};
      selectable.forEach(function(account){ valid[String(account.id)] = true; });
      var normalized = ids.map(function(id){ return String(id); }).filter(function(id){ return valid[id]; });
      if (ids.length > 0 && !normalized.length) return selectable.map(function(account){ return account.id; });
      return normalized;
    }
    return selectable.map(function(account){ return account.id; });
  }
  function selectedRepoItem(binding, repos){
    var selected = binding && binding.selected_repo;
    for (var i = 0; selected && i < repos.length; i++) {
      if (repos[i].full_name === selected && repos[i].granted) return repos[i];
    }
    for (var j = 0; j < repos.length; j++) {
      if (repos[j].granted) return repos[j];
    }
    return repos[0] || null;
  }
  function installationForRepo(binding, repo){
    if (!binding || !repo || !repo.installation_id) return null;
    var id = String(repo.installation_id);
    var installations = binding.installations || [];
    for (var i = 0; i < installations.length; i++) {
      if (String(installations[i].id) === id) return installations[i];
    }
    return null;
  }
  function applySelectedRepo(binding, repo){
    if (!binding || !repo || !repo.full_name) return binding;
    binding.selected_repo = repo.full_name;
    if (repo.granted && repo.installation_id && !String(repo.installation_id).startsWith("owner:")) {
      var installation = installationForRepo(binding, repo);
      binding.installation_id = Number(repo.installation_id);
      binding.account = repo.installation_account || (installation && installation.account) || binding.account || null;
      binding.account_type = repo.installation_account_type || (installation && installation.accountType) || binding.account_type || null;
      binding.repos = installation && installation.repos ? installation.repos : [repo.full_name];
      var attestation = binding.binding_attestations && binding.binding_attestations[String(binding.installation_id)];
      if (attestation) {
        binding.binding_attestation = attestation.binding_attestation || binding.binding_attestation;
        binding.binding_attestation_payload = attestation.binding_attestation_payload || binding.binding_attestation_payload;
      }
    } else {
      binding.account = repo.installation_account || binding.account || null;
      binding.account_type = repo.installation_account_type || binding.account_type || null;
    }
    return binding;
  }
  function syncCurrentRepo(binding){
    var repos = repoItems(binding);
    var selected = selectedRepoItem(binding, repos);
    if (selected) applySelectedRepo(binding, selected);
    return selected;
  }
  function accountSelectorHtml(binding){
    var accounts = accountItems(binding);
    if (!accounts.length) return "";
    var selected = {};
    selectedInstallationIds(binding).forEach(function(id){ selected[String(id)] = true; });
    var hasOrgScope = accounts.some(function(account){ return String(account.accountType || account.account_type || "").toLowerCase() === "organization"; });
    var orgHint = hasOrgScope ? "" : '<p class="muted repo-account-hint">Organization repositories appear after installing or approving the GitHub App in that organization.</p>';
    return '<fieldset class="repo-account-scope"><legend>GitHub account / organization</legend>'
      + accounts.map(function(account){
        var label = account.account + (account.accountType ? " · " + account.accountType : "");
        var installed = account.installed !== false;
        var detail = installed ? (account.repos.length + " authorized repo(s)") : "Not authorized yet";
        return '<label class="repo-account' + (installed ? "" : " unavailable") + '"><input class="rn-installation-scope" type="checkbox" value="' + esc(account.id) + '"' + (selected[account.id] && installed ? " checked" : "") + (installed ? "" : " disabled") + '><span><b>' + esc(label) + '</b><br><span class="muted">' + esc(detail) + '</span></span></label>';
      }).join("")
      + orgHint
      + '</fieldset>';
  }
  function repoSelectorHtml(binding, selectId){
    var repos = repoItems(binding);
    if (!repos.length) return '<p class="muted">No repositories available in the selected accounts/orgs.</p>';
    var selected = selectedRepoItem(binding, repos);
    return '<label class="muted" for="' + esc(selectId) + '">Research repo</label><br>'
      + '<select id="' + esc(selectId) + '" class="repo-select">'
      + repos.map(function(repo){
          var label = repo.full_name + (repo.installation_account ? " · " + repo.installation_account : "");
          return '<option value="' + esc(repo.full_name) + '" data-installation-id="' + esc(repo.installation_id || "") + '" data-installation-account="' + esc(repo.installation_account || "") + '" data-installation-account-type="' + esc(repo.installation_account_type || "") + '"' + (selected && repo.full_name === selected.full_name ? " selected" : "") + '>' + esc(label) + '</option>';
        }).join("")
      + '</select>';
  }
  function selectedOptionRepo(select){
    var option = select.options[select.selectedIndex];
    return {
      full_name: select.value,
      granted: !option.disabled,
      installation_id: option.getAttribute("data-installation-id") || null,
      installation_account: option.getAttribute("data-installation-account") || null,
      installation_account_type: option.getAttribute("data-installation-account-type") || null
    };
  }
  function wireRepoControls(binding, selectId, pickerId){
    if (!binding) return;
    function persist(){ localStorage.setItem("rn_github", JSON.stringify(binding)); }
    function wireSelect(){
      var select = document.getElementById(selectId);
      if (!select) return;
      if (select.value && binding.selected_repo !== select.value) {
        applySelectedRepo(binding, selectedOptionRepo(select));
        persist();
      }
      select.addEventListener("change", function(){
        applySelectedRepo(binding, selectedOptionRepo(select));
        persist();
      });
    }
    Array.prototype.forEach.call(document.querySelectorAll(".rn-installation-scope"), function(input){
      input.addEventListener("change", function(){
        var checked = Array.prototype.slice.call(document.querySelectorAll(".rn-installation-scope"))
          .filter(function(el){ return el.checked; })
          .map(function(el){ return String(el.value); });
        binding.selected_installation_ids = checked;
        syncCurrentRepo(binding);
        var picker = document.getElementById(pickerId);
        if (picker) picker.innerHTML = repoSelectorHtml(binding, selectId);
        persist();
        wireSelect();
      });
    });
    wireSelect();
  }
  function saveGithubState(value){
    var encoded = JSON.stringify(value);
    sessionStorage.setItem("rn_gh_state", encoded);
    try { localStorage.setItem("rn_gh_state", encoded); } catch (e) {}
  }
  function clearGithubState(){
    sessionStorage.removeItem("rn_gh_state");
    try { localStorage.removeItem("rn_gh_state"); } catch (e) {}
  }
  function readGithubState(sessionAddress){
    var values = [];
    try { values.push(JSON.parse(sessionStorage.getItem("rn_gh_state") || "null")); } catch (e) {}
    try { values.push(JSON.parse(localStorage.getItem("rn_gh_state") || "null")); } catch (e) {}
    for (var i = 0; i < values.length; i++) {
      var value = values[i];
      if (!value || !value.csrf || value.address !== sessionAddress) continue;
      if (value.ts && Date.now() - Number(value.ts) > 30 * 60 * 1000) continue;
      return value;
    }
    return null;
  }
  function readGithubRecovery(sessionAddress){
    var value = null;
    try { value = JSON.parse(sessionStorage.getItem("rn_gh_recovery") || "null"); } catch (e) {}
    if (!value || value.address !== sessionAddress) return { count: 0 };
    if (value.ts && Date.now() - Number(value.ts) > 10 * 60 * 1000) return { count: 0 };
    return { count: Number(value.count) || 0 };
  }
  function saveGithubRecovery(sessionAddress, count){
    try { sessionStorage.setItem("rn_gh_recovery", JSON.stringify({ address: sessionAddress, count: count, ts: Date.now() })); } catch (e) {}
  }
  function clearGithubRecovery(){
    try { sessionStorage.removeItem("rn_gh_recovery"); } catch (e) {}
  }
  function readZkLoginProof(sessionAddress){
    var zkSession = null;
    try { zkSession = JSON.parse(sessionStorage.getItem("rn_zk_session") || "null"); } catch (e) {}
    if (zkSession && zkSession.id_token) {
      return { id_token: zkSession.id_token };
    }
    var stored = null;
    try { stored = JSON.parse(localStorage.getItem("rn_zk_attestation") || "null"); } catch (e) {}
    if (
      stored &&
      stored.address === sessionAddress &&
      stored.session_attestation &&
      (!stored.exp || Number(stored.exp) * 1000 >= Date.now())
    ) {
      return { zk_session_attestation: stored.session_attestation };
    }
    return null;
  }
  var CFG = window.RN_AUTH_CONFIG || {};
  var p = new URLSearchParams(location.search);
  var code = p.get("code");
  var installationId = p.get("installation_id");

  var session = null;
  try { session = JSON.parse(localStorage.getItem("rn_session") || "null"); } catch (e) {}
  if (!session || !session.address) { fail("Sign in with Google (zkLogin) first — GitHub repos are bound to your Sui address."); return; }

  var ghState = null;
  ghState = readGithubState(session.address);
  function restartGithubAuthorize(message){
    if (!CFG.githubClientId) { fail("GitHub OAuth is not configured."); return; }
    out('<p class="muted"><span class="spinner"></span>' + esc(message) + '</p>');
    var csrf = randomHex(16);
    saveGithubState({ csrf: csrf, address: session.address, ts: Date.now() });
    var url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", CFG.githubClientId);
    url.searchParams.set("redirect_uri", location.origin + (CFG.githubCallbackPath || "/auth/github-callback.html"));
    url.searchParams.set("state", csrf);
    location.replace(url.toString());
  }
  function recoverGithubStateMismatch(message){
    var recovery = readGithubRecovery(session.address);
    if (recovery.count >= 2) {
      fail("OAuth state mismatch — restart the GitHub connection from the sign-in page.");
      return;
    }
    saveGithubRecovery(session.address, recovery.count + 1);
    restartGithubAuthorize(message);
  }

  if (!code) {
    // Install-only redirect (Setup URL) without user authorization — send through the authorize
    // step so the server can verify who is connecting (never trust bare URL params, D-11).
    if (installationId && CFG.githubClientId) {
      restartGithubAuthorize("Installation detected — finishing authorization…");
      return;
    }
    fail("No authorization code in the redirect — the GitHub App may be missing \\"Request user authorization (OAuth) during installation\\", or you cancelled.");
    return;
  }

  // CSRF check when the flow started on this site. (A Setup-URL re-entry restarts above.)
  if (!ghState || !ghState.csrf || p.get("state") !== ghState.csrf) {
    if (installationId || p.get("setup_action")) {
      recoverGithubStateMismatch("Repository access updated — finishing GitHub authorization…");
      return;
    }
    recoverGithubStateMismatch("GitHub authorization state expired — retrying securely…");
    return;
  }
  clearGithubRecovery();
  clearGithubState();

  var zkProof = readZkLoginProof(session.address);
  if (!zkProof) { fail("Your zkLogin session proof expired — sign in with Google again before connecting GitHub."); return; }

  out('<p class="muted"><span class="spinner"></span>Connecting to GitHub… checking installations</p>');
  var oauthBody = { code: code };
  if (zkProof.id_token) {
    oauthBody.id_token = zkProof.id_token;
  } else {
    oauthBody.zk_session_attestation = zkProof.zk_session_attestation;
  }
  fetch(CFG.githubOauthPath || "/api/github-oauth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(oauthBody)
  }).then(function(r){
    return r.json().then(function(body){ return { status: r.status, body: body }; });
  }).then(function(res){
    var body = res.body || {};
    if (res.status === 503) { throw new Error("GitHub OAuth is not configured on the server (client secret missing)."); }
    if (res.status !== 200) { throw new Error(body.message || body.error || ("HTTP " + res.status)); }
    if (!body.sui_address || body.sui_address !== session.address) { throw new Error("Verified zkLogin address did not match the current session; sign in again before connecting GitHub."); }
    if (!body.installed || !body.installations || !body.installations.length) {
      if (CFG.githubInstallUrl) {
        out('<p class="muted"><span class="spinner"></span>App not installed yet — taking you to the install page…</p>');
        setTimeout(function(){ location.href = CFG.githubInstallUrl; }, 800);
        return;
      }
      throw new Error("The GitHub App is not installed on any of your accounts.");
    }
    var installations = body.installations || [];
    var selectedInstallationIds = installations.map(function(inst){ return String(inst.id); });
    var inst = installations[0];
    var availableRepos = body.available_repositories || [];
    var binding = {
      sui_address: body.sui_address,
      login: body.login || null,
      installation_id: inst && inst.id,
      account: inst && inst.account || null,
      account_type: inst && (inst.accountType || inst.account_type) || null,
      installations: installations,
      organizations: body.organizations || [],
      organization_scopes: body.organization_scopes || [],
      selected_installation_ids: selectedInstallationIds,
      repos: inst && inst.repos || [],
      available_repos: availableRepos,
      selected_repo: null,
      binding_attestation: body.binding_attestation || null,
      binding_attestation_payload: body.binding_attestation_payload || null,
      binding_attestations: body.binding_attestations || {},
      server_persisted: Boolean(body.server_persisted),
      account_id: body.account_id || null,
      ts: Date.now()
    };
    syncCurrentRepo(binding);
    localStorage.setItem("rn_github", JSON.stringify(binding));
    var manageUrl = CFG.githubInstallUrl || (inst && inst.id ? "https://github.com/settings/installations/" + encodeURIComponent(String(inst.id)) : "");
    var accountCount = installations.length;
    var repoCount = repoItems(binding).length;
    out('<h2>GitHub connected &#10003;</h2>'
      + '<p><b>' + esc(body.login || "GitHub user") + '</b> &rarr; bound to <code class="addr">' + esc(session.address) + '</code></p>'
      + '<p class="repo-summary">' + accountCount + ' GitHub account/org scope(s), ' + repoCount + ' authorized repo(s).</p>'
      + accountSelectorHtml(binding)
      + '<div id="rn-repo-picker">' + repoSelectorHtml(binding, "rn-repo-select") + '</div>'
      + '<p class="repo-actions"><a class="button" href="/account.html">Account &rarr;</a>'
      + (manageUrl ? '<a class="button" href="' + esc(manageUrl) + '" rel="noopener">Add GitHub account/org access &rarr;</a>' : '')
      + '<a class="button" href="/">&larr; Back to site</a></p>');
    wireRepoControls(binding, "rn-repo-select", "rn-repo-picker");
  }).catch(function(e){
    fail((e && e.message) ? e.message : String(e));
  });
})();`;
