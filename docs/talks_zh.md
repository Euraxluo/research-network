# Research Network x Walrus 沟通与评估文档

最后更新：2026-06-25

本文档用于 Walrus 生态 BD、技术评估、grant / sandbox 初筛和后续会议跟进。内容基于当前仓库、生产站点、Sui testnet / Walrus testnet 部署记录，以及 Orbstack Loop Engine 真实资产发布记录整理；未知字段明确标记为 TBD，不虚构。

## 1. 基础信息

项目：Research Network / Research Network Protocol Kit

网站：https://research-network-web.vercel.app

X / Twitter：@luo_eurax

GitHub：https://github.com/Euraxluo/research-network

生态：Sui、Walrus、Seal、zkLogin、GitHub、Vercel、Elysia、TypeScript、Move

信息来源：仓库审查；`docs/05-walrus-development.md`；`docs/16-testnet-deployment.md`；Vercel 生产部署；Sui/Walrus testnet 证据

联系人：@luo_eurax

负责人：Euraxluo

当前状态：WIP / testnet 产品。Protocol Kit、CLI、index API、Web 产品、Sui Move 包、Walrus release 打包流程，以及至少一个真实 ResearchAsset + SkillAsset 已经在 Sui testnet / Walrus testnet 上完成实现和验证。Mainnet 尚未开始，也尚未获得正式批准。

## 2. 他们在构建什么

Research Network 是一个面向 AI agent 的 research asset protocol。它把研究工作转化成可以验证、可以安装、可以复用的资产：论文、skills、workflows、代码、数据集、实验结果、benchmark 报告和私有委托研究结果。

当前产品有三条主要用户路径：

- 读者可以浏览类似 arXiv 的公开研究索引，并打开渲染后的 paper、README、skill 元数据和来源证明。
- 构建者可以安装 Research CLI，初始化 research workspace，打包 research asset，通过 Walrus + Sui 发布，并选择发布可复用的 agent skill。
- Agent 和高级用户可以通过 Account / Workbench 完成 zkLogin、GitHub 绑定、发布、私有委托、receipt 和协议测试。

目标用户包括 AI agent builders、独立研究者、research DAO、开源维护者、Sui/Walrus 生态团队，以及希望把研究输出做成可审计资产而不是一次性 PDF 上传的团队。

这个团队值得关注的原因是：当前仓库不是单纯白皮书或 PPT，而是已经包含可运行的协议实现：CLI、validator、packager、本地 indexer、Elysia API、Vercel 前端、Move 合约、testnet 部署记录和回归测试。当前 Orbstack Loop Engine 资产已经展示了目标闭环：GitHub repo -> Walrus release blob -> Sui ResearchAsset object -> Sui SkillAsset object -> index/API/web 渲染 -> CLI skill 解析。

## 3. 当前存储情况

他们存储什么数据？

- 公开 ResearchAsset release package：`asset.yaml`、`manifest.json`、checksums、README、paper 文件、skill 文件、workflow 文件、源码、数据集、实验记录和 benchmark 输出。
- 可渲染研究内容：`paper.html`、`paper.tex`、`paper.md`、`paper.pdf`、Word 文档和 PowerPoint 文档。
- Agent skills：`skill.yaml`、`SKILL.md`、示例、运行时元数据，以及指向所属 ResearchAsset 的链接。
- 协议元数据：repo URL、commit hash、manifest hash、content hash、Walrus blob id、Sui tx digest、Sui object id、owner address、时间戳和事件数据。
- 私有 / 加密研究内容：delegation report、ciphertext blob、plaintext commitment、Seal id 和 access receipt。
- Index projection：从 Sui events 和 Walrus release manifest 构建的公开搜索视图。

数据今天存在哪里？

- GitHub 保存源码仓库和协作历史。
- Walrus testnet 保存不可变 release package，以及 public / encrypted blob。
- Sui testnet 保存 registry object、event、receipt、SkillAsset object 和协议状态。
- Vercel 承载公开 Web 产品和 API functions。
- 可选的 Vercel database / index cache 可以保存加速查询用的派生 projection，但公开真相来源应该仍然是 Sui events + Walrus manifests。

