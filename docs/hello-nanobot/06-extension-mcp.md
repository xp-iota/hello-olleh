---
title: "扩展与 MCP：四类扩展面总览"
---
# 扩展与 MCP：四类扩展面总览

> 基于 `sources/nanobot/nanobot/agent/tools/mcp.py`、`sources/nanobot/nanobot/agent/tools/loader.py`、`sources/nanobot/nanobot/agent/skills.py` 与 `sources/nanobot/nanobot/channels/registry.py` 中的 nanobot `v0.3.0` 源码校对。

**目录**

- [1. 四类扩展面](#1-四类扩展面)
- [2. MCP：动态工具来源](#2-mcp动态工具来源)
- [3. Skill：prompt 级扩展](#3-skillprompt-级扩展)
- [4. 渠道包与工具插件](#4-渠道包与工具插件)
- [5. 扩展面选择建议](#5-扩展面选择建议)

---

## 1. 四类扩展面

| 扩展面 | 机制 | 扩展内容 | 深入章节 |
| --- | --- | --- | --- |
| MCP | `tools/mcp.py` 连接外部 MCP server | 工具 | [24-mcp-system.md](./24-mcp-system.md) |
| Skill | `agent/skills.py` 加载 Markdown 技能包 | prompt 知识与流程 | [13-skill-system.md](./13-skill-system.md) |
| 渠道包 | `channels/<name>/` 自包含包 | 聊天平台接入 | [21-bridge-system.md](./21-bridge-system.md) |
| 工具插件 | entry points 发现第三方 `Tool` 类 | 工具 | [14-plugin-system.md](./14-plugin-system.md) |

四类都没有独立运行时：扩展最终都变成"注册表里的一个工具"或"prompt 里的一段文本"，与内建能力同构。

## 2. MCP：动态工具来源

`AgentLoop._connect_mcp()` 在启动时读取配置的 MCP server 列表，`tools/mcp.py` 建立连接并把远端工具适配为本地 `Tool`（名字经 `_sanitize_mcp_tool_name` 清洗与 `_limit_tool_name` 截断，避免与内建冲突或超出 provider 限制）。连接级容错：`_is_transient` / `_is_session_terminated` 区分可重试错误与会话终结，`_filter_malformed_mcp_progress_notifications` 过滤畸形进度通知防止污染流。详见 [24-mcp-system.md](./24-mcp-system.md)。

## 3. Skill：prompt 级扩展

`agent/skills.py` 的 `SkillsLoader` 扫描技能目录（内建 `nanobot/skills/`：clawhub、cron、github、image-generation、memory、my、skill-creator、summarize、tmux、update-setup、weather），`load_skills_for_context` 把匹配的技能说明注入 system prompt，`build_skills_summary` 生成清单。技能可以声明依赖（requirements），不满足时跳过。详见 [13-skill-system.md](./13-skill-system.md)。

## 4. 渠道包与工具插件

- **渠道包**：`channels/registry.py` 用 `pkgutil.iter_modules` 发现 `nanobot/channels/` 下的自包含包（每个包声明 descriptor：字段、激活、setup），`load_channel_plugin(name)` 惰性加载运行时。旧版 `nanobot.channels` entry-point 组已废弃（`_warn_legacy_channel_entry_points` 仅告警不加载）。第三方渠道应以内置包形式合入，而非 pip 插件。
- **工具插件**：与渠道相反，工具走 entry points 开放扩展——`ToolLoader._discover_plugins()` 发现已安装包声明的 `Tool` 子类。`nanobot plugins ...` CLI 子树提供管理面。

## 5. 扩展面选择建议

| 需求 | 选哪个 |
| --- | --- |
| 接入已有 MCP server（文件系统、数据库等） | MCP 配置，零代码 |
| 给 agent 加领域流程/知识 | 写一个 skill 目录 |
| 接入新的聊天平台 | 新增 `channels/<name>/` 包 |
| 加确定性的本地能力（调本地 API、硬件） | entry point 工具插件 |

## 源码锚点

- [`sources/nanobot/nanobot/agent/tools/mcp.py`](../../sources/nanobot/nanobot/agent/tools/mcp.py)：MCP 适配
- [`sources/nanobot/nanobot/agent/skills.py`](../../sources/nanobot/nanobot/agent/skills.py)：SkillsLoader
- [`sources/nanobot/nanobot/channels/registry.py`](../../sources/nanobot/nanobot/channels/registry.py)：渠道发现
- [`sources/nanobot/docs/channel-package-guide.md`](../../sources/nanobot/docs/channel-package-guide.md)：渠道包开发指南
