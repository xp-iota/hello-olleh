---
title: "配置系统：JSON5 单文件、严格校验与热重载"
---
# 配置系统：JSON5 单文件、严格校验与热重载

> 基于 `sources/openclaw/`（openclaw v2026.10.2，OpenClaw Foundation）源码校对。OpenClaw 是开源个人 AI 助理网关，配置围绕常驻本机的 Gateway 展开。

**目录**

- [1. 单文件与状态目录](#1-单文件与状态目录)
- [2. 两桶规则与 schema 驱动](#2-两桶规则与-schema-驱动)
- [3. 读写路径与防破坏写](#3-读写路径与防破坏写)
- [4. 热重载与恢复策略](#4-热重载与恢复策略)
- [5. onboard 向导与 daemon 安装](#5-onboard-向导与-daemon-安装)

---

## 1. 单文件与状态目录

全部配置是一个可选的 **JSON5** 文件 `~/.openclaw/openclaw.json`（注释、尾逗号合法），缺文件时走安全默认；路径可被 `OPENCLAW_STATE_DIR` / `OPENCLAW_CONFIG_PATH` 整体重定向（`src/config/paths.ts` 的 `resolveStateDir()` 与 `resolveConfigPath()`）。OpenClaw 自己的写入是**原子 rename 落位**，符号链接的 `openclaw.json` 会被当成普通文件替换目标——文档直接建议别用符号链接布局。校验是严格的：未知键、类型错误、非法值一律让 **Gateway 拒绝启动**，唯一根级豁免是 `$schema`（供编辑器挂 JSON Schema 元数据）；此时只允许诊断命令（`openclaw doctor` / `logs` / `health` / `status`）工作（`docs/gateway/configuration.md`）。

## 2. 两桶规则与 schema 驱动

配置分层遵循 **two-bucket rule**：根层兄弟键装基础设施与跨 agent 默认值，`agents.defaults` 装 agent 循环行为，`agents.entries.<id>` 在 schema 允许处覆盖两者。workspace 概念也落在这里（`agents.defaults.workspace`），是 [03-agent-loop.md](./03-agent-loop.md) 各 agent 的默认工作目录。schema 本身是一等公民：

- `openclaw config schema` 打印 Control UI 与校验共用的 live JSON Schema（含插件/通道运行时 schema 合并）；
- agent 改配置前被要求调 `config.schema.lookup` 取路径作用域的字段级文档（`docs/gateway/configuration-reference.md`），"Code truth beats this page"；
- 每个叶子带 `uiHints` 的 common/advanced 两档展示分层（默认 advanced），只影响呈现不影响校验与 reload。

## 3. 读写路径与防破坏写

`src/config/config.ts` 是 90 行的纯 re-export 门面，实体拆在 `io.ts`（快照/写回）、`mutate.ts`（变换式修改）、`config-write-guard.ts`、`env-substitution.ts` 等模块。几个值得注意的工程决定：

- **路径解析防原型污染**：`config-paths.ts` 的 `parseConfigPath()` 在 setter 之前就拒绝 `__proto__` 等危险对象键段；
- **环境变量替换是一等语法**：`${VAR}` / `${VAR:-fallback}` 占位符按 authoring order 保留、可写回不破坏原文，引用缺失时抛 `MissingEnvVarError`（`env-substitution.ts`）；秘密另有 secret refs 通道，见 `docs/gateway/config-secrets-env.md`；
- **写保护三件套**（`docs/gateway/configuration.md`）：看起来像"意外覆盖"的写（丢掉有效 `gateway.mode`、或文件缩小过半）默认拒绝，拒绝的 payload 存为 `<path>.rejected.<timestamp>` 供检查；每轮迁移写入前旧配置进 `.bak` ring；成功启动后提升 **last-known-good** 副本。Nix 托管的配置进入只读模式（`config-write-guard.ts` 的 `NixModeConfigMutationError`）。

## 4. 热重载与恢复策略

Gateway watch 配置文件并自动应用变更；**无效的热重载被跳过**，运行时继续用上一个接受的配置——启动迁移只在整份迁移后配置（含插件校验）通过时才落盘，与 `openclaw doctor --fix` 共用同一组确定性、无 prompt 的变换。恢复哲学是"保守"：last-known-good 不自动回滚（只有 `doctor --fix` 会用它），被拒绝的写入原样保留现场；含 `***` / `[redacted]` 之类脱敏占位符的候选**不会**被提升为 last-known-good。启动迁移/doctor 修复的每一步都进 config journal snapshot（`config-journal-snapshot.ts`），供审计与回看（见 [09-observability.md](./09-observability.md)）。

## 5. onboard 向导与 daemon 安装

`openclaw onboard` 是首次配置的交互向导（`src/wizard/setup.ts` 的 `runSetupWizard()`）：模型鉴权（`setup.model-auth.ts` + 推理验证 `setup.inference-verification.ts`）、workspace 选择与校验、插件能力 consent（`plugin-capability-consent.ts`）、telemetry 同意询问（`requestTelemetryConsent`）、从旧部署迁移导入（`setup.migration-*.ts` 的 detect → snapshot → import → promotion 流水线）。两个工程细节：

- **prompter 子进程化**：向导 UI 跑在独立 child process（`clack-prompter.ts` + `clack-prompter-process-driver.mjs`），主进程不被交互库阻塞；
- **daemon 安装**：`openclaw onboard --install-daemon` 在 Linux 上检测 systemd 可用后默认装 user 级 systemd 单元（`setup.finalize.ts`），macOS 走 launchd 对应路径——Gateway 的常驻属性由此从安装期固定下来。

## 源码锚点

- [`sources/openclaw/src/config/config.ts`](../../sources/openclaw/src/config/config.ts)：IO/mutation/validation 门面
- [`sources/openclaw/src/config/paths.ts`](../../sources/openclaw/src/config/paths.ts)：状态目录与配置文件路径解析
- [`sources/openclaw/src/config/config-paths.ts`](../../sources/openclaw/src/config/config-paths.ts)：dot-path 解析与原型键防护
- [`sources/openclaw/src/config/env-substitution.ts`](../../sources/openclaw/src/config/env-substitution.ts)：`${VAR}` 语法
- [`sources/openclaw/src/config/config-write-guard.ts`](../../sources/openclaw/src/config/config-write-guard.ts)：写模式守卫
- [`sources/openclaw/src/wizard/setup.ts`](../../sources/openclaw/src/wizard/setup.ts)：onboard 向导主流程
- [`sources/openclaw/docs/gateway/configuration.md`](../../sources/openclaw/docs/gateway/configuration.md)：配置总览与严格校验说明