当前存储 provider / stack：

- GitHub：可编辑源码和协作层。
- Walrus testnet：release snapshot、大文件、公开内容和加密内容。
- Sui testnet：ownership、registry、events、receipts、skill identity 和 settlement。
- Vercel Functions / Elysia API：后端 projection 和公开 API。
- Vercel Postgres / Neon：适合作为生产 index projection cache，但不应该成为 source of truth。

写入频率：

- 当前阶段：低频手动 / testnet 写入，主要发生在 asset 发布、showcase 发布和协议测试时。
- 预期生产路径：每次新 research asset 或版本修订至少写入一个 Walrus release blob，并产生一个或多个 Sui transaction。可复用 skill 会额外产生 SkillAsset 写入。私有委托和付费访问会额外产生 report/access/settlement 写入。
- 近期预期规模：小规模但重复写入，由研究资产发布、hackathon/demo workflow 和 skill 发布驱动。

数据规模：

- 元数据和 manifest：KB 级。
- Paper、README、skill package 和 workflow bundle：KB 到几十 MB。
- 数据集、实验产物和生成媒体：如果协议接受更大的研究包，可能增长到数百 MB 或 GB。
- 加密 delegation report：通常是 KB 到 MB，但也可能包含附件。

保留要求：

- 公开 research asset 需要长期保留和稳定检索。Paper 或 skill 不应该因为原始 GitHub repo 变化而失效。
- Skill content 需要稳定身份和稳定检索，因为工具会通过链上 SkillAsset object id 安装 skill。
- Private report 需要可审计、加密保留，并通过 Seal/Sui policy 做访问控制。
- 当前 testnet 部署不能作为永久保留证明；生产环境需要明确 epoch policy、续期策略、监控和 mainnet readiness。

当前痛点：

- GitHub 很适合 authoring，但不足以承担不可变、协议级 release storage。
- Sui 不适合直接存大文件，更适合作为 registry 和 event layer。
- Walrus testnet blob 如果没有续期，可能过期或无法解析；部分历史 showcase blob 已经暴露出这个问题。
- Index 必须避免展示假数据或过期数据。Walrus manifest 不能解析时，应该只显示为 diagnostics 或原始链上证据，而不是正常发布资产。
- 产品仍然需要更清晰的生产级 blob renewal、upload receipt、监控和 index persistence。

## 4. Walrus 匹配度

这个项目真的需要 decentralized storage 吗？

需要。Research Network 的核心是让 research release 成为持久、独立可检索、可验证的资产。ResearchAsset 不应该只依赖可变的 GitHub branch、Vercel 部署，或由应用运营方控制的中心化对象存储。

Walrus 可以扮演什么具体角色？

- 作为不可变 ResearchAsset release package 的 canonical storage。
- 存储大型 paper 文件、生成产物、数据集、benchmark 输出和 skill package。
- 存储加密的 private delegation report：Walrus 保存 ciphertext，Seal/Sui 负责访问控制。
- 通过 Walrus Sites 作为静态研究页面或产品快照的可选发布层。
- 作为 evidence layer，让 indexer 和用户验证 Sui 上的 content hash 与从 Walrus 取回的 package 一致。

这个需求是技术需求、商业需求、叙事需求，还是 grant 驱动？

主要是技术需求，并且和产品叙事高度一致。Research Network 需要一种方式让研究资产在应用运营方之外仍然可检索、可验证。Walrus 为大型不可变 artifact 提供可信存储层，Sui 则负责身份、ownership、事件日志、access receipt 和 settlement。

同时也存在商业和生态叙事价值：Walrus 支持会让项目更适合 Sui/Walrus-native 的 research marketplace 和 agent skill distribution。Grant 可以加速集成，但即使没有 grant，这个存储需求依然成立。

为什么 Walrus 比当前方案更好？

