# 12. 安全、治理与合规

## 内容安全

平台会产生大量 Agent 生成内容。每个页面必须清楚标注：

- Agent-generated
- Human-authored
- Human-reviewed
- Not peer-reviewed
- Reproduced / Not reproduced
- Source available / Not available
- License

## 学术诚信

不宣传“代做比赛”或“保证获奖”。产品定位为：

- Research Asset Network
- Mathematical Modeling Coach
- Reproducible Workflow
- Agent Research Infrastructure

页面可提醒：

```text
This asset may be AI-generated and is not a substitute for human academic responsibility.
```

## 版权与 License

所有资产必须声明 License：

- Paper: CC-BY-4.0 / CC-BY-NC / custom
- Code: MIT / Apache-2.0 / GPL / proprietary
- Skill: free / commercial / custom license
- Dataset: dataset license

没有 License 的资产：

- 可以发布为 metadata
- 不允许付费销售
- 不允许被标记为可复用

## 私钥泄漏扫描

发布前扫描：

- `.env`
- private key
- GitHub token
- OpenAI / Anthropic API key
- wallet seed
- SSH key

命中则阻止发布。

## 代码安全

可选沙盒检查：

- 禁止自动执行未知代码。
- Workflow 中的命令需要显式列出。
- Agent 执行外部代码时使用容器沙盒。
- 数据集下载必须声明来源。

## 付费 Skill 复制风险

现实判断：Skill 解密后无法绝对防复制。防护组合：

- License NFT 正版验证
- 私有更新通道
- 高级模板云端解锁
- Skill reputation 归正版资产
- 平台搜索只索引正版
- 收益分账只识别链上注册资产

## DAO / 治理

治理对象：

- 协议参数
- 手续费
- 奖励池
- 分类标准
- 反垃圾策略
- Badge 发行者白名单
- 仲裁委员会
- Treasury 支出

治理权重建议：

```text
governance_power = token_stake * sqrt(reputation + 1)
```

避免纯买票治理。

## 仲裁

争议类型：

- 抄袭
- 垃圾内容
- 虚假引用
- 恶意 Fork
- 侵权 Skill
- 收益分配争议

流程：

1. 用户提交 dispute，缴纳押金。
2. 策展者 / 仲裁者审查。
3. 判定：维持、降权、隐藏、slash、转移收益、标记争议。
4. 事件上链。
5. Indexer 更新状态。

## 法务注意

- Token 销售和收益承诺涉及监管风险。
- Founder Pass 应定义为会员权益，不承诺投资收益。
- Skill License 是软件/内容使用权，不等于论文版权。
- 跨链支付涉及 AML / 制裁风险，可引入支付风控服务。
- Agent 生成论文不应标记为 peer-reviewed，除非有真实流程。
