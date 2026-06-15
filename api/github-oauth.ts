import { createGithubBindingAttestation } from "../src/core/github-binding.js";
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
    const userToken = tokenBody.access_token;
    const apiHeaders = {
      authorization: `Bearer ${userToken}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "research-network"
    };

    const userResponse = await fetch("https://api.github.com/user", { headers: apiHeaders });
    if (!userResponse.ok) {
      res.status(502).send(JSON.stringify({ error: "github_user_fetch_failed" }));
      return;
    }
    const user = await userResponse.json() as { login?: string };

    const availableRepos: RepositorySummary[] = [];
    const grantedRepoNames = new Set<string>();
    const grantedRepoInstallations = new Map<string, {
      installationId: number;
      account: string | null;
      accountType: string | null;
    }>();

    const installationsResponse = await fetch("https://api.github.com/user/installations?per_page=100", { headers: apiHeaders });
    if (!installationsResponse.ok) {
      res.status(502).send(JSON.stringify({ error: "github_installations_fetch_failed" }));
      return;
    }
    const installationsBody = await installationsResponse.json() as {
      installations?: Array<{ id: number; app_slug?: string; account?: { login?: string; type?: string } }>;
    };
    const appSlug = process.env.GITHUB_APP_SLUG;
    const installations = (installationsBody.installations ?? [])
      .filter((installation) => !appSlug || installation.app_slug === appSlug);

    const summaries: InstallationSummary[] = [];
    for (const installation of installations) {
      const repos: string[] = [];
      const installationAccount = installation.account?.login ?? null;
      const installationAccountType = installation.account?.type ?? null;
      const reposResponse = await fetch(
        `https://api.github.com/user/installations/${installation.id}/repositories?per_page=100`,
        { headers: apiHeaders }
      );
      if (reposResponse.ok) {
        const reposBody = await reposResponse.json() as { repositories?: Array<{ full_name?: string }> };
        for (const repo of reposBody.repositories ?? []) {
          if (repo.full_name) {
            repos.push(repo.full_name);
            grantedRepoNames.add(repo.full_name);
            grantedRepoInstallations.set(repo.full_name, {
              installationId: installation.id,
              account: installationAccount,
              accountType: installationAccountType
            });
          }
        }
      }
      summaries.push({
        id: installation.id,
        account: installationAccount,
        accountType: installationAccountType,
        appSlug: installation.app_slug ?? null,
        repos
      });
    }

    // Best effort: GitHub App user tokens can expose the repositories visible to the user, depending
    // on the App/OAuth permissions. When available, the browser can render a Vercel-style selector
    // in our own UI; granted=false repos still require GitHub App access to be expanded on GitHub.
    const userReposResponse = await fetch(
      "https://api.github.com/user/repos?per_page=100&affiliation=owner,collaborator,organization_member&visibility=all&sort=updated",
      { headers: apiHeaders }
    );
    if (userReposResponse.ok) {
      const reposBody = await userReposResponse.json() as Array<{ id?: number; full_name?: string; private?: boolean; html_url?: string }>;
      for (const repo of reposBody) {
        if (!repo.full_name) {
          continue;
        }
        const grant = grantedRepoInstallations.get(repo.full_name);
        availableRepos.push({
          id: typeof repo.id === "number" ? repo.id : null,
          full_name: repo.full_name,
          private: Boolean(repo.private),
          html_url: repo.html_url ?? null,
          granted: grantedRepoNames.has(repo.full_name),
          installation_id: grant?.installationId ?? null,
          installation_account: grant?.account ?? null,
          installation_account_type: grant?.accountType ?? null
        });
      }
    }
    for (const [fullName, grant] of grantedRepoInstallations) {
      if (!availableRepos.some((repo) => repo.full_name === fullName)) {
        availableRepos.push({
          id: null,
          full_name: fullName,
          private: false,
          html_url: `https://github.com/${fullName}`,
          granted: true,
          installation_id: grant.installationId,
          installation_account: grant.account,
          installation_account_type: grant.accountType
        });
      }
    }

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
          github_login: user.login ?? null,
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
