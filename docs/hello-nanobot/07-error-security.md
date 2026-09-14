---
title: "错误与安全：工作区边界、SSRF 与配对"
---
# 错误与安全：工作区边界、SSRF 与配对

> 基于 `sources/nanobot/nanobot/security/`、`sources/nanobot/nanobot/pairing/` 与 `sources/nanobot/nanobot/agent/runner.py` 中的 nanobot `v0.3.0` 源码校对。

**目录**

- [1. 安全模型概览](#1-安全模型概览)
- [2. 工作区边界](#2-工作区边界)
- [3. SSRF 防护](#3-ssrf-防护)
- [4. 渠道配对](#4-渠道配对)
- [5. 错误兜底策略](#5-错误兜底策略)

---

## 1. 安全模型概览

nanobot 是"个人助手"定位：默认信任本地用户，威胁模型集中在三处——agent 写文件不能越出工作区、agent 抓 URL 不能打到内网、聊天渠道接入要确认对端身份。对应 `security/` 两个模块加 `pairing/` 一个流程。

## 2. 工作区边界

`security/workspace_policy.py`：

- `resolve_path(path, workspace, strict=False)` 把工具传入的路径解析到工作区内；越界抛 `WorkspaceBoundaryError`（PermissionError 子类）；
- `is_path_within(path, root)` 与 `_path_key`（大小写/分隔符归一）做包含判定；
- `workspace_access.py` 把策略接到文件工具的读写路径上。

效果：模型给出的 `../../etc/passwd` 这类路径在工具层被拒，而不是依赖 prompt 约束。

## 3. SSRF 防护

`security/network.py` 为 web/search 工具提供出站防护：

- `resolve_url_target(url, allow_loopback=False)` 解析 URL 并做 DNS 解析，返回 (是否允许, 原因, 解析到的 IP 组)；`_is_private` 判定私网地址；
- `pin_resolved_url_dns` + `PinnedDNSAsyncTransport`：把已验证的解析结果**钉住**，防止 DNS rebinding（验证时解析到公网、连接时换成内网）；
- `configure_ssrf_whitelist(cidrs)` 由配置加载器 `_apply_ssrf_whitelist` 调用，放行指定网段；
- `contains_internal_url(command)` 扫描 shell 命令里的内网 URL；`httpx_env_proxy_mounts` / `env_proxy_applies_to_url` 处理代理环境变量与 no_proxy 匹配；
- 违规抛出 `UnsafeURLRequestError`（httpx.RequestError 子类）。

## 4. 渠道配对

`pairing/`（store.py + `__init__.py` 的 `handle_pairing_command`）实现聊天渠道的配对流程：陌生用户第一次触达时拿到配对码，本地用户经 `/pairing` 命令（`command/builtin.py` 的 `cmd_pairing`）确认后才建立会话信任。配对响应带 `PAIRING_COMMAND_META_KEY` 元数据标记，避免被当作普通回复广播。

## 5. 错误兜底策略

| 层 | 策略 |
| --- | --- |
| 模型调用失败 | runner 捕获后用 `error_message`（默认 "Sorry, I encountered an error calling the AI model."）兜底回复，`fail_on_tool_error` 控制工具错误是否中断回合 |
| 畸形 tool call | `_drop_malformed_tool_calls` + 纠正消息让模型重试，而不是整回合失败 |
| 工具名打错 | `ToolRegistry._suggest_name` 在错误结果里给纠错建议 |
| 会话文件损坏 | `SessionManager._repair` 截掉坏行重建 |
| provider 不稳定 | `fallback_provider.py` 与 `provider_retry_mode`（见 [16-resilience.md](./16-resilience.md)） |

## 源码锚点

- [`sources/nanobot/nanobot/security/workspace_policy.py`](../../sources/nanobot/nanobot/security/workspace_policy.py)：工作区边界
- [`sources/nanobot/nanobot/security/network.py`](../../sources/nanobot/nanobot/security/network.py)：SSRF 防护与 DNS 钉扎
- [`sources/nanobot/nanobot/pairing/`](../../sources/nanobot/nanobot/pairing)：渠道配对
- [`sources/nanobot/SECURITY.md`](../../sources/nanobot/SECURITY.md)：上游安全策略
