const phases = [
  ['注册、发现并注入代码审查 Skill', './phases/01-skill-code-review.ts'],
  ['验证本地 MCP 启动失败边界', './phases/02-mcp-client.ts'],
  ['检查 Webhook Host-plane 组合边界', './phases/03-webhook-runtime.ts'],
  ['装配动态 Cordis 扩展工具', './phases/04-cordis-extensions.ts'],
  ['配置 Webhook 所需默认模型路由', './phases/05-agent-default-model.ts'],
] as const

console.log('\n████ M10 · 外部能力接入：知识、协议、Webhook 与动态扩展 ████')
for (const [index, [title, path]] of phases.entries()) {
  console.log(`\n════════ M10.${index + 1} · ${title} ════════`)
  await import(path)
}
console.log('\n结论：Skill 是数据资产；MCP、Webhook 和 Cordis extensions 是显式 Host 能力，默认离线且依赖不完整时 fail loud。')
