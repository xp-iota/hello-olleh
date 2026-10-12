---
title: "Skill 系统：七级优先级、不可变修订与 Workshop"
---
# Skill 系统：七级优先级、不可变修订与 Workshop

> 基于 sources/openclaw/（openclaw v2026.10.2，OpenClaw Foundation）源码校对。skill 是教 agent 用工具的 `SKILL.md` 指令包：文件系统发现、ClawHub 安装、SQLite 修订库、Workshop 提案队列四条供给线汇入同一个按 agent 过滤的快照。

**目录**

- [1. SKILL.md 与七级优先级](#1-skillmd-与七级优先级)
- [2. 门控：inventory / readiness / visibility](#2-门控inventory--readiness--visibility)
- [3. 快照与刷新](#3-快照与刷新)
- [4. 个人技能库：不可变修订](#4-个人技能库不可变修订)
- [5. Workshop、ClawHub 与安全](#5-workshopclawhub-与安全)
- [6. 节点技能与沙箱同步](#6-节点技能与沙箱同步)

---

## 1. SKILL.md 与七级优先级

skill 遵循 [AgentSkills](https://agentskills.io) 规范：目录 + `SKILL.md`（YAML frontmatter 至少 `name`/`description`，body 用 `{baseDir}` 引用技能目录）。发现由 `src/skills/discovery/skill-index.ts` 完成：在任何配置根下最深 6 层找 `SKILL.md`，命中后停止向下遍历（支持分组布局），skill 名取自 frontmatter 而非目录名。加载优先级（`docs/tools/skills.md`）自高到低是 workspace `<workspace>/skills` → 项目 `<workspace>/.agents/skills` → 个人 `~/.agents/skills` → 受管 `<state-dir>/skills` → Workshop `<state-dir>/agents/<agentId>/agent/workshop-skills` → 内建（仓库根 `skills/` 共约 50 个，如 `coding-agent`、`weather`）与 Custodian 专属（`custodian-skills/` 4 个管理技能：`add-model-provider`、`cloud-image-bake`、`configure-channel`、`diagnose-gateway`，仅配置的 system/Custodian agent 可见）→ 最低为 `skills.load.extraDirs` 与插件技能。同名高优先级覆盖低优先级，覆盖产生 per-root 摘要与告警；插件技能（manifest `skills` 字段声明）也落在最低层。优先级是"位置"维度，与"可见性"维度正交——一个高优先级技能照样可能被 allowlist 拦在某个 agent 之外。

## 2. 门控：inventory / readiness / visibility

OpenClaw 把三个问题分开（`docs/tools/skills.md`）：**inventory**（是否被发现）、**readiness**（运行时能否满足声明的要求）、**visibility**（就绪的技能是否暴露给该 agent）。门控写在 frontmatter 的 `metadata.openclaw` 块（JSON5 嵌套，YAML 失败时回退单行解析）：`requires.bins`/`anyBins`（PATH 检查）、`requires.env`、`requires.config`（`openclaw.json` 路径真值）、`os` 硬平台过滤、`always` 跳过依赖检查。`requires.bins` 在**宿主**技能加载时检查；沙箱内运行还要求容器里有同一二进制。visibility 另受 agent allowlist 约束：`agents.entries.<id>.skills` 非空即为最终集合（不与 defaults 合并），`[]` 表示无技能；allowlist 贯穿 prompt 构建、slash 命令发现、沙箱同步与技能快照四条路径。`disable-model-invocation: true` 把技能藏出模型自选面，但授权的显式 `$skill-name` 引用（每条消息最多 8 个）仍可调用；`command-dispatch: tool` 让斜杠命令绕过模型直发工具。

配置层覆盖在 `skills.entries`：`enabled: false` 即便内建/已安装也禁用；`apiKey`（明文或 SecretRef）配合技能声明的 `primaryEnv` 注入凭据；`env` 只在进程未设该变量时注入；`config` 提供技能自定义配置。配套的诊断命令是 `openclaw skills check`——技能出现在配置里却不露面时，它逐项报告缺的工具、凭据或宿主能力。

## 3. 快照与刷新

技能清单在 **session 启动时快照**，之后仅在刷新触发时重算：watcher 检测到 `SKILL.md` 变化、Gateway 重启、新 eligible 节点接入、watch 容量耗尽后的下一回合等。watcher 事件 250 ms 去抖，只有 `SKILL.md` 的变更推进快照版本；辅助文件事件只作废沙箱副本。原生事件不可用时回退 30 秒轮询（`CHOKIDAR_INTERVAL` 可覆盖，下限 20 ms）；watcher 订阅按 agent×配置 workspace×执行 workspace 的组合保留最近 128 个，空闲一小时退役。命名事件提示仍即时触发刷新。Agent allowlist 变化会强制刷新快照以对齐可见技能。快照机制让技能面在 Gateway 常驻、技能树巨大的现实下保持可预期的稳定性。

watcher 自身可经 `skills.load` 配置：`extraDirs` 追加发现根、`allowSymlinkTargets` 显式信任某个 symlink 目标根（默认要求 skill root 的 realpath 留在配置根内）、`watch: true` 默认开启。这些键同时决定 inventory 的合法边界与沙箱物化的输入集。

## 4. 个人技能库：不可变修订

共享 Gateway 上，operator 可以拥有**个人技能库**而不必动所有人的 workspace 技能（`docs/tools/skills.md`）：从 Control UI 或 ZIP 创建技能，保存即发布一个**完整不可变修订**——`SKILL.md` 与全部支撑文件，修订 hash 覆盖路径、内容、大小、可执行位；改一个辅助脚本也产生新修订，重复保存是 no-op，过期编辑以冲突失败而非覆盖。库记录与修订元数据存在 `state/openclaw.sqlite`，bundle 存在 `skill-library/<skill-id>/revisions/<revision-hash>/`（上限 256 文件、单文件 1 MiB、总量 8 MiB）。session 选定技能后**钉住修订**——换人接管 session、Gateway 重启都不替换选择；新 session 最多选择 64 个启用库技能。实现集中在 `src/skills/library/`（`service.ts` 组装 store/selection/persistence worker，`selection.ts` 处理按身份+修订的选择）。库技能的优先级不走目录扫描，而是按身份注入。

## 5. Workshop、ClawHub 与安全

**Skill Workshop**（`src/skills/workshop/`）是 agent 与其 workshop-skills 目录之间的提案队列：agent 发现可复用工作时起草提案（`proposal-draft.ts`）而非直写 `SKILL.md`；每周 collection review 是唯一允许直接编辑 Workshop 目录内 `SKILL.md` 的例外回合（`experience-review-scheduler.ts`）。CLI 走 `openclaw skills workshop list/inspect/evaluate/apply`，评估可由插件 `skill_proposal_evaluate` hook 承接（见 [19-hooks-lifecycle.md](./19-hooks-lifecycle.md)）。**ClawHub** 安装（`src/skills/lifecycle/clawhub.ts` + `install.ts`）支持 `@owner/<slug>`、`skills-sh:`、`git:` 与本地目录源，追踪落在 `.clawhub/lock.json` 与每个技能的 `.clawhub/origin.json`；`openclaw skills verify` 校验 `clawhub.skill.verify.v1` 信任封套，扫描失败退出非零。安全姿态：第三方技能视为**不受信代码**——路径遏制要求 skill root 的 realpath 留在配置根内（除非 `allowSymlinkTargets`），`security.installPolicy` 可挂本地策略命令且 fail-closed，`skills.entries.*.env/apiKey` 的秘密只注入宿主进程的当次回合。插件技能与 ClawHub 共同构成低优先级的供给端，形态对比见 [14-plugin-system.md](./14-plugin-system.md)。

## 6. 节点技能与沙箱同步

两条跨主机通道补全了文件面：**节点技能**——接入的 headless node 把自己 `~/.openclaw/skills` 下的技能发布给 Gateway，出现在正常的 agent 技能列表里，断开即消失；本地/Gateway 同名技能保留原名，节点技能改用确定性的 node 前缀名，其文件与二进制留在节点上，执行要带 `exec host=node node=<node-id>`。**沙箱同步**——沙箱化运行读取物化副本而非宿主原始路径；当 session 的执行 workspace 不同于配置 workspace 时，OpenClaw 同时加载执行 workspace 的 `skills/` 与 `.agents/skills/`，它们整体排在 agent 目录之后，且受同一套快照刷新与沙箱同步约束。模型侧对 workspace 技能的读取走 `workspace-skill://` 位置，防止用相同 Gateway 路径把读取重定向到节点。

兼容性上 OpenClaw 刻意吸收相邻生态的技能格式：Codex 原生的 `$CODEX_HOME/skills` 不是 OpenClaw 技能根，但 `openclaw migrate plan codex` / `openclaw migrate codex` 可以盘点并拷入 OpenClaw workspace；`openclaw skills install skills-sh:owner/repo/slug` 直接消费 skills.sh 引用。仓库快照里的 `docs/tools/creating-skills.md` 给出从零创建一个 skill 的完整路径（含 `skill-creator` 内建技能辅助起草），`src/skills/workshop/skill-authoring-standards.ts` 则把写作标准固化为可测试的契约。

## 源码锚点

- [`sources/openclaw/src/skills/discovery/skill-index.ts`](../../sources/openclaw/src/skills/discovery/skill-index.ts)：技能发现与索引
- [`sources/openclaw/src/skills/discovery/filter.ts`](../../sources/openclaw/src/skills/discovery/filter.ts)：门控过滤（bins/env/config/os）
- [`sources/openclaw/src/skills/library/service.ts`](../../sources/openclaw/src/skills/library/service.ts)：个人技能库服务组装
- [`sources/openclaw/src/skills/library/selection.ts`](../../sources/openclaw/src/skills/library/selection.ts)：按身份+修订的会话选择
- [`sources/openclaw/src/skills/workshop/proposal-draft.ts`](../../sources/openclaw/src/skills/workshop/proposal-draft.ts)：Workshop 提案起草
- [`sources/openclaw/src/skills/workshop/experience-review-scheduler.ts`](../../sources/openclaw/src/skills/workshop/experience-review-scheduler.ts)：每周回顾调度
- [`sources/openclaw/src/skills/lifecycle/install.ts`](../../sources/openclaw/src/skills/lifecycle/install.ts)：安装管线
- [`sources/openclaw/src/skills/lifecycle/clawhub.ts`](../../sources/openclaw/src/skills/lifecycle/clawhub.ts)：ClawHub 生命周期门面
- [`sources/openclaw/skills/coding-agent/SKILL.md`](../../sources/openclaw/skills/coding-agent/SKILL.md)：内建技能实例
- [`sources/openclaw/custodian-skills/diagnose-gateway/SKILL.md`](../../sources/openclaw/custodian-skills/diagnose-gateway/SKILL.md)：Custodian 专属技能实例
- [`sources/openclaw/docs/tools/skills.md`](../../sources/openclaw/docs/tools/skills.md)：技能系统用户文档
