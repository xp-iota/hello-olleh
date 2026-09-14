---
title: "Skill 系统：SKILL.md 与按需加载"
---
# Skill 系统：SKILL.md 与按需加载

> 基于 `sources/nanobot/nanobot/agent/skills.py` 与 `sources/nanobot/nanobot/skills/` 中的 nanobot `v0.3.0` 源码校对。

**目录**

- [1. Skill 是什么](#1-skill-是什么)
- [2. 发现与加载](#2-发现与加载)
- [3. 需求检查](#3-需求检查)
- [4. 内建 skills](#4-内建-skills)
- [5. 注入策略](#5-注入策略)

---

## 1. Skill 是什么

Skill 是一个含 `SKILL.md` 的目录：frontmatter 声明 `name` / `description` / `metadata.nanobot.requires`（如 `bins: ["curl"]`），正文是教 agent 完成某类任务的 Markdown 流程。它不注册工具、不改运行时——skill 是**纯 prompt 级扩展**，能力仍靠既有工具（shell、web 等）完成。

## 2. 发现与加载

`SkillsLoader`（`agent/skills.py`）：

- 两个来源：内建目录 `BUILTIN_SKILLS_DIR`（`nanobot/skills/`）与工作区 skills 目录；`_skill_entries_from_dir(base, source, skip_names=...)` 扫描各目录，`source` 标记出处；
- `load_skill(name)` 读全文；`load_skills_for_context(skill_names)` 拼注入文本；`_STRIP_SKILL_FRONTMATTER` 在注入前剥掉 frontmatter；
- `disabled_skills`（配置）可在构造时整体禁用。

## 3. 需求检查

`list_skills(filter_unavailable=True)` 默认只列需求满足的 skill：`_check_requirements(meta)` 校验 `requires`（如所需二进制是否存在），`_get_missing_requirements` 生成缺失说明，`get_skill_availability(name)` 返回 (可用, 原因)。不满足的 skill 不出现在摘要里——agent 不会尝试一条注定失败的流程。

## 4. 内建 skills

| Skill | 能力 |
| --- | --- |
| `weather` | wttr.in 天气查询（需 curl） |
| `github` | GitHub 操作 |
| `image-generation` | 图像生成流程 |
| `memory` / `my` | 记忆管理与个人资料 |
| `cron` | 定时任务管理 |
| `summarize` | 摘要流程 |
| `tmux` | tmux 会话操作 |
| `skill-creator` | 创建新 skill |
| `update-setup` | 安装与更新 |
| `clawhub` | skill 市场（clawhub）接入 |

## 5. 注入策略

`build_skills_summary(exclude=...)` 生成**摘要**进 system prompt（skills_section.md 包装）：agent 先知道"有哪些 skill、各自解决什么"，需要时再经 `load_skill` 把全文读进上下文——两层注入控制 prompt 体积。`/skill` 命令（`cmd_skill`）让用户在会话里显式加载/查看 skill。

## 源码锚点

- [`sources/nanobot/nanobot/agent/skills.py`](../../sources/nanobot/nanobot/agent/skills.py)：SkillsLoader
- [`sources/nanobot/nanobot/skills/`](../../sources/nanobot/nanobot/skills)：内建 skills
- [`sources/nanobot/nanobot/templates/agent/skills_section.md`](../../sources/nanobot/nanobot/templates/agent/skills_section.md)：摘要包装模板