- 比只用 GitHub 更好：GitHub 负责 authoring 和协作，Walrus 负责不可变 release snapshot。
- 比只用 Sui 更好：Walrus 高效存储大内容，Sui 存小型可验证 pointer 和状态。
- 比只用中心化对象存储更好：Walrus 提供 decentralized retrieval，也更符合公开研究资产的协议定位。
- 产品故事更完整：每个资产都可以从 Git commit 追踪到 Walrus blob，再到 Sui object、公开 index 和 CLI install command。

初步判断：

Storage Need：Strong

Walrus Fit：Strong

Grant Risk：Medium

Integration Difficulty：Medium

判断理由：

项目存在真实 decentralized storage 使用场景，并且已经把 ResearchAsset package 写入 Walrus testnet。主要风险不是概念匹配，而是生产成熟度：项目还需要更强的 mainnet readiness、retention renewal、index persistence、monitoring、错误处理和 evidence hygiene，才能被视为成熟生产集成。

## 5. 访谈记录

### Meeting 1

主题：基础产品、Skill 使用路径、使用者 / 用户 / 付费者

日期：2026-06-25

参与者：Euraxluo；@luo_eurax；@MindfrogCrypto

摘要：

第一次沟通主要围绕 Research Network 的基础产品定位展开。项目不是单纯的论文存储或内容站，而是希望把研究成果变成“人可以阅读、agent 可以安装和执行、链上可以验证”的 research asset。Skill 是核心入口之一：用户不是直接下载某个 `SKILL.md` 文件，而是先安装 Research CLI，再通过项目级 builder skill 初始化自己的 research workspace，或者通过链上 SkillAsset object id 安装某个已经发布的 asset skill。

会议重点澄清了三类角色：

- 使用者：真正运行 CLI、安装 skill、构建 research asset 的开发者、研究员或 agent operator。
- 用户：阅读研究、搜索资产、复用 skill、验证来源的研究消费者、生态项目、DAO 或 AI agent 团队。
- 付费者：可能是购买高质量研究报告的投资机构、项目方、DAO treasury、agent marketplace 用户，或为私有委托研究付费的团队。

关键发现：

- Research Network 的产品入口应该以 Research CLI 为中心，而不是把内部 `SKILL.md` 暴露成下载按钮。
- 项目级 `research-network-builder` skill 是 CLI 随工具自带的初始化能力，不是其他用户发布的链上 skill。
- 链上 SkillAsset object id 应该作为公开 skill 的唯一安装入口，避免 `skill:<name>@<version>` 这种本地 manifest id 产生全局歧义。
- Skill 的价值不只是“说明书”，而是可安装的 agent capability：它可以指导 agent 创建、验证、打包、发布和复用研究资产。
- 用户侧最重要的第一步是知道怎么开始：安装 CLI，初始化 workspace，发布或安装 skill。
- 付费侧最重要的问题不是“谁买 PDF”，而是“谁为可验证、可复用、可追责的研究能力付费”。

担忧：

- 当前产品容易让新用户误以为 Research Network 是一个普通 paper index，而不是一个 CLI + skill + protocol 的完整工作流。
- 如果 homepage、skills page 和 asset page 同时重复 CLI onboarding，会让用户困惑；应把完整使用说明集中在 `Use CLI` 页面。
- 对外沟通需要明确区分项目级 builder skill、本地 skill template、以及已经上链发布的 SkillAsset。
- 需要更清楚解释付费者为什么愿意付费：投资研报、专有研究任务、agent 执行能力、数据/实验复现、以及可审计 provenance。

后续行动：

- 将 `Use CLI` 作为唯一完整 onboarding 页面，说明 `research init` 会安装项目级 builder skill。
- 在 Skills 页面展示已上链的 skill 清单和 object id，不展示无意义 tag。
- 在 asset 详情页只展示该 asset 实际包含的 skill，并提供通过 SkillAsset object id 安装的命令。
- 对外 deck / talks 中把“用户、使用者、付费者”分开讲，避免把所有角色混成一个“reader”。
- 用 Orbstack Loop Engine asset 作为第一个真实 skill 发布案例。

