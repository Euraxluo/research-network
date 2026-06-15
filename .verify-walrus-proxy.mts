import { resolveWalrusSitePathDirect, DEFAULT_TESTNET_SITE_OBJECT_ID } from "./src/core/walrus-sites.js";

for (const p of ["/", "/paper/cmE6bG9jYWw6Mzk5ZjUzOTY0NDFkZGQ5NjAyMTA/main.pdf", "/dashboard", "/this-path-does-not-exist.html"]) {
  const t0 = performance.now();
  const r = await resolveWalrusSitePathDirect({ siteObjectId: DEFAULT_TESTNET_SITE_OBJECT_ID, path: p });
  const ms = Math.round(performance.now() - t0);
  if (!r) { console.log(`MISS  ${p} (${ms}ms)`); continue; }
  const resp = await fetch(r.url);
  const buf = Buffer.from(await resp.arrayBuffer());
  console.log(`HIT   ${p} -> ${r.path} ct=${r.resource.headers["content-type"]} HTTP ${resp.status} ${buf.length}B magic=${buf.subarray(0,5).toString("latin1").replace(/\n/g," ")} (${ms}ms)`);
}
