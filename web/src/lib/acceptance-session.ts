import { readSession } from "./storage.js";

interface ZkEphStorage {
  secret?: string;
  maxEpoch?: number;
  randomness?: string;
}

interface ZkSessionStorage {
  id_token?: string;
  salt?: string;
  maxEpoch?: number;
  randomness?: string;
}

export interface AcceptanceSessionExport {
  address: string;
  ephemeralSecretKey: string;
  idToken: string;
  salt: string;
  maxEpoch: number;
  randomness: string;
  rn_zk_eph: {
    secret: string;
    maxEpoch: number;
    randomness: string;
  };
  rn_zk_session: {
    id_token: string;
    salt: string;
    maxEpoch: number;
    randomness: string;
  };
  exportedAt: string;
  warning: string;
}

export function buildAcceptanceSessionExport(now = new Date()): AcceptanceSessionExport {
  const session = readSession();
  const eph = readSessionJson<ZkEphStorage>("rn_zk_eph", sessionStorage);
  const zk = readSessionJson<ZkSessionStorage>("rn_zk_session", sessionStorage);
  const maxEpoch = Number(zk?.maxEpoch ?? eph?.maxEpoch ?? 0);
  const randomness = zk?.randomness ?? eph?.randomness;
  const missing = [
    ["address", session?.address],
    ["rn_zk_eph.secret", eph?.secret],
    ["rn_zk_session.id_token", zk?.id_token],
    ["rn_zk_session.salt", zk?.salt],
    ["maxEpoch", maxEpoch > 0 ? String(maxEpoch) : undefined],
    ["randomness", randomness]
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    throw new Error(`Current tab cannot export an acceptance session; missing ${missing.join(", ")}`);
  }
  return {
    address: session!.address,
    ephemeralSecretKey: eph!.secret!,
    idToken: zk!.id_token!,
    salt: zk!.salt!,
    maxEpoch,
    randomness: randomness!,
    rn_zk_eph: {
      secret: eph!.secret!,
      maxEpoch,
      randomness: randomness!
    },
    rn_zk_session: {
      id_token: zk!.id_token!,
      salt: zk!.salt!,
      maxEpoch,
      randomness: randomness!
    },
    exportedAt: now.toISOString(),
    warning: "Sensitive zkLogin acceptance session. Keep under .research-network/secrets/, never commit, and use only for capped production acceptance."
  };
}

export function downloadAcceptanceSession(role: "buyer" | "agent"): string {
  const payload = buildAcceptanceSessionExport();
  const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const filename = `acceptance-${role}.json`;
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return filename;
}

function readSessionJson<T>(key: string, storage: Storage): T | null {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}
