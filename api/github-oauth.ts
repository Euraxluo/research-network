import { createGithubBindingAttestation } from "../src/core/github-binding.js";
import { collectGithubUserAccess } from "../src/core/github.js";
import { upsertGithubRepositoryBinding } from "../src/core/local-store.js";
import { deriveUserSalt, deriveZkLoginAddress, JwtVerificationError, verifyJwt } from "../src/core/zklogin.js";

interface InstallationSummary {
  id: number;
  account: string | null;
  accountType: string | null;
  appSlug: string | null;
  repos: string[];
}

interface RepositorySummary {
  id: number | null;
  full_name: string;
  private: boolean;
  html_url: string | null;
  granted: boolean;
  installation_id: number | null;
  installation_account: string | null;
  installation_account_type: string | null;
}

interface GithubScopeSummary {
  id: string;
  account: string;
  accountType: string;
  installed: boolean;
  installation_id: number | null;
  repos: string[];
}

/** GitHub user-authorization callback exchange (Cursor-style flow, HANDOFF §2.3).
 *  POST { code } → exchanges it with the App's client secret for a user access token, then checks
 *  the user's installations of THIS app and the repos they granted. It also verifies the current
 *  zkLogin id_token and returns the server-derived Sui address, so the browser can only persist a
 *  GitHub binding that matches the signed-in Google account. Requires GitHub OAuth env vars plus
 *  GOOGLE_CLIENT_ID and ZKLOGIN_SALT_SECRET. */
export default async function handler(req: any, res: any) {
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/json; charset=utf-8");
  if (req.method !== "POST") {
    res.status(405).send(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }
  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.status(503).send(JSON.stringify({
      error: "github_oauth_not_configured",
      message: "GITHUB_APP_CLIENT_ID / GITHUB_APP_CLIENT_SECRET env vars are missing"
    }));
    return;
  }
  if (!process.env.ZKLOGIN_SALT_SECRET || !process.env.GOOGLE_CLIENT_ID) {
    res.status(503).send(JSON.stringify({
      error: "zklogin_binding_not_configured",
      message: "ZKLOGIN_SALT_SECRET / GOOGLE_CLIENT_ID env vars are missing"
    }));
    return;
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
    const code = typeof body.code === "string" ? body.code : undefined;
    if (!code) {
      res.status(400).send(JSON.stringify({ error: "missing_code" }));
      return;
    }
    const idToken = typeof body.id_token === "string" ? body.id_token : undefined;
    if (!idToken) {
      res.status(400).send(JSON.stringify({ error: "missing_id_token" }));
      return;
    }
    const claims = await verifyJwt(idToken, { audience: process.env.GOOGLE_CLIENT_ID });
    const salt = deriveUserSalt({ issuer: claims.iss, subject: claims.sub, audience: claims.aud });
    const suiAddress = deriveZkLoginAddress(idToken, salt);

    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code })
    });
    const tokenBody = await tokenResponse.json() as { access_token?: string; error?: string; error_description?: string };
    if (!tokenResponse.ok || !tokenBody.access_token) {
      res.status(401).send(JSON.stringify({
        error: "code_exchange_failed",
        message: tokenBody.error_description || tokenBody.error || `HTTP ${tokenResponse.status}`
      }));
      return;
    }
    const snapshot = await collectGithubUserAccess(tokenBody.access_token, {
      appSlug: process.env.GITHUB_APP_SLUG
    });
    const user = snapshot.user;
    const summaries: InstallationSummary[] = snapshot.installations.map((installation) => ({
      id: installation.id,
      account: installation.account.login,
      accountType: installation.account.type,
      appSlug: installation.app_slug,
      repos: installation.repos
    }));
    const availableRepos: RepositorySummary[] = snapshot.available_repositories.map((repo) => ({
      id: repo.id,
      full_name: repo.full_name,
      private: repo.private,
      html_url: repo.html_url,
      granted: repo.granted,
      installation_id: repo.installation_id,
      installation_account: repo.installation_account,
      installation_account_type: repo.installation_account_type
    }));
    const organizationScopes: GithubScopeSummary[] = snapshot.organization_scopes;

    const attestationByInstallation = new Map<number, ReturnType<typeof createGithubBindingAttestation>>();
    for (const installation of summaries) {
      attestationByInstallation.set(
        installation.id,
        createGithubBindingAttestation({
          suiAddress,
          githubLogin: user.login ?? null,
          installationId: installation.id,
          account: installation.account,
          repos: installation.repos
        })
      );
    }
    const primaryInstallation = summaries.find((installation) => installation.repos.length > 0) ?? summaries[0];
    const attestation = primaryInstallation ? attestationByInstallation.get(primaryInstallation.id) ?? null : null;
    let persistedAccountId: string | null = null;
    let persistedInstallationCount = 0;
    for (const installation of summaries) {
      const installationAttestation = attestationByInstallation.get(installation.id);
      if (!installationAttestation) {
        continue;
      }
      try {
        const account = await upsertGithubRepositoryBinding({
          provider: "github",
          github_login: user.login || null,
          sui_address: suiAddress,
          installation_id: installation.id,
          account: installation.account,
          repos: installation.repos,
          selected_repo: installation.repos[0] ?? null,
          binding_attestation: installationAttestation.token,
          binding_attestation_payload: installationAttestation.payload as unknown as Record<string, unknown>,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, typeof req.localnetRoot === "string" ? req.localnetRoot : undefined);
        persistedAccountId = account.id;
        persistedInstallationCount += 1;
      } catch (persistError) {
        console.error("github_binding_persist_failed", persistError);
      }
    }
    const bindingAttestations = Object.fromEntries([...attestationByInstallation.entries()].map(([installationId, item]) => [
      String(installationId),
      {
        binding_attestation: item.token,
        binding_attestation_payload: item.payload
      }
    ]));

    res.status(200).send(JSON.stringify({
      login: user.login ?? null,
      sui_address: suiAddress,
      installed: summaries.length > 0,
      installations: summaries,
      organizations: snapshot.organizations,
      organization_scopes: organizationScopes,
      available_repositories: availableRepos,
      binding_attestation: attestation ? attestation.token : null,
      binding_attestation_payload: attestation ? attestation.payload : null,
      binding_attestations: bindingAttestations,
      server_persisted: persistedInstallationCount > 0,
      account_id: persistedAccountId
    }));
  } catch (error) {
    if (error instanceof JwtVerificationError) {
      res.status(401).send(JSON.stringify({ error: "invalid_id_token", code: error.code }));
      return;
    }
    res.status(500).send(JSON.stringify({ error: "github_oauth_error" }));
  }
}