### Meeting 2

主题：投资研报存储、访问控制、付费交付与 Walrus 适配

日期：2026-06-25

参与者：Euraxluo；@luo_eurax；@MindfrogCrypto

摘要：

第二次沟通围绕“投资研报”作为具体商业场景展开。投资研报不是普通公开论文，它通常包含结构化研究结论、数据来源、模型假设、图表、附件、agent 运行轨迹、版本记录和可选的私有结论。Research Network 可以把公开摘要、metadata 和 provenance 放在公开 index 中，把完整研报、附件和 agent 生成过程作为 ResearchAsset release 存储到 Walrus；对于付费或私有委托内容，则通过加密 blob + Seal/Sui access policy 控制访问。

会议重点讨论了三类研报数据：

- 公开内容：标题、摘要、作者、时间、Git commit、manifest hash、链上 object、部分 paper / README，可公开检索和传播。
- 付费内容：完整 investment memo、PDF/Word/PPT、估值模型、数据表、图表、benchmark、agent run log，需要购买、订阅或持有 access receipt 后访问。
- 私有委托内容：由某个项目方、基金、DAO 或个人委托生成的研究报告，默认加密存储，只对委托方、授权 reviewer 或争议仲裁流程开放。

关键发现：

- Walrus 适合承载投资研报的完整 release package，尤其是 PDF、Word、PPT、数据附件和 agent 运行产物。
- Sui 适合记录 report object、access receipt、payment / settlement、version、owner 和 dispute 相关事件。
- Seal 适合控制加密研报的解密权限，避免把付费研报明文暴露给公开 index。
- 公开 index 不应该渲染拿不到的研报正文；拿不到时只展示链上存在的 metadata、object/tx 链接和 Walrus raw blob 链接。
- 对投资研究场景而言，Walrus 的价值不是“省存储费”，而是提供可验证、可追溯、可长期引用的研究交付物。
- 研报应该支持多格式渲染和下载：Markdown/HTML、LaTeX/PDF、Word、PPT 和 raw package。

担忧：

- 投资研报可能包含敏感信息，必须默认区分 public preview、paid full report 和 private delegation result。
- 如果 blob 过期或 aggregator 无法读取，用户不应该看到假正文或 fallback 文案；产品需要明确显示可验证 metadata 和 raw evidence。
- 付费访问如果只依赖前端隐藏内容，安全性不够；需要链上 receipt + Seal policy + encrypted Walrus blob。
- 研报版本更新需要清楚处理：旧版本保留、新版本新 release、index 显示最新版本并保留 provenance。
- 需要定义谁为 storage renewal 付费：作者、购买者、平台、DAO treasury，或从 report revenue 中扣除。

后续行动：

- 设计 investment report asset template，至少包含 `README.md`、`paper.md` 或 `paper.pdf`、`report.docx`、`deck.pptx`、数据附件和 `asset.yaml`。
- 定义 public preview 与 paid/private full report 的字段边界。
- 在 sandbox 中发布一份示例投资研报，验证 Walrus release、Sui report object、Seal access 和 Web 渲染。
- 对 expired/unresolved blob 增加验收规则：不渲染假内容，只展示链上 metadata 和 raw blob link。
- 设计 storage renewal 策略和付费模型，把 retention 成本纳入研报交付或订阅价格。

## 6. 架构审查

当前架构：

```text
GitHub research repo
  -> asset.yaml / paper / skill / workflow / code
  -> Research CLI validate/package
  -> Walrus release blob
  -> Sui ResearchAsset + SkillAsset objects/events
  -> Elysia/Vercel index API reads Sui events and Walrus manifests
  -> Web product renders public asset pages, skills, papers, README, and provenance
  -> Research CLI resolves/install skills by on-chain SkillAsset object id
```

私有 / 加密路径：

