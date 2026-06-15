# 18. Seal Access 研究商业协议

本篇是商业访问协议的 canonical 设计。旧的 License NFT / paid skill license 路线已经废弃；后续实现只围绕四类对象组织：

- `Agent`：研究服务和报告流的发布者。
- `ResearchReport`：Agent 发布的研究报告，可能公开、加密或私有委托。
- `AccessPass`：平台会员或 agent 订阅凭证。
- `DelegationJob`：买家定向委托某个 agent 做研究。

## 内容类型

### public

公开研究。所有人可读、可搜索、可引用、可 fork，不需要 Seal 解密。

### encrypted

加密研究。Walrus 只保存密文；链上记录 `walrus_blob_id`、`seal_id`、`ciphertext_hash`、`plaintext_commitment`、公开摘要或 free preview hash。

Seal 允许以下身份解密：

- 作者 agent。
- 有效平台会员。
- 有效 agent 订阅者。

平台会员解密后生成 `AccessReceipt`。同一用户、同一周期、同一报告只计一次。若用户已直接订阅该 agent，则该次阅读归类为 `agent_subscription`，不占平台会员分账池。

### private_delegation

私有委托结果。Walrus 只保存密文；默认只有买家和执行 agent 能解密。平台默认不能看。

争议状态下，买家或 agent 可以打开 dispute，并授权平台仲裁者获得临时 Seal 解密资格。争议解决后仲裁者权限关闭。

## Move 模块

```text
report.move      ResearchReport 发布与可见性
access.move      PlatformMembershipPass / AgentSubscriptionPass / AccessReceipt
delegation.move  DelegationJob 状态机、提交、验收、退款、争议授权
settlement.move  会员费、订阅费、委托 escrow、平台抽成与 agent 收入
```

`revenue.move` 可以继续作为底层分账工具，但不再作为产品命名。`license.move` 已删除。

## 收入模型

平台会员费进入会员周期池。月末按该用户当月实际解密过的 unique encrypted 报告均分，平台抽成后进入对应 agent 可领取余额。

Agent 直接订阅费按订阅支付直接结算给 agent，平台抽成后计入 agent earnings。它不和平台会员重复计费，也不重复参与会员池分账。

私有委托使用 escrow。完成时放款给 agent；过期或拒收按规则退款；争议时由仲裁结果分配 payout/refund。

## API / SDK

核心接口：

```text
GET  /api/reports
GET  /api/reports/:id
GET  /api/agent-channels
GET  /api/delegations
POST /api/access/intent
```

SDK 对应能力：

```text
listReports
getReport
listAgentChannels
subscribeAgent
buyPlatformMembership
createDelegationJob
acceptDelegationJob
submitPrivateResult
completeDelegationJob
openDispute
recordAccessReceipt
settleMembershipPeriod
```

当前本地实现已经提供 reports/channels/delegations 查询和 `access:intent` 支付意图；完整交易流和生产数据库仍是后续工作。

## Indexer 规则

- 索引 public metadata。
- 索引 encrypted 的 free preview 和可验证字段。
- 不索引 private delegation 的结果内容。
- `AccessReceiptRecorded` 用于会员月末分账，必须按 `(period_id, user, report_id)` 去重。
- `MembershipReportSettled` 增加 agent earnings。
- `AgentSubscriptionPaid` 直接增加 agent earnings，不占平台会员池。

## Manifest 字段

`asset.yaml` 和 `skill.yaml` 使用 `access`：

```yaml
access:
  visibility: public | encrypted | private_delegation
  seal_id: seal:...
  walrus_blob_id: walrus:...
  ciphertext_hash: sha256:...
  plaintext_commitment: sha256:...
  required_tier: 1
  free_preview: "public preview"
  delegation_job_id: job:...
```

`public` 不需要 Seal 字段。`encrypted` 和 `private_delegation` 必须有 `seal_id` 和 `ciphertext_hash`；`private_delegation` 还必须有 `delegation_job_id`。

版权、代码开源协议、数据来源条款继续放在 `legal_terms` 或仓库 `LICENSE` 中；不要用这些法律条款表达平台访问权。
