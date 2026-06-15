import { verifyGithubBindingAttestation } from "../src/core/github-binding.js";

/** Verify a browser-stored GitHub binding attestation server-side.
 *  The browser may keep the selected repo in localStorage, but the "server-attested" badge must
 *  only appear after this endpoint validates the HMAC token issued by `api/github-oauth.ts`. */
export default async function handler(req: any, res: any) {
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/json; charset=utf-8");
  if (req.method !== "POST") {
    res.status(405).send(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
    const token = typeof body.binding_attestation === "string" ? body.binding_attestation : undefined;
    if (!token) {
      res.status(400).send(JSON.stringify({ error: "missing_binding_attestation" }));
      return;
    }
    const payload = verifyGithubBindingAttestation(token, {
      suiAddress: typeof body.sui_address === "string" ? body.sui_address : undefined,
      installationId: typeof body.installation_id === "number" ? body.installation_id : undefined,
      repos: Array.isArray(body.repos) ? body.repos.map(String) : undefined
    });
    res.status(200).send(JSON.stringify({ valid: true, payload }));
  } catch {
    res.status(401).send(JSON.stringify({ error: "invalid_binding_attestation" }));
  }
}
