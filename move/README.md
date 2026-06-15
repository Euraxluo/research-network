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

历史包已部署到 Sui testnet：

- Package ID: `0x03d2e61b22a98c3eabb49ccb0fe4e6252fee9f5076cec3b5e513a45b0c57a245`
- Publish tx: `6a38rdmgZ1RV5YTpmYU6HXafQhBGnhJgrE4R1J5HerMB`
- Shared `payment::SettlementRegistry`: `0xd0565a1a06de32503ebb8c07c61db33c3a0dd57c5966aec79f5f8b871ef8f9b2`

详细部署记录见 `docs/16-testnet-deployment.md`。Seal Access 重构后的新 Move 源码已本地 build/test 通过；是否重新发布 testnet package 需要单独决策。
