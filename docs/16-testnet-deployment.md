# 16. Testnet Deployment Report

Deployment date: 2026-06-10

This deployment used the local `research deploy:testnet` flow against Walrus testnet and Sui testnet. The CLI now also publishes the generated static frontend to Walrus Sites when `site-builder` is installed; use `--skip-walrus-sites` to leave site publication as a manual step.

> **版本说明**：本报告记录历史 testnet 部署。`## Sui Testnet` 是 v0.1 骨架包；`## v2 Deployment` 是 2026-06-12 的 revenue/payment 经济安全包。2026-06-15 的 Seal Access 重构删除了旧 `license.move` 并新增 `report/access/delegation/settlement`，本报告尚未记录该新源码的 testnet 发布。不要把本报告中的历史包当作当前 Seal Access 已上线证明。

> **2026-06-17 更新**：最新 Seal Access package 已重新发布到 Sui testnet，并包含
> `settlement::AgentEarnings.settled_receipts`，可阻止同一个 `AccessReceipt` 重复结算。
> `move/Published.toml` 和 Web 默认配置当前指向 package
> `0x5ecd097d8f13e995493d23c9b033c815bd6a8bf771331c389c027296e8b8231e`。该包已完成真实
> Walrus + Seal + Sui author decrypt 回归：tx `EtJWxVQ99aFfkDhh8JB2mia5BsdqeX6V72Ps3bhoVy8C`，
> report `0x1574d82f0de52242c9c82d36300629793fc3113d6d4324d0256442a5ae04fa09`，Seal id
> `0x7de40428ce8fb805262b108a0041201618f57a857009532a355a2d3d5cbc36ee`。下一道 gate
> 仍然是两个真实 zkLogin 账号运行带资金上限的 production acceptance。

## 2026-06-25 Orbstack Loop Engine Refresh

2026-06-24 的 Orbstack Loop Engine release blob 已在 Walrus testnet aggregator 上返回
404。为避免 public index 展示不可取回内容，新的 live index 只把 Walrus release manifest
可解析的链上对象显示为 ResearchAsset；旧对象保留为 dashboard diagnostics。

2026-06-25 重新发布了同一 GitHub repo/commit 的 release package，并在当前 Sui testnet
package 下注册了新的 ResearchAsset 和 SkillAsset。该新 blob 已通过 aggregator `HEAD`
验证返回 `HTTP 200`，本地 `/api/index?refresh=1` 已能解析为 resolved asset。

- GitHub repo: `https://github.com/Euraxluo/orbstack-loop-engine-research-asset`
- Repo commit: `98ab5507d757813d006116f0f01fb40896e37546`
- Package ID: `0x5ecd097d8f13e995493d23c9b033c815bd6a8bf771331c389c027296e8b8231e`
- Walrus release blob: `VldHk_w-YXXFKNukTgsrQ_JstLPc-HjwNzUJzSeag9w`
- Walrus blob object: `0x090ef9bb316dca9efcfff973de7c4a31337a35b997f7466802624d6b11a6f21f`
- Walrus storage epochs: `439` to `444`
- Manifest hash: `sha256:3ad0bc69fc4bd096819575324cac8763ab346b2e49b1905802d44e36b61f1269`
- ResearchAsset tx: `GXmY76SAzmtFNQZEfo8WWtzjgVXRtnCHFTVBTVLEjTU5`
- ResearchAsset object: `0xc1f59ca4e632717a6de086e3c87f2237006aaffc64ede2e5a388ddd66586620f`
- SkillPublished tx: `nwF5jbEJ76jRWsjJN7Mrzd1Mymyw5tb3WNmR7AUbp47`
- SkillAsset object: `0x2af18315d971e62988656a3ce0ffaac1fe597599390079536733ce23f2d257eb`
- Skill manifest id stored in `SkillAsset.name_hash`: `skill:orbstack-loop-engine@0.1.0`
- Raw skill content path inside the Walrus release: `skill/orbstack-loop-engine/SKILL.md`

Resolver contract:

