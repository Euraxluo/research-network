# Sui Move Protocol Implementation Notes

本目录包含 Research Asset Protocol 的 Sui Move 合约实现。核心模块：

- `research_asset.move`：ResearchAsset 发布与事件。
- `skill.move`：SkillAsset 发布、Fork、依赖。
- `license.move`：Skill License NFT。
- `revenue.move`：RevenuePool 与分账。
- `agent.move`：Agent Passport。
- `badge.move`：Review / Reproducibility Badge。
- `payment.move`：本地与跨链支付结算。
- `reputation.move`：不可转让 Reputation。

链上负责最小事实：对象、所有权、哈希、Walrus blob、关系、价格策略、分账、事件。全文、搜索、展示由 Walrus 和 Indexer 负责。

## Build

```bash
sui move build --path move --silence-warnings
```

## Testnet Deployment

已部署到 Sui testnet：

- Package ID: `0x03d2e61b22a98c3eabb49ccb0fe4e6252fee9f5076cec3b5e513a45b0c57a245`
- Publish tx: `6a38rdmgZ1RV5YTpmYU6HXafQhBGnhJgrE4R1J5HerMB`
- Shared `payment::SettlementRegistry`: `0xd0565a1a06de32503ebb8c07c61db33c3a0dd57c5966aec79f5f8b871ef8f9b2`

详细部署记录见 `docs/16-testnet-deployment.md`。