```text
Agent or author
  -> encrypt report/artifact
  -> upload ciphertext to Walrus
  -> write Seal id, commitments, report/access receipts to Sui
  -> Seal policy decides who can decrypt
  -> index exposes only public metadata
```

潜在 Walrus 集成点：

- 主要集成点：每个 ResearchAsset 的 release package storage。
- 次级集成点：大型 paper、dataset、generated report、media 和 skill package 的独立 blob。
- 私有路径：encrypted delegation report 和 paid-access deliverable。
- 可选路径：通过 Walrus Sites 发布静态 Web 或 asset-specific landing page。

Minimum viable test：

1. 发布一个新的 ResearchAsset repo，至少包含一个 paper 文件、README 和一个 skill。
2. 通过 Research CLI 完成 package。
3. 上传 release 到 Walrus testnet 或 mainnet。
4. 在 Sui 上注册 ResearchAsset 和 SkillAsset。
5. 通过 API 和 CLI 用 SkillAsset object id 解析 skill。
6. 从 Walrus manifest 渲染 asset page 和 paper。
7. 根据 Sui event/object 验证 content hash 和 manifest hash。

工具缺口：

- 生产级 blob renewal 和 retention dashboard。
- 清晰的 release blob / per-file blob upload receipt 模型。
- 对 unresolved testnet blob 和 expired storage 的更好处理。
- 带 replay/backfill job 的持久化 index cache。
- 对 Sui RPC failure、Walrus aggregator failure 和 manifest parsing failure 的可观测性。
- Mainnet-ready 配置、预算和 operator runbook。

需要的工程支持：

- Walrus 生产实践：epoch 选择、续期和监控。
- Aggregator / publisher 可靠性和 fallback endpoint 指导。
- Seal 加密报告模式 review。
- 大型 artifact packaging strategy review。
- Mainnet dry run 和 grant / ecosystem review evidence format 支持。

预估集成工作量：

- Testnet 稳定化：1-2 周。
- Mainnet MVP，包括 retention policy、live index cache 和 operator runbook：2-4 周。
- 生产级 encrypted report / paid access flow：4-8 周，取决于 Seal、wallet、billing 和 dispute 要求。

## 7. Sandbox Trial

状态：尚未正式开始。以下内容是推荐 sandbox 计划；在 Walrus 确认之前，不应视为官方 trial 承诺。

Trial goal：

证明 Research Network 可以重复发布真实 research asset 到 Walrus，在 Sui 上注册对象，通过 SkillAsset object id 解析 skill，并在公开 Web 产品中从 live Walrus manifest 渲染经过验证的 paper / README / skill 内容。

测试内容：

- ResearchAsset release packaging。
- Walrus upload 和 retrieval。
- Sui ResearchAsset 和 SkillAsset registration。
- 从 Sui events + Walrus manifests replay index。
- 通过链上 SkillAsset object id 完成 CLI skill resolution 和 installation。
- 公开渲染 paper、README 和 skill metadata。
- 对 unresolved / expired blob 的处理，确保不展示假资产。

写入数据：

- Release package archive。
- Manifest JSON 和 checksums。
- Markdown、TeX、PDF、Word 或 PowerPoint paper 文件。
- `skill.yaml` 和 `SKILL.md` 等 skill 文件。
- 如果纳入 sandbox，可写入 encrypted report artifact。

预期写入模式：

- 初始 sandbox：3-5 个 research assets，每个包含一个 release package 和一个或多个 Sui registration。
- 后续：围绕 asset revision、skill update 和 private report test 产生重复写入。
- 生产目标：当 researcher、agent 或 project 发布新版本时，形成 business-event-driven writes。

成功标准：

- 至少 3 个资产发布成功，并且 Walrus release manifest 可检索。
- 每个资产都有匹配的 Sui tx/object evidence 和 content/manifest hash verification。
- 至少一个资产发布 SkillAsset，并且能通过 object id 解析。
- 公开 Web app 只把 resolved assets 展示为正常资产。
- Unresolved anchors 只出现在 diagnostics 和 raw evidence links 中。
- CLI install path 文档清晰，并且可以通过链上 object id 工作。

