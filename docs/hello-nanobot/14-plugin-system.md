---
title: "Plugin 系统：工具 entry points 与渠道包"
---
# Plugin 系统：工具 entry points 与渠道包

> 基于 `sources/nanobot/nanobot/agent/tools/loader.py` 与 `sources/nanobot/nanobot/channels/plugin.py` 中的 nanobot `v0.3.0` 源码校对。

**目录**

- [1. 插件模型](#1-插件模型)
- [2. 工具插件：nanobot.tools](#2-工具插件nanobottools)
- [3. 加载顺序与覆盖规则](#3-加载顺序与覆盖规则)
- [4. 渠道插件的转向](#4-渠道插件的转向)
- [5. 管理面](#5-管理面)

---

## 1. 插件模型

nanobot 的插件系统是刻意轻量的：没有插件运行时、没有生命周期回调、没有独立配置树。一个插件就是一个声明了 entry point 的 Python 包，被发现后走与内建组件完全相同的注册路径。插件分两类：工具插件（开放）与渠道插件（已收编为内置包）。

## 2. 工具插件：nanobot.tools

`ToolLoader._discover_plugins()`（loader.py）经 `importlib.metadata.entry_points(group="nanobot.tools")` 发现外部工具：

- entry point 加载出的必须是**非抽象 `Tool` 子类**；
- `_plugin_discoverable = False` 的类被跳过（类级开关）；
- 单个插件加载失败只记 `logger.exception`，不影响其他插件与内建工具。

第三方包在 `pyproject.toml` 声明 `[project.entry-points."nanobot.tools"]` 即完成接入，不需要 nanobot 侧任何改动。

## 3. 加载顺序与覆盖规则

`ToolLoader.load(ctx, registry, scope="core")` 的顺序：`discover()` 的内建类先注册（记入 `builtin_names`），`_discover_plugins()` 的插件类后注册。返回已注册名字列表；内建与插件同名时后者覆盖前者的行为由 `ToolRegistry.register` 的语义决定。测试可用 `ToolLoader(package=..., test_classes=[...])` 完全绕开发现机制。

## 4. 渠道插件的转向

渠道曾用 `nanobot.channels` entry-point 组开放扩展，v0.2.3 起废弃：`channels/registry.py` 的 `_warn_legacy_channel_entry_points()` 检测到该组的 entry point 时只告警"不再加载，请迁移为内置渠道包"。现行机制是 `channels/plugin.py` 的 `ChannelPlugin` + 自包含包（`channels/<name>/`），发现走 `pkgutil` 扫描本地包而非 entry points。上游理由：渠道需要安装引导、字段校验等 descriptor 元数据（`contracts.py`），自包含包比 entry point 更能承载。详见 [21-bridge-system.md](./21-bridge-system.md)。

## 5. 管理面

- `nanobot plugins ...` CLI 子树（commands.py L2579 起）提供插件检视/管理；
- `onboard` 的 `_onboard_plugins(config_path)` 在初始化时处理已安装插件的配置落位；
- 插件没有热重载：安装/卸载后需重启进程。

## 源码锚点

- [`sources/nanobot/nanobot/agent/tools/loader.py`](../../sources/nanobot/nanobot/agent/tools/loader.py)：工具插件发现与加载
- [`sources/nanobot/nanobot/channels/plugin.py`](../../sources/nanobot/nanobot/channels/plugin.py)：ChannelPlugin
- [`sources/nanobot/nanobot/channels/registry.py`](../../sources/nanobot/nanobot/channels/registry.py)：legacy entry-point 告警
