# 05. Walrus 开发设计

## Walrus 在系统中的角色

Walrus 是发布态存储层，负责保存不可变的 Research Asset 快照。不要用 Walrus 替代 Git。

```text
GitHub Repo = workspace
Walrus Blob = immutable release snapshot
Sui Object = ownership / registry / settlement
Indexer = query projection
```

## 需要上传到 Walrus 的内容

### 1. Research Asset Release Package

```text
research-asset-v0.1.0.tar.zst
```

包含：

- `manifest.json`
- `asset.yaml`
- `checksums.json`
- `paper/`
- `skill/`
- `workflow/`
- `code/`
- `data/`
- `experiments/`

### 2. 单独资产 Blob

为了页面快速加载，可以单独上传：

- `paper/main.pdf`
- `paper/main.tex`
- `skill/<name>.tar.zst`
- `workflow/workflow.yaml`
- `manifest.json`

### 3. Encrypted Research Report Blob

encrypted / private delegation 报告在 Walrus 上只保存密文：

- `walrus_blob_id`
- `seal_id`
- `ciphertext_hash`
- `plaintext_commitment`
- public free preview hash

Seal 根据链上 AccessPass / DelegationJob / dispute 状态判断解密资格。

### 4. Walrus Site

前端网站的静态 build 通过 Walrus Sites 发布。

## Release Manifest

canonical 结构是 v0.1 扁平结构（与 `src/core/packager.ts` 实际输出一致，见 docs/17 裁决 4）：

```json
{
  "schema": "research-asset-manifest/v0.1",
  "repo": "https://github.com/owner/repo",
  "commit": "abc123",
  "asset_yaml_hash": "sha256:...",
  "content_hash": "sha256:...",
  "created_at": "2026-06-10T00:00:00Z",
  "files": [{ "path": "paper/main.pdf", "size": 12345, "sha256": "..." }],
  "assets": { "...": "asset.yaml 的解析结果" },
  "skills": [{ "id": "skill:<slug>@<version>", "path": "skill/<name>/skill.yaml", "manifest": {} }],
  "workflows": [{ "id": "workflow:<slug>@<version>", "path": "workflow/workflow.yaml", "manifest": {} }],
  "relationships": [{ "src_id": "...", "dst_id": "...", "relation_type": "cites", "metadata": {} }],
  "manifest_hash": "sha256:..."
}
```

v0.2 提案（引入时必须升级 schema 版本号）：增加 `walrus.release_blob_id` / `walrus.manifest_blob_id` / `walrus.pdf_blob_id` 等单独 blob 引用，支持页面快速加载大文件。

## Walrus Publisher 服务

接口：

```ts
interface WalrusPublisher {
  uploadReleasePackage(file: Buffer): Promise<WalrusUploadResult>
  uploadAssetFile(path: string, file: Buffer): Promise<WalrusUploadResult>
  uploadSiteBuild(dir: string): Promise<WalrusSiteResult>
  fetchManifest(blobId: string): Promise<Manifest>
  fetchReleasePackage(blobId: string): Promise<Buffer>
}
```

## 上传策略

- 小文件：可打包到 release tar。
- 大 PDF / 数据集：单独 blob + manifest 引用。
- encrypted report / private delegation result：加密后上传 Walrus。
- 公共 Paper：明文上传。

## 加密 Report / Skill Package

对 encrypted 报告或随报告交付的 Skill 包：

1. 生成随机内容密钥 `content_key`。
2. 用 `content_key` 加密 report 或 `skill-package.tar.zst`。
3. 加密包上传 Walrus。
4. `content_key` 通过 Seal policy 解锁。
5. Seal policy 读取平台会员、agent 订阅、私有委托或争议仲裁授权。

注意：内容一旦被解密，技术上无法绝对阻止用户复制。商业护城河来自唯一 receipt 计量、订阅关系、agent 声誉、私有服务、平台索引和争议治理。

## Walrus Sites

前端静态站点发布目录：

```text
apps/web/.next/static-export/
```

发布命令抽象：

```bash
site-builder --context mainnet deploy ./out --epochs 10
```

测试网实现命令：

```bash
npx tsx src/cli.ts deploy:testnet ./my-asset --epochs 1 --site-name research-network-demo
```

`deploy:testnet` 会先构建 `web/dist`，再在检测到 `site-builder` 时调用 Walrus Sites testnet deploy。默认 Sui testnet RPC 不稳定时会自动回退到 `https://sui-testnet-rpc.publicnode.com`。

发布后需要记录：

- site object id
- resources file
- portal URL
- build commit
- deployment timestamp

## 网站资源分层

- 静态前端：Walrus Sites。
- 动态 API：中心化 API 或边缘函数。
- 资产内容：Walrus blobs。
- 链上状态：Sui。

## Walrus 成本模型

每次发布应估算：

```text
package_size_mb
storage_epochs
wal_cost
sui_gas_cost
site_update_cost
```

发布页面显示预估费用：

```text
Storage: 124 MB for 10 epochs
Estimated WAL: ...
Estimated SUI gas: ...
```

## 失败恢复

如果流程失败：

- Walrus 上传成功但链上注册失败：保留 pending release，允许重试注册。
- 链上注册成功但 Indexer 失败：Indexer 重放事件即可恢复。
- Site 发布失败：不影响资产发布。
- Manifest hash 不匹配：资产标记 invalid，禁止交易。
