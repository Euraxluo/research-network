# 16. Testnet Deployment Report

Deployment date: 2026-06-10

This deployment used the local `research deploy:testnet` flow against Walrus testnet and Sui testnet. The CLI now also publishes the generated static frontend to Walrus Sites when `site-builder` is installed; use `--skip-walrus-sites` to leave site publication as a manual step.

## Sui Testnet

- Active environment: `testnet`
- Publisher address: `0x8ac06d3d4328aff5bef88990741c1f620a96d5fc579bf2e459467763bd605788`
- Package ID: `0x03d2e61b22a98c3eabb49ccb0fe4e6252fee9f5076cec3b5e513a45b0c57a245`
- Package publish tx: `6a38rdmgZ1RV5YTpmYU6HXafQhBGnhJgrE4R1J5HerMB`
- Payment settlement registry: `0xd0565a1a06de32503ebb8c07c61db33c3a0dd57c5966aec79f5f8b871ef8f9b2`
- Registered ResearchAsset object: `0xf7916b250ac36410ff86eebad2ecec83664ad2775dd3ba29cfb8bf34b7661ecb`
- ResearchAsset registration tx: `AviDpiTMnG1d8smxAyYhKZ3DGt6rUbeScqACAF3s1S6H`
- Emitted event: `ResearchAssetPublished`

Published modules:

- `agent`
- `badge`
- `license`
- `payment`
- `reputation`
- `research_asset`
- `revenue`
- `skill`

## Walrus Testnet

- Walrus context: `testnet`
- Upload relay: `https://upload-relay.testnet.walrus.space`
- Blob ID: `mKMQifEujeWmyjrxLR8EfPQsa9CH0x3ZwcWcOK-n49Y`
- Certified epoch: `424`
- Blob object IDs:
  - `0x1dd01c2af4934504ff2cad69fd63fb149e49579d1d2ad4d794827ae3b47d2396`
  - `0xd421a90bf81f31926b464dd0d943298362bd35cd1ec0cac1f4323b0d1170b0bd`
- Release archive SHA-256: `290c1ba4a0bee04782fdc7eecc271ce39e8f2b647e411b5b026438e10bdef336`
- Release size: `4692` bytes

The blob was read back from Walrus testnet and matched the local release archive hash.

## Verification Commands

```bash
sui client object 0x03d2e61b22a98c3eabb49ccb0fe4e6252fee9f5076cec3b5e513a45b0c57a245 --json
sui client object 0xf7916b250ac36410ff86eebad2ecec83664ad2775dd3ba29cfb8bf34b7661ecb --json
sui client object 0xd0565a1a06de32503ebb8c07c61db33c3a0dd57c5966aec79f5f8b871ef8f9b2 --json
sui client tx-block AviDpiTMnG1d8smxAyYhKZ3DGt6rUbeScqACAF3s1S6H --json
walrus --context testnet list-blobs --json
walrus --context testnet read mKMQifEujeWmyjrxLR8EfPQsa9CH0x3ZwcWcOK-n49Y --out /tmp/research-network-release-read.tar.zst --json
shasum -a 256 /tmp/research-network-release-read.tar.zst .research-network/releases/demo-research-asset-0a63b6107936/release.tar.zst
```

`walrus blob-status --blob-id ...` intermittently returned a quorum-status error, while `list-blobs` showed `certifiedEpoch: 424` and `read` succeeded. For this deployment, read-back plus hash equality is the stronger verification.

## Walrus Sites

The static frontend was generated at `web/dist` and published to Walrus Sites testnet with the official `site-builder` testnet binary. The `deploy:testnet` command records the tool path, RPC used, resources file, site object id, and local portal URL in `.research-network/deployments/testnet.json`.

Canonical full deployment site:

- Site object ID: `0x066b4141207b92863ae4a64bcdb059a80208a68b4ea00d9a3ccef32acce29646`
- Site object type: `0xf99aee9f21493e1590e7e5a9aea6f343a1f381031a04a732724871fc294be799::site::Site`
- Site owner: `0x8ac06d3d4328aff5bef88990741c1f620a96d5fc579bf2e459467763bd605788`
- Site name on object: `research-network-demo`
- Base36 testnet portal host: `5rcanrmyuxpgku4uqnrqcj7shtop077sj87qwvxb4s5fy1sue`
- Local portal URL: `http://5rcanrmyuxpgku4uqnrqcj7shtop077sj87qwvxb4s5fy1sue.localhost:3000`

Published site resources:

