import { createHash, createHmac } from "node:crypto";
import {
  type AuthLoginIntent,
  type CrossChainAuthProvider,
  type GitIdentity,
  type GitProvider,
  type PlatformAccount,
  type WalletBinding,
  type ZkLoginBinding
} from "./types.js";
import { randomToken, shortHash } from "./crypto.js";
import { readAuthState, upsertAuthIntent, upsertPlatformAccount } from "./local-store.js";

const GIT_PROVIDERS = new Set<GitProvider>(["github", "gitlab", "gitea"]);
const CROSS_CHAIN_PROVIDERS = new Set<CrossChainAuthProvider>(["privy", "dynamic", "web3auth", "particle", "lit", "custom-oidc"]);

const DEFAULT_GIT_SCOPES: Record<GitProvider, string[]> = {
  github: ["read:user", "user:email", "repo"],
  gitlab: ["openid", "profile", "email", "read_repository", "write_repository"],
  gitea: ["openid", "profile", "email", "read:repository", "write:repository"]
};

const DEFAULT_REPO_PERMISSIONS = [
  "metadata:read",
  "contents:read",
  "contents:write",
  "pull_requests:write"
];

export interface StartAuthLoginInput {
  provider: GitProvider | CrossChainAuthProvider;
  redirectUri: string;
  clientId: string;
  scopes?: string[];
  state?: string;
  ttlSeconds?: number;
  giteaBaseUrl?: string;
  externalAuthorizeUrl?: string;
  externalIssuer?: string;
  externalWallets?: WalletBinding["chain"][];
  externalSupportsGitLinking?: boolean;
  zkLogin?: boolean;
  zkLoginIssuer?: string;
  zkLoginProverUrl?: string;
  saltStrategy?: AuthLoginIntent["zklogin"]["salt_strategy"];
  localnetRoot?: string;
}

export interface CompleteAuthLoginInput {
  intentId?: string;
  state?: string;
  issuer?: string;
  subject?: string;
  audience?: string;
  displayName?: string;
  git?: GitIdentity;
  wallets?: WalletBinding[];
  roles?: string[];
  saltSecret?: string;
  localnetRoot?: string;
}

export interface ZkLoginAddressInput {
  issuer: string;
  subject: string;
  audience?: string;
  saltSecret?: string;
}

function providerKind(provider: GitProvider | CrossChainAuthProvider): AuthLoginIntent["provider_kind"] {
  if (GIT_PROVIDERS.has(provider as GitProvider)) {
    return "git";
  }
  if (CROSS_CHAIN_PROVIDERS.has(provider as CrossChainAuthProvider)) {
    return "cross-chain";
  }
  throw new Error(`Unsupported auth provider: ${provider}`);
}

function gitAuthorizeUrl(provider: GitProvider, giteaBaseUrl?: string): string {
  if (provider === "github") {
    return "https://github.com/login/oauth/authorize";
  }
  if (provider === "gitlab") {
    return "https://gitlab.com/oauth/authorize";
  }
  if (!giteaBaseUrl) {
    throw new Error("giteaBaseUrl is required for Gitea OAuth");
  }
  return new URL("/login/oauth/authorize", giteaBaseUrl).toString();
}

