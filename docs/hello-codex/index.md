---
layout: default
title: "OpenAI Codex 源码分析"
---

<section class="hero page-wrapper">
  <p class="hero-kicker">Source Code Analysis</p>
  <h1 class="hero-title">🔶 OpenAI Codex</h1>
  <p class="hero-subtitle">基于 Codex（Rust + TypeScript）rust-v0.141.0 源码的结构化深读</p>
  <div class="hero-badges">
    <span class="hero-badge"><span class="dot"></span>rust-v0.141.0</span>
  </div>
</section>

<div class="page-wrapper">
  <hr class="section-divider">
  <h2>01-08 核心主线</h2>
  <div class="chapter-grid">
    <a class="chapter-card" href="01-architecture"><div class="chapter-number">01</div><div class="chapter-title">架构全景：Crate/Package 拓扑、分层模型与核心抽象</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="02-startup-flow"><div class="chapter-number">02</div><div class="chapter-title">启动流程：入口点、CLI 参数解析、初始化顺序与子命令分发</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="03-agent-loop"><div class="chapter-number">03</div><div class="chapter-title">核心执行循环：Agent 决策链、Prompt 构建、LLM 调用与流式响应处理</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="04-state-session-memory"><div class="chapter-number">04</div><div class="chapter-title">状态、会话与记忆系统：Thread/Turn/ThreadItem、上下文管理与记忆管道</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="05-tool-system"><div class="chapter-number">05</div><div class="chapter-title">工具调用机制：工具注册、权限控制、执行闭环与结果回传</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="06-extension-mcp"><div class="chapter-number">06</div><div class="chapter-title">扩展系统：MCP、Plugin、Skill 与动态工具的接入方式</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="07-error-security"><div class="chapter-number">07</div><div class="chapter-title">错误处理与安全性：重试策略、沙箱隔离与敏感文件边界</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="08-performance"><div class="chapter-number">08</div><div class="chapter-title">性能与代码质量：流式渲染、持久化调优与维护成本评估</div><span class="chapter-arrow">&#8599;</span></a>
  </div>

  <h2>09-20 共享主题（与 Claude Code / Gemini CLI / OpenCode 对齐）</h2>
  <div class="chapter-grid">
    <a class="chapter-card" href="09-observability"><div class="chapter-number">09</div><div class="chapter-title">可观测性：日志、追踪与监控</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="10-session-resume"><div class="chapter-number">10</div><div class="chapter-title">配置、恢复与安全边界：config、resume/fork、approval 与 sandbox</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="11-prompt-system"><div class="chapter-number">11</div><div class="chapter-title">Prompt 系统：build_prompt()、AGENTS.md 与系统消息拼装</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="12-multi-agent"><div class="chapter-number">12</div><div class="chapter-title">多代理与并行：单代理架构与 child-agents 机制</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="13-skill-system"><div class="chapter-number">13</div><div class="chapter-title">Skill 系统：Codex 的能力扩展与自定义指令机制</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="14-plugin-system"><div class="chapter-number">14</div><div class="chapter-title">Plugin 系统：MCP 作为 Codex 的主要插件机制</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="15-sdk-transport"><div class="chapter-number">15</div><div class="chapter-title">宿主表面与传输层：app-server、remote websocket、SDK 与多宿主复用</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="16-resilience"><div class="chapter-number">16</div><div class="chapter-title">韧性机制：重试策略、错误归一化与 Sandbox 隔离</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="17-settings-config"><div class="chapter-number">17</div><div class="chapter-title">配置与设置：config.toml、环境变量与运行时策略</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="18-lsp-integration"><div class="chapter-number">18</div><div class="chapter-title">LSP 集成：代码语义理解的工具化路径</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="19-hooks-lifecycle"><div class="chapter-number">19</div><div class="chapter-title">Hooks 与生命周期：Codex 的事件拦截与扩展点</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="20-repl-and-state"><div class="chapter-number">20</div><div class="chapter-title">REPL 与交互层：TUI、非交互模式与输入分发</div><span class="chapter-arrow">&#8599;</span></a>
  </div>

  <h2>21-26 扩展专题</h2>
  <div class="chapter-grid">
    <a class="chapter-card" href="21-bridge-system"><div class="chapter-number">21</div><div class="chapter-title">宿主桥接：app-server 协议与多宿主复用</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="22-project-init-analysis"><div class="chapter-number">22</div><div class="chapter-title">项目初始化分析报告：面向首次进入仓库的总览版摘要</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="23-input-command-queue"><div class="chapter-number">23</div><div class="chapter-title">用户输入、命令解析与 Mailbox 队列系统</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="24-mcp-system"><div class="chapter-number">24</div><div class="chapter-title">Codex 的 MCP/RMCP 系统</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="25-debugging"><div class="chapter-number">25</div><div class="chapter-title">调试指南</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="26-ghost-snapshot"><div class="chapter-number">26</div><div class="chapter-title">GhostSnapshot：Git 快照、Undo 恢复与 Compaction 幸存机制</div><span class="chapter-arrow">&#8599;</span></a>
  </div>
</div>

<footer class="site-footer page-wrapper">
  <div class="footer-links">
    <a href="https://github.com/feuyeux/hello-olleh">GitHub</a>
    <a href="{{ '/' | relative_url }}">返回首页</a>
  </div>
</footer>