- `/index.html`
- `/search.html`
- `/dashboard.html`
- `/licenses.html`
- `/styles.css`
- `/abs/ra%3Alocal%3Ae01d55009f82ef530594.html`
- `/graph/ra%3Alocal%3Ae01d55009f82ef530594.html`
- `/skill/skill%3Aexample-skill%400.1.0.html`

The default Sui testnet fullnode intermittently returned TLS handshake/time-out errors during deployment. The CLI first tries the default testnet fullnode, then falls back to `https://sui-testnet-rpc.publicnode.com`. The successful Walrus Sites deployment used:

```bash
site-builder --context testnet \
  --rpc-url https://sui-testnet-rpc.publicnode.com \
  --wallet-env testnet \
  --walrus-context testnet \
  --gas-budget 1000000000 \
  deploy --epochs 1 --site-name research-network-demo web/dist
```

Equivalent project command:

```bash
npx tsx src/cli.ts deploy:testnet .research-network/demo-workspace \
  --epochs 1 \
  --site-name research-network-demo \
  --walrus-sites-fallback-rpc-url https://sui-testnet-rpc.publicnode.com
```

## Latest CLI Automation Verification

On 2026-06-11, the updated `deploy:testnet` command was re-run with `--skip-move-publish` and `--skip-register` to verify the automated Walrus Sites path without publishing a duplicate Move package or registering a second ResearchAsset.

- Existing package ID reused: `0x03d2e61b22a98c3eabb49ccb0fe4e6252fee9f5076cec3b5e513a45b0c57a245`
- Register status: `skipped`
- Walrus blob ID from refresh: `8shuA0zW3L9xbj1F2ZZzAN_iNuqY21e0aQi4kDDZNrU`
- Walrus blob object ID from refresh: `0xbb565c105c7fde2cf8b1f66b4d876c430ffddc1439b410eeecb8dcef7451dea1`
- Walrus Sites status: `success`
- Latest site object ID: `0x2cd9764af24dde6e202bf8454ca11f312e0b21312867422fd685955f39a7f12a`
- Latest local portal URL: `http://148p7vy4nrikdcc8rgk5fqot9lvy9m7y37ut3hp1ksp94zsvfu.localhost:3000`
- RPC used: `https://sui-testnet-rpc.publicnode.com`

`web/dist/ws-resources.json` now contains:

```json
{
  "site_name": "My Walrus Site",
  "object_id": "0x2cd9764af24dde6e202bf8454ca11f312e0b21312867422fd685955f39a7f12a"
}
```

## 2026-06-11 — Site update (HTML/PDF tabs + base64 routes)

The CLI now **updates** the existing Walrus Site (instead of creating a new object) when `web/dist/ws-resources.json` already contains `object_id`.

Command used:

```bash
npm run demo && npm run demo:pdf
npx tsx src/cli.ts deploy:testnet .research-network/demo-workspace \
  --epochs 1 \
  --skip-move-publish \
  --skip-register \
  --package-id 0x03d2e61b22a98c3eabb49ccb0fe4e6252fee9f5076cec3b5e513a45b0c57a245 \
  --site-name research-network-demo \
  --walrus-sites-rpc-url https://sui-testnet-rpc.publicnode.com \
  --walrus-sites-fallback-rpc-url https://sui-testnet-rpc.publicnode.com
```

- Walrus Sites mode: `update` (same object ID as above)
- New routes use base64url asset segments, e.g. `/abs/cmE6bG9jYWw6M2Y5YTAwMWIwYjk1ZTg3ZDFiZTM.html` (PDF-only demo with HTML metadata tab)
- `/site.js` and PDF.js inline preview are now published on testnet

**Testnet portal domain** (requires a running Walrus Sites portal — see [Walrus Sites portal docs](https://docs.wal.app/walrus-sites/portal.html#running-the-portal-locally)):

- Base36 host: `148p7vy4nrikdcc8rgk5fqot9lvy9m7y37ut3hp1ksp94zsvfu`
- Local: `http://148p7vy4nrikdcc8rgk5fqot9lvy9m7y37ut3hp1ksp94zsvfu.localhost:3000`
- PDF-only abs page: `http://148p7vy4nrikdcc8rgk5fqot9lvy9m7y37ut3hp1ksp94zsvfu.localhost:3000/abs/cmE6bG9jYWw6M2Y5YTAwMWIwYjk1ZTg3ZDFiZTM.html#paper`

> `wal.app` is mainnet-only. Testnet always uses the `{base36}.localhost:3000` subdomain (or your own domain in front of the portal).

## Local Receipt

The full local JSON receipt is written to:

```text
.research-network/deployments/testnet.json
```

That path is intentionally gitignored because it contains large command receipts and environment-specific object data.