- Canonical skill lookup key: `SkillAsset` object id only.
- `skill:orbstack-loop-engine@0.1.0` remains a release-local manifest id and is not globally unique.
- API: `GET /api/index/skill/0x2af18315d971e62988656a3ce0ffaac1fe597599390079536733ce23f2d257eb`
- Raw entry: `GET /api/index/skill/0x2af18315d971e62988656a3ce0ffaac1fe597599390079536733ce23f2d257eb/content`
- Raw manifest: `GET /api/index/skill/0x2af18315d971e62988656a3ce0ffaac1fe597599390079536733ce23f2d257eb/content?file=manifest`
- CLI: `research skill:resolve 0x2af18315d971e62988656a3ce0ffaac1fe597599390079536733ce23f2d257eb --include-content`

## 2026-06-24 Orbstack Loop Engine Asset + Skill

`orbstack-loop-engine-research-asset` 已作为真实 ResearchAsset 发布，并且其 bundled
skill 已注册为一等链上 `skill::SkillAsset`。全局 skill id 使用 `SkillAsset` object id；
`skill:<name>@<version>` 只作为 release-local manifest id，用于从对应 Walrus release
定位原始 `skill.yaml` 和 `SKILL.md` 内容。

- GitHub repo: `https://github.com/Euraxluo/orbstack-loop-engine-research-asset`
- Repo commit: `98ab5507d757813d006116f0f01fb40896e37546`
- Package ID: `0x5ecd097d8f13e995493d23c9b033c815bd6a8bf771331c389c027296e8b8231e`
- Walrus release blob: `E5AV_dMv5f4XenTVEIF7-RccP4OPuK0Tl27GgF9-UUM`
- ResearchAsset tx: `BaBF7je2fjHzk7ZnUDmUvVGNSzd9UyHkkSGDxq53SsbR`
- ResearchAsset object: `0x4141e4bd5c85d1c25adbde619ead911df044326497efb2383d9b73ecf37a4b18`
- SkillPublished tx: `F3kR1hPVGncfDSptd5v4sRb6dQXcufhdHKvxjrXmWH8F`
- SkillAsset object: `0xa683ea0b4a6b90610144d3e2e05fbf870076e32d31332dbbdc36f787c03b2784`
- Skill manifest id stored in `SkillAsset.name_hash`: `skill:orbstack-loop-engine@0.1.0`
- Raw skill content path inside the Walrus release: `skill/orbstack-loop-engine/SKILL.md`

Resolver contract:

- Canonical skill lookup key: `SkillAsset` object id only.
- `skill:orbstack-loop-engine@0.1.0` is not globally unique and must not be used as an install id.
- API: `GET /api/index/skill/0xa683ea0b4a6b90610144d3e2e05fbf870076e32d31332dbbdc36f787c03b2784`
- Raw entry: `GET /api/index/skill/0xa683ea0b4a6b90610144d3e2e05fbf870076e32d31332dbbdc36f787c03b2784/content`
- Raw manifest: `GET /api/index/skill/0xa683ea0b4a6b90610144d3e2e05fbf870076e32d31332dbbdc36f787c03b2784/content?file=manifest`
- CLI: `research skill:resolve 0xa683ea0b4a6b90610144d3e2e05fbf870076e32d31332dbbdc36f787c03b2784 --include-content`

## 2026-06-23 Public Showcase Testnet Assets

为避免把本地 demo 当成链上证据，public showcase 的三个演示仓库已经逐个通过
`deploy:testnet` 发布到 Walrus testnet，并在当前 Sui testnet package
`0x5ecd097d8f13e995493d23c9b033c815bd6a8bf771331c389c027296e8b8231e` 下注册为真实
`research_asset::ResearchAsset` 对象。每个交易都 emit
`research_asset::ResearchAssetPublished`，并把 manifest hash、Walrus blob id、repo commit
写入链上字段。

