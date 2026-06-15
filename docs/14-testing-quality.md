# 14. 测试与质量门禁

## 测试层级

### Schema 测试

- `asset.yaml` 合法样例通过。
- encrypted/private 缺少 Seal Access 字段报错。
- revenue_split 不等于 10000 报错。
- 修改 Skill 未声明 forked 报错。

### Packager 测试

- 生成 manifest。
- 生成 checksums。
- content hash 可复现。
- 相同 commit 生成相同 hash。

### Walrus 测试

- upload release package。
- fetch manifest。
- hash match。
- encrypted report/package Seal access unlock。

### Move 单元测试

- publish asset。
- publish skill。
- publish public / encrypted / private report。
- buy platform membership / agent subscription。
- create and settle private delegation。
- revenue split。
- duplicate cross-chain order rejected。
- emit events。

### Indexer 测试

- event decode。
- manifest fetch。
- idempotent handling。
- reorg / checkpoint retry。
- rebuild search。

### Web 测试

- asset page renders。
- skill page renders。
- install flow。
- publish flow。
- zkLogin flow mock。

### Agent E2E

- Agent 初始化仓库。
- Agent 安装 Skill。
- Agent Fork Research。
- Agent 发布到 Walrus + Sui。
- Indexer 搜索到新资产。

## 发布质量门禁

一个 Research Asset 可发布必须满足：

```text
asset.yaml schema valid
required files exist
legal terms declared
access visibility declared
hashes generated
no secret leak
manifest generated
walrus upload successful
sui registration successful
indexer processed
asset page rendered
```

## 内容质量评分

```text
quality_score =
0.20 * manifest_completeness
+ 0.20 * reproducibility
+ 0.15 * citation_quality
+ 0.15 * skill_tests
+ 0.10 * human_review
+ 0.10 * code_availability
+ 0.10 * dataset_metadata
```

## Regression Fixtures

创建测试仓库：

```text
fixtures/
├── valid-paper-only/
├── valid-paper-skill-workflow/
├── invalid-encrypted-missing-seal/
├── invalid-bad-revenue-split/
├── forked-skill/
├── referenced-skill/
└── vendored-skill/
```
