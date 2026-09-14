---
title: "Prompt 系统：模板目录与 ContextBuilder"
---
# Prompt 系统：模板目录与 ContextBuilder

> 基于 `sources/nanobot/nanobot/agent/context.py` 与 `sources/nanobot/nanobot/templates/` 中的 nanobot `v0.3.0` 源码校对。

**目录**

- [1. 组装入口](#1-组装入口)
- [2. 模板目录](#2-模板目录)
- [3. 身份文件与 bootstrap](#3-身份文件与-bootstrap)
- [4. 动态上下文注入](#4-动态上下文注入)
- [5. 消息构建细节](#5-消息构建细节)

---

## 1. 组装入口

`agent/context.py` 的 `ContextBuilder` 在回合的 BUILD 状态工作：`build_system_prompt(...)` 拼系统提示，`build_messages(...)` 拼完整消息列表。构造参数是 `workspace`、`timezone`、`disabled_skills`——prompt 的全部可变性来自工作区文件与配置，没有硬编码的用户画像。

## 2. 模板目录

`nanobot/templates/` 是 prompt 的素材库（`templates/__init__.py` 提供加载）：

| 模板 | 用途 |
| --- | --- |
| `agent/identity.md` | 基础身份与人格 |
| `agent/tool_contract.md` | 工具使用契约 |
| `agent/platform_policy.md` | 平台策略 |
| `agent/skills_section.md` | skills 段落的包装 |
| `agent/subagent_system.md` / `subagent_announce.md` | 子代理系统提示与结果宣告 |
| `agent/dream.md` / `evaluator.md` / `consolidator_archive.md` | Dream 整合流程 |
| `agent/cron_reminder.md` / `goal_runtime.md` / `max_iterations_message.md` | 自动化提醒、goal 模式、迭代上限文案 |
| `agent/_snippets/untrusted_content.md` | 不可信内容包裹片段 |
| `AGENTS.md` / `SOUL.md` / `USER.md` / `HEARTBEAT.md` | 工作区身份文件的出厂模板 |
| `memory/MEMORY.md` | 长期记忆初始内容 |

## 3. 身份文件与 bootstrap

`BOOTSTRAP_FILES = ["AGENTS.md", "SOUL.md", "USER.md"]`：`_load_bootstrap_files` 从工作区读这三个文件拼进 system prompt——**用户直接改 Markdown 就改了 agent 的人格**，这是 nanobot "you can truly own" 的落地方式。`_is_template_content(content, template_path)` 检测文件是否还是未修改的出厂模板（未定制的模板内容可以走更轻的注入策略）。`_get_identity(channel, workspace)` 生成按渠道微调的身份段。

## 4. 动态上下文注入

两块动态内容进 system prompt：

- **Skills 摘要**：`SkillsLoader.build_skills_summary` 的输出（见 [13-skill-system.md](./13-skill-system.md)），`disabled_skills` 可禁用；
- **RuntimeContext**：实现 `RuntimeContextProvider` 的工具（`runtime_context.py` 的 `RuntimeContextBlock`、`append_runtime_context` / `resolve_runtime_context`）按块注入，可以标记进历史（`RUNTIME_CONTEXT_HISTORY_META`）或仅随消息（`RUNTIME_CONTEXT_MESSAGE_META`）。

## 5. 消息构建细节

`build_messages` 把 system prompt、会话历史、当前用户输入组装成 provider 消息列表；`_build_user_content(text, media)` 在有媒体时产出多模态 content blocks；`_merge_message_content` / `_to_blocks` 处理文本与块的合并。发给模型前整列再过 `ContextGovernor.prepare_for_model`（见 [08-performance.md](./08-performance.md) §3）。

## 源码锚点

- [`sources/nanobot/nanobot/agent/context.py`](../../sources/nanobot/nanobot/agent/context.py)：ContextBuilder
- [`sources/nanobot/nanobot/templates/`](../../sources/nanobot/nanobot/templates)：模板目录
- [`sources/nanobot/nanobot/runtime_context.py`](../../sources/nanobot/nanobot/runtime_context.py)：RuntimeContext 注入
