# Sui Move Protocol Implementation Notes

本目录包含 Research Asset Protocol 的 Sui Move 合约实现。核心模块：

- `research_asset.move`：ResearchAsset 发布与事件。
- `skill.move`：SkillAsset 发布、Fork、依赖。
- `report.move`：Agent 发布 public / encrypted / private delegation 研究报告。
- `access.move`：平台会员、agent 订阅、AccessReceipt 与 Seal 访问判断。
- `delegation.move`：私有委托任务、提交、验收、退款与争议授权。
- `settlement.move`：平台会员费、agent 订阅费、私有委托 escrow 与 agent 收入。
- `revenue.move`：保留为底层分账工具；新产品命名不再以 License/旧 revenue product 语义暴露。
- `agent.move`：Agent Passport。
- `badge.move`：Review / Reproducibility Badge。
- `payment.move`：本地与跨链支付结算。
- `reputation.move`：不可转让 Reputation。

链上负责最小事实：对象、所有权、哈希、Walrus blob、Seal id、访问凭证、委托状态、分账和事件。全文、搜索、展示由 Walrus 和 Indexer 负责；encrypted/private 内容只存 Walrus 密文，解密资格由 Seal policy 判断。

## Build

```bash
sui move build --path move --silence-warnings
```

## Testnet Deployment

当前 Seal Access 包已部署到 Sui testnet：

- Package ID: `0x5ecd097d8f13e995493d23c9b033c815bd6a8bf771331c389c027296e8b8231e`
- Publish tx: `CvzaiupRbddPTmNhKQ5zLkS737GUS2DLmpKkjePnaoX6`
- Shared `settlement::SettlementConfig`: `0x612c971a021e8139e0cd4e63bfef162f4301e72532b808a840d3d16512125ea4`
- Shared `settlement::AgentEarnings`: `0xb637059cb77aca697e36673afa2e8639f7f82d16b8f0eba8eb6a1f5bd12eda2b`
- Shared `settlement::MembershipReceiptRegistry`: `0x5a25a789a4032c8460afa68b26b839a081c770372fa04e567207c606b68ad748`

该包包含 `AgentEarnings.settled_receipts`，并已完成真实 Walrus + Seal + Sui author decrypt
回归。下一步仍需两个真实 zkLogin 账号执行带资金上限的 production acceptance。

历史骨架包也保留在 Sui testnet：

- Package ID: `0x03d2e61b22a98c3eabb49ccb0fe4e6252fee9f5076cec3b5e513a45b0c57a245`
- Publish tx: `6a38rdmgZ1RV5YTpmYU6HXafQhBGnhJgrE4R1J5HerMB`
- Shared `payment::SettlementRegistry`: `0xd0565a1a06de32503ebb8c07c61db33c3a0dd57c5966aec79f5f8b871ef8f9b2`

详细部署记录见 `docs/16-testnet-deployment.md`。