function withQuery(baseUrl: string, params: Record<string, string | undefined>): string {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function hashHex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function deriveZkLoginBinding(input: ZkLoginAddressInput & { nonce: string; provider: GitProvider | CrossChainAuthProvider }): ZkLoginBinding {
  const saltSecret = input.saltSecret ?? process.env.JWT_SALT_SECRET ?? "local-dev-zklogin-salt";
  const stableSubject = `${input.issuer}:${input.subject}:${input.audience ?? ""}`;
  const salt = createHmac("sha256", saltSecret).update(stableSubject).digest("hex");
  const address = `0x${hashHex(`zklogin:${stableSubject}:${salt}`).slice(0, 64)}`;
  return {
    issuer: input.issuer,
    subject: input.subject,
    audience: input.audience,
    address,
    salt_hash: `sha256:${hashHex(salt)}`,
    nonce: input.nonce,
    provider: input.provider
  };
}

export async function startAuthLogin(input: StartAuthLoginInput): Promise<AuthLoginIntent> {
  const kind = providerKind(input.provider);
  const state = input.state ?? randomToken("auth_state");
  const nonce = randomToken("zk_nonce");
  const scopes = input.scopes ?? (kind === "git" ? DEFAULT_GIT_SCOPES[input.provider as GitProvider] : ["openid", "profile", "email", "wallets"]);
  const ttlSeconds = input.ttlSeconds ?? 600;
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + ttlSeconds * 1000);
  const zkLoginEnabled = input.zkLogin ?? true;
  const issuer = input.zkLoginIssuer ?? input.externalIssuer ?? (kind === "git" ? `https://${input.provider}.com` : undefined);

  const authorizeBase = kind === "git"
    ? gitAuthorizeUrl(input.provider as GitProvider, input.giteaBaseUrl)
    : input.externalAuthorizeUrl;
  if (!authorizeBase) {
    throw new Error("externalAuthorizeUrl is required for cross-chain auth providers");
  }

  const authorizationUrl = withQuery(authorizeBase, {
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    state,
    nonce
  });

  const intent: AuthLoginIntent = {
    id: `auth:${shortHash(`${input.provider}:${state}:${nonce}`, 18)}`,
    provider: input.provider,
    provider_kind: kind,
    authorization_url: authorizationUrl,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    scopes,
    state,
    nonce,
    created_at: createdAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    zklogin: {
      enabled: zkLoginEnabled,
      issuer,
      salt_strategy: input.saltStrategy ?? "platform-derived",
      prover_url: input.zkLoginProverUrl
    }
  };

  if (kind === "git") {
    intent.git = {
      provider: input.provider as GitProvider,
      repository_permissions_required: DEFAULT_REPO_PERMISSIONS
    };
  } else {
    intent.external = {
      provider: input.provider as CrossChainAuthProvider,
      issuer: issuer ?? input.externalAuthorizeUrl ?? "custom",
      supports_wallets: input.externalWallets ?? ["sui", "evm", "solana"],
      supports_git_linking: input.externalSupportsGitLinking ?? true
    };
  }

  return upsertAuthIntent(intent, input.localnetRoot);
}

function accountIdFromBinding(binding: ZkLoginBinding | undefined, git: GitIdentity | undefined, provider: AuthLoginIntent["provider"]): string {
  if (binding) {
    return `acct:${shortHash(`${binding.issuer}:${binding.subject}:${binding.address}`, 18)}`;
  }
  if (git) {
    return `acct:${shortHash(`${git.provider}:${git.user_id}`, 18)}`;
  }
  return `acct:${shortHash(`${provider}:${Date.now()}:${Math.random()}`, 18)}`;
}

function findIntent(auth: Awaited<ReturnType<typeof readAuthState>>, input: CompleteAuthLoginInput): AuthLoginIntent {
  const intent = input.intentId
    ? auth.intents[input.intentId]
    : Object.values(auth.intents).find((candidate) => candidate.state === input.state);
  if (!intent) {
    throw new Error("Auth login intent not found");
  }
  if (new Date(intent.expires_at).getTime() < Date.now()) {
    throw new Error("Auth login intent expired");
  }
  return intent;
}

export async function completeAuthLogin(input: CompleteAuthLoginInput): Promise<PlatformAccount> {
  const auth = await readAuthState(input.localnetRoot);
  const intent = findIntent(auth, input);
  const issuer = input.issuer ?? intent.zklogin.issuer;
  const subject = input.subject ?? input.git?.user_id;
  const zklogin = intent.zklogin.enabled && issuer && subject
    ? deriveZkLoginBinding({
      issuer,
      subject,
      audience: input.audience ?? intent.client_id,
      nonce: intent.nonce,
      provider: intent.provider,
      saltSecret: input.saltSecret
    })
    : undefined;

  const wallets = [...(input.wallets ?? [])];
  if (zklogin && !wallets.some((wallet) => wallet.chain === "sui" && wallet.address === zklogin.address)) {
    wallets.unshift({
      chain: "sui",
      address: zklogin.address,
      verified_by: "zklogin"
    });
  }

  const account: PlatformAccount = {
    id: accountIdFromBinding(zklogin, input.git, intent.provider),
    display_name: input.displayName ?? input.git?.username ?? subject ?? "Research Network User",
    primary_provider: intent.provider,
    git: input.git,
    zklogin,
    wallets,
    roles: input.roles ?? ["user"],
    created_at: auth.accounts[accountIdFromBinding(zklogin, input.git, intent.provider)]?.created_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  return upsertPlatformAccount(account, input.localnetRoot);
}
