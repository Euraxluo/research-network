/** zkLogin prover proxy (Vercel serverless function).
 *  Proxies the browser's proof request to the configured zkLogin prover
 *  (ZKLOGIN_PROVER_URL), keeping the prover URL server-side. The prover returns
 *  the ZK proof inputs; the browser assembles the composite zkLogin signature
 *  itself via @mysten/sui getZkLoginSignature(proof, ephemeralSignature, maxEpoch). */
export default async function handler(req: any, res: any) {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") {
    res.status(405).setHeader("content-type", "application/json; charset=utf-8");
    res.send(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }
  const proverUrl = process.env.ZKLOGIN_PROVER_URL;
  if (!proverUrl) {
    res.status(500).setHeader("content-type", "application/json; charset=utf-8");
    res.send(JSON.stringify({ error: "prover_not_configured", message: "Set ZKLOGIN_PROVER_URL" }));
    return;
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
    const jwt = typeof body.jwt === "string" ? body.jwt : "";
    const extendedEphemeralPublicKey = String(body.extended_ephemeral_public_key ?? body.extendedEphemeralPublicKey ?? "");
    const maxEpoch = Number(body.max_epoch ?? body.maxEpoch ?? 0);
    const jwtRandomness = String(body.jwt_randomness ?? body.jwtRandomness ?? "");
    const salt = String(body.salt ?? "");
    if (!jwt || !extendedEphemeralPublicKey || !maxEpoch || !jwtRandomness || !salt) {
      res.status(400).setHeader("content-type", "application/json; charset=utf-8");
      res.send(JSON.stringify({ error: "missing_proof_inputs" }));
      return;
    }
    const proofRes = await fetch(proverUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        keyClaimName: "sub",
        jwt,
        extendedEphemeralPublicKey,
        maxEpoch,
        jwtRandomness,
        salt
      })
    });
    if (!proofRes.ok) {
      res.status(502).setHeader("content-type", "application/json; charset=utf-8");
      res.send(JSON.stringify({ error: "prover_failed", status: proofRes.status, detail: await proofRes.text() }));
      return;
    }
    const proof = await proofRes.json();
    res.status(200).setHeader("content-type", "application/json; charset=utf-8");
    res.send(JSON.stringify(proof));
  } catch (error) {
    res.status(500).setHeader("content-type", "application/json; charset=utf-8");
    res.send(JSON.stringify({ error: "prover_proxy_error", message: String((error as Error)?.message || error) }));
  }
}
