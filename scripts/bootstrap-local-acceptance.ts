/**
 * Bootstrap local-only acceptance materials.
 *
 * This script is intentionally NOT a substitute for real testnet/mainnet
 * production acceptance. It creates synthetic zkLogin-like sessions, starts a
 * local mock zkLogin prover + Sui JSON-RPC server, and runs the no-spend
 * production acceptance preflight against those mocks.
 *
 * Output files live under .research-network/ so they stay gitignored:
 *   - .research-network/secrets/acceptance-buyer.json
 *   - .research-network/secrets/acceptance-agent.json
 *   - .research-network/acceptance/local-preflight.json
 *   - .research-network/acceptance/local-materials.json
 */
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { generateNonce, generateRandomness, genAddressSeed } from "@mysten/sui/zklogin";
import { deriveZkLoginAddress } from "../src/core/zklogin.js";

interface LocalSession {
  localMockOnly: true;
  warning: string;
  address: string;
  ephemeralSecretKey: string;
  idToken: string;
  salt: string;
  maxEpoch: number;
  randomness: string;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SECRET_DIR = path.join(ROOT, ".research-network", "secrets");
const ACCEPTANCE_DIR = path.join(ROOT, ".research-network", "acceptance");
const BUYER_SESSION_PATH = path.join(SECRET_DIR, "acceptance-buyer.json");
const AGENT_SESSION_PATH = path.join(SECRET_DIR, "acceptance-agent.json");
const LOCAL_PREFLIGHT_PATH = path.join(ACCEPTANCE_DIR, "local-preflight.json");
const MATERIALS_PATH = path.join(ACCEPTANCE_DIR, "local-materials.json");

const MOCK_EPOCH = 120;
const MAX_EPOCH = 130;
const BALANCE_MIST = "250000000";
const AUDIENCE = "research-network-local-acceptance";

async function main() {
  await mkdir(SECRET_DIR, { recursive: true });
  await mkdir(ACCEPTANCE_DIR, { recursive: true });

  const buyer = createSession("buyer", "11111111111111111111111111111111");
  const agent = createSession("agent", "22222222222222222222222222222222");
  await writeFile(BUYER_SESSION_PATH, JSON.stringify(buyer, null, 2) + "\n", "utf8");
  await writeFile(AGENT_SESSION_PATH, JSON.stringify(agent, null, 2) + "\n", "utf8");

  const server = createServer((request, response) => {
    void handleRequest(request, response);
  });
  const mockBaseUrl = await listen(server);
  try {
    const { stdout, stderr } = await runPreflight(mockBaseUrl);
    const receipt = JSON.parse(await readFile(LOCAL_PREFLIGHT_PATH, "utf8")) as Record<string, unknown>;
    const materials = {
      kind: "local-acceptance-materials/v1",
      generatedAt: new Date().toISOString(),
      mode: "local-mock-only",
      warning: "Synthetic sessions and mock prover/RPC. Do not use as testnet/mainnet readiness evidence.",
      buyerSessionPath: relative(BUYER_SESSION_PATH),
      agentSessionPath: relative(AGENT_SESSION_PATH),
      localPreflightReceiptPath: relative(LOCAL_PREFLIGHT_PATH),
      buyerAddress: buyer.address,
      agentAddress: agent.address,
      mock: {
        epoch: MOCK_EPOCH,
        maxEpoch: MAX_EPOCH,
        balanceMist: BALANCE_MIST
      },
      receipt: {
        conclusion: receipt.conclusion,
        network: receipt.network,
        preflight: receipt.preflight,
        execute: receipt.execute,
        gitCommit: (receipt.provenance as Record<string, unknown> | undefined)?.gitCommit,
        gitTreeState: (receipt.provenance as Record<string, unknown> | undefined)?.gitTreeState
      },
      stdoutLines: stdout.trim().split(/\r?\n/).length,
      stderr: stderr.trim()
    };
    await writeFile(MATERIALS_PATH, JSON.stringify(materials, null, 2) + "\n", "utf8");
    console.log(JSON.stringify(materials, null, 2));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function createSession(role: "buyer" | "agent", salt: string): LocalSession {
  const keypair = Ed25519Keypair.generate();
  const randomness = String(generateRandomness());
  const nonce = generateNonce(keypair.getPublicKey(), MAX_EPOCH, randomness);
  const idToken = unsignedJwt({
    iss: "https://accounts.google.com",
    sub: `local-${role}`,
    aud: AUDIENCE,
    email: `${role}@local-acceptance.invalid`,
    nonce,
    iat: 1,
    exp: 4_102_444_800
  });
  return {
    localMockOnly: true,
    warning: "Synthetic local acceptance session. It is only valid with scripts/bootstrap-local-acceptance.ts mock prover/RPC.",
    address: deriveZkLoginAddress(idToken, salt),
    ephemeralSecretKey: keypair.getSecretKey(),
    idToken,
    salt,
    maxEpoch: MAX_EPOCH,
    randomness
  };
}

function unsignedJwt(payload: Record<string, unknown>): string {
  return [
    base64UrlJson({ alg: "none", typ: "JWT" }),
    base64UrlJson(payload),
    "local-signature-placeholder"
  ].join(".");
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  try {
    if (request.url === "/zkp") {
      const body = await readObjectBody(request);
      const jwt = String(body.jwt ?? "");
      const salt = String(body.salt ?? "");
      const claimName = String(body.keyClaimName ?? "sub");
      const claims = decodeJwt(jwt);
      json(response, {
        proofPoints: {
          a: ["1", "2"],
          b: [["3", "4"], ["5", "6"]],
          c: ["7", "8"]
        },
        issBase64Details: {
          value: Buffer.from(String(claims.iss ?? "")).toString("base64"),
          indexMod4: 0
        },
        headerBase64: jwt.split(".")[0] ?? "",
        addressSeed: genAddressSeed(salt, claimName, String(claims[claimName] ?? ""), audience(claims)).toString()
      });
      return;
    }

    const rpc = await readJsonBody(request);
    if (Array.isArray(rpc)) {
      json(response, rpc.map((item) => rpcResponse(item)));
      return;
    }
    json(response, rpcResponse(rpc));
  } catch (error) {
    response.statusCode = 500;
    json(response, { error: String((error as Error)?.message || error) });
  }
}

function rpcResponse(input: Record<string, unknown>): Record<string, unknown> {
  const id = input.id ?? null;
  switch (input.method) {
    case "suix_getLatestSuiSystemState":
      return { jsonrpc: "2.0", id, result: { epoch: String(MOCK_EPOCH) } };
    case "suix_getCoins": {
      const owner = Array.isArray(input.params) ? String(input.params[0] ?? "0x0") : "0x0";
      return {
        jsonrpc: "2.0",
        id,
        result: {
          data: [{
            coinType: "0x2::sui::SUI",
            coinObjectId: objectIdFor(owner),
            version: "1",
            digest: digestFor(owner),
            balance: BALANCE_MIST,
            previousTransaction: digestFor(`${owner}:previous`)
          }],
          nextCursor: null,
          hasNextPage: false
        }
      };
    }
    default:
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `local mock does not implement ${String(input.method)}` }
      };
  }
}

async function readObjectBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readJsonBody(request);
  if (Array.isArray(body)) throw new Error("expected JSON object body");
  return body;
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown> | Record<string, unknown>[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) as Record<string, unknown> | Record<string, unknown>[] : {};
}

