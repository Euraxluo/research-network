# 02. Research Asset Git 仓库标准

## 标准目录

```text
research-asset/
├── asset.yaml
├── README.md
├── LICENSE
├── paper/
│   ├── main.tex
│   ├── main.pdf
│   ├── references.bib
│   └── figures/
├── skill/
│   ├── <skill-name>/
│   │   ├── SKILL.md
│   │   ├── skill.yaml
│   │   ├── templates/
│   │   ├── examples/
│   │   └── tests/
├── vendor/
│   └── skills/
│       └── <external-skill>/
├── workflow/
│   ├── workflow.yaml
│   └── steps/
├── code/
│   ├── README.md
│   ├── src/
│   └── requirements.txt
├── data/
│   ├── README.md
│   └── metadata.yaml
├── experiments/
│   ├── README.md
│   ├── runs/
│   └── results.json
├── benchmark/
│   ├── benchmark.yaml
│   └── cases/
└── reviews/
    └── review.md
```

## 必须文件

- `asset.yaml`
- `README.md`
- `LICENSE`

如果声明 `types` 中包含 `paper`，必须有：

- `paper/main.pdf` 或 `paper/main.tex`
- `paper/references.bib`，如果有引用

如果声明 `types` 中包含 `skill`，必须有：

- `skill/<name>/SKILL.md`
- `skill/<name>/skill.yaml`

如果声明 `types` 中包含 `workflow`，必须有：

- `workflow/workflow.yaml`

## asset.yaml 示例

```yaml
schema: research-asset/v0.1
id: null
title: "Mathematical Modeling Coach for Emergency Logistics"
slug: "math-modeling-emergency-logistics"
version: "0.1.0"
types:
  - paper
  - skill
  - workflow
  - code

abstract: |
  This research asset contains a mathematical modeling solution, an executable workflow,
  and a reusable skill for emergency logistics network design.

tags:
  - mathematical-modeling
  - operations-research
  - logistics
  - optimization
  - mcm

categories:
  - cs.AI
  - math.OC
  - operations-research

authors:
  - name: "Euraxluo"
    type: human
    wallet: "0x..."
    github: "euraxluo"
  - name: "MathModelingAgent"
    type: agent
    agent_id: "agent:math-modeling-agent"
    passport: null

assets:
  paper:
    path: paper/main.pdf
    source: paper/main.tex
    bib: paper/references.bib
  skills:
    - name: math-modeling-coach
      path: skill/math-modeling-coach/
      relation: owned
  workflow:
    path: workflow/workflow.yaml
  code:
    path: code/
  data:
    path: data/
  experiments:
    path: experiments/

generated_by:
  agent: "agent:math-modeling-agent"
  skills:
    - name: math-modeling-coach
      version: "0.1.0"
  workflow: workflow/workflow.yaml
  models:
    - provider: anthropic/openai/google/local
      name: "model-name"
      role: planner

derived_from: []

references:
  papers: []
  skills: []
  datasets: []
  workflows: []

dependencies:
  skills: []
  datasets: []
  packages:
    python:
      - ortools
      - pandas
      - numpy

license:
  paper: CC-BY-4.0
  code: MIT
  skill: commercial-license
  workflow: commercial-license

commerce:
  purchasable: true
  price_policy:
    default_currency: USDC
    one_time_price: "49.00"
    subscription_price_monthly: "19.00"
  revenue_split:
    - recipient: "0x..."
      role: creator
      weight_bps: 7000
    - recipient: "treasury"
      role: protocol
      weight_bps: 2000
    - recipient: "rewards_pool"
      role: ecosystem
      weight_bps: 1000

publish:
  storage: walrus
  chain: sui
  visibility: public
  register_on_chain: true
```

## Skill 关系规则

### owned

仓库作者创建的新 Skill。

### forked

仓库作者修改了已有 Skill，必须声明来源。

### dependency

当前 Skill 依赖另一个 Skill，但没有复制其内容。

### referenced

研究过程中使用或引用了外部 Skill，但没有修改，也没有纳入仓库快照。

### vendored

把外部 Skill 的快照放进 `vendor/skills/`，用于可复现，但不声明为自己创建。

## 修改规则

- 未修改外部 Skill：`referenced` 或 `vendored`。
- 修改外部 Skill：`forked`。
- 新建 Skill：`owned`。
- 新 Skill 需要旧 Skill 能力：`dependency`。

## 发布包结构

```text
research-asset-release.tar.zst
├── manifest.json
├── asset.yaml
├── checksums.json
├── README.md
├── LICENSE
├── paper/
├── skill/
├── vendor/
├── workflow/
├── code/
├── data/
├── experiments/
├── benchmark/
└── reviews/
```
