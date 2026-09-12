---
layout: default
title: "Claude Code 源码分析"
---

<section class="hero page-wrapper">
  <p class="hero-kicker">Source Code Analysis</p>
  <h1 class="hero-title">🔷 Claude Code</h1>
  <p class="hero-subtitle">基于 Claude Code v2.1.87（反编译版）源码的深度解析</p>
  <div class="hero-badges">
    <span class="hero-badge"><span class="dot"></span>v2.1.87</span>
  </div>
</section>

<div class="page-wrapper">
  <hr class="section-divider">
  <h2>01-08 核心主线</h2>
  <div class="chapter-grid">
    <a class="chapter-card" href="01-architecture"><div class="chapter-number">01</div><div class="chapter-title">`src` 工程架构全景</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="02-startup-flow"><div class="chapter-number">02</div><div class="chapter-title">启动流程详解</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="03-agent-loop"><div class="chapter-number">03</div><div class="chapter-title">`query()` 主循环与请求构造</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="04-state-session-memory"><div class="chapter-number">04</div><div class="chapter-title">状态管理、会话与记忆系统</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="05-tool-system"><div class="chapter-number">05</div><div class="chapter-title">工具系统与权限机制</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="06-extension-mcp"><div class="chapter-number">06</div><div class="chapter-title">扩展体系：技能、插件与 MCP</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="07-error-security"><div class="chapter-number">07</div><div class="chapter-title">API Provider 选择、请求构造、重试与错误治理</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="08-performance"><div class="chapter-number">08</div><div class="chapter-title">性能、缓存与长会话稳定性专题</div><span class="chapter-arrow">&#8599;</span></a>
  </div>

  <h2>09-18 共享主题（与 Codex / Gemini CLI / OpenCode 对齐）</h2>
  <div class="chapter-grid">
    <a class="chapter-card" href="09-observability"><div class="chapter-number">09</div><div class="chapter-title">可观测性：日志、遥测与运行时状态追踪</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="10-session-resume"><div class="chapter-number">10</div><div class="chapter-title">Transcript 持久化、会话恢复与 `resume` 语义</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="11-prompt-system"><div class="chapter-number">11</div><div class="chapter-title">Claude Code 的提示词系统</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="12-multi-agent"><div class="chapter-number">12</div><div class="chapter-title">多代理、后台任务与远程会话</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="13-skill-system"><div class="chapter-number">13</div><div class="chapter-title">Skill 系统：Markdown 定义、命令总线注入与执行语义</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="14-plugin-system"><div class="chapter-number">14</div><div class="chapter-title">Plugin 系统：JS/TS 插件的加载、命令贡献与 Hooks 注册</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="15-sdk-transport"><div class="chapter-number">15</div><div class="chapter-title">Claude Code 的传输系统</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="16-resilience"><div class="chapter-number">16</div><div class="chapter-title">韧性机制：重试策略、Provider 故障转移与长会话稳定性</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="17-settings-config"><div class="chapter-number">17</div><div class="chapter-title">设置系统、托管策略与环境变量注入</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="18-lsp-integration"><div class="chapter-number">18</div><div class="chapter-title">LSP 集成：代码理解与符号定位</div><span class="chapter-arrow">&#8599;</span></a>
  </div>

  <h2>19-25 特色专题与附录</h2>
  <div class="chapter-grid">
    <a class="chapter-card" href="19-hooks-lifecycle"><div class="chapter-number">19</div><div class="chapter-title">Hooks 生命周期与运行时语义</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="20-repl-and-state"><div class="chapter-number">20</div><div class="chapter-title">REPL 与状态管理</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="21-bridge-system"><div class="chapter-number">21</div><div class="chapter-title">Claude Code 的桥接系统</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="22-project-init-analysis"><div class="chapter-number">22</div><div class="chapter-title">项目初始化分析报告：面向首次进入 Claude Code 仓库的总览</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="23-input-command-queue"><div class="chapter-number">23</div><div class="chapter-title">用户输入、Slash 命令与队列分发</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="24-mcp-system"><div class="chapter-number">24</div><div class="chapter-title">Claude Code 的 MCP 系统（深度专题）</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="24b-mcp-deep"><div class="chapter-number">24b</div><div class="chapter-title">MCP 补充：OAuth/XAA 认证、生命周期钩子与渠道权限</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="25b-growthbook"><div class="chapter-number">25b</div><div class="chapter-title">GrowthBook 远程配置门控：tengu_* feature flags 与三层覆盖机制</div><span class="chapter-arrow">&#8599;</span></a>
    <a class="chapter-card" href="25-debugging"><div class="chapter-number">25</div><div class="chapter-title">调试指南</div><span class="chapter-arrow">&#8599;</span></a>
  </div>
</div>

<footer class="site-footer page-wrapper">
  <div class="footer-links">
    <a href="https://github.com/feuyeux/hello-olleh">GitHub</a>
    <a href="{{ '/' | relative_url }}">返回首页</a>
  </div>
</footer>
