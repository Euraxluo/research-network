import { spawn } from "node:child_process";
import { createCipheriv, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { decodeJwtClaims, deriveUserSalt, deriveZkLoginAddress, verifyJwt } from "./zklogin.js";
import { readAuthState, upsertPlatformAccount, writeCliAuthSession } from "./local-store.js";
import { DEFAULT_LOCALNET_DIR, PROJECT_ROOT } from "./paths.js";
import { sha256Bytes, shortHash } from "./crypto.js";
import type { CliAuthSession, PlatformAccount } from "./types.js";

const DEFAULT_CLI_LOGIN_PORT = 8765;
const CLI_SESSION_KEY_PATH = path.join(PROJECT_ROOT, ".research-network", "secrets", "cli-session.key");

export interface CliLoginOptions {
  port?: number;
  localnetRoot?: string;
  clientId?: string;
  openBrowser?: boolean;
  timeoutMs?: number;
  onAuthorizeUrl?: (url: string) => void;
}

export interface CliLoginResult {
  account: PlatformAccount;
  session: Omit<CliAuthSession, "encrypted_id_token">;
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function loadGoogleClientId(explicit?: string): Promise<string> {
  const fromSecrets = await readJsonIfExists<{ google?: { client_id?: string } }>(
    path.join(PROJECT_ROOT, ".research-network", "secrets", "oauth.json")
  );
  const clientId = explicit ?? process.env.GOOGLE_CLIENT_ID ?? fromSecrets?.google?.client_id;
  if (!clientId) {
    throw new Error("Google OAuth client id not configured (set GOOGLE_CLIENT_ID or .research-network/secrets/oauth.json)");
  }
  return clientId;
}

async function ensureCliSessionKey(): Promise<Buffer> {
  await fs.mkdir(path.dirname(CLI_SESSION_KEY_PATH), { recursive: true, mode: 0o700 });
  try {
    const existing = await fs.readFile(CLI_SESSION_KEY_PATH);
    if (existing.length === 32) {
      return existing;
    }
  } catch {
    /* generate below */
  }
  const key = randomBytes(32);
  await fs.writeFile(CLI_SESSION_KEY_PATH, key, { mode: 0o600 });
  await fs.chmod(CLI_SESSION_KEY_PATH, 0o600).catch(() => {});
  return key;
}

async function encryptToken(idToken: string): Promise<CliAuthSession["encrypted_id_token"]> {
  const key = await ensureCliSessionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(idToken, "utf8"), cipher.final()]);
  return {
    alg: "aes-256-gcm",
    kid: shortHash(key.toString("base64url"), 12),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url")
  };
}

function openUrl(url: string): void {
  const command = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "cmd"
      : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

function callbackHtml(): string {
  return `<!doctype html><meta charset="utf-8"><title>Research Network CLI Login</title>
<body style="font-family:system-ui,sans-serif;max-width:680px;margin:40px auto;line-height:1.5">
<h1>Completing Research Network login...</h1>
<p id="status">Returning the Google id_token to the local CLI.</p>
<script>
(function () {
  var status = document.getElementById("status");
  var params = new URLSearchParams(location.hash.slice(1));
  fetch("/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id_token: params.get("id_token"),
      state: params.get("state"),
      error: params.get("error") || params.get("error_description")
    })
  }).then(function (res) { return res.json().then(function (body) { return { status: res.status, body: body }; }); })
    .then(function (res) {
      if (res.status !== 200) throw new Error(res.body.error || "login_failed");
      status.textContent = "Login complete. You can close this tab and return to the terminal.";
    })
    .catch(function (err) {
      status.textContent = "Login failed: " + (err && err.message ? err.message : String(err));
    });
})();
</script>`;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readRequestJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>;
}

export async function startCliLogin(options: CliLoginOptions = {}): Promise<CliLoginResult> {
  const clientId = await loadGoogleClientId(options.clientId);
  const port = options.port ?? DEFAULT_CLI_LOGIN_PORT;
  const state = randomBytes(18).toString("base64url");
  const nonce = randomBytes(18).toString("base64url");
  const redirectUri = `http://localhost:${port}/callback`;
  const authorizeUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("response_type", "id_token");
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "openid email profile");
  authorizeUrl.searchParams.set("nonce", nonce);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("prompt", "select_account");

  return new Promise<CliLoginResult>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close(() => fn());
    };
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", redirectUri);
        if (req.method === "GET" && url.pathname === "/callback") {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
          res.end(callbackHtml());
          return;
        }
        if (req.method === "POST" && url.pathname === "/token") {
          const body = await readRequestJson(req);
          if (body.error) {
            sendJson(res, 400, { error: String(body.error) });
            finish(() => reject(new Error(String(body.error))));
            return;
          }
          const idToken = typeof body.id_token === "string" ? body.id_token : "";
          if (!idToken || body.state !== state) {
            sendJson(res, 400, { error: "oauth_state_or_token_missing" });
            return;
          }
          const claims = await verifyJwt(idToken, { audience: clientId, nonce });
          const salt = deriveUserSalt({ issuer: claims.iss, subject: claims.sub, audience: claims.aud });
          const address = deriveZkLoginAddress(idToken, salt);
          const now = new Date().toISOString();
          const account: PlatformAccount = {
            id: `acct:${shortHash(`${claims.iss}:${claims.sub}:${address}`, 18)}`,
            display_name: String(claims.email ?? claims.sub),
            primary_provider: "custom-oidc",
            zklogin: {
              issuer: claims.iss,
              subject: claims.sub,
              audience: claims.aud,
              address,
              salt_hash: sha256Bytes(salt),
              nonce,
              provider: "custom-oidc"
            },
            wallets: [{ chain: "sui", address, verified_by: "zklogin" }],
            roles: ["user"],
            created_at: now,
            updated_at: now
          };
          const saved = await upsertPlatformAccount(account, options.localnetRoot);
          const session: CliAuthSession = {
            provider: "google",
            account_id: saved.id,
            address,
            email: typeof claims.email === "string" ? claims.email : undefined,
            issuer: claims.iss,
            subject: claims.sub,
            audience: claims.aud,
            encrypted_id_token: await encryptToken(idToken),
            created_at: now,
            updated_at: now,
            expires_at: claims.exp ? new Date(Number(claims.exp) * 1000).toISOString() : undefined
          };
          await writeCliAuthSession(session, options.localnetRoot);
          sendJson(res, 200, { ok: true, address });
          const { encrypted_id_token: _token, ...publicSession } = session;
          finish(() => resolve({ account: saved, session: publicSession }));
          return;
        }
        sendJson(res, 404, { error: "not_found" });
      } catch (error) {
        sendJson(res, 500, { error: "login_failed" });
        finish(() => reject(error instanceof Error ? error : new Error(String(error))));
      }
    });
    const timer = setTimeout(() => {
      finish(() => reject(new Error("CLI login timed out")));
    }, options.timeoutMs ?? 10 * 60 * 1000);
    server.listen(port, "127.0.0.1", () => {
      const url = authorizeUrl.toString();
      options.onAuthorizeUrl?.(url);
      if (options.openBrowser ?? true) {
        openUrl(url);
      }
    });
    server.on("error", (error) => finish(() => reject(error)));
  });
}

export async function readCliLoginSession(localnetRoot = DEFAULT_LOCALNET_DIR): Promise<CliAuthSession | undefined> {
  return (await readAuthState(localnetRoot)).cli_session;
}

export async function clearCliLoginSession(localnetRoot = DEFAULT_LOCALNET_DIR): Promise<void> {
  await writeCliAuthSession(undefined, localnetRoot);
}
