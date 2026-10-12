---
title: "错误与安全：单一信任边界、DM pairing 与不可信内容包裹"
---
# 错误与安全：单一信任边界、DM pairing 与不可信内容包裹

> 基于 `sources/openclaw/`（openclaw v2026.10.2，OpenClaw Foundation）源码校对。OpenClaw 是开源个人 AI 助理网关：常驻本机的 Gateway 是控制面，Control UI / CLI / TUI 与 20+ 消息通道都是它的客户端。

**目录**

- [1. 安全模型：一个 Gateway 一个信任边界](#1-安全模型一个-gateway-一个信任边界)
- [2. DM pairing：通道消息准入](#2-dm-pairing通道消息准入)
- [3. 不可信内容包裹](#3-不可信内容包裹)
- [4. 权限模式与 exec 审批](#4-权限模式与-exec-审批)
- [5. 安全审计与供应链](#5-安全审计与供应链)

---

## 1. 安全模型：一个 Gateway 一个信任边界

OpenClaw 的安全论述是 "trusted gateway, untrusted execution, deterministic policy"（README 的 [Why OpenClaw](https://docs.openclaw.ai/start/why-openclaw)），本地对应物在 `docs/gateway/security/trust-model.md`：**一个 Gateway 只支持一个信任边界**——单一 operator 或相互信任的团队；敌对用户共享一个 Gateway/agent 是明确不支持的，隔离要靠分开的 OS 用户/主机跑分开的 Gateway。威胁模型自述很坦率："Most failures here are not exotic exploits — they are 'someone messaged the bot and the bot did what they asked.'"，应对次序是 **Identity first → Scope next → Model last**：先决定谁能跟 bot 说话（DM pairing / allowlist），再决定 bot 能在哪里行动（工具、sandbox、设备权限），最后假设模型本身可被操纵、让操纵的爆炸半径有限。

几个容易误判的点文档直接列成了"不是漏洞"清单：`sessionKey` 是路由选择器不是授权 token；prompt-injection-only 链不构成 auth bypass；`tools.sessions.visibility` 默认 `all`、`tools.agentToAgent.enabled` 默认 `true` 是"一个信任边界"的自然推论，不是租户隔离缺陷。能改 `~/.openclaw`（含 `openclaw.json`）的人就是 trusted operator。

## 2. DM pairing：通道消息准入

通道消息视为不可信输入，DM 通道默认要求 pairing 审批。实现在 `src/pairing/`：

- `pairing-store.ts`（SQLite 持久化）：pairing code 长度 8、字母表 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`（去掉了易混淆字符），**pending 请求 TTL 1 小时、每 sender 至多 3 个**；`resolveChannelPairingRequestId()` 用 SHA-256 派生不暴露人类可读 code 的稳定 opaque id；
- `pairing-challenge.ts` 的 `issuePairingChallenge()` 是所有通道共享的 create-if-missing + 回复流：首次消息生成 code 并回复提示，`channel_pairing_requested` hook 异步通知、**不得延迟 code 回复**；
- 审批入口是 CLI 的 `openclaw pairing approve <channel> <code>`（`src/cli/pairing-cli.ts`）。

设备侧（macOS/iOS/Android node）是另一层 pairing：设备配对（role `node`，5 分钟过期）先闸 `connect` 握手，node capability 审批（`node.pair.*`）再决定已配对 node 能暴露哪些命令——pending capability 请求**不会**随时间过期，Gateway 是唯一事实源（`docs/gateway/pairing.md`）。

## 3. 不可信内容包裹

`src/security/external-content.ts` 处理"内容本身就是威胁面"：web fetch / 邮件 / webhook / browser / channel metadata 等外部内容进 prompt 前被包进包裹边界：

- 边界标记每次用 `randomBytes` 生成随机 ID，防止注入文本伪造自己的边界；
- 边界提示语刻意只声明 data/instruction 区分，不做动作清单——"action lists here made models refuse legitimate user requests"（源码注释）；
- **LLM 特殊 token 清除**：ChatML `<|im_start|>`、Llama `<|eot_id|>`、Mistral `[INST]`、Gemma `<start_of_turn>` 等全家族字面量（含 `<|reserved_special_token_\d+|>`）替换为 `[REMOVED_SPECIAL_TOKEN]`，且替换文本不会拼出新 token；
- **全角/异体括号折叠**：`MARKER_CHAR_FOLDS` 把 20 余种 Unicode 角括号（`〈`、`＜`、`❬`、`«` 等）折叠成 ASCII `<>` 再检测伪造的包裹标记；
- `detectSuspiciousPatterns()` 用 15 条正则识别 "ignore previous instructions" 类模式——**只记录不拦截**，内容仍被安全包裹后处理。

## 4. 权限模式与 exec 审批

session 级别的文件系统边界与 exec 升级审查由 permission mode 决定（`docs/gateway/permission-modes.md`）：

| Mode | 文件系统 | exec 升级审查者 |
| --- | --- | --- |
| `read-only` | 只读 `sessionRoot`，变更类工具被省略 | 无；exec 拒绝 |
| `guarded` | `sessionRoot` 内读写 | allowlist 快速通道后由**人**审查 |
| `workspace` | `sessionRoot` 内读写 | **LLM 审查**：allow / deny / ask a human |
| `full` | 不受限 | 无（需 `operator.admin`） |

配套规则：审批绑定的命令段可执行文件在 review 前解析、launch 前复检（受保护可执行文件用 real-path 身份，可写的还加内容哈希）；POSIX login/interactive shell wrapper 跳过 auto-review、必须人工审批；`workspace` 模式下 LLM 审查拒绝会把原因返回给 agent，且"must not work around the denial"，连续三次 gateway reviewer 拒绝升级为人工审批。沙箱是独立一维：未开沙箱时隐式 `host=auto` 落到 gateway host，显式 `host=sandbox` 在无沙箱运行时时 **fail closed**（`docs/gateway/security/prompt-injection.md`）。

## 5. 安全审计与供应链

- **`openclaw audit`**（`src/security/audit.ts`）是内置安全体检：聚合 gateway config、agent roster、exec/filesystem policy drift、plugin trust、MCP registry 等维度的 findings，输出 `SecurityAuditReport`；`dangerous-config-flags.ts` 会列出已启用的 insecure/dangerous 配置旗标（含插件 manifest contract 里的）用于审计与启动警告；
- `src/security/dm-policy-shared.ts` 把 DM/group 准入决策编码为稳定 reason code（`dm_policy_pairing_required`、`group_policy_not_allowlisted` 等），通道插件、command auth 与诊断共用一套判定语义；
- 供应链侧 `security/opengrep/precise.yml` 是随仓库发布的 OpenGrep 规则包（`scripts/run-opengrep.sh` 在 CI 与本地跑），每条规则带 source/provenance 元数据（`security/README.md`）；`src/security/secret-equal.ts`、`config-regex.ts`、`safe-regex.ts` 提供恒时比较与安全正则原语。威胁模型的总册在 `docs/security/THREAT-MODEL-ATLAS.md`，审计记录本身的设计见 [09-observability.md](./09-observability.md)。

## 源码锚点

- [`sources/openclaw/docs/gateway/security/trust-model.md`](../../sources/openclaw/docs/gateway/security/trust-model.md)：信任边界矩阵与"不是漏洞"清单
- [`sources/openclaw/src/pairing/pairing-store.ts`](../../sources/openclaw/src/pairing/pairing-store.ts)：pairing code 生成、TTL 与 opaque id
- [`sources/openclaw/src/pairing/pairing-challenge.ts`](../../sources/openclaw/src/pairing/pairing-challenge.ts)：统一 challenge 签发流
- [`sources/openclaw/src/security/external-content.ts`](../../sources/openclaw/src/security/external-content.ts)：不可信内容包裹、特殊 token 清除与全角折叠
- [`sources/openclaw/docs/gateway/permission-modes.md`](../../sources/openclaw/docs/gateway/permission-modes.md)：四种 session 权限模式
- [`sources/openclaw/src/security/audit.ts`](../../sources/openclaw/src/security/audit.ts)：`openclaw audit` 安全体检聚合
- [`sources/openclaw/security/opengrep/precise.yml`](../../sources/openclaw/security/opengrep/precise.yml)：随仓库发布的 OpenGrep 规则包