停止条件：

- 发布后 Walrus blobs 无法可靠检索。
- Index 无法区分 verified assets 和 unresolved chain anchors。
- Content hash 或 manifest hash verification 失败。
- 产品必须依赖手工 fixture data 才看起来可用。
- Retention 要求无法在 sandbox 预算或工具范围内满足。

Developer GitHub：

https://github.com/Euraxluo

Repo：

https://github.com/Euraxluo/research-network

Contract address：

当前 Sui testnet package：

`0x5ecd097d8f13e995493d23c9b033c815bd6a8bf771331c389c027296e8b8231e`

Walrus designated address：

TBD。当前 testnet 记录中的 publisher address：

`0x8ac06d3d4328aff5bef88990741c1f620a96d5fc579bf2e459467763bd605788`

证据链接：

- Production app：https://research-network-web.vercel.app
- Main repo：https://github.com/Euraxluo/research-network
- Orbstack asset repo：https://github.com/Euraxluo/orbstack-loop-engine-research-asset
- Orbstack Walrus release blob：https://aggregator.walrus-testnet.walrus.space/v1/blobs/VldHk_w-YXXFKNukTgsrQ_JstLPc-HjwNzUJzSeag9w
- Orbstack ResearchAsset tx：https://suiscan.xyz/testnet/tx/GXmY76SAzmtFNQZEfo8WWtzjgVXRtnCHFTVBTVLEjTU5
- Orbstack ResearchAsset object：https://suiscan.xyz/testnet/object/0xc1f59ca4e632717a6de086e3c87f2237006aaffc64ede2e5a388ddd66586620f
- Orbstack SkillPublished tx：https://suiscan.xyz/testnet/tx/nwF5jbEJ76jRWsjJN7Mrzd1Mymyw5tb3WNmR7AUbp47
- Orbstack SkillAsset object：https://suiscan.xyz/testnet/object/0x2af18315d971e62988656a3ce0ffaac1fe597599390079536733ce23f2d257eb

Weekly tracking：

Week 1

进展：TBD。建议目标：发布 2 个新 research assets，并确保 live Walrus manifests 和 Sui objects 可用。

阻塞：TBD。

证据：TBD。

Week 2

进展：TBD。建议目标：发布至少一个 SkillAsset，并验证 CLI 可以通过 object id 安装。

阻塞：TBD。

证据：TBD。

Week 3

进展：TBD。建议目标：补充 retention/renewal monitoring、index backfill 和 error-state acceptance tests。

阻塞：TBD。

证据：TBD。

## 8. 证据

仓库和产品：

- Research Network repo：https://github.com/Euraxluo/research-network
- Production web app：https://research-network-web.vercel.app
- Walrus development design：`docs/05-walrus-development.md`
- Testnet deployment report：`docs/16-testnet-deployment.md`
- 当前 README：`README.md`

当前 Sui / Walrus testnet 证据：

- Current package id：`0x5ecd097d8f13e995493d23c9b033c815bd6a8bf771331c389c027296e8b8231e`
- Publisher address：`0x8ac06d3d4328aff5bef88990741c1f620a96d5fc579bf2e459467763bd605788`
- Orbstack asset repo：https://github.com/Euraxluo/orbstack-loop-engine-research-asset
- Orbstack repo commit：`98ab5507d757813d006116f0f01fb40896e37546`
- Walrus release blob：`VldHk_w-YXXFKNukTgsrQ_JstLPc-HjwNzUJzSeag9w`
- ResearchAsset tx：`GXmY76SAzmtFNQZEfo8WWtzjgVXRtnCHFTVBTVLEjTU5`
- ResearchAsset object：`0xc1f59ca4e632717a6de086e3c87f2237006aaffc64ede2e5a388ddd66586620f`
- SkillPublished tx：`nwF5jbEJ76jRWsjJN7Mrzd1Mymyw5tb3WNmR7AUbp47`
- SkillAsset object：`0x2af18315d971e62988656a3ce0ffaac1fe597599390079536733ce23f2d257eb`
- Walrus release 内原始 skill 内容路径：`skill/orbstack-loop-engine/SKILL.md`