| Showcase asset | Sui tx | ResearchAsset object | Walrus blob | Manifest hash |
| --- | --- | --- | --- | --- |
| `research-network-protocol` | [`EJD7sfuDZbDH2mCVaqsCwAf7QhamfV9c14XiE4HsEWjV`](https://suiscan.xyz/testnet/tx/EJD7sfuDZbDH2mCVaqsCwAf7QhamfV9c14XiE4HsEWjV) | [`0x58fdc8e67512849e9d7ee322f2bd4f8366a7683255ad1c2e390d6b47301611ee`](https://suiscan.xyz/testnet/object/0x58fdc8e67512849e9d7ee322f2bd4f8366a7683255ad1c2e390d6b47301611ee) | [`88y4P-ijXE9iQT6GXWD-QMjjk2uFFeDy13yB3xKPmpo`](https://aggregator.walrus-testnet.walrus.space/v1/blobs/88y4P-ijXE9iQT6GXWD-QMjjk2uFFeDy13yB3xKPmpo) | `sha256:7367b8f66e2abfa63fec612f0793bbeadb072620daa1a9b88bba1e5d86c5667d` |
| `citation-liquidity` | [`FycA5Y7TDrpB9xEpXNjbWpmsqZ4DoSEyDz235VTDB7bf`](https://suiscan.xyz/testnet/tx/FycA5Y7TDrpB9xEpXNjbWpmsqZ4DoSEyDz235VTDB7bf) | [`0xea1e3ed1e01f5972fd3754af1efb49a7289290d5e92ae7c9620327aeb2b7f921`](https://suiscan.xyz/testnet/object/0xea1e3ed1e01f5972fd3754af1efb49a7289290d5e92ae7c9620327aeb2b7f921) | [`NU6_924TmvjsiG8raTmsZ1K4x9F8WDjHKN2tCX9YLrM`](https://aggregator.walrus-testnet.walrus.space/v1/blobs/NU6_924TmvjsiG8raTmsZ1K4x9F8WDjHKN2tCX9YLrM) | `sha256:9ce81817048886186754e8299ddb2f217304047fcac18f5c2fde34c377b5673d` |
| `browse-to-publish-benchmark` | [`DydfGpMKJGuM5YxU6uN4z9qrH81wnXhLnY6TopLeVKj`](https://suiscan.xyz/testnet/tx/DydfGpMKJGuM5YxU6uN4z9qrH81wnXhLnY6TopLeVKj) | [`0x9ef6f1e846b8188054ee2a9bde95622a5ec3447560ca6e3b0d47f2db29f9ccad`](https://suiscan.xyz/testnet/object/0x9ef6f1e846b8188054ee2a9bde95622a5ec3447560ca6e3b0d47f2db29f9ccad) | [`eqWy43XYB3AmlygLHC6UQD5w9y3TkhpIXpo5mb3qPzs`](https://aggregator.walrus-testnet.walrus.space/v1/blobs/eqWy43XYB3AmlygLHC6UQD5w9y3TkhpIXpo5mb3qPzs) | `sha256:7ea6877cc332c273a2141ed3fec7a675f14c3ed8e34ee7d4412216c0f9eac3e2` |

Common provenance:

- Publisher address: `0x8ac06d3d4328aff5bef88990741c1f620a96d5fc579bf2e459467763bd605788`
- Package ID: `0x5ecd097d8f13e995493d23c9b033c815bd6a8bf771331c389c027296e8b8231e`
- Repo commit written on chain: `c590446c4c80aff65935e67e79b7bb5d24ea1a12`
- Walrus status check: all three blob ids returned `count_deletable_certified: 1` at initial certified epoch `437`.
- Frontend behavior: the generated homepage does not embed tx/object/blob ids from fixtures. It only carries the configured Sui testnet package id and RPC URL, then calls `suix_queryEvents` for `research_asset::ResearchAssetPublished` in the browser. The returned chain events provide tx digest, ResearchAsset object id, owner, manifest hash, repo commit, and Walrus blob id; the page then calls `sui_multiGetObjects` and `sui_multiGetTransactionBlocks` to cross-check object type, owner, tx success, manifest hash, and blob id live.

Verification commands:

```bash
sui client tx-block EJD7sfuDZbDH2mCVaqsCwAf7QhamfV9c14XiE4HsEWjV --json
sui client tx-block FycA5Y7TDrpB9xEpXNjbWpmsqZ4DoSEyDz235VTDB7bf --json
sui client tx-block DydfGpMKJGuM5YxU6uN4z9qrH81wnXhLnY6TopLeVKj --json

walrus --context testnet blob-status --blob-id 88y4P-ijXE9iQT6GXWD-QMjjk2uFFeDy13yB3xKPmpo --json
walrus --context testnet blob-status --blob-id NU6_924TmvjsiG8raTmsZ1K4x9F8WDjHKN2tCX9YLrM --json
walrus --context testnet blob-status --blob-id eqWy43XYB3AmlygLHC6UQD5w9y3TkhpIXpo5mb3qPzs --json
```

## Latest Seal Access Testnet Package（2026-06-17）

- Publisher address: `0x8ac06d3d4328aff5bef88990741c1f620a96d5fc579bf2e459467763bd605788`
- Package ID: `0x5ecd097d8f13e995493d23c9b033c815bd6a8bf771331c389c027296e8b8231e`
- Publish tx: `CvzaiupRbddPTmNhKQ5zLkS737GUS2DLmpKkjePnaoX6`
- Upgrade capability: `0x37623166a16dff2c7ee5641c3b1aef5d51e4defb2b39a1a875cb32ef5a0d9f7e`
- Shared `settlement::SettlementConfig`: `0x612c971a021e8139e0cd4e63bfef162f4301e72532b808a840d3d16512125ea4`
- Shared `settlement::AgentEarnings`: `0xb637059cb77aca697e36673afa2e8639f7f82d16b8f0eba8eb6a1f5bd12eda2b`
- Shared `settlement::MembershipReceiptRegistry`: `0x5a25a789a4032c8460afa68b26b839a081c770372fa04e567207c606b68ad748`
- Shared `payment::SettlementRegistry`: `0x03485f5dc44ab8e465ec73435ed9754928128daa297cfb118a6a9cc3d2382340`
- Owned `settlement::SettlerCap`: `0x46b1c097f6bf4002290a474c445c310031678c5b2381be014c2d4746ae36780d`

Verification performed:

```bash
RN_SUI_RPC_URL=https://sui-testnet-rpc.publicnode.com npx tsx scripts/m4-encrypted-check.ts
```

This verified the current `seal_id` design against the latest package: the publisher chooses a
random 32-byte `seal_id`, Seal encrypts under that id, the real Sui transaction writes the same
`seal_id` into `ResearchReport`, and `access::seal_approve_report_author` authorizes decryption.

## v2 Deployment（historical economic safety package，2026-06-12）

v2（真实 Coin 托管/分账、历史 paid access 入口、跨链 attestation + `Table` 幂等去重、capability 权限、链上 `Clock`）已发布到 Sui testnet 并完成链上经济冒烟验证。

- Publisher address: `0x8ac06d3d4328aff5bef88990741c1f620a96d5fc579bf2e459467763bd605788`
- **v2 Package ID:** `0x1c8ecc61ae13c03d8d0f7427e12abf39f286aac3235732f02928352be770b592`
- Publish tx: `EBL2fpKvaaXnUtFTwXPUND5UVJoBDJjL362kjaJ8UdnJ`
- Upgrade capability: `0x06eb8f841f64c85bd2fc6ec23eedf91746fcfd257910e1b3ea5490929a1143c9`
- Shared `SettlementRegistry` (payment): `0x9ea83c3ad8b01e78015b2eb99c3329aeabfa75c35f28e847941438857cb98997`
- `SettlerCap` (payment, owned by publisher): `0x8ec361a334ede8ceae94d4c1c81a79dd6a35c2463c9eaaa58c07e405f99e35b5`
- Modules: `agent`, `badge`, `license`, `payment`, `reputation`, `research_asset`, `revenue`, `skill`

### 链上经济冒烟验证（revenue escrow + 真实分账）

证明真实 `Coin<SUI>` 托管与按 bps 领取在链上生效：

- `create_revenue_pool`（recipients=[publisher], weights=[10000]）→ 共享 RevenuePool `0x7e25e7c8bbe6954b11eb64bb0d55fc609b2065be13edb24569f58b9d75f8b402`，tx `5d3LeA7qBZZ6uwKWSMrdkZXVFykmhxbSEPEvbA4hTooR`，emit `RevenuePoolCreated`。
- `deposit_revenue`（存入 0.013 SUI 的 Coin）→ tx `F4RSn2uCGvJjSnYe7Yi261NxUfizn92H2buUNXGH7j57`，emit `RevenueDeposited{amount=13000000, total_received=13000000, created_ms 来自链上 Clock}`。
- `record_revenue_claim`（唯一受益人领取 100%）→ tx `KaMa3jVgTrsZNrsrkW48Sgt5ATVbiZpu1wZzb14iaJ7`，emit `RevenueClaimed{amount=13000000}`，铸出 `Coin<SUI>` `0x979e4a411a8fe7d4f6539ce1acfd5abde993ad50e2de03838728e370626bf082`（balance 13000000）转给领取人。
- 余额变动核对：deposit 净 −13057372 MIST（13000000 入池 + gas），claim 净 +9327308 MIST（13000000 提取 − gas）。**真实资金完成 入池→托管→按份额提取 闭环。**

> 范围说明（不 overclaim）：本次链上验证覆盖 **revenue 托管/分账** 路径。历史 paid access 入口与 `settle_cross_chain_payment` 由当时的 Move 单元测试覆盖、合约已部署，但本会话**未**在链上单独跑这两条。Seal Access 新模块需要后续单独发布与验证。

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
- `/membership.html`（当前新构建；历史部署中可能仍保留 `/licenses.html`）
- `/delegations.html`（当前新构建）
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

> `wal.app` is mainnet-only. Testnet uses a self-hosted portal on `{base36}.localhost:<portal-port>` (or your own domain in front of the portal); older examples in this report used `:3000`, while the current local container is exposed on `:3010`.

## 2026-06-12 — Login / GitHub install update

The existing Walrus Site object was updated in place to add the static login surface and GitHub App post-install callback.

- Site object ID unchanged: `0x2cd9764af24dde6e202bf8454ca11f312e0b21312867422fd685955f39a7f12a`
- Base36 host unchanged: `148p7vy4nrikdcc8rgk5fqot9lvy9m7y37ut3hp1ksp94zsvfu`
- Current local portal URL (`research-walrus-portal` maps host `3010` to container `3000`): `http://148p7vy4nrikdcc8rgk5fqot9lvy9m7y37ut3hp1ksp94zsvfu.localhost:3010`
- GitHub App slug: `research-network-app`
- GitHub install URL: `https://github.com/apps/research-network-app/installations/new`

New/updated auth resources:

- `/account.html`
- `/auth/callback.html`
- `/auth/config.js`
- `/auth/login.js`
- `/auth/github-callback.html`
- `/auth/github-callback.js`
- `/zklogin-browser.js`

Verification notes:

- `npm run build` passed after adding the auth site generator.
- `npm test` passed after this continuation with 34 vitest tests, including auth-asset E2E coverage.
- The account surface serves Google zkLogin and GitHub connection controls together.
- `/auth/config.js` served the public Google client id and GitHub install URL.
- `/zklogin-browser.js` initially returned a transient portal/aggregator 503 on cold fetch, then retried successfully with HTTP 200, `688252` bytes, `text/javascript`.
- `/auth/github-callback.html` served successfully after the incremental upload.
- After the 2026-06-12 Codex continuation, `/auth/github-callback.js` was redeployed and verified through the local portal at `:3010` with HTTP 200 and the callback output escaping fix (`function esc`).

Required GitHub App setting:

- Set **Callback URL** and **Setup URL** to `https://research-network-web.vercel.app/auth/github-callback.html` for public testing/production.
- Enable **Request user authorization during installation** so GitHub returns a user OAuth `code` after installation/repository selection.
- Store the generated GitHub App client secret only in Vercel env as `GITHUB_APP_CLIENT_SECRET`; do not commit it.
- Until Setup URL is configured, GitHub can install the App and choose repositories, but the user remains on GitHub after installation instead of returning to Research Network with `installation_id`.

## 2026-06-13 — Vercel shell + Walrus proxy production update

The production Vercel entrypoint now separates mutable auth/account UI from Walrus content:

- `vercel.json` runs `npm run vercel:shell` and serves `.vercel-shell` as the static output.
- `/account.html`, `/workbench.html`, `/debug.html`, `/auth/callback.html`, `/auth/github-callback.html`, `/auth/*.js`, and `/zklogin-browser.js` are served directly by Vercel.
- Unknown non-`/api/*` content misses rewrite to the branded 404 function. Explicit Walrus proxying remains available through `/api/walrus`.
- `/site-data.json` is generated by `buildStaticWeb`; the account shell can fetch it through the Walrus proxy to render "my assets" by zkLogin address.

Walrus Site object updated in place:

- Site object ID unchanged: `0x2cd9764af24dde6e202bf8454ca11f312e0b21312867422fd685955f39a7f12a`
- Base36 host unchanged: `148p7vy4nrikdcc8rgk5fqot9lvy9m7y37ut3hp1ksp94zsvfu`
- Added/updated resource: `/site-data.json` plus current auth/account assets for portal parity.

Vercel production deployment:

- URL: `https://research-network-web.vercel.app`
- Latest production deployment recorded in handoff: `dpl_CkohPTfb5fiM58PQL5WZCJRS9iRC`
- Build command: `npm run vercel:shell`
- Output directory: `.vercel-shell`

Production cache-bust probes from the repair session:

- `/site-data.json` returned `200 application/json` with `x-research-network-source: walrus-testnet`.
- `/paper/.../main.pdf` returned `200 application/pdf`, `%PDF-1.4`, 3328 bytes.
- A missing path returned `404 text/plain` instead of the old `index.html` fallback.
- A Range request returned `302` to the aggregator, avoiding Vercel function response-size and byte-range limits.
- 2026-06-14 attestation probe: `/auth/login.js` and `/account.html` contain `/api/github-binding` + `server-attested`; `POST /api/github-binding` without a token returns `400 {"error":"missing_binding_attestation"}`.
- 2026-06-14 01:10 persistence deploy probe: production deployment `dpl_8JWHYgk1HQq87zjZGwJwfXYKFqbG` is Ready and aliased to the main domain; `/auth/github-callback.js` contains `selected_repo`, `available_repositories`, `binding_attestation`, `server_persisted`, and `account_id`; `POST /api/github-oauth {}` returns `400 {"error":"missing_code"}`.
- 2026-06-14 01:29 final proxy probe: production deployment `dpl_AVxGoNxHVsPsDEfY3EuinpoQnVxH` is Ready and aliased to the main domain; `api/walrus` includes ws-resources routes fallback V1. The Walrus Site object was updated in place and expired blobs were re-stored; `/site-data.json`, `/dashboard.html`, and `/paper/.../main.pdf` returned 200 in repeated cache-bust probes.
- 2026-06-14 09:05 GitHub all-repo authorization state-fix probe: production deployment `dpl_x5kLYf92nDpDs9ELgBgyDAwt3Na7` is Ready and aliased to the main domain; `/auth/github-callback.js` contains `readGithubState`, localStorage-backed `rn_gh_state`, `setup_action` restart handling, `server_persisted`, and `account_id`; API probes still return `missing_code` / `missing_binding_attestation` for empty POSTs.
- 2026-06-14 09:13 GitHub all-repo authorization state recovery hardening: production deployment `dpl_CkohPTfb5fiM58PQL5WZCJRS9iRC` is Ready and aliased to the main domain; `/auth/github-callback.js` contains `readGithubRecovery`, `recoverGithubStateMismatch`, `rn_gh_recovery`, and `GitHub authorization state expired`, so any GitHub OAuth state mismatch is safely retried without consuming the mismatched code. Empty API probes still return `missing_code` / `missing_binding_attestation`.

Local DNS on the repair machine sometimes resolved `research-network-web.vercel.app` to `198.18.*`; use an explicit Vercel edge IP when reproducing probes if needed:

```bash
curl --resolve research-network-web.vercel.app:443:76.76.21.21 https://research-network-web.vercel.app/site-data.json
```

Validation for this update:

- `npm run build` passed.
- `npm test` passed（6 files / 54 tests in the latest repair session）.
- `npm run web:build` passed.
- `npm run move:build` passed.
- `sui move test --path move --silence-warnings` passed（19 tests）.
- Earlier repair session: `research whoami` / `research logout` / `research whoami` CLI smoke passed.

## Local Receipt

The full local JSON receipt is written to:

```text
.research-network/deployments/testnet.json
```

That path is intentionally gitignored because it contains large command receipts and environment-specific object data.
