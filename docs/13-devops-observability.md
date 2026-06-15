# 13. DevOps 与可观测性

## 服务列表

```text
api-server
indexer-worker
walrus-publisher
github-connector
payment-relayer
search-worker
embedding-worker
web-app
seal-access-service
```

## 基础设施

```text
PostgreSQL
Redis
Vector DB: pgvector / Qdrant
Object cache
Queue: BullMQ / RabbitMQ / Kafka
Sui RPC / GraphQL
Walrus SDK / CLI
```

## Docker Compose 本地环境

服务：

- postgres
- redis
- qdrant
- api
- indexer
- web

## 环境变量

```env
DATABASE_URL=
REDIS_URL=
QDRANT_URL=
SUI_RPC_URL=
SUI_GRAPHQL_URL=
SUI_PACKAGE_ID=
WALRUS_CONTEXT=
WALRUS_AGGREGATOR_URL=
WALRUS_PUBLISHER_URL=
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
ZKLOGIN_PROVER_URL=
ZKLOGIN_SALT_SECRET=
CIRCLE_API_KEY=
WORMHOLE_RPC=
KMS_MASTER_KEY=
```

## 可观测性指标

### API

- request latency
- error rate
- auth failures
- publish requests
- access intent creations
- report decrypt requests
- delegation state changes

### Walrus

- upload latency
- upload failures
- blob size
- storage cost
- fetch latency

### Sui

- transaction success rate
- gas used
- event lag
- RPC latency
- package version

### Indexer

- latest checkpoint
- event lag
- failed event count
- manifest fetch failures
- reindex queue size

### Search

- query latency
- zero-result rate
- click-through
- install conversion

### Payments

- pending orders
- bridged orders
- settled orders
- failed settlements
- duplicate order attempts

## 日志结构

所有服务日志包含：

```json
{
  "request_id": "...",
  "user_id": "...",
  "agent_id": "...",
  "asset_id": "...",
  "tx_digest": "...",
  "walrus_blob_id": "...",
  "event_type": "...",
  "level": "info",
  "message": "..."
}
```

## 告警

- Indexer lag > 5 min
- Walrus upload failure rate > 5%
- Sui tx failure rate > 5%
- payment pending > 30 min
- manifest hash mismatch > 0
- API 5xx > 1%
- KMS unlock anomaly

## 备份

- PostgreSQL PITR
- Indexer 可重放
- Walrus blob id 由链上记录恢复
- GitHub repo 是源工作区
- 前端 Walrus Site 可从 git build 恢复
