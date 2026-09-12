---
layout: default
title: "Gemini CLI 源码分析"
---

<section class="hero page-wrapper">
  <p class="hero-kicker">Source Code Analysis</p>
  <h1 class="hero-title">🟡 Gemini CLI</h1>
  <p class="hero-subtitle">基于 Gemini CLI v0.47.0（TypeScript monorepo）源码的深度解析</p>
  <div class="hero-badges">
    <span class="hero-badge"><span class="dot"></span>v0.47.0</span>
  </div>
</section>

<div class="page-wrapper">
  <hr class="section-divider">
  <h2>01-08 核心主线</h2>
  <div class="chapter-grid">
    <a class="chapter-card" href="01-architecture"><div class="chapter-number">01</div><div class="chapter-title">架构全景：Gemini CLI 的分层模型与核心抽象</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="02-startup-flow"><div class="chapter-number">02</div><div class="chapter-title">启动链路：从入口到运行模式的分发</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="03-agent-loop"><div class="chapter-number">03</div><div class="chapter-title">核心执行循环：Agent 决策链与 LLM 调用</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="04-state-session-memory"><div class="chapter-number">04</div><div class="chapter-title">状态、会话与记忆：持久化、上下文管理与 Memory 系统</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="05-tool-system"><div class="chapter-number">05</div><div class="chapter-title">工具调用机制：Tool 注册、权限策略与执行闭环</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="06-extension-mcp"><div class="chapter-number">06</div><div class="chapter-title">扩展性：MCP 与扩展机制的加载与隔离</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="07-error-security"><div class="chapter-number">07</div><div class="chapter-title">错误处理与安全性：Agent 的自愈与边界防护</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="08-performance"><div class="chapter-number">08</div><div class="chapter-title">性能与代码质量：大仓库处理与架构评估</div><span class="chapter-arrow">&#8599;</span></a>
  </div>

  <h2>09-18 共享主题（与 Claude Code / Codex / OpenCode 对齐）</h2>
  <div class="chapter-grid">
    <a class="chapter-card" href="09-observability"><div class="chapter-number">09</div><div class="chapter-title">可观测性：日志、MessageBus 与 UI 状态追踪</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="10-session-resume"><div class="chapter-number">10</div><div class="chapter-title">会话恢复：Session 持久化与历史重建</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="11-prompt-system"><div class="chapter-number">11</div><div class="chapter-title">Prompt 系统：PromptProvider 与上下文组装</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="12-multi-agent"><div class="chapter-number">12</div><div class="chapter-title">多代理与远程：本地子代理、A2A 远程代理与调度器</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="13-skill-system"><div class="chapter-number">13</div><div class="chapter-title">Skill 系统：Markdown 定义与 Prompt 注入</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="14-plugin-system"><div class="chapter-number">14</div><div class="chapter-title">插件系统：MCP 集成与信任校验</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="15-sdk-transport"><div class="chapter-number">15</div><div class="chapter-title">SDK 与传输：GeminiClient 与 Headless 模式</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="16-resilience"><div class="chapter-number">16</div><div class="chapter-title">韧性机制：重试策略、错误归一化与自愈路径</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="17-settings-config"><div class="chapter-number">17</div><div class="chapter-title">配置与设置：环境变量、.gemini 目录与运行时策略</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="18-lsp-integration"><div class="chapter-number">18</div><div class="chapter-title">LSP 集成：代码理解能力的现状与设计取向</div><span class="chapter-arrow">&#8599;</span></a>
  </div>

  <h2>19-25 扩展专题</h2>
  <div class="chapter-grid">
    <a class="chapter-card" href="19-hooks-lifecycle"><div class="chapter-number">19</div><div class="chapter-title">Hooks 与生命周期：Gemini CLI 的事件回调与扩展点</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="20-repl-and-state"><div class="chapter-number">20</div><div class="chapter-title">REPL 与交互层：Ink TUI、非交互模式与输入分发</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="21-bridge-system"><div class="chapter-number">21</div><div class="chapter-title">桥接与集成：Gemini CLI 的 IDE 集成与外部系统接入</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="22-project-init-analysis"><div class="chapter-number">22</div><div class="chapter-title">项目初始化分析报告：面向首次进入 Gemini CLI 仓库的总览</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="23-input-command-queue"><div class="chapter-number">23</div><div class="chapter-title">用户输入、Slash 命令与队列分发</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="24-mcp-system"><div class="chapter-number">24</div><div class="chapter-title">Gemini CLI 的 MCP 系统</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="25-debugging"><div class="chapter-number">25</div><div class="chapter-title">调试指南</div><span class="chapter-arrow">&#8599;</span></a>
  </div>
</div>

<footer class="site-footer page-wrapper">
  <div class="footer-links">
    <a href="https://github.com/feuyeux/hello-olleh">GitHub</a>
    <a href="{{ '/' | relative_url }}">返回首页</a>
  </div>
</footer>