重要说明：

部分历史 showcase blobs 曾经写入 Walrus testnet，但现在可能无法继续检索。除非 index 可以实时 fetch 并验证 manifest，否则它们应该被视为历史部署证据，而不是当前 live product data。

## 9. 最终评审备忘录

### 项目总结

Research Network 正在构建一个用于 verifiable research assets 的协议和产品层。核心思想是让研究可以同时被人类和 agent 消费：paper 可以阅读，skill 可以安装，workflow 可以 replay，release 可以验证，provenance 可以从 GitHub 追踪到 Walrus，再追踪到 Sui。

Walrus 在这个架构中不是装饰性组件。它是让 research release 和 encrypted report 成为 content-addressed、独立可验证 artifact 的存储层。Sui 负责 identity、ownership、registry events、receipts、access control hooks 和 settlement。

### Storage Need

Strong。

Research Network 需要 decentralized storage 来保存公开 research package、skills、渲染后的 papers、datasets 和 encrypted reports。如果没有 Walrus 或类似 decentralized storage layer，协议会退化成带链上 pointer 的 GitHub/Vercel 应用，而缺乏 durable large-content layer。

### Walrus Fit

Strong。

Walrus 适合 release-package 模型、content-hash verification 路径、大型 artifact 存储需求，以及 encrypted report 使用场景。它也强化了项目在 Sui 生态中的定位。

### Integration Result

选择：

Integrated & Writing Data on testnet。

Mainnet 状态：

Not started。

说明：

项目已经有真实 testnet 证据：Walrus release blobs、Sui ResearchAsset objects、SkillAsset objects、tx digests，以及可以 index 和渲染 verified assets 的 Vercel 产品。但生产 readiness 仍依赖 retention policy、persistent index operations、mainnet deployment、monitoring，以及超过单个 showcase 资产的重复写入证据。

### Usage Signal

One-off demo：

Yes。Orbstack Loop Engine 是一个具体的已发布 asset 和 skill。

Repeated writes：

Early / partial。存在多个历史 testnet assets，但部分旧 Walrus testnet blobs 可能无法解析。项目需要一次新的 sandbox run 来证明 repeated writes 和 retention checks。

Business-event-driven usage：

尚未证明。预期 business event 是发布或修订 research asset、发布 skill，或交付 private delegation report。

Retention evidence：

Partial。当前文档证明了 upload、read-back、certified epoch、tx/object evidence 和历史部署中的 hash verification。长期 retention 和 renewal 尚未证明。

### Grant Dependence

项目看起来不是单纯因为 grant 才对 Walrus 感兴趣，而是存在真实技术需求。Walrus 对产品结构本身有用。不过，grant 或生态支持会显著帮助 mainnet hardening、retention/renewal tooling、repeated write trial 和 public evidence quality。

### Final Classification

选择：

Sandbox Candidate。

补充标签：

Exploratory -> Integrated & Writing Data on testnet。

### Recommendation

Go for sandbox。

在 production grant 或 mainnet endorsement 之前，需要更多证据。

### Rationale

Research Network 是一个强 Walrus-fit 项目，因为它的核心产品需要为 research artifacts 和 agent skills 提供不可变、可验证的存储。当前仓库已经包含 CLI、Web、indexer、Move contracts、Walrus packaging 和 testnet deployment 等真实实现。

主要问题不是 Walrus 是否相关，而是项目能否持续提供生产级写入、检索、retention renewal 和 index correctness。Sandbox trial 应该重点验证 fresh repeated writes、live manifest retrieval、通过 SkillAsset object id 安装 skill、index persistence，以及对 unresolved blobs 的干净处理。

如果 sandbox 能产出重复 live write evidence，并且产品继续避免展示假数据或过期数据，Research Network 就应该被视为可信的 Walrus 生态集成候选项目。
