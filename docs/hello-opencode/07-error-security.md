---
title: "错误与安全：结构化错误、权限断言与 provider policy"
---
# 错误与安全：结构化错误、权限断言与 provider policy

> 基于 `sources/opencode/specs/v2/provider-policy.md`、`sources/opencode/packages/core/src/permission.ts` 与 `packages/server/` 中的 OpenCode `v2.0.2` 源码校对。

**目录**

- [1. 错误模型](#1-错误模型)
- [2. 权限：工具侧的断言路径](#2-权限工具侧的断言路径)
- [3. provider policy：独立于配置的授权](#3-provider-policy独立于配置的授权)
- [4. 事件流隔离](#4-事件流隔离)
- [5. 输入与路径安全](#5-输入与路径安全)
- [6. 高危开关](#6-高危开关)

---

## 1. 错误模型

v2 全面使用 Effect 的类型化错误通道：`Schema.TaggedError` 定义可序列化错误（如 MCP 的 `NeedsAuthError` / `ConnectError`、事件馈送的 `SubscriberOverflowError` / `EncodingError`、inbox 的 `SessionInbox.LifecycleConflict`），公共错误形状落在 `packages/schema`，传输错误归 `packages/protocol`。法则：

- 预期失败走类型化错误，最终翻译成模型可见或协议可见结果；
- **中断与 defect 不得被翻译成模型可见失败**（工具章 §6 同律）；
- Bus/projector 边界的非法 projection 以 defect 中止，不被业务错误吞没。

## 2. 权限：工具侧的断言路径

- 权限入口是 `packages/core/src/permission.ts`：`AssertInput` / `ReplyInput` 形状、`Source`（如 `{ type: "tool", messageID, callID }`）、持久化在 `permission/`（`saved.ts`、`sql.ts`）。
- 工具实现以 **durable 调用身份 + 具体资源** 发起 `PermissionV2.assert`；policy 评估与工具注册保持分离，registry 不注入权限助手。
- 工具响应里绝不回传原始 provider 输入，权限判定的 source 始终可追溯到 durable 的 Session/agent/message/call 四元组。

## 3. provider policy：独立于配置的授权

`specs/v2/provider-policy.md`（状态：Implemented）：

- **配置与授权分离**：`providers` 描述端点、选项与模型覆盖；`experimental.policies` 决定使用某 provider 的操作是否被允许。provider 可以配置正确、凭据有效，仍被 policy 拒绝。
- 语句形状：`{ effect: "allow" | "deny", action, resource }`；首个消费者是 `provider.use`（resource 为 provider ID）。
- 匹配用通配符，**无模式优先级**——书写的评估顺序决定结果，最后一个匹配获胜；评估从调用方的回退值开始（provider 使用默认为 allow）。
- 权威次序：authored policy 文档被反转以使**用户全局 policy 覆盖仓库 policy**；未来组织托管 policy 拥有最终权威。
- 非目标：policy 不配置端点/凭据/模型，不让不可用资源变可用，当前不提供条件、principal、批准提示；`plugin.load`、`mcp.connect` 等动作预留了词汇空间。

## 4. 事件流隔离

`specs/v2/event-stream-architecture.md`（状态：Accepted and implemented）：

- Server 对每个公共事件**只编码一次**，把共享不可变 SSE 帧非阻塞 offer 给每条连接的独立 `Queue.dropping`（容量 4 096 帧）。
- 溢出法则：某条连接的 offer 返回 false 时，该队列立即从活动订阅注册表移除、以 `SubscriberOverflowError` 失败，**同一帧仍投递给其它所有健康队列**，Core 发布与 Server 观察者绝不为慢连接挂起。
- 编码失败会终止当前订阅者以避免静默空洞，但馈送对后续连接保持可用。
- 该 endpoint 故意在 `LocationMiddleware` 之外：全局跨 Location 事件流是有意设计，TUI 用事件里的 location 元数据同时更新多个 Location 的状态，馈送不得新增请求级 Location 过滤。

## 5. 输入与路径安全

- skill 发现对路径段做严格校验（拒绝空段、`.`、`..`、分隔符、NUL、可解析为 URL 的值），并限制并发扫描。
- 配置发现只认 `opencode.json` / `opencode.jsonc` 与受信全局目录（`~/.config/opencode`、`~/.claude`、`~/.agents`），不信任任意路径。
- Server 侧有独立的 `auth.ts`、`cors.ts` 中间件层；MCP remote 连接的 OAuth 走 `mcp/oauth.ts`。

## 6. 高危开关

CLI 暴露两级权限旁路：`--auto`（自动批准未显式拒绝的权限）与 `--dangerously-skip-permissions` / 隐藏 flag `--yolo`（跳过权限确认）。它们只影响审批交互，不改变 durable 事件与 policy 评估的留痕。

## 源码锚点

- [`sources/opencode/specs/v2/provider-policy.md`](../../sources/opencode/specs/v2/provider-policy.md)：provider 授权决策记录
- [`sources/opencode/specs/v2/event-stream-architecture.md`](../../sources/opencode/specs/v2/event-stream-architecture.md)：事件流隔离决策记录
- [`sources/opencode/packages/core/src/permission.ts`](../../sources/opencode/packages/core/src/permission.ts) 与 [`permission/`](../../sources/opencode/packages/core/src/permission)：权限断言与持久化
- [`sources/opencode/packages/server/src/event-feed.ts`](../../sources/opencode/packages/server/src/event-feed.ts)：单编码馈送与溢出法则
- [`sources/opencode/packages/core/src/skill/discovery.ts`](../../sources/opencode/packages/core/src/skill/discovery.ts)：路径段校验