function decodeJwt(jwt: string): Record<string, unknown> {
  const part = jwt.split(".")[1];
  if (!part) throw new Error("mock prover received malformed jwt");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

function audience(claims: Record<string, unknown>): string {
  return Array.isArray(claims.aud) ? String(claims.aud[0] ?? "") : String(claims.aud ?? "");
}

function json(response: ServerResponse, body: unknown) {
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

function listen(server: ReturnType<typeof createServer>): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("mock server did not bind to a TCP port");
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function runPreflight(mockBaseUrl: string): Promise<{ stdout: string; stderr: string }> {
  const args = [
    "tsx",
    "scripts/production-acceptance.ts",
    "--network", "testnet",
    "--preflight",
    "--buyer-session", BUYER_SESSION_PATH,
    "--agent-session", AGENT_SESSION_PATH,
    "--receipt", LOCAL_PREFLIGHT_PATH,
    "--sui-rpc-url", mockBaseUrl
  ];
  return new Promise((resolve, reject) => {
    const child = spawn("npx", args, {
      cwd: ROOT,
      env: {
        ...process.env,
        ZKLOGIN_PROVER_URL: `${mockBaseUrl}/zkp`
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`local preflight failed with code ${code}\n${stderr}\n${stdout}`));
    });
  });
}

function objectIdFor(seed: string): string {
  return "0x" + Buffer.from(seed).toString("hex").padEnd(64, "0").slice(0, 64);
}

function digestFor(seed: string): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  let out = "";
  for (let index = 0; index < 44; index += 1) {
    hash = (hash * 1664525 + 1013904223) >>> 0;
    out += alphabet[hash % alphabet.length];
  }
  return out;
}

function relative(filePath: string): string {
  return path.relative(ROOT, filePath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
