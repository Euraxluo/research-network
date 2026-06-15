import { deriveUserSalt, JwtVerificationError, verifyJwt } from "../src/core/zklogin.js";

/** Salt service: returns the deterministic per-user zkLogin salt for a VERIFIED Google id_token.
 *  The browser callback page calls this instead of minting a random per-browser salt, so the same
 *  Google account always derives the same Sui address on every device (HANDOFF §6.1-1).
 *  Requires `ZKLOGIN_SALT_SECRET` (and `GOOGLE_CLIENT_ID`) in the deployment environment. */
export default async function handler(req: any, res: any) {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") {
    res.status(405).setHeader("content-type", "application/json; charset=utf-8");
    res.send(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }
  if (!process.env.ZKLOGIN_SALT_SECRET) {
    res.status(503).setHeader("content-type", "application/json; charset=utf-8");
    res.send(JSON.stringify({ error: "salt_service_not_configured", message: "ZKLOGIN_SALT_SECRET env var is missing" }));
    return;
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
    const idToken = typeof body.id_token === "string" ? body.id_token : undefined;
    if (!idToken) {
      res.status(400).setHeader("content-type", "application/json; charset=utf-8");
      res.send(JSON.stringify({ error: "missing_id_token" }));
      return;
    }
    const claims = await verifyJwt(idToken, {
      audience: process.env.GOOGLE_CLIENT_ID || undefined
    });
    const salt = deriveUserSalt({ issuer: claims.iss, subject: claims.sub, audience: claims.aud });
    res.status(200).setHeader("content-type", "application/json; charset=utf-8");
    res.send(JSON.stringify({ salt }));
  } catch (error) {
    // Verification failures are client errors; never echo internals beyond a stable code.
    const verificationFailure = error instanceof JwtVerificationError;
    res.status(verificationFailure ? 401 : 500).setHeader("content-type", "application/json; charset=utf-8");
    res.send(JSON.stringify({
      error: verificationFailure ? "invalid_id_token" : "salt_service_error",
      code: verificationFailure ? error.code : undefined
    }));
  }
}
